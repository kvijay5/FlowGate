import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, OutboxEvent } from '@prisma/client';

export interface CreateOutboxEventParams {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  scheduledFor?: Date;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an outbox event inside an existing Prisma transaction.
   * Guarantees atomic inclusion with the business domain operation.
   */
  async createEvent(
    tx: Prisma.TransactionClient,
    params: CreateOutboxEventParams,
  ): Promise<OutboxEvent> {
    return tx.outboxEvent.create({
      data: {
        tenantId: params.tenantId,
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId,
        payload: params.payload as unknown as Prisma.InputJsonValue,
        idempotencyKey: params.idempotencyKey,
        scheduledFor: params.scheduledFor || new Date(),
        status: 'PENDING',
      },
    });
  }

  /**
   * Concurrency-safe claiming of pending or stalled outbox events.
   * Uses PostgreSQL row locking with FOR UPDATE SKIP LOCKED inside an atomic transaction.
   * Guarantees multiple publisher instances cannot double-claim or block each other.
   * Also reclaims events stuck in 'PROCESSING' for > 60 seconds (crash recovery).
   */
  async claimPendingEvents(limit = 50): Promise<OutboxEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Select and lock eligible row IDs using SKIP LOCKED
      const claimed: Array<{ id: string }> = await tx.$queryRaw`
        SELECT id FROM outbox_events
        WHERE (
          (status = 'PENDING'::outbox_status AND scheduled_for <= NOW())
          OR (status = 'PROCESSING'::outbox_status AND updated_at <= NOW() - INTERVAL '60 seconds')
        )
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (!claimed || claimed.length === 0) {
        return [];
      }

      const ids = claimed.map((c) => c.id);

      // 2. Mark claimed rows as PROCESSING atomically
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PROCESSING',
          updatedAt: new Date(),
        },
      });

      // 3. Fetch full records
      return tx.outboxEvent.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  /**
   * Marks an outbox event as successfully PUBLISHED.
   */
  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        lastError: null,
      },
    });
  }

  /**
   * Handles publishing failures: applies exponential retry backoff
   * or transitions to FAILED if maximum retry limit is reached.
   */
  async markFailed(
    id: string,
    errorMessage: string,
    currentRetryCount: number,
    maxRetries = 5,
  ): Promise<void> {
    const isFinalFailure = currentRetryCount + 1 >= maxRetries;
    const nextRetryCount = currentRetryCount + 1;

    // Exponential backoff: 2s, 4s, 8s, 16s... capped at 60s
    const backoffSeconds = Math.min(60, Math.pow(2, nextRetryCount));
    const nextScheduledFor = new Date(Date.now() + backoffSeconds * 1000);

    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: isFinalFailure ? 'FAILED' : 'PENDING',
        retryCount: nextRetryCount,
        scheduledFor: isFinalFailure ? undefined : nextScheduledFor,
        lastError: errorMessage.substring(0, 2000),
      },
    });

    if (isFinalFailure) {
      this.logger.error(
        `Outbox event ${id} permanently FAILED after ${nextRetryCount} attempts: ${errorMessage}`,
      );
    } else {
      this.logger.warn(
        `Outbox event ${id} retry #${nextRetryCount} scheduled in ${backoffSeconds}s: ${errorMessage}`,
      );
    }
  }

  /**
   * Returns outbox processing statistics for monitoring & health checks.
   */
  async getStats(tenantId?: string) {
    const where: Prisma.OutboxEventWhereInput = tenantId ? { tenantId } : {};

    const [pending, processing, published, failed] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { ...where, status: 'PROCESSING' } }),
      this.prisma.outboxEvent.count({ where: { ...where, status: 'PUBLISHED' } }),
      this.prisma.outboxEvent.count({ where: { ...where, status: 'FAILED' } }),
    ]);

    return { pending, processing, published, failed };
  }
}

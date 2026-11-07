import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NOTIFICATIONS, JOB_SEND_NOTIFICATION } from '../queues/queue.constants';
import { Prisma } from '@prisma/client';
import { NotificationLogSummary, PaginatedResult, UserRole } from '@flowgate/shared-types';

export interface DispatchNotificationDto {
  tenantId: string;
  recipientEmail: string;
  recipientUserId?: string | null;
  eventType: string;
  subject: string;
  content: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notifQueue: Queue,
  ) {}

  /**
   * Dispatches a notification idempotently.
   * Creates a notification log record in PENDING state and enqueues a background BullMQ job.
   * If Redis is temporarily degraded, the record remains in DB and does not abort approval transactions.
   */
  async dispatchWorkflowNotification(dto: DispatchNotificationDto) {
    try {
      // 1. Upsert or find existing notification log record (idempotency guard)
      let record = await this.prisma.notificationLog.findUnique({
        where: {
          tenant_notification_idempotency_unique: {
            tenantId: dto.tenantId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });

      if (!record) {
        record = await this.prisma.notificationLog.create({
          data: {
            tenantId: dto.tenantId,
            recipientEmail: dto.recipientEmail,
            recipientUserId: dto.recipientUserId || null,
            channel: 'EMAIL',
            eventType: dto.eventType,
            subject: dto.subject,
            content: dto.content,
            metadata: (dto.metadata || {}) as Prisma.InputJsonValue,
            idempotencyKey: dto.idempotencyKey,
            status: 'PENDING',
          },
        });
      } else if (record.status === 'SENT') {
        this.logger.log(
          `Notification with idempotency key ${dto.idempotencyKey} already sent. Skipping duplicate enqueue.`,
        );
        return record;
      }

      // 2. Enqueue background processing job with deterministic jobId
      const jobId = `${dto.tenantId}__${dto.idempotencyKey}`.replace(/[:/]/g, '_');
      await this.notifQueue.add(
        JOB_SEND_NOTIFICATION,
        {
          tenantId: dto.tenantId,
          notificationId: record.id,
          idempotencyKey: dto.idempotencyKey,
        },
        {
          jobId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      );

      this.logger.log(
        `[NOTIF ENQUEUED] Tenant: ${dto.tenantId} | Event: ${dto.eventType} | To: ${dto.recipientEmail} | JobId: ${jobId}`,
      );

      return record;
    } catch (err: any) {
      // Never allow background notification failures to corrupt primary business transactions
      this.logger.error(
        `Failed to enqueue notification for ${dto.recipientEmail} (${dto.eventType}): ${err.message}`,
        err.stack,
      );
      return null;
    }
  }

  /**
   * Retrieves paginated notification history for a tenant, respecting user role context.
   */
  async findAll(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<NotificationLogSummary>> {
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationLogWhereInput = {
      tenantId,
    };

    // Ordinary requesters and approvers only see notifications directed to them
    if (userRole !== 'TENANT_ADMIN' && userRole !== 'SUPER_ADMIN') {
      where.recipientUserId = userId;
    }

    const [total, items] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        recipientEmail: item.recipientEmail,
        recipientUserId: item.recipientUserId,
        channel: item.channel,
        eventType: item.eventType,
        subject: item.subject,
        content: item.content,
        metadata: (item.metadata as Record<string, unknown>) || {},
        status: item.status,
        attemptCount: item.attemptCount,
        errorMessage: item.errorMessage,
        sentAt: item.sentAt ? item.sentAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Gets notification delivery statistics for a tenant.
   */
  async getStats(tenantId: string) {
    const [sent, pending, failed] = await Promise.all([
      this.prisma.notificationLog.count({ where: { tenantId, status: 'SENT' } }),
      this.prisma.notificationLog.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.notificationLog.count({ where: { tenantId, status: 'FAILED' } }),
    ]);

    return { sent, pending, failed, total: sent + pending + failed };
  }
}

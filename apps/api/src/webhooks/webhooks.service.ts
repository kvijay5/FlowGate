import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_WEBHOOKS, JOB_DISPATCH_WEBHOOK } from '../queues/queue.constants';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import {
  WebhookSubscriptionSummary,
  WebhookDeliverySummary,
  PaginatedResult,
} from '@flowgate/shared-types';
import { Prisma } from '@prisma/client';
import { validateWebhookDestination } from './ssrf/ssrf-guard';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly webhookQueue: Queue,
  ) {}

  /**
   * Validates a destination URL against SSRF policy.
   */
  private async validateUrl(url: string) {
    const allowInsecureHttp =
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_HTTP_WEBHOOKS === 'true';

    try {
      await validateWebhookDestination(url, { allowInsecureHttp });
    } catch (err: any) {
      throw new BadRequestException(
        `Webhook destination URL fails security policy: ${err.message}`,
      );
    }
  }

  /**
   * Creates a new tenant webhook subscription.
   * Generates a cryptographically strong HMAC-SHA256 secret.
   * Validates target URL against SSRF rules.
   * Note: The plaintext secret is ONLY returned in this response.
   */
  async create(tenantId: string, dto: CreateWebhookDto): Promise<WebhookSubscriptionSummary> {
    await this.validateUrl(dto.url);

    const rawSecret = `whsec_${randomBytes(24).toString('hex')}`;

    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        secret: rawSecret,
        eventTypes: dto.eventTypes as unknown as Prisma.InputJsonValue,
        status: 'ACTIVE',
      },
    });

    this.logger.log(
      `Created webhook subscription '${dto.name}' (${subscription.id}) for tenant: ${tenantId}`,
    );

    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      name: subscription.name,
      url: subscription.url,
      eventTypes: (subscription.eventTypes as string[]) || [],
      status: subscription.status,
      failureCount: subscription.failureCount,
      secret: rawSecret, // Returned exclusively on creation!
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  /**
   * Lists all webhook subscriptions for a tenant.
   * Masks secrets unconditionally.
   */
  async findAll(tenantId: string): Promise<WebhookSubscriptionSummary[]> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((s) => ({
      id: s.id,
      tenantId: s.tenantId,
      name: s.name,
      url: s.url,
      eventTypes: (s.eventTypes as string[]) || [],
      status: s.status,
      failureCount: s.failureCount,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  /**
   * Finds a specific webhook subscription by tenant ID and subscription ID.
   */
  async findOne(tenantId: string, id: string): Promise<WebhookSubscriptionSummary> {
    const s = await this.prisma.webhookSubscription.findUnique({
      where: {
        tenant_webhook_subscription_id_unique: {
          tenantId,
          id,
        },
      },
    });

    if (!s) {
      throw new NotFoundException(`Webhook subscription with id '${id}' not found`);
    }

    return {
      id: s.id,
      tenantId: s.tenantId,
      name: s.name,
      url: s.url,
      eventTypes: (s.eventTypes as string[]) || [],
      status: s.status,
      failureCount: s.failureCount,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /**
   * Updates an existing webhook subscription.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookSubscriptionSummary> {
    await this.findOne(tenantId, id);

    if (dto.url) {
      await this.validateUrl(dto.url);
    }

    const updated = await this.prisma.webhookSubscription.update({
      where: {
        tenant_webhook_subscription_id_unique: {
          tenantId,
          id,
        },
      },
      data: {
        name: dto.name,
        url: dto.url,
        eventTypes: dto.eventTypes
          ? (dto.eventTypes as unknown as Prisma.InputJsonValue)
          : undefined,
        status: dto.status,
      },
    });

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      name: updated.name,
      url: updated.url,
      eventTypes: (updated.eventTypes as string[]) || [],
      status: updated.status,
      failureCount: updated.failureCount,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Deletes a webhook subscription.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);

    await this.prisma.webhookSubscription.delete({
      where: {
        tenant_webhook_subscription_id_unique: {
          tenantId,
          id,
        },
      },
    });
  }

  /**
   * Triggers an outbound webhook event for matching active subscriptions.
   * Generates or preserves a stable logical event ID across retries.
   */
  async triggerEvent(
    tenantId: string,
    eventType: string,
    payload: Record<string, unknown>,
    explicitEventId?: string,
  ) {
    try {
      const subscriptions = await this.prisma.webhookSubscription.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
      });

      // Filter subscriptions that match this specific event type or wildcard '*'
      const matching = subscriptions.filter((s) => {
        const events = (s.eventTypes as string[]) || [];
        return events.includes(eventType) || events.includes('*');
      });

      if (matching.length === 0) return;

      const eventId =
        explicitEventId || (payload.eventId as string) || (payload.id as string) || randomUUID();
      const enrichedPayload = { ...payload, eventId };

      this.logger.log(
        `Triggering webhook event '${eventType}' (eventId: ${eventId}) for tenant: ${tenantId} across ${matching.length} endpoint(s)`,
      );

      for (const sub of matching) {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            tenantId,
            subscriptionId: sub.id,
            eventId,
            eventType,
            payload: enrichedPayload as unknown as Prisma.InputJsonValue,
            status: 'PENDING',
            maxAttempts: 3,
          },
        });

        const jobId = `tenant_${tenantId}_delivery_${delivery.id}`;
        await this.webhookQueue.add(
          JOB_DISPATCH_WEBHOOK,
          {
            tenantId,
            deliveryId: delivery.id,
          },
          {
            jobId,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1500,
            },
          },
        );
      }
    } catch (err: any) {
      this.logger.error(`Error triggering webhook event '${eventType}': ${err.message}`);
    }
  }

  /**
   * Retrieves paginated delivery history for a webhook subscription or tenant.
   */
  async findDeliveries(
    tenantId: string,
    subscriptionId?: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<WebhookDeliverySummary>> {
    const where: Prisma.WebhookDeliveryWhereInput = {
      tenantId,
      ...(subscriptionId ? { subscriptionId } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          subscription: {
            select: { name: true },
          },
        },
      }),
    ]);

    return {
      data: items.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        subscriptionId: d.subscriptionId,
        subscriptionName: d.subscription?.name,
        eventId: d.eventId,
        eventType: d.eventType,
        payload: (d.payload as Record<string, unknown>) || {},
        status: d.status,
        httpStatusCode: d.httpStatusCode,
        attemptCount: d.attemptCount,
        maxAttempts: d.maxAttempts,
        nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
        errorMessage: d.errorMessage,
        durationMs: d.durationMs,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Manually retries a failed webhook delivery.
   * Strictly preserves the original logical event ID (eventId).
   */
  async retryDelivery(tenantId: string, deliveryId: string): Promise<WebhookDeliverySummary> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: true },
    });

    if (!delivery || delivery.tenantId !== tenantId) {
      throw new NotFoundException(`Webhook delivery with id '${deliveryId}' not found`);
    }

    const updated = await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'PENDING',
        errorMessage: null,
      },
    });

    // Re-enqueue job while strictly maintaining the original eventId
    const retryJobId = `tenant_${tenantId}_delivery_${delivery.id}_retry_${Date.now()}`;
    await this.webhookQueue.add(
      JOB_DISPATCH_WEBHOOK,
      {
        tenantId,
        deliveryId: delivery.id,
      },
      {
        jobId: retryJobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      subscriptionId: updated.subscriptionId,
      subscriptionName: delivery.subscription?.name,
      eventId: updated.eventId,
      eventType: updated.eventType,
      payload: (updated.payload as Record<string, unknown>) || {},
      status: updated.status,
      httpStatusCode: updated.httpStatusCode,
      attemptCount: updated.attemptCount,
      maxAttempts: updated.maxAttempts,
      nextRetryAt: updated.nextRetryAt ? updated.nextRetryAt.toISOString() : null,
      errorMessage: updated.errorMessage,
      durationMs: updated.durationMs,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Dispatches a test ping event to verify webhook connectivity.
   * Validates destination URL against SSRF policy and assigns a stable event ID.
   */
  async testPing(tenantId: string, id: string) {
    const sub = await this.findOne(tenantId, id);

    // Revalidate destination before ping
    await this.validateUrl(sub.url);

    const eventId = randomUUID();
    const payload = {
      event: 'webhook.test_ping',
      eventId,
      tenantId,
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      timestamp: new Date().toISOString(),
      message: 'FlowGate test ping payload',
    };

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
        subscriptionId: sub.id,
        eventId,
        eventType: 'webhook.test_ping',
        payload: payload as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        maxAttempts: 3,
      },
    });

    const jobId = `tenant_${tenantId}_delivery_${delivery.id}`;
    await this.webhookQueue.add(
      JOB_DISPATCH_WEBHOOK,
      {
        tenantId,
        deliveryId: delivery.id,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    return {
      event: 'webhook.test_ping',
      eventId,
      message: 'Test ping queued for delivery',
    };
  }

  /**
   * Persistent Inbound Webhook Replay Deduplication.
   * Atomically records and verifies event IDs to prevent replay within or across timestamp windows.
   */
  async recordInboundEvent(
    tenantId: string,
    eventId: string,
    eventType: string,
    payloadSummary?: Record<string, unknown>,
    ttlSeconds = 600,
  ): Promise<{ isDuplicate: boolean; eventId: string; firstProcessedAt?: Date }> {
    const existing = await this.prisma.inboundWebhookEvent.findUnique({
      where: {
        tenantId_eventId: {
          tenantId,
          eventId,
        },
      },
    });

    if (existing) {
      return {
        isDuplicate: true,
        eventId,
        firstProcessedAt: existing.processedAt,
      };
    }

    try {
      const created = await this.prisma.inboundWebhookEvent.create({
        data: {
          tenantId,
          eventId,
          eventType,
          source: 'EXTERNAL',
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          payloadSummary: (payloadSummary || {}) as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        isDuplicate: false,
        eventId: created.eventId,
      };
    } catch (err: any) {
      // Concurrency protection: if unique constraint race happens
      if (err.code === 'P2002') {
        const found = await this.prisma.inboundWebhookEvent.findUnique({
          where: {
            tenantId_eventId: {
              tenantId,
              eventId,
            },
          },
        });
        return {
          isDuplicate: true,
          eventId,
          firstProcessedAt: found?.processedAt,
        };
      }
      throw err;
    }
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
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

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly webhookQueue: Queue,
  ) {}

  /**
   * Creates a new tenant webhook subscription.
   * Generates a cryptographically strong HMAC-SHA256 secret.
   * Note: The plaintext secret is ONLY returned in this response.
   */
  async create(tenantId: string, dto: CreateWebhookDto): Promise<WebhookSubscriptionSummary> {
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
   * Masks/omits secrets to ensure confidentiality.
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
   * Retrieves a single subscription. Masks secret.
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
   * Asynchronously dispatches deliveries using BullMQ background queue.
   */
  async triggerEvent(tenantId: string, eventType: string, payload: Record<string, unknown>) {
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

      this.logger.log(
        `Triggering webhook event '${eventType}' for tenant: ${tenantId} across ${matching.length} endpoint(s)`,
      );

      for (const sub of matching) {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            tenantId,
            subscriptionId: sub.id,
            eventType,
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
    const skip = (page - 1) * limit;

    const where: Prisma.WebhookDeliveryWhereInput = {
      tenantId,
    };

    if (subscriptionId) {
      where.subscriptionId = subscriptionId;
    }

    const [total, items] = await Promise.all([
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.findMany({
        where,
        include: {
          subscription: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        subscriptionId: d.subscriptionId,
        subscriptionName: d.subscription?.name,
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

    // Re-enqueue job
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
   */
  async testPing(tenantId: string, id: string) {
    const sub = await this.findOne(tenantId, id);

    const payload = {
      event: 'webhook.test_ping',
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

    return { event: 'webhook.test_ping', message: 'Test ping queued for delivery' };
  }
}

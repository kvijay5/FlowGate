import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_WEBHOOKS, JOB_DISPATCH_WEBHOOK } from '../queues/queue.constants';
import { signWebhookPayload } from './webhook-signature.util';
import { executeSafeWebhookRequest } from './ssrf/ssrf-guard';

export interface WebhookJobData {
  tenantId: string;
  deliveryId: string;
}

@Processor(QUEUE_WEBHOOKS, { concurrency: 5 })
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<WebhookJobData, any, string>): Promise<any> {
    if (job.name !== JOB_DISPATCH_WEBHOOK) {
      this.logger.warn(`Unknown job name on webhooks queue: ${job.name}`);
      return;
    }

    const { deliveryId } = job.data;
    const startTime = Date.now();

    // 1. Fetch delivery record with its parent subscription
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: true },
    });

    if (!delivery) {
      this.logger.warn(`Webhook delivery ${deliveryId} not found. Skipping.`);
      return { skipped: true, reason: 'Delivery record not found' };
    }

    if (delivery.status === 'SENT') {
      this.logger.log(
        `Webhook delivery ${deliveryId} is already marked SENT. Skipping duplicate execution.`,
      );
      return { skipped: true, reason: 'Already delivered' };
    }

    if (delivery.subscription.status !== 'ACTIVE') {
      this.logger.log(
        `Webhook subscription ${delivery.subscriptionId} is not active (${delivery.subscription.status}). Skipping.`,
      );
      return { skipped: true, reason: 'Subscription inactive' };
    }

    const rawPayload = JSON.stringify(delivery.payload);
    const { header, timestamp } = signWebhookPayload(rawPayload, delivery.subscription.secret);

    // Explicit security headers: stable event ID across retries + attempt ID
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'FlowGate-Webhook-Dispatcher/1.0',
      'X-FlowGate-Signature': header,
      'X-FlowGate-Timestamp': timestamp.toString(),
      'X-FlowGate-Event-Id': delivery.eventId,
      'X-FlowGate-Delivery-Id': delivery.id,
      'X-FlowGate-Attempt': (job.attemptsMade + 1).toString(),
      'X-FlowGate-Event-Type': delivery.eventType,
    };

    let httpStatusCode: number | null = null;
    let responseBody = '';
    let errorMessage: string | null = null;
    let isSuccess = false;

    try {
      this.logger.log(
        `[WEBHOOK POST] Attempt #${job.attemptsMade + 1} to ${delivery.subscription.url} for event: ${delivery.eventType} (eventId: ${delivery.eventId})`,
      );

      const allowInsecureHttp =
        process.env.NODE_ENV !== 'production' &&
        process.env.ALLOW_INSECURE_HTTP_WEBHOOKS === 'true';

      const res = await executeSafeWebhookRequest({
        url: delivery.subscription.url,
        method: 'POST',
        headers,
        body: rawPayload,
        timeoutMs: 5000,
        connectTimeoutMs: 3000,
        maxResponseBytes: 65536,
        maxRedirects: 3,
        allowInsecureHttp,
      });

      httpStatusCode = res.statusCode;
      responseBody = res.body.substring(0, 1000);
      isSuccess = res.statusCode >= 200 && res.statusCode < 300;

      if (!isSuccess) {
        errorMessage = `Destination returned HTTP ${res.statusCode}: ${res.statusMessage || responseBody.substring(0, 200)}`;
      }
    } catch (err: any) {
      errorMessage = err.message;
      this.logger.warn(`Webhook delivery to ${delivery.subscription.url} failed: ${errorMessage}`);
    }

    const durationMs = Date.now() - startTime;
    const maxAttempts = delivery.maxAttempts || 3;
    const isFinalAttempt = isSuccess || job.attemptsMade + 1 >= maxAttempts;
    const newStatus = isSuccess ? 'SENT' : isFinalAttempt ? 'FAILED' : 'PENDING';

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: newStatus,
        httpStatusCode,
        attemptCount: { increment: 1 },
        requestHeaders: headers,
        responseBody: responseBody || null,
        errorMessage: errorMessage || null,
        durationMs,
      },
    });

    if (isSuccess) {
      this.logger.log(
        `[WEBHOOK SUCCESS] Delivery ${delivery.id} (eventId: ${delivery.eventId}) succeeded (HTTP ${httpStatusCode}) in ${durationMs}ms`,
      );
      return { success: true, statusCode: httpStatusCode, durationMs };
    }

    // Update failure count on subscription
    await this.prisma.webhookSubscription.update({
      where: { id: delivery.subscription.id },
      data: { failureCount: { increment: 1 } },
    });

    // Throw error to trigger BullMQ exponential backoff retry if not final attempt
    if (!isFinalAttempt) {
      throw new Error(`Webhook dispatch failed: ${errorMessage}`);
    }

    return { success: false, statusCode: httpStatusCode, error: errorMessage };
  }
}

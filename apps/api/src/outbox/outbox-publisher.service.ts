import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationsService } from '../escalations/escalations.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { OutboxEvent } from '@prisma/client';
import {
  OUTBOX_EVENT_NOTIFICATION,
  OUTBOX_EVENT_WEBHOOK,
  OUTBOX_EVENT_ESCALATION_SCHEDULE,
  OUTBOX_EVENT_ESCALATION_CANCEL,
} from './outbox.constants';

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly notificationsService: NotificationsService,
    private readonly escalationsService: EscalationsService,
    private readonly webhooksService: WebhooksService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting Outbox Publisher background scheduler...');
    // Initial recovery sweep to claim any pending or stalled events from restarts
    this.trigger();

    // Regular polling interval (every 1000ms)
    this.timer = setInterval(() => {
      this.trigger();
    }, 1000);
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Outbox Publisher stopped cleanly.');
  }

  /**
   * Triggers an immediate publishing sweep (e.g. called right after a business tx commits).
   */
  trigger() {
    if (this.isProcessing) return;
    this.processBatch().catch((err) => {
      this.logger.error(`Outbox batch publishing error: ${err.message}`, err.stack);
    });
  }

  /**
   * Claims and publishes a batch of pending events using safe row-locking semantics.
   */
  async processBatch(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const events = await this.outboxService.claimPendingEvents(50);
      if (events.length === 0) {
        return 0;
      }

      this.logger.debug(`Claimed ${events.length} outbox event(s) for publishing.`);

      for (const event of events) {
        await this.publishSingleEvent(event);
      }

      return events.length;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Publishes a single outbox event to the appropriate BullMQ queue or service.
   * On queue publication success -> marks PUBLISHED.
   * On failure -> applies exponential backoff or marks FAILED.
   */
  private async publishSingleEvent(event: OutboxEvent): Promise<void> {
    try {
      const payload = event.payload as Record<string, any>;

      switch (event.eventType) {
        case OUTBOX_EVENT_NOTIFICATION: {
          await this.notificationsService.dispatchWorkflowNotification({
            tenantId: event.tenantId,
            recipientEmail: payload.recipientEmail,
            recipientUserId: payload.recipientUserId,
            eventType: payload.eventType,
            subject: payload.subject,
            content: payload.content,
            metadata: payload.metadata,
            idempotencyKey: payload.idempotencyKey || `notif_${event.id}`,
          });
          break;
        }

        case OUTBOX_EVENT_WEBHOOK: {
          await this.webhooksService.triggerEvent(
            event.tenantId,
            payload.eventType,
            payload.data || {},
            event.id, // Use stable outbox event ID as logical eventId
          );
          break;
        }

        case OUTBOX_EVENT_ESCALATION_SCHEDULE: {
          await this.escalationsService.scheduleStepJobs({
            tenantId: event.tenantId,
            approvalRequestId: payload.approvalRequestId,
            stepId: payload.stepId,
            stepOrder: payload.stepOrder,
            config: payload.config,
          });
          break;
        }

        case OUTBOX_EVENT_ESCALATION_CANCEL: {
          await this.escalationsService.cancelStepJobs(event.tenantId, payload.stepId);
          break;
        }

        default:
          this.logger.warn(`Unrecognized outbox event type: ${event.eventType}. Skipping.`);
      }

      // Mark event as PUBLISHED only after successful queue publication
      await this.outboxService.markPublished(event.id);
    } catch (err: any) {
      this.logger.error(
        `Failed to publish outbox event ${event.id} (${event.eventType}): ${err.message}`,
      );
      await this.outboxService.markFailed(
        event.id,
        err.message,
        event.retryCount,
        event.maxRetries,
      );
    }
  }
}

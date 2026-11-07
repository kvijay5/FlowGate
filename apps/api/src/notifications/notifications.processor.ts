import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NOTIFICATIONS, JOB_SEND_NOTIFICATION } from '../queues/queue.constants';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';

export interface NotificationJobData {
  tenantId: string;
  notificationId: string;
  idempotencyKey: string;
}

@Processor(QUEUE_NOTIFICATIONS, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData, any, string>): Promise<any> {
    if (job.name !== JOB_SEND_NOTIFICATION) {
      this.logger.warn(`Unknown job name on notifications queue: ${job.name}`);
      return;
    }

    const { tenantId, notificationId, idempotencyKey } = job.data;
    this.logger.log(
      `Processing notification job [${job.id}] for tenant: ${tenantId}, notif: ${notificationId}, attempt: ${job.attemptsMade + 1}`,
    );

    // 1. Re-check notification record in database
    const record = await this.prisma.notificationLog.findUnique({
      where: {
        tenant_notification_idempotency_unique: {
          tenantId,
          idempotencyKey,
        },
      },
    });

    if (!record) {
      this.logger.warn(`Notification record ${notificationId} not found. Skipping.`);
      return { skipped: true, reason: 'Record not found' };
    }

    // 2. Idempotency guard: if already delivered, do not send duplicate
    if (record.status === 'SENT') {
      this.logger.log(`Notification ${notificationId} already delivered. Skipping duplicate.`);
      return { skipped: true, reason: 'Already delivered' };
    }

    // 3. Dispatch via email provider
    const result = await this.emailProvider.sendEmail({
      to: record.recipientEmail,
      subject: record.subject,
      text: record.content,
      metadata: (record.metadata as Record<string, unknown>) || {},
    });

    if (result.success) {
      await this.prisma.notificationLog.update({
        where: { id: record.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attemptCount: { increment: 1 },
          errorMessage: null,
        },
      });

      this.logger.log(
        `Notification ${notificationId} delivered successfully to ${record.recipientEmail}`,
      );
      return { success: true, messageId: result.messageId };
    }

    // 4. Handle delivery failure and record attempt details
    const maxAttempts = job.opts.attempts || 3;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    await this.prisma.notificationLog.update({
      where: { id: record.id },
      data: {
        status: isFinalAttempt ? 'FAILED' : 'PENDING',
        attemptCount: { increment: 1 },
        errorMessage: result.error || 'Delivery failed',
      },
    });

    this.logger.error(
      `Notification ${notificationId} failed delivery (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${result.error}`,
    );

    // Throw error so BullMQ invokes configured backoff and retry policy
    throw new Error(`Email delivery failed: ${result.error}`);
  }
}

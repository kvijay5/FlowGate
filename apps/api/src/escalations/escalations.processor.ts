import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  QUEUE_ESCALATIONS,
  JOB_CHECK_REMINDER,
  JOB_PROCESS_ESCALATION,
} from '../queues/queue.constants';
import { UserRole } from '@flowgate/shared-types';

export interface StepJobData {
  tenantId: string;
  approvalRequestId: string;
  stepId: string;
  stepOrder: number;
  reminderSeq?: number;
  escalateToRole?: UserRole;
  escalateToUserId?: string;
  escalationReason?: string;
}

@Processor(QUEUE_ESCALATIONS, { concurrency: 5 })
export class EscalationsProcessor extends WorkerHost {
  private readonly logger = new Logger(EscalationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<StepJobData, any, string>): Promise<any> {
    switch (job.name) {
      case JOB_CHECK_REMINDER:
        return this.handleStepReminder(job);
      case JOB_PROCESS_ESCALATION:
        return this.handleStepEscalation(job);
      default:
        this.logger.warn(`Unknown job name on escalations queue: ${job.name}`);
        return;
    }
  }

  /**
   * Processes a delayed approval reminder.
   * Re-checks database state; if step is already approved/rejected, exits silently as a no-op.
   */
  private async handleStepReminder(job: Job<StepJobData>): Promise<any> {
    const { tenantId, approvalRequestId, stepId, stepOrder, reminderSeq } = job.data;
    this.logger.log(
      `Checking approval reminder for tenant: ${tenantId}, request: ${approvalRequestId}, step #${stepOrder}`,
    );

    // 1. Re-check state from database
    const step = await this.prisma.approvalStep.findFirst({
      where: {
        id: stepId,
        tenantId,
        approvalRequestId,
      },
      include: {
        assignedTo: true,
        approvalRequest: true,
      },
    });

    if (!step) {
      this.logger.warn(`Step ${stepId} not found. Skipping reminder.`);
      return { skipped: true, reason: 'Step not found' };
    }

    // 2. State Invariant: only trigger reminder if step is still actively IN_REVIEW
    if (step.status !== 'IN_REVIEW') {
      this.logger.log(
        `Step ${stepId} status is '${step.status}' (not IN_REVIEW). Suppressing reminder.`,
      );
      return { skipped: true, reason: `Step status is ${step.status}` };
    }

    // Also verify request itself is not cancelled or finalized
    if (
      step.approvalRequest.status === 'APPROVED' ||
      step.approvalRequest.status === 'REJECTED' ||
      step.approvalRequest.status === 'CANCELLED'
    ) {
      this.logger.log(
        `Approval request is '${step.approvalRequest.status}'. Suppressing reminder.`,
      );
      return { skipped: true, reason: `Request status is ${step.approvalRequest.status}` };
    }

    const now = new Date();
    const updatedCount = step.reminderCount + 1;

    // 3. Update step reminder count
    await this.prisma.approvalStep.update({
      where: { id: stepId },
      data: {
        reminderCount: updatedCount,
        lastRemindedAt: now,
      },
    });

    // 4. Record audit log entry
    await this.auditService.log({
      tenantId,
      entityType: 'ApprovalStep',
      entityId: stepId,
      action: 'STEP_REMINDER_SENT',
      metadata: {
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        reminderNumber: updatedCount,
        assignedRole: step.assignedRole,
        assignedToId: step.assignedToId,
      },
    });

    // 5. Send reminder notification
    const recipientEmail =
      step.assignedTo?.email ||
      `approvers@${step.assignedRole?.toLowerCase() || 'company'}.flowgate.local`;

    await this.notificationsService.dispatchWorkflowNotification({
      tenantId,
      recipientEmail,
      recipientUserId: step.assignedToId,
      eventType: 'STEP_REMINDER_DUE',
      subject: `Reminder: Action required on "${step.approvalRequest.title}"`,
      content: `This is a reminder that Step ${step.stepOrder} (${step.stepName}) for request "${step.approvalRequest.title}" is awaiting your review.`,
      idempotencyKey: `reminder:${stepId}:${reminderSeq || updatedCount}`,
      metadata: {
        approvalRequestId,
        stepId,
        stepOrder: step.stepOrder,
      },
    });

    this.logger.log(
      `Reminder #${updatedCount} sent successfully for step ${stepId} (Request: ${approvalRequestId})`,
    );

    return { reminded: true, reminderNumber: updatedCount };
  }

  /**
   * Processes step timeout escalation.
   * Re-checks database state; if step was already actioned or escalated, exits safely as a no-op.
   */
  private async handleStepEscalation(job: Job<StepJobData>): Promise<any> {
    const {
      tenantId,
      approvalRequestId,
      stepId,
      stepOrder,
      escalateToRole,
      escalateToUserId,
      escalationReason,
    } = job.data;

    this.logger.log(
      `Evaluating timeout escalation for tenant: ${tenantId}, request: ${approvalRequestId}, step #${stepOrder}`,
    );

    // 1. Re-check state from database
    const step = await this.prisma.approvalStep.findFirst({
      where: {
        id: stepId,
        tenantId,
        approvalRequestId,
      },
      include: {
        approvalRequest: true,
      },
    });

    if (!step) {
      this.logger.warn(`Step ${stepId} not found. Skipping escalation.`);
      return { skipped: true, reason: 'Step not found' };
    }

    // 2. Invariant: only escalate if still actively IN_REVIEW and NOT already escalated
    if (step.status !== 'IN_REVIEW') {
      this.logger.log(
        `Step ${stepId} is in state '${step.status}' (not IN_REVIEW). Escalation discarded.`,
      );
      return { skipped: true, reason: `Step status is ${step.status}` };
    }

    if (step.isEscalated) {
      this.logger.log(`Step ${stepId} has already been escalated. Escalation discarded.`);
      return { skipped: true, reason: 'Already escalated' };
    }

    if (
      step.approvalRequest.status === 'APPROVED' ||
      step.approvalRequest.status === 'REJECTED' ||
      step.approvalRequest.status === 'CANCELLED'
    ) {
      this.logger.log(`Request is '${step.approvalRequest.status}'. Escalation discarded.`);
      return { skipped: true, reason: `Request status is ${step.approvalRequest.status}` };
    }

    const now = new Date();
    const reason = escalationReason || 'Approval step exceeded designated review response deadline';

    // 3. Atomic conditional update: acquire exclusive lock and guarantee idempotency
    const updateResult = await this.prisma.$transaction(async (tx) => {
      const updateCheck = await tx.approvalStep.updateMany({
        where: {
          id: stepId,
          tenantId,
          status: 'IN_REVIEW',
          isEscalated: false,
        },
        data: {
          isEscalated: true,
          escalatedAt: now,
          escalatedToRole: (escalateToRole as any) || 'TENANT_ADMIN',
          escalatedToUserId: escalateToUserId || null,
          escalationReason: reason,
          assignedRole: (escalateToRole as any) || step.assignedRole || 'TENANT_ADMIN',
          assignedToId: escalateToUserId || null,
        },
      });

      if (updateCheck.count === 0) {
        // Step was actioned concurrently by another process
        return { applied: false };
      }

      // Record audit event in same atomic transaction
      await this.auditService.log(
        {
          tenantId,
          entityType: 'ApprovalStep',
          entityId: stepId,
          action: 'STEP_ESCALATED',
          metadata: {
            stepOrder: step.stepOrder,
            stepName: step.stepName,
            previousRole: step.assignedRole,
            escalatedToRole: escalateToRole || 'TENANT_ADMIN',
            escalatedToUserId: escalateToUserId || null,
            reason,
          },
        },
        tx,
      );

      return { applied: true };
    });

    if (!updateResult.applied) {
      this.logger.log(`Escalation race condition handled: step was actioned concurrently.`);
      return { skipped: true, reason: 'Actioned concurrently' };
    }

    // 4. Dispatch notification to newly assigned role or user
    await this.notificationsService.dispatchWorkflowNotification({
      tenantId,
      recipientEmail: `escalations@flowgate.local`,
      recipientUserId: escalateToUserId || null,
      eventType: 'STEP_ESCALATED',
      subject: `[ESCALATED] Action required on "${step.approvalRequest.title}"`,
      content: `Step ${step.stepOrder} (${step.stepName}) for request "${step.approvalRequest.title}" has been escalated to you due to timeout.`,
      idempotencyKey: `escalate:${stepId}`,
      metadata: {
        approvalRequestId,
        stepId,
        stepOrder: step.stepOrder,
        escalatedToRole: escalateToRole || 'TENANT_ADMIN',
      },
    });

    this.logger.log(
      `Step ${stepId} escalated successfully to ${escalateToRole || 'TENANT_ADMIN'} (Request: ${approvalRequestId})`,
    );

    return { escalated: true };
  }
}

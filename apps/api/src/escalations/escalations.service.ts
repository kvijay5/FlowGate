import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_ESCALATIONS,
  JOB_CHECK_REMINDER,
  JOB_PROCESS_ESCALATION,
} from '../queues/queue.constants';
import { UserRole } from '@flowgate/shared-types';

export interface StepScheduleConfig {
  reminderIntervalHours?: number;
  reminderDelayMs?: number; // Supports fast testing/simulation
  escalationTimeoutHours?: number;
  escalationDelayMs?: number; // Supports fast testing/simulation
  escalateToRole?: UserRole;
  escalateToUserId?: string;
  escalationReason?: string;
}

export interface ScheduleStepJobsParams {
  tenantId: string;
  approvalRequestId: string;
  stepId: string;
  stepOrder: number;
  config?: StepScheduleConfig;
}

@Injectable()
export class EscalationsService {
  private readonly logger = new Logger(EscalationsService.name);

  constructor(@InjectQueue(QUEUE_ESCALATIONS) private readonly escQueue: Queue) {}

  /**
   * Schedules delayed reminder and escalation BullMQ background jobs for an active approval step.
   */
  async scheduleStepJobs(params: ScheduleStepJobsParams) {
    const { tenantId, approvalRequestId, stepId, stepOrder, config } = params;
    if (!config) return;

    // 1. Schedule Reminder Job if configured
    const reminderDelay =
      config.reminderDelayMs ??
      (config.reminderIntervalHours ? config.reminderIntervalHours * 3600 * 1000 : null);

    if (reminderDelay && reminderDelay > 0) {
      const reminderJobId = `tenant_${tenantId}_reminder_${stepId}_1`;
      try {
        await this.escQueue.add(
          JOB_CHECK_REMINDER,
          {
            tenantId,
            approvalRequestId,
            stepId,
            stepOrder,
            reminderSeq: 1,
            escalateToRole: config.escalateToRole,
            escalateToUserId: config.escalateToUserId,
          },
          {
            jobId: reminderJobId,
            delay: reminderDelay,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
        this.logger.log(
          `[REMINDER SCHEDULED] Step ${stepId} (Request: ${approvalRequestId}) in ${reminderDelay}ms (JobId: ${reminderJobId})`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to schedule reminder job: ${err.message}`);
      }
    }

    // 2. Schedule Escalation Job if configured
    const escalationDelay =
      config.escalationDelayMs ??
      (config.escalationTimeoutHours ? config.escalationTimeoutHours * 3600 * 1000 : null);

    if (escalationDelay && escalationDelay > 0) {
      const escalateJobId = `tenant_${tenantId}_escalate_${stepId}`;
      try {
        await this.escQueue.add(
          JOB_PROCESS_ESCALATION,
          {
            tenantId,
            approvalRequestId,
            stepId,
            stepOrder,
            escalateToRole: config.escalateToRole,
            escalateToUserId: config.escalateToUserId,
            escalationReason: config.escalationReason,
          },
          {
            jobId: escalateJobId,
            delay: escalationDelay,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
        this.logger.log(
          `[ESCALATION SCHEDULED] Step ${stepId} (Request: ${approvalRequestId}) in ${escalationDelay}ms (JobId: ${escalateJobId})`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to schedule escalation job: ${err.message}`);
      }
    }
  }

  /**
   * Safely cancels pending delayed reminder and escalation jobs when a step is actioned or completed.
   */
  async cancelStepJobs(tenantId: string, stepId: string) {
    const reminderJobId = `tenant_${tenantId}_reminder_${stepId}_1`;
    const escalateJobId = `tenant_${tenantId}_escalate_${stepId}`;

    try {
      const reminderJob = await this.escQueue.getJob(reminderJobId);
      if (reminderJob) {
        await reminderJob.remove();
        this.logger.log(`[JOB REMOVED] Cancelled pending reminder job: ${reminderJobId}`);
      }
    } catch (err: any) {
      this.logger.warn(`Could not cancel reminder job ${reminderJobId}: ${err.message}`);
    }

    try {
      const escalateJob = await this.escQueue.getJob(escalateJobId);
      if (escalateJob) {
        await escalateJob.remove();
        this.logger.log(`[JOB REMOVED] Cancelled pending escalation job: ${escalateJobId}`);
      }
    } catch (err: any) {
      this.logger.warn(`Could not cancel escalation job ${escalateJobId}: ${err.message}`);
    }
  }
}

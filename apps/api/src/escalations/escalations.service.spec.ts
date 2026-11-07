import { Test, TestingModule } from '@nestjs/testing';
import { EscalationsService } from './escalations.service';
import { EscalationsProcessor } from './escalations.processor';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getQueueToken } from '@nestjs/bullmq';
import {
  QUEUE_ESCALATIONS,
  JOB_CHECK_REMINDER,
  JOB_PROCESS_ESCALATION,
} from '../queues/queue.constants';
import { Job } from 'bullmq';

describe('Escalations Module', () => {
  let service: EscalationsService;
  let processor: EscalationsProcessor;
  let mockQueue: any;
  let mockPrisma: any;
  let mockAudit: any;
  let mockNotifications: any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn().mockResolvedValue(null),
    };

    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      approvalStep: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'step-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    mockNotifications = {
      dispatchWorkflowNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationsService,
        EscalationsProcessor,
        { provide: getQueueToken(QUEUE_ESCALATIONS), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<EscalationsService>(EscalationsService);
    processor = module.get<EscalationsProcessor>(EscalationsProcessor);
  });

  describe('EscalationsService.scheduleStepJobs', () => {
    it('should schedule reminder and escalation jobs based on config', async () => {
      await service.scheduleStepJobs({
        tenantId: 'tenant-1',
        approvalRequestId: 'req-1',
        stepId: 'step-1',
        stepOrder: 1,
        config: {
          reminderDelayMs: 5000,
          escalationDelayMs: 10000,
          escalateToRole: 'MANAGER',
          escalationReason: 'Timeout after 10s',
        },
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);

      // 1. Reminder job
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        1,
        JOB_CHECK_REMINDER,
        expect.objectContaining({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          reminderSeq: 1,
        }),
        expect.objectContaining({
          jobId: 'tenant_tenant-1_reminder_step-1_1',
          delay: 5000,
        }),
      );

      // 2. Escalation job
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        2,
        JOB_PROCESS_ESCALATION,
        expect.objectContaining({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          escalateToRole: 'MANAGER',
          escalationReason: 'Timeout after 10s',
        }),
        expect.objectContaining({
          jobId: 'tenant_tenant-1_escalate_step-1',
          delay: 10000,
        }),
      );
    });

    it('should do nothing if config is omitted', async () => {
      await service.scheduleStepJobs({
        tenantId: 'tenant-1',
        approvalRequestId: 'req-1',
        stepId: 'step-1',
        stepOrder: 1,
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('EscalationsService.cancelStepJobs', () => {
    it('should remove pending reminder and escalation jobs if present in queue', async () => {
      const mockReminderJob = { remove: jest.fn().mockResolvedValue(true) };
      const mockEscalateJob = { remove: jest.fn().mockResolvedValue(true) };

      mockQueue.getJob
        .mockResolvedValueOnce(mockReminderJob)
        .mockResolvedValueOnce(mockEscalateJob);

      await service.cancelStepJobs('tenant-1', 'step-1');

      expect(mockReminderJob.remove).toHaveBeenCalled();
      expect(mockEscalateJob.remove).toHaveBeenCalled();
    });
  });

  describe('EscalationsProcessor.handleStepReminder', () => {
    const createReminderJob = (data: any) =>
      ({
        id: 'job-rem-1',
        name: JOB_CHECK_REMINDER,
        data,
      }) as unknown as Job;

    it('should skip reminder if step is no longer IN_REVIEW', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue({
        id: 'step-1',
        status: 'APPROVED',
        approvalRequest: { status: 'IN_PROGRESS' },
      });

      const res = await processor.process(
        createReminderJob({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          stepOrder: 1,
        }),
      );

      expect(res.skipped).toBe(true);
      expect(mockPrisma.approvalStep.update).not.toHaveBeenCalled();
      expect(mockNotifications.dispatchWorkflowNotification).not.toHaveBeenCalled();
    });

    it('should skip reminder if parent request is APPROVED or CANCELLED', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue({
        id: 'step-1',
        status: 'IN_REVIEW',
        approvalRequest: { status: 'CANCELLED' },
      });

      const res = await processor.process(
        createReminderJob({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          stepOrder: 1,
        }),
      );

      expect(res.skipped).toBe(true);
      expect(mockPrisma.approvalStep.update).not.toHaveBeenCalled();
    });

    it('should update reminder count, record audit log, and send notification when IN_REVIEW', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue({
        id: 'step-1',
        stepOrder: 1,
        stepName: 'Manager Signoff',
        status: 'IN_REVIEW',
        reminderCount: 0,
        assignedRole: 'MANAGER',
        assignedTo: { email: 'mgr@flowgate.local' },
        approvalRequest: { title: 'New Software License', status: 'IN_PROGRESS' },
      });

      const res = await processor.process(
        createReminderJob({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          stepOrder: 1,
        }),
      );

      expect(res.reminded).toBe(true);
      expect(res.reminderNumber).toBe(1);
      expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'step-1' },
          data: expect.objectContaining({ reminderCount: 1 }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STEP_REMINDER_SENT',
          entityId: 'step-1',
        }),
      );
      expect(mockNotifications.dispatchWorkflowNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'STEP_REMINDER_DUE',
          recipientEmail: 'mgr@flowgate.local',
        }),
      );
    });
  });

  describe('EscalationsProcessor.handleStepEscalation', () => {
    const createEscalateJob = (data: any) =>
      ({
        id: 'job-esc-1',
        name: JOB_PROCESS_ESCALATION,
        data,
      }) as unknown as Job;

    it('should skip escalation if step is already escalated or not IN_REVIEW', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue({
        id: 'step-1',
        status: 'IN_REVIEW',
        isEscalated: true, // Already escalated!
        approvalRequest: { status: 'IN_PROGRESS' },
      });

      const res = await processor.process(
        createEscalateJob({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          stepOrder: 1,
        }),
      );

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('Already escalated');
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('should atomically escalate step and dispatch notification', async () => {
      mockPrisma.approvalStep.findFirst.mockResolvedValue({
        id: 'step-1',
        stepOrder: 1,
        stepName: 'Finance Approval',
        status: 'IN_REVIEW',
        isEscalated: false,
        assignedRole: 'APPROVER',
        approvalRequest: { title: 'Procurement Order', status: 'IN_PROGRESS' },
      });

      mockPrisma.approvalStep.updateMany.mockResolvedValue({ count: 1 });

      const res = await processor.process(
        createEscalateJob({
          tenantId: 'tenant-1',
          approvalRequestId: 'req-1',
          stepId: 'step-1',
          stepOrder: 1,
          escalateToRole: 'TENANT_ADMIN',
          escalationReason: 'Overdue by 24h',
        }),
      );

      expect(res.escalated).toBe(true);
      expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'step-1',
            status: 'IN_REVIEW',
            isEscalated: false,
          }),
          data: expect.objectContaining({
            isEscalated: true,
            escalatedToRole: 'TENANT_ADMIN',
            escalationReason: 'Overdue by 24h',
          }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STEP_ESCALATED',
          metadata: expect.objectContaining({
            escalatedToRole: 'TENANT_ADMIN',
          }),
        }),
        expect.anything(),
      );
      expect(mockNotifications.dispatchWorkflowNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'STEP_ESCALATED',
        }),
      );
    });
  });
});

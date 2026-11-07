import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS, JOB_SEND_NOTIFICATION } from '../queues/queue.constants';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';
import { Job } from 'bullmq';

describe('Notifications Module', () => {
  let service: NotificationsService;
  let processor: NotificationsProcessor;
  let mockPrisma: any;
  let mockQueue: any;
  let mockEmailProvider: EmailProvider;

  beforeEach(async () => {
    mockPrisma = {
      notificationLog: {
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'notif-1',
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: args.where.id,
            ...args.data,
          }),
        ),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    mockEmailProvider = {
      sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationsProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: mockQueue },
        { provide: EMAIL_PROVIDER, useValue: mockEmailProvider },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    processor = module.get<NotificationsProcessor>(NotificationsProcessor);
  });

  describe('NotificationsService.dispatchWorkflowNotification', () => {
    it('should create a pending notification log and enqueue background job', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue(null);

      const result = await service.dispatchWorkflowNotification({
        tenantId: 'tenant-1',
        recipientEmail: 'user@example.com',
        recipientUserId: 'user-1',
        eventType: 'REQUEST_SUBMITTED',
        subject: 'Request Submitted',
        content: 'Your request was submitted',
        idempotencyKey: 'idemp-1',
      });

      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            recipientEmail: 'user@example.com',
            status: 'PENDING',
            idempotencyKey: 'idemp-1',
          }),
        }),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_SEND_NOTIFICATION,
        {
          tenantId: 'tenant-1',
          notificationId: 'notif-1',
          idempotencyKey: 'idemp-1',
        },
        expect.objectContaining({
          jobId: 'tenant-1__idemp-1',
          attempts: 3,
        }),
      );

      expect(result).toBeDefined();
    });

    it('should skip duplicate enqueue if notification was already SENT', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue({
        id: 'notif-existing',
        tenantId: 'tenant-1',
        status: 'SENT',
        idempotencyKey: 'idemp-existing',
      });

      const result = await service.dispatchWorkflowNotification({
        tenantId: 'tenant-1',
        recipientEmail: 'user@example.com',
        eventType: 'REQUEST_SUBMITTED',
        subject: 'Request Submitted',
        content: 'Your request was submitted',
        idempotencyKey: 'idemp-existing',
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(result?.status).toBe('SENT');
    });

    it('should not throw or bubble exceptions if queue enqueue fails', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue(null);
      mockQueue.add.mockRejectedValue(new Error('Redis connection failure'));

      const result = await service.dispatchWorkflowNotification({
        tenantId: 'tenant-1',
        recipientEmail: 'user@example.com',
        eventType: 'REQUEST_SUBMITTED',
        subject: 'Request Submitted',
        content: 'Your request was submitted',
        idempotencyKey: 'idemp-fail',
      });

      expect(result).toBeNull();
    });
  });

  describe('NotificationsService.findAll & getStats', () => {
    it('should scope notifications to recipientUserId for regular users', async () => {
      mockPrisma.notificationLog.count.mockResolvedValue(1);
      mockPrisma.notificationLog.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          tenantId: 'tenant-1',
          recipientEmail: 'user@flowgate.local',
          recipientUserId: 'user-1',
          channel: 'EMAIL',
          eventType: 'STEP_ASSIGNED',
          subject: 'Review Needed',
          content: 'Please review',
          status: 'SENT',
          attemptCount: 1,
          errorMessage: null,
          sentAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const result = await service.findAll('tenant-1', 'user-1', 'REQUESTER', 1, 10);

      expect(mockPrisma.notificationLog.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', recipientUserId: 'user-1' },
      });
      expect(result.data.length).toBe(1);
    });

    it('should allow TENANT_ADMIN to see all notifications across tenant', async () => {
      mockPrisma.notificationLog.count.mockResolvedValue(2);
      mockPrisma.notificationLog.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', 'admin-1', 'TENANT_ADMIN', 1, 10);

      expect(mockPrisma.notificationLog.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
    });

    it('should aggregate delivery statistics', async () => {
      mockPrisma.notificationLog.count
        .mockResolvedValueOnce(10) // SENT
        .mockResolvedValueOnce(2) // PENDING
        .mockResolvedValueOnce(1); // FAILED

      const stats = await service.getStats('tenant-1');
      expect(stats).toEqual({
        sent: 10,
        pending: 2,
        failed: 1,
        total: 13,
      });
    });
  });

  describe('NotificationsProcessor.process', () => {
    const createMockJob = (data: any, attemptsMade = 0) =>
      ({
        id: 'job-1',
        name: JOB_SEND_NOTIFICATION,
        data,
        attemptsMade,
        opts: { attempts: 3 },
      }) as unknown as Job;

    it('should skip delivery if record is already in SENT status', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        status: 'SENT',
      });

      const res = await processor.process(
        createMockJob({
          tenantId: 'tenant-1',
          notificationId: 'notif-1',
          idempotencyKey: 'idemp-1',
        }),
      );

      expect(res.skipped).toBe(true);
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('should deliver email successfully and mark notification status SENT', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        recipientEmail: 'approver@example.com',
        subject: 'Approval Needed',
        content: 'Please approve request',
        status: 'PENDING',
        metadata: {},
      });

      const res = await processor.process(
        createMockJob({
          tenantId: 'tenant-1',
          notificationId: 'notif-1',
          idempotencyKey: 'idemp-1',
        }),
      );

      expect(res.success).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'approver@example.com',
          subject: 'Approval Needed',
        }),
      );
      expect(mockPrisma.notificationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({
            status: 'SENT',
          }),
        }),
      );
    });

    it('should record failure and rethrow for BullMQ backoff retry', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        recipientEmail: 'approver@example.com',
        subject: 'Approval Needed',
        content: 'Please approve request',
        status: 'PENDING',
      });

      (mockEmailProvider.sendEmail as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'SMTP timeout connection refused',
      });

      await expect(
        processor.process(
          createMockJob(
            {
              tenantId: 'tenant-1',
              notificationId: 'notif-1',
              idempotencyKey: 'idemp-1',
            },
            0,
          ),
        ),
      ).rejects.toThrow('Email delivery failed: SMTP timeout connection refused');

      expect(mockPrisma.notificationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({
            status: 'PENDING', // Still pending because attemptsMade (0) + 1 < 3
            errorMessage: 'SMTP timeout connection refused',
          }),
        }),
      );
    });

    it('should set status FAILED when max retry attempts reached', async () => {
      mockPrisma.notificationLog.findUnique.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        recipientEmail: 'approver@example.com',
        subject: 'Approval Needed',
        content: 'Please approve request',
        status: 'PENDING',
      });

      (mockEmailProvider.sendEmail as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Permanent failure',
      });

      // attemptsMade = 2 -> attempt 3 of 3 (final)
      await expect(
        processor.process(
          createMockJob(
            {
              tenantId: 'tenant-1',
              notificationId: 'notif-1',
              idempotencyKey: 'idemp-1',
            },
            2,
          ),
        ),
      ).rejects.toThrow('Email delivery failed: Permanent failure');

      expect(mockPrisma.notificationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({
            status: 'FAILED',
            errorMessage: 'Permanent failure',
          }),
        }),
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OutboxService } from './outbox.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationsService } from '../escalations/escalations.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { OUTBOX_EVENT_NOTIFICATION, OUTBOX_EVENT_WEBHOOK } from './outbox.constants';

describe('Transactional Outbox Pattern', () => {
  let outboxService: OutboxService;
  let publisherService: OutboxPublisherService;
  let mockPrisma: any;
  let mockNotifications: any;
  let mockEscalations: any;
  let mockWebhooks: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      $queryRaw: jest.fn(),
      outboxEvent: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'evt-outbox-1',
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    mockNotifications = {
      dispatchWorkflowNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    mockEscalations = {
      scheduleStepJobs: jest.fn().mockResolvedValue(undefined),
      cancelStepJobs: jest.fn().mockResolvedValue(undefined),
    };

    mockWebhooks = {
      triggerEvent: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        OutboxPublisherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: EscalationsService, useValue: mockEscalations },
        { provide: WebhooksService, useValue: mockWebhooks },
      ],
    }).compile();

    outboxService = module.get<OutboxService>(OutboxService);
    publisherService = module.get<OutboxPublisherService>(OutboxPublisherService);
  });

  describe('OutboxService.createEvent', () => {
    it('should write an outbox event within the passed transaction client', async () => {
      const mockTx: any = {
        outboxEvent: {
          create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        },
      };

      const result = await outboxService.createEvent(mockTx, {
        tenantId: 'tenant-1',
        eventType: OUTBOX_EVENT_NOTIFICATION,
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        payload: { recipient: 'user@example.com' },
        idempotencyKey: 'notif_123',
      });

      expect(mockTx.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: OUTBOX_EVENT_NOTIFICATION,
          entityType: 'ApprovalRequest',
          entityId: 'req-1',
          status: 'PENDING',
          idempotencyKey: 'notif_123',
        }),
      });
      expect(result.id).toBe('evt-1');
    });
  });

  describe('OutboxService.claimPendingEvents', () => {
    it('should query with FOR UPDATE SKIP LOCKED and transition claimed rows to PROCESSING', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'evt-claim-1' }, { id: 'evt-claim-2' }]);
      mockPrisma.outboxEvent.findMany.mockResolvedValue([
        { id: 'evt-claim-1', status: 'PROCESSING' },
        { id: 'evt-claim-2', status: 'PROCESSING' },
      ]);

      const claimed = await outboxService.claimPendingEvents(50);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.outboxEvent.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['evt-claim-1', 'evt-claim-2'] } },
        data: expect.objectContaining({
          status: 'PROCESSING',
        }),
      });
      expect(claimed.length).toBe(2);
    });

    it('should return empty array if no events are pending', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const claimed = await outboxService.claimPendingEvents(50);

      expect(claimed).toEqual([]);
      expect(mockPrisma.outboxEvent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('OutboxService.markPublished & markFailed', () => {
    it('should mark event as PUBLISHED with publishedAt timestamp', async () => {
      await outboxService.markPublished('evt-1');

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          lastError: null,
          publishedAt: expect.any(Date),
        }),
      });
    });

    it('should schedule retry with exponential backoff when under maxRetries', async () => {
      await outboxService.markFailed('evt-1', 'Redis connection timeout', 1, 5);

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          retryCount: 2,
          lastError: 'Redis connection timeout',
          scheduledFor: expect.any(Date),
        }),
      });
    });

    it('should mark event as FAILED when maxRetries is reached', async () => {
      await outboxService.markFailed('evt-1', 'Redis connection fatal error', 4, 5);

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          retryCount: 5,
          lastError: 'Redis connection fatal error',
        }),
      });
    });
  });

  describe('OutboxPublisherService.processBatch', () => {
    it('should claim events, dispatch to target queues, and mark as PUBLISHED', async () => {
      const mockEvent: any = {
        id: 'evt-notif-1',
        tenantId: 'tenant-1',
        eventType: OUTBOX_EVENT_NOTIFICATION,
        payload: {
          recipientEmail: 'approver@example.com',
          eventType: 'REQUEST_SUBMITTED',
          subject: 'Review needed',
          idempotencyKey: 'idemp-1',
        },
        retryCount: 0,
        maxRetries: 5,
      };

      jest.spyOn(outboxService, 'claimPendingEvents').mockResolvedValue([mockEvent]);
      jest.spyOn(outboxService, 'markPublished').mockResolvedValue(undefined);

      const count = await publisherService.processBatch();

      expect(count).toBe(1);
      expect(mockNotifications.dispatchWorkflowNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          recipientEmail: 'approver@example.com',
        }),
      );
      expect(outboxService.markPublished).toHaveBeenCalledWith('evt-notif-1');
    });

    it('should handle transient Redis failures gracefully and invoke markFailed', async () => {
      const mockEvent: any = {
        id: 'evt-wh-1',
        tenantId: 'tenant-1',
        eventType: OUTBOX_EVENT_WEBHOOK,
        payload: {
          eventType: 'request.created',
          data: { title: 'Purchase' },
        },
        retryCount: 0,
        maxRetries: 5,
      };

      jest.spyOn(outboxService, 'claimPendingEvents').mockResolvedValue([mockEvent]);
      mockWebhooks.triggerEvent.mockRejectedValue(new Error('Redis connection closed'));
      const markFailedSpy = jest.spyOn(outboxService, 'markFailed').mockResolvedValue(undefined);

      await publisherService.processBatch();

      expect(markFailedSpy).toHaveBeenCalledWith('evt-wh-1', 'Redis connection closed', 0, 5);
    });
  });
});

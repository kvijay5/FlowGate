import { Test, TestingModule } from '@nestjs/testing';
import { QueueHealthService } from './queue-health.service';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NOTIFICATIONS, QUEUE_ESCALATIONS, QUEUE_WEBHOOKS } from './queue.constants';

describe('QueueHealthService', () => {
  let service: QueueHealthService;
  let mockNotifQueue: any;
  let mockEscQueue: any;
  let mockWebhookQueue: any;
  let mockPrisma: any;

  beforeEach(async () => {
    mockNotifQueue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 2,
        active: 1,
        completed: 10,
        failed: 0,
        delayed: 3,
      }),
    };

    mockEscQueue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 5,
        failed: 1,
        delayed: 2,
      }),
    };

    mockWebhookQueue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 20,
        failed: 0,
        delayed: 0,
      }),
    };

    mockPrisma = {
      outboxEvent: {
        count: jest.fn().mockImplementation((args: any) => {
          if (args.where?.status === 'PENDING') return Promise.resolve(2);
          if (args.where?.status === 'PROCESSING') return Promise.resolve(1);
          if (args.where?.status === 'PUBLISHED') return Promise.resolve(50);
          if (args.where?.status === 'FAILED') return Promise.resolve(0);
          return Promise.resolve(0);
        }),
      },
      notificationLog: {
        count: jest.fn().mockImplementation((args: any) => {
          if (args.where?.status === 'PENDING') return Promise.resolve(1);
          if (args.where?.status === 'SENT') return Promise.resolve(25);
          if (args.where?.status === 'FAILED') return Promise.resolve(0);
          return Promise.resolve(0);
        }),
      },
      webhookSubscription: {
        count: jest.fn().mockResolvedValue(3),
      },
      webhookDelivery: {
        count: jest.fn().mockImplementation((args: any) => {
          if (args.where?.status === 'FAILED') return Promise.resolve(2);
          return Promise.resolve(45);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueHealthService,
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: mockNotifQueue },
        { provide: getQueueToken(QUEUE_ESCALATIONS), useValue: mockEscQueue },
        { provide: getQueueToken(QUEUE_WEBHOOKS), useValue: mockWebhookQueue },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<QueueHealthService>(QueueHealthService);
  });

  describe('getHealthStatus (SUPER_ADMIN Global Metrics)', () => {
    it('should aggregate job counts across all background queues', async () => {
      jest.spyOn(service, 'checkRedisPing').mockResolvedValue(true);

      const status = await service.getHealthStatus();

      expect(status.redisConnected).toBe(true);
      expect(status.queues.notifications).toEqual({
        waiting: 2,
        active: 1,
        completed: 10,
        failed: 0,
        delayed: 3,
      });
      expect(status.queues.escalations).toEqual({
        waiting: 0,
        active: 0,
        completed: 5,
        failed: 1,
        delayed: 2,
      });
      expect(status.queues.webhooks).toEqual({
        waiting: 1,
        active: 0,
        completed: 20,
        failed: 0,
        delayed: 0,
      });
      expect(status.timestamp).toBeDefined();
    });

    it('should report redisConnected false when ping fails', async () => {
      jest.spyOn(service, 'checkRedisPing').mockResolvedValue(false);

      const status = await service.getHealthStatus();
      expect(status.redisConnected).toBe(false);
    });
  });

  describe('getTenantHealthStatus (Tenant-Isolated Metrics)', () => {
    it('should return strictly tenant-scoped metrics without global queue totals', async () => {
      jest.spyOn(service, 'checkRedisPing').mockResolvedValue(true);

      const tenantStatus = await service.getTenantHealthStatus('tenant-123');

      expect(tenantStatus.tenantId).toBe('tenant-123');
      expect(tenantStatus.redisConnected).toBe(true);
      expect(tenantStatus.outbox).toEqual({
        pending: 2,
        processing: 1,
        published: 50,
        failed: 0,
      });
      expect(tenantStatus.notifications).toEqual({
        pending: 1,
        sent: 25,
        failed: 0,
      });
      expect(tenantStatus.webhooks).toEqual({
        activeEndpoints: 3,
        totalDeliveries: 45,
        failedDeliveries: 2,
      });
      // Ensure global queue counts are NOT exposed in tenant metrics
      expect((tenantStatus as any).queues).toBeUndefined();
    });
  });
});

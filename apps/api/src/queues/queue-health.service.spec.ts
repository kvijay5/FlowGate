import { Test, TestingModule } from '@nestjs/testing';
import { QueueHealthService } from './queue-health.service';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NOTIFICATIONS, QUEUE_ESCALATIONS, QUEUE_WEBHOOKS } from './queue.constants';

describe('QueueHealthService', () => {
  let service: QueueHealthService;
  let mockNotifQueue: any;
  let mockEscQueue: any;
  let mockWebhookQueue: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueHealthService,
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: mockNotifQueue },
        { provide: getQueueToken(QUEUE_ESCALATIONS), useValue: mockEscQueue },
        { provide: getQueueToken(QUEUE_WEBHOOKS), useValue: mockWebhookQueue },
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

  describe('getHealthStatus', () => {
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
});

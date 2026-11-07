import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_WEBHOOKS, JOB_DISPATCH_WEBHOOK } from '../queues/queue.constants';
import { NotFoundException } from '@nestjs/common';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let mockPrisma: any;
  let mockQueue: any;

  beforeEach(async () => {
    mockPrisma = {
      webhookSubscription: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'sub-1',
            ...args.data,
            failureCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: args.where.tenant_webhook_subscription_id_unique.id,
            ...args.data,
            failureCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        delete: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      },
      webhookDelivery: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'del-1',
            ...args.data,
            attemptCount: 0,
            createdAt: new Date(),
          }),
        ),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: args.where.id,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.data,
          }),
        ),
      },
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-wh-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(QUEUE_WEBHOOKS), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  describe('create', () => {
    it('should generate a whsec_ secret and return it on creation', async () => {
      const result = await service.create('tenant-1', {
        name: 'Zapier Webhook',
        url: 'https://hooks.zapier.com/flowgate',
        eventTypes: ['request.created', 'request.approved'],
      });

      expect(mockPrisma.webhookSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            name: 'Zapier Webhook',
            url: 'https://hooks.zapier.com/flowgate',
            secret: expect.stringMatching(/^whsec_[a-f0-9]{48}$/),
            status: 'ACTIVE',
          }),
        }),
      );

      expect(result.secret).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(result.id).toBe('sub-1');
    });
  });

  describe('findAll and findOne', () => {
    it('should omit secrets when listing subscriptions', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          name: 'Slack Hook',
          url: 'https://hooks.slack.com/services/...',
          secret: 'whsec_secret_must_not_leak',
          eventTypes: ['request.rejected'],
          status: 'ACTIVE',
          failureCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const list = await service.findAll('tenant-1');
      expect(list.length).toBe(1);
      expect((list[0] as any).secret).toBeUndefined();
    });

    it('should throw NotFoundException if subscription not found for tenant', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('triggerEvent', () => {
    it('should enqueue background delivery only for matching active subscriptions', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: 'sub-matching',
          tenantId: 'tenant-1',
          name: 'Matching Endpoint',
          url: 'https://api.external.com/webhook',
          eventTypes: ['request.created'],
          status: 'ACTIVE',
        },
        {
          id: 'sub-wildcard',
          tenantId: 'tenant-1',
          name: 'Wildcard Endpoint',
          url: 'https://api.external.com/wildcard',
          eventTypes: ['*'],
          status: 'ACTIVE',
        },
        {
          id: 'sub-other',
          tenantId: 'tenant-1',
          name: 'Other Endpoint',
          url: 'https://api.external.com/other',
          eventTypes: ['request.rejected'],
          status: 'ACTIVE',
        },
      ]);

      await service.triggerEvent('tenant-1', 'request.created', {
        requestId: 'req-1',
        title: 'New Hardware Order',
      });

      // Matching and Wildcard should be triggered (2 subscriptions)
      expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_DISPATCH_WEBHOOK,
        expect.objectContaining({
          tenantId: 'tenant-1',
          deliveryId: 'del-1',
        }),
        expect.objectContaining({
          attempts: 3,
        }),
      );
    });
  });

  describe('retryDelivery', () => {
    it('should reset failed delivery status to PENDING and re-enqueue job', async () => {
      mockPrisma.webhookDelivery.findUnique.mockResolvedValue({
        id: 'del-failed',
        tenantId: 'tenant-1',
        status: 'FAILED',
      });

      const res = await service.retryDelivery('tenant-1', 'del-failed');

      expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del-failed' },
          data: expect.objectContaining({
            status: 'PENDING',
            errorMessage: null,
          }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_DISPATCH_WEBHOOK,
        expect.objectContaining({
          tenantId: 'tenant-1',
          deliveryId: 'del-failed',
        }),
        expect.anything(),
      );
      expect(res.status).toBe('PENDING');
    });
  });
});

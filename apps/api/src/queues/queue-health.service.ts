import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QueueHealthStatus } from '@flowgate/shared-types';
import { QUEUE_NOTIFICATIONS, QUEUE_ESCALATIONS, QUEUE_WEBHOOKS } from './queue.constants';

@Injectable()
export class QueueHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueHealthService.name);
  private redisClient: Redis | null = null;

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notifQueue: Queue,
    @InjectQueue(QUEUE_ESCALATIONS) private readonly escQueue: Queue,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly webhookQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    try {
      const redisUrl =
        this.configService.get<string>('REDIS_URL') ||
        'redis://:flowgate_redis_pass@localhost:6379/0';
      this.redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redisClient.on('error', (err) => {
        this.logger.warn(`Redis health client connection warning: ${err.message}`);
      });
    } catch (err: any) {
      this.logger.error(`Failed to initialize Redis health client: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        this.redisClient.disconnect();
      }
    }
    this.logger.log('Queue health client disconnected cleanly.');
  }

  async checkRedisPing(): Promise<boolean> {
    if (!this.redisClient) return false;
    try {
      const pong = await this.redisClient.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async getHealthStatus(): Promise<QueueHealthStatus> {
    const redisConnected = await this.checkRedisPing();

    const [notifCounts, escCounts, webhookCounts] = await Promise.all([
      this.notifQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      this.escQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      this.webhookQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);

    return {
      redisConnected,
      timestamp: new Date().toISOString(),
      queues: {
        notifications: {
          waiting: notifCounts.waiting || 0,
          active: notifCounts.active || 0,
          completed: notifCounts.completed || 0,
          failed: notifCounts.failed || 0,
          delayed: notifCounts.delayed || 0,
        },
        escalations: {
          waiting: escCounts.waiting || 0,
          active: escCounts.active || 0,
          completed: escCounts.completed || 0,
          failed: escCounts.failed || 0,
          delayed: escCounts.delayed || 0,
        },
        webhooks: {
          waiting: webhookCounts.waiting || 0,
          active: webhookCounts.active || 0,
          completed: webhookCounts.completed || 0,
          failed: webhookCounts.failed || 0,
          delayed: webhookCounts.delayed || 0,
        },
      },
    };
  }
}

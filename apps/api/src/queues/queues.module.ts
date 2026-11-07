import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NOTIFICATIONS, QUEUE_ESCALATIONS, QUEUE_WEBHOOKS } from './queue.constants';
import { QueueHealthService } from './queue-health.service';
import { QueueHealthController } from './queue-health.controller';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('REDIS_URL') || 'redis://:flowgate_redis_pass@localhost:6379/0';
        const parsed = new URL(redisUrl);
        return {
          connection: {
            host: parsed.hostname || 'localhost',
            port: parseInt(parsed.port || '6379', 10),
            password: parsed.password || undefined,
            db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0', 10) : 0,
            maxRetriesPerRequest: null, // Required by BullMQ
            enableReadyCheck: false,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: {
              age: 3600,
              count: 500,
            },
            removeOnFail: {
              age: 86400 * 7,
              count: 1000,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUE_NOTIFICATIONS },
      { name: QUEUE_ESCALATIONS },
      { name: QUEUE_WEBHOOKS },
    ),
  ],
  controllers: [QueueHealthController],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueuesModule {}

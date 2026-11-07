import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsController } from './notifications.controller';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { MockEmailProvider } from './mock-email.provider';

@Module({
  imports: [PrismaModule, QueuesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    MockEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useExisting: MockEmailProvider,
    },
  ],
  exports: [NotificationsService, EMAIL_PROVIDER, MockEmailProvider],
})
export class NotificationsModule {}

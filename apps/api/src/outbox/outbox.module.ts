import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { OutboxService } from './outbox.service';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [PrismaModule, NotificationsModule, EscalationsModule, WebhooksModule],
  providers: [OutboxService, OutboxPublisherService],
  exports: [OutboxService, OutboxPublisherService],
})
export class OutboxModule {}

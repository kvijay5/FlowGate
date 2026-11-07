import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [AuditModule, NotificationsModule, EscalationsModule, WebhooksModule, OutboxModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}

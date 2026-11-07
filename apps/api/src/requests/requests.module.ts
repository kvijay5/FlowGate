import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [AuditModule, NotificationsModule, EscalationsModule, WebhooksModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}

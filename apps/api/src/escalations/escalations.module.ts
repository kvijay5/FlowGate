import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscalationsService } from './escalations.service';
import { EscalationsProcessor } from './escalations.processor';

@Module({
  imports: [PrismaModule, QueuesModule, AuditModule, NotificationsModule],
  providers: [EscalationsService, EscalationsProcessor],
  exports: [EscalationsService],
})
export class EscalationsModule {}

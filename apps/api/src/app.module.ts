import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { RequestsModule } from './requests/requests.module';
import { QueuesModule } from './queues/queues.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EscalationsModule } from './escalations/escalations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    WorkflowsModule,
    RequestsModule,
    QueuesModule,
    NotificationsModule,
    EscalationsModule,
    WebhooksModule,
    OutboxModule,
  ],
})
export class AppModule {}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { QueueHealthService } from './queue-health.service';

@Controller('api/v1/admin/queues')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QueueHealthController {
  constructor(private readonly queueHealthService: QueueHealthService) {}

  /**
   * Global queue health & aggregate BullMQ job counts.
   * STRICTLY RESTRICTED to SUPER_ADMIN.
   * Ordinary users and TENANT_ADMIN will receive 403 Forbidden.
   */
  @Get('status')
  @Roles('SUPER_ADMIN')
  async getStatus() {
    return this.queueHealthService.getHealthStatus();
  }

  /**
   * Tenant-scoped background processing metrics.
   * Accessible to TENANT_ADMIN and SUPER_ADMIN.
   * Derives tenant identity strictly from verified authentication context.
   * Never exposes global queue totals or cross-tenant operational data.
   */
  @Get('tenant-status')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  async getTenantStatus(@CurrentTenant() tenantId: string) {
    return this.queueHealthService.getTenantHealthStatus(tenantId);
  }
}

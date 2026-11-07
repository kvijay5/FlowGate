import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { QueueHealthService } from './queue-health.service';

@Controller('api/v1/admin/queues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT_ADMIN', 'SUPER_ADMIN')
export class QueueHealthController {
  constructor(private readonly queueHealthService: QueueHealthService) {}

  @Get('status')
  async getStatus() {
    return this.queueHealthService.getHealthStatus();
  }
}

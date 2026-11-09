import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { AuditChainVerificationResult } from '@flowgate/shared-types';

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Cryptographically verifies the SHA-256 audit log hash chain for the current tenant.
   * Ensures zero gaps, forks, modified payloads, deletions, or reorderings.
   */
  @Get('verify')
  async verifyChain(@CurrentTenant() tenantId: string): Promise<AuditChainVerificationResult> {
    return this.auditService.verifyChain(tenantId);
  }
}

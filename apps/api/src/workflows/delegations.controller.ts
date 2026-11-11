import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DelegationService, DelegationQueryFilters } from './delegation.service';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/v1/delegations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DelegationsController {
  constructor(private readonly delegationService: DelegationService) {}

  /**
   * Create an out-of-office delegation for the authenticated user.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') delegatorId: string,
    @Body() dto: CreateDelegationDto,
  ) {
    return this.delegationService.createDelegation(tenantId, delegatorId, dto);
  }

  /**
   * List delegations for the tenant.
   */
  @Get()
  async findAll(@CurrentTenant() tenantId: string, @Query() filters: DelegationQueryFilters) {
    return this.delegationService.getDelegations(tenantId, filters);
  }

  /**
   * List eligible active colleagues in the tenant to designate as a delegatee.
   */
  @Get('colleagues')
  async getColleagues(@CurrentTenant() tenantId: string, @CurrentUser('id') currentUserId: string) {
    return this.delegationService.getEligibleColleagues(tenantId, currentUserId);
  }

  /**
   * Revoke an active or scheduled delegation.
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.delegationService.revokeDelegation(tenantId, actorId, actorRole, id);
  }

  /**
   * Evaluates and updates delegation lifecycle statuses.
   */
  @Post('sync-lifecycle')
  @HttpCode(HttpStatus.OK)
  async syncLifecycle(@CurrentTenant() tenantId: string) {
    return this.delegationService.checkAndExpireDelegations(tenantId);
  }
}

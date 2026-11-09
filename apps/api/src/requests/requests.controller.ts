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
import { RequestsService } from './requests.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { ResubmitRequestDto } from './dto/resubmit-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@flowgate/shared-types';

@Controller('api/v1/requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  /**
   * Submit a new approval request using an active workflow definition
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApprovalRequestDto,
  ) {
    return this.requestsService.create(tenantId, userId, dto);
  }

  /**
   * List requests for the authenticated tenant with filtering and pagination
   */
  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryRequestsDto,
  ) {
    return this.requestsService.findAll(tenantId, user.id, user.role, query);
  }

  /**
   * Retrieve single request detail with full step progression and audit history
   */
  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.requestsService.findOne(tenantId, id);
  }

  /**
   * Retrieve normalized execution graph/tree for DAG visualization
   */
  @Get(':id/execution-tree')
  async getExecutionTree(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requestsService.getExecutionGraph(tenantId, id);
  }

  /**
   * Retrieve normalized execution graph/tree for DAG visualization
   */
  @Get(':id/execution-graph')
  async getExecutionGraph(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requestsService.getExecutionGraph(tenantId, id);
  }

  /**
   * Execute approval action (APPROVE, REJECT, REQUEST_CHANGES)
   */
  @Post(':id/actions')
  @HttpCode(HttpStatus.OK)
  async submitAction(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.requestsService.submitAction(tenantId, user.id, user.role, id, dto);
  }

  /**
   * Resubmit a request that had changes requested
   */
  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  async resubmit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResubmitRequestDto,
  ) {
    return this.requestsService.resubmit(tenantId, user.id, user.role, id, dto);
  }

  /**
   * Cancel an in-progress or pending approval request
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requestsService.cancel(tenantId, user.id, user.role, id);
  }
}

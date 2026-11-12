import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowSimulatorService } from './workflow-simulator.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { SimulateWorkflowDto } from './dto/simulate-workflow.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/v1/workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly simulatorService: WorkflowSimulatorService,
  ) {}

  /**
   * Create a new workflow definition (Admin & Manager only)
   */
  @Post()
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflowsService.create(tenantId, actorId, dto);
  }

  /**
   * List all workflows belonging to the authenticated tenant
   */
  @Get()
  async findAll(@CurrentTenant() tenantId: string) {
    return this.workflowsService.findAll(tenantId);
  }

  /**
   * Retrieve execution graph for visual rendering
   */
  @Get('requests/:id/execution-graph')
  async getRequestExecutionGraph(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.getExecutionGraph(tenantId, id);
  }

  /**
   * Retrieve a specific workflow definition by ID
   */
  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflowsService.findOne(tenantId, id);
  }

  /**
   * Update workflow details or steps (Admin & Manager only)
   */
  @Patch(':id')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflowsService.update(tenantId, actorId, id, dto);
  }

  /**
   * Activate workflow (Admin & Manager only)
   */
  @Post(':id/activate')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async activate(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.activate(tenantId, actorId, id);
  }

  /**
   * Deactivate workflow (Admin & Manager only)
   */
  @Post(':id/deactivate')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.deactivate(tenantId, actorId, id);
  }

  /**
   * Publish a draft workflow definition (Admin & Manager only)
   */
  @Post(':id/publish')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.publishWorkflow(tenantId, id, actorId);
  }

  /**
   * Clone workflow into a new DRAFT version (Admin & Manager only)
   */
  @Post(':id/clone-draft')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async cloneDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.cloneDraftVersion(tenantId, id, actorId);
  }

  /**
   * Alias: Clone workflow version (POST /api/v1/workflows/:id/versions)
   */
  @Post(':id/versions')
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async createVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowsService.cloneDraftVersion(tenantId, id, actorId);
  }

  /**
   * Dry-run simulate workflow execution with sample payload
   */
  @Post(':id/simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulateWorkflowDto,
  ) {
    return this.simulatorService.simulateWorkflow(tenantId, id, dto.requestData);
  }
}

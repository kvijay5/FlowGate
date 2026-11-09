import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowStepConfigDto } from './dto/workflow-step.dto';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { WorkflowGraphEngineService } from './workflow-graph-engine.service';
import { Prisma, WorkflowStatus } from '@prisma/client';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly graphValidator: WorkflowGraphValidatorService,
    private readonly graphEngine: WorkflowGraphEngineService,
  ) {}

  /**
   * Validates that workflow approval steps form a coherent, continuous sequential chain.
   */
  validateStepConfiguration(steps: WorkflowStepConfigDto[]) {
    if (!steps || steps.length === 0) {
      throw new BadRequestException('Workflow must configure at least one approval step');
    }

    // Sort steps by stepOrder
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);

    // Verify continuous 1-based sequence without duplicates or gaps
    for (let i = 0; i < sorted.length; i++) {
      const expectedOrder = i + 1;
      if (sorted[i].stepOrder !== expectedOrder) {
        throw new BadRequestException(
          `Invalid step order sequence. Expected step order ${expectedOrder}, but found ${sorted[i].stepOrder}`,
        );
      }

      const step = sorted[i];
      if (step.assigneeType === 'ROLE' && !step.role) {
        throw new BadRequestException(
          `Step ${step.stepOrder} ('${step.name}') specifies assigneeType ROLE but no role was provided`,
        );
      }

      if (step.assigneeType === 'USER' && !step.userId && !step.userEmail) {
        throw new BadRequestException(
          `Step ${step.stepOrder} ('${step.name}') specifies assigneeType USER but no userId or userEmail was provided`,
        );
      }
    }
  }

  /**
   * Creates a new workflow definition scoped to the authenticated tenant.
   * Supports both Milestone 6 DAG graphs (nodes & edges) and legacy sequential steps.
   */
  async create(tenantId: string, actorId: string, dto: CreateWorkflowDto) {
    const hasDAG =
      (dto.nodes && dto.nodes.length > 0) ||
      (dto.configuration?.nodes && dto.configuration.nodes.length > 0);
    const hasSteps =
      (dto.steps && dto.steps.length > 0) ||
      (dto.configuration?.steps && dto.configuration.steps.length > 0);

    if (!hasDAG && !hasSteps) {
      throw new BadRequestException(
        'Workflow must configure approval steps or a valid DAG graph (nodes & edges)',
      );
    }

    let configuration: Record<string, unknown> = {};

    if (hasDAG) {
      const configNodes = dto.configuration?.nodes;
      const nodes = dto.nodes || (configNodes as any);
      const edges = dto.edges || dto.configuration?.edges || [];
      const inputSchema = dto.inputSchema || dto.configuration?.inputSchema;

      this.graphValidator.validateDAG({ nodes, edges, inputSchema });

      configuration = {
        nodes,
        edges,
        inputSchema,
        steps: dto.steps || dto.configuration?.steps,
        approvalThresholdUsd: dto.approvalThresholdUsd,
      };
    } else {
      const configSteps = dto.configuration?.steps;
      const steps = (dto.steps || configSteps) as WorkflowStepConfigDto[];
      this.validateStepConfiguration(steps);

      configuration = {
        steps,
        approvalThresholdUsd: dto.approvalThresholdUsd,
      };
    }

    const initialStatus = dto.status || WorkflowStatus.ACTIVE;

    return this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowDefinition.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          status: initialStatus,
          version: 1,
          configuration: configuration as unknown as Prisma.InputJsonValue,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: workflow.id,
          action: 'WORKFLOW_CREATED',
          metadata: {
            name: workflow.name,
            version: workflow.version,
            status: workflow.status,
            hasDAG: !!hasDAG,
          },
        },
        tx,
      );

      return workflow;
    });
  }

  /**
   * Lists all workflows belonging to the authenticated tenant.
   */
  async findAll(tenantId: string) {
    return this.prisma.workflowDefinition.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { approvalRequests: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retrieves a single workflow definition by ID, strictly enforcing tenant isolation.
   */
  async findOne(tenantId: string, id: string) {
    const workflow = await this.prisma.workflowDefinition.findUnique({
      where: {
        tenant_workflow_id_unique: {
          tenantId,
          id,
        },
      },
      include: {
        _count: {
          select: { approvalRequests: true },
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException(`Workflow definition '${id}' not found in this tenant`);
    }

    return workflow;
  }

  /**
   * Updates workflow details. If the workflow has existing active approval requests,
   * structural step updates bump the definition version to prevent corrupting historical requests.
   */
  async update(tenantId: string, actorId: string, id: string, dto: UpdateWorkflowDto) {
    const existing = await this.findOne(tenantId, id);
    const existingConfig = (existing.configuration || {}) as any;

    const newNodes = dto.nodes || dto.configuration?.nodes || existingConfig.nodes;
    const newEdges = dto.edges || dto.configuration?.edges || existingConfig.edges;
    const newInputSchema =
      dto.inputSchema || dto.configuration?.inputSchema || existingConfig.inputSchema;
    const newSteps = dto.steps || dto.configuration?.steps || existingConfig.steps;

    const hasNewDAG =
      (dto.nodes && dto.nodes.length > 0) ||
      (dto.configuration?.nodes && dto.configuration.nodes.length > 0);
    const hasNewSteps =
      (dto.steps && dto.steps.length > 0) ||
      (dto.configuration?.steps && dto.configuration.steps.length > 0);

    if (hasNewDAG) {
      this.graphValidator.validateDAG({
        nodes: newNodes,
        edges: newEdges || [],
        inputSchema: newInputSchema,
      });
    } else if (hasNewSteps) {
      const configSteps = dto.configuration?.steps;
      this.validateStepConfiguration((dto.steps || configSteps) as WorkflowStepConfigDto[]);
    }

    return this.prisma.$transaction(async (tx) => {
      let nextVersion = existing.version;

      if (hasNewDAG || hasNewSteps) {
        // Check if there are active requests using this workflow
        const activeRequestsCount = await tx.approvalRequest.count({
          where: {
            tenantId,
            workflowDefinitionId: id,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
        });

        if (activeRequestsCount > 0) {
          nextVersion += 1;
          this.logger.log(
            `Workflow ${id} has ${activeRequestsCount} active requests. Bumping version from ${existing.version} to ${nextVersion}`,
          );
        }
      }

      const updatedConfiguration = {
        ...existingConfig,
        ...(hasNewDAG || existingConfig.nodes ? { nodes: newNodes, edges: newEdges } : {}),
        inputSchema: newInputSchema,
        steps: newSteps,
        approvalThresholdUsd: dto.approvalThresholdUsd ?? existingConfig.approvalThresholdUsd,
      };

      const updated = await tx.workflowDefinition.update({
        where: {
          tenant_workflow_id_unique: {
            tenantId,
            id,
          },
        },
        data: {
          name: dto.name ? dto.name.trim() : undefined,
          description: dto.description !== undefined ? dto.description?.trim() : undefined,
          status: dto.status ?? undefined,
          configuration: updatedConfiguration as unknown as Prisma.InputJsonValue,
          version: nextVersion,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: id,
          action: 'WORKFLOW_UPDATED',
          metadata: {
            name: updated.name,
            version: updated.version,
            previousVersion: existing.version,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Publishes a draft workflow, validating DAG integrity and freezing the definition.
   */
  async publishWorkflow(tenantId: string, id: string, actorId: string) {
    const workflow = await this.findOne(tenantId, id);
    const config = (workflow.configuration || {}) as any;

    if (config.nodes && config.nodes.length > 0) {
      this.graphValidator.validateDAG({
        nodes: config.nodes,
        edges: config.edges || [],
        inputSchema: config.inputSchema,
      });
    } else if (config.steps && config.steps.length > 0) {
      this.validateStepConfiguration(config.steps);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowDefinition.update({
        where: {
          tenant_workflow_id_unique: {
            tenantId,
            id,
          },
        },
        data: {
          status: WorkflowStatus.ACTIVE,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: id,
          action: 'WORKFLOW_PUBLISHED',
          metadata: {
            name: updated.name,
            version: updated.version,
            status: WorkflowStatus.ACTIVE,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Clones an existing workflow into a new DRAFT version record (vN -> vN+1).
   * In-flight requests remain pinned to their original version and workflow definition ID.
   */
  async cloneDraftVersion(tenantId: string, id: string, actorId: string) {
    const source = await this.findOne(tenantId, id);

    // Compute next version for workflow family
    const family = await this.prisma.workflowDefinition.findMany({
      where: { tenantId, name: source.name },
      select: { version: true },
    });

    const maxVersion = Math.max(source.version, ...family.map((w) => w.version));
    const nextVersion = maxVersion + 1;

    return this.prisma.$transaction(async (tx) => {
      const cloned = await tx.workflowDefinition.create({
        data: {
          tenantId,
          name: source.name,
          description: source.description,
          status: WorkflowStatus.DRAFT,
          version: nextVersion,
          configuration: source.configuration as unknown as Prisma.InputJsonValue,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: cloned.id,
          action: 'WORKFLOW_DRAFT_CLONED',
          metadata: {
            sourceWorkflowId: source.id,
            sourceVersion: source.version,
            newVersion: nextVersion,
            status: WorkflowStatus.DRAFT,
          },
        },
        tx,
      );

      return cloned;
    });
  }

  /**
   * Returns normalized execution graph for frontend rendering.
   */
  async getExecutionGraph(tenantId: string, requestId: string) {
    return this.graphEngine.getExecutionGraph(tenantId, requestId);
  }

  /**
   * Activates a workflow after verifying its step configuration is valid.
   */
  async activate(tenantId: string, actorId: string, id: string) {
    const workflow = await this.findOne(tenantId, id);
    const steps = (workflow.configuration as any)?.steps;
    this.validateStepConfiguration(steps);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowDefinition.update({
        where: {
          tenant_workflow_id_unique: {
            tenantId,
            id,
          },
        },
        data: {
          status: WorkflowStatus.ACTIVE,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: id,
          action: 'WORKFLOW_ACTIVATED',
          metadata: {
            name: updated.name,
            version: updated.version,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Deactivates / archives a workflow.
   */
  async deactivate(tenantId: string, actorId: string, id: string) {
    await this.findOne(tenantId, id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowDefinition.update({
        where: {
          tenant_workflow_id_unique: {
            tenantId,
            id,
          },
        },
        data: {
          status: WorkflowStatus.ARCHIVED,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorId,
          entityType: 'WorkflowDefinition',
          entityId: id,
          action: 'WORKFLOW_DEACTIVATED',
          metadata: {
            name: updated.name,
          },
        },
        tx,
      );

      return updated;
    });
  }
}

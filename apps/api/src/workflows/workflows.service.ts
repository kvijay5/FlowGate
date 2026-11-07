import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowStepConfigDto } from './dto/workflow-step.dto';
import { Prisma, WorkflowStatus } from '@prisma/client';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
   */
  async create(tenantId: string, actorId: string, dto: CreateWorkflowDto) {
    this.validateStepConfiguration(dto.steps);

    return this.prisma.$transaction(async (tx) => {
      const configuration = {
        steps: dto.steps,
        approvalThresholdUsd: dto.approvalThresholdUsd,
      };

      const workflow = await tx.workflowDefinition.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          status: WorkflowStatus.ACTIVE,
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
            stepCount: dto.steps.length,
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

    let newSteps = (existing.configuration as any)?.steps;
    if (dto.steps) {
      this.validateStepConfiguration(dto.steps);
      newSteps = dto.steps;
    }

    return this.prisma.$transaction(async (tx) => {
      let nextVersion = existing.version;

      if (dto.steps) {
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
        ...(existing.configuration as Record<string, unknown>),
        steps: newSteps,
        approvalThresholdUsd:
          dto.approvalThresholdUsd ?? (existing.configuration as any)?.approvalThresholdUsd,
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

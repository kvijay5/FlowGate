import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { ResubmitRequestDto } from './dto/resubmit-request.dto';
import {
  ApprovalRequestStatus,
  ApprovalRequestSummary,
  PaginatedResult,
  StepStatus,
  UserRole,
  WorkflowStepConfig,
  StepPolicy,
  RejectionPolicy,
} from '@flowgate/shared-types';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationsService } from '../escalations/escalations.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { WorkflowGraphEngineService } from '../workflows/workflow-graph-engine.service';
import {
  OUTBOX_EVENT_NOTIFICATION,
  OUTBOX_EVENT_WEBHOOK,
  OUTBOX_EVENT_ESCALATION_SCHEDULE,
  OUTBOX_EVENT_ESCALATION_CANCEL,
} from '../outbox/outbox.constants';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly escalationsService: EscalationsService,
    private readonly webhooksService: WebhooksService,
    private readonly outboxService: OutboxService,
    private readonly outboxPublisher: OutboxPublisherService,
    private readonly graphEngine: WorkflowGraphEngineService,
  ) {}

  /**
   * Creates and submits a new approval request using an active workflow definition.
   */
  async create(tenantId: string, userId: string, dto: CreateApprovalRequestDto) {
    // 1. Validate workflow definition exists and is active within this tenant
    const workflow = await this.prisma.workflowDefinition.findUnique({
      where: {
        tenant_workflow_id_unique: {
          tenantId,
          id: dto.workflowDefinitionId,
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException('Workflow definition not found in this tenant');
    }

    if (workflow.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot create request using an inactive or archived workflow');
    }

    const config = (workflow.configuration || {}) as {
      nodes?: any[];
      edges?: any[];
      steps?: WorkflowStepConfig[];
    };
    const hasDAG = Array.isArray(config.nodes) && config.nodes.length > 0;

    if (hasDAG) {
      const initResult = await this.graphEngine.initializeGraphExecution(
        tenantId,
        userId,
        workflow.id,
        {
          title: dto.title,
          description: dto.description,
          requestData: dto.requestData || dto.payload || {},
        },
      );
      this.outboxPublisher.trigger();
      return this.findOne(tenantId, initResult.id);
    }

    const stepConfigs = config?.steps || [];

    if (stepConfigs.length === 0) {
      throw new BadRequestException('Workflow definition has no configured approval steps');
    }

    // Sort step configurations
    const sortedConfigs = [...stepConfigs].sort((a, b) => a.stepOrder - b.stepOrder);

    // 2. Execute within transaction
    const created = await this.prisma.$transaction(async (tx) => {
      // Create request with immutable workflow version and snapshot
      const request = await tx.approvalRequest.create({
        data: {
          tenantId,
          workflowDefinitionId: workflow.id,
          workflowVersion: workflow.version,
          workflowSnapshot: workflow.configuration as unknown as Prisma.InputJsonValue,
          requestedById: userId,
          title: dto.title.trim(),
          description: dto.description?.trim(),
          status: 'IN_PROGRESS',
        },
      });

      // Create instantiated steps
      for (let i = 0; i < sortedConfigs.length; i++) {
        const step = sortedConfigs[i];
        const isFirstStep = i === 0;

        await tx.approvalStep.create({
          data: {
            tenantId,
            approvalRequestId: request.id,
            stepName: step.name,
            stepOrder: step.stepOrder,
            status: isFirstStep ? 'IN_REVIEW' : 'PENDING',
            assignedRole: step.role ? (step.role as any) : null,
            assignedToId: step.userId || null,
          },
        });
      }

      // Record audit log
      await this.auditService.log(
        {
          tenantId,
          actorId: userId,
          entityType: 'ApprovalRequest',
          entityId: request.id,
          action: 'REQUEST_CREATED',
          metadata: {
            title: request.title,
            workflowId: workflow.id,
            workflowName: workflow.name,
            totalSteps: sortedConfigs.length,
          },
        },
        tx,
      );

      // --- TRANSACTIONAL OUTBOX: Atomic writes inside business transaction ---
      const step1Config = sortedConfigs[0] as any;
      const step1Record = await tx.approvalStep.findFirst({
        where: { approvalRequestId: request.id, stepOrder: 1 },
      });

      if (step1Record) {
        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_ESCALATION_SCHEDULE,
          entityType: 'ApprovalStep',
          entityId: step1Record.id,
          idempotencyKey: `esc_sched_${step1Record.id}_1`,
          payload: {
            tenantId,
            approvalRequestId: request.id,
            stepId: step1Record.id,
            stepOrder: 1,
            config: {
              reminderIntervalHours: step1Config?.reminderIntervalHours,
              reminderDelayMs: step1Config?.reminderDelayMs,
              escalationTimeoutHours: step1Config?.escalationTimeoutHours,
              escalationDelayMs: step1Config?.escalationDelayMs,
              escalateToRole: step1Config?.escalateToRole,
              escalateToUserId: step1Config?.escalateToUserId,
              escalationReason: step1Config?.escalationReason,
            },
          },
        });
      }

      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_WEBHOOK,
        entityType: 'ApprovalRequest',
        entityId: request.id,
        idempotencyKey: `wh_req_created_${request.id}`,
        payload: {
          tenantId,
          eventType: 'request.created',
          data: {
            event: 'request.created',
            tenantId,
            requestId: request.id,
            title: request.title,
            workflowId: workflow.id,
            requestedById: userId,
            totalSteps: sortedConfigs.length,
            createdAt: request.createdAt,
          },
        },
      });

      const requesterUser = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const requesterEmail = requesterUser?.email || `requester@flowgate.local`;

      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_NOTIFICATION,
        entityType: 'ApprovalRequest',
        entityId: request.id,
        idempotencyKey: `notif_req_sub_${request.id}`,
        payload: {
          tenantId,
          recipientEmail: requesterEmail,
          recipientUserId: userId,
          eventType: 'REQUEST_SUBMITTED',
          subject: `Approval Request Submitted: "${request.title}"`,
          content: `Your approval request "${request.title}" has been submitted and is currently in review.`,
          idempotencyKey: `req-submitted:${request.id}`,
          metadata: { requestId: request.id },
        },
      });

      return this.findOne(tenantId, request.id, tx);
    });

    // Trigger immediate outbox publication sweep (non-blocking)
    this.outboxPublisher.trigger();

    return created;
  }

  /**
   * Lists approval requests with filtering, role-aware assignment queries, and pagination.
   */
  async findAll(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    query: QueryRequestsDto,
  ): Promise<PaginatedResult<ApprovalRequestSummary>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ApprovalRequestWhereInput = {
      tenantId,
    };

    if (query.status) {
      where.status = query.status as any;
    }

    if (query.filter === 'mine') {
      where.requestedById = userId;
    } else if (query.filter === 'pending_approval') {
      where.status = 'IN_PROGRESS';
      if (userRole !== 'TENANT_ADMIN' && userRole !== 'SUPER_ADMIN') {
        where.steps = {
          some: {
            status: 'IN_REVIEW',
            OR: [{ assignedToId: userId }, { assignedRole: userRole as any }],
          },
        };
      } else {
        where.steps = {
          some: {
            status: 'IN_REVIEW',
          },
        };
      }
    }

    const [total, requests] = await Promise.all([
      this.prisma.approvalRequest.count({ where }),
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          workflowDefinition: { select: { name: true } },
          requestedBy: { select: { id: true, name: true, email: true } },
          steps: {
            select: {
              stepOrder: true,
              status: true,
              stepName: true,
            },
            orderBy: { stepOrder: 'asc' },
          },
        },
      }),
    ]);

    const summaries: ApprovalRequestSummary[] = requests.map((req) => {
      const activeStep = req.steps.find((s) => s.status === 'IN_REVIEW');
      return {
        id: req.id,
        tenantId: req.tenantId,
        workflowDefinitionId: req.workflowDefinitionId,
        workflowName: req.workflowDefinition.name,
        workflowVersion: req.workflowVersion,
        requestedById: req.requestedById,
        requesterName: req.requestedBy.name,
        requesterEmail: req.requestedBy.email,
        title: req.title,
        description: req.description,
        status: req.status as ApprovalRequestStatus,
        currentStep: activeStep ? activeStep.stepOrder : null,
        totalSteps: req.steps.length,
        createdAt: req.createdAt.toISOString(),
        updatedAt: req.updatedAt.toISOString(),
      };
    });

    return {
      data: summaries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves full request details including step progression and audit history.
   */
  async findOne(tenantId: string, id: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    const request = await client.approvalRequest.findUnique({
      where: {
        tenant_request_id_unique: {
          tenantId,
          id,
        },
      },
      include: {
        workflowDefinition: true,
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        steps: {
          include: {
            assignedTo: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            actionedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            assignees: {
              include: {
                assignedTo: { select: { id: true, name: true, email: true, role: true } },
                actionedBy: { select: { id: true, name: true, email: true, role: true } },
                delegatedFromUser: { select: { id: true, name: true, email: true, role: true } },
              },
            },
          },
          orderBy: [{ reviewRound: 'asc' }, { stepOrder: 'asc' }],
        },
        nodeExecutions: {
          orderBy: [{ reviewRound: 'asc' }, { createdAt: 'asc' }],
        },
        branchExecutions: {
          orderBy: [{ reviewRound: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found in this tenant`);
    }

    const auditLogs = await this.auditService.getEntityAuditTrail(tenantId, 'ApprovalRequest', id);

    const activeStep = request.steps.find((s) => s.status === 'IN_REVIEW');

    return {
      id: request.id,
      tenantId: request.tenantId,
      workflowDefinitionId: request.workflowDefinitionId,
      workflowName: request.workflowDefinition.name,
      workflowVersion: request.workflowVersion,
      workflowSnapshot: request.workflowSnapshot as Record<string, unknown> | null,
      requestedById: request.requestedById,
      requesterName: request.requestedBy.name,
      requesterEmail: request.requestedBy.email,
      title: request.title,
      description: request.description,
      status: request.status as ApprovalRequestStatus,
      currentStep: activeStep ? activeStep.stepOrder : null,
      currentReviewRound: request.currentReviewRound,
      currentNodeId: request.currentNodeId,
      requestData: request.requestData as Record<string, unknown> | null,
      totalSteps: request.steps.length,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      workflowDefinition: {
        id: request.workflowDefinition.id,
        tenantId: request.workflowDefinition.tenantId,
        name: request.workflowDefinition.name,
        description: request.workflowDefinition.description,
        status: request.workflowDefinition.status,
        version: request.workflowDefinition.version,
        configuration: request.workflowDefinition.configuration as any,
        createdAt: request.workflowDefinition.createdAt.toISOString(),
        updatedAt: request.workflowDefinition.updatedAt.toISOString(),
      },
      steps: request.steps.map((step) => ({
        id: step.id,
        tenantId: step.tenantId,
        approvalRequestId: step.approvalRequestId,
        stepName: step.stepName,
        stepOrder: step.stepOrder,
        reviewRound: step.reviewRound,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        branchKey: step.branchKey,
        policy: step.policy as StepPolicy,
        rejectionPolicy: step.rejectionPolicy as RejectionPolicy,
        totalAssigned: step.totalAssigned,
        requiredApprovals: step.requiredApprovals,
        approvedCount: step.approvedCount,
        rejectedCount: step.rejectedCount,
        status: step.status as StepStatus,
        assignedRole: step.assignedRole as UserRole | null,
        assignedToId: step.assignedToId,
        assignedTo: step.assignedTo
          ? {
              id: step.assignedTo.id,
              name: step.assignedTo.name,
              email: step.assignedTo.email,
              role: step.assignedTo.role as UserRole,
            }
          : null,
        actionedById: step.actionedById,
        actionedBy: step.actionedBy
          ? {
              id: step.actionedBy.id,
              name: step.actionedBy.name,
              email: step.actionedBy.email,
            }
          : null,
        actionedAt: step.actionedAt ? step.actionedAt.toISOString() : null,
        comments: step.comments,
        assignees: (step as any).assignees?.map((a: any) => ({
          id: a.id,
          tenantId: a.tenantId,
          stepId: a.stepId,
          reviewRound: a.reviewRound,
          assignedToId: a.assignedToId,
          assignedTo: a.assignedTo,
          assignedRole: a.assignedRole,
          status: a.status,
          actionedById: a.actionedById,
          actionedBy: a.actionedBy,
          delegatedFromUserId: a.delegatedFromUserId,
          delegatedFromUser: a.delegatedFromUser,
          actionedAt: a.actionedAt ? a.actionedAt.toISOString() : null,
          comments: a.comments,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        createdAt: step.createdAt.toISOString(),
        updatedAt: step.updatedAt.toISOString(),
      })),
      nodeExecutions: (request as any).nodeExecutions?.map((ne: any) => ({
        id: ne.id,
        tenantId: ne.tenantId,
        approvalRequestId: ne.approvalRequestId,
        reviewRound: ne.reviewRound,
        nodeId: ne.nodeId,
        nodeType: ne.nodeType,
        status: ne.status,
        activatedAt: ne.activatedAt ? ne.activatedAt.toISOString() : null,
        completedAt: ne.completedAt ? ne.completedAt.toISOString() : null,
        executionData: ne.executionData as Record<string, unknown>,
        createdAt: ne.createdAt.toISOString(),
        updatedAt: ne.updatedAt.toISOString(),
      })),
      branchExecutions: (request as any).branchExecutions?.map((be: any) => ({
        id: be.id,
        tenantId: be.tenantId,
        approvalRequestId: be.approvalRequestId,
        reviewRound: be.reviewRound,
        branchKey: be.branchKey,
        sourceNodeId: be.sourceNodeId,
        targetNodeId: be.targetNodeId,
        status: be.status,
        activatedAt: be.activatedAt ? be.activatedAt.toISOString() : null,
        completedAt: be.completedAt ? be.completedAt.toISOString() : null,
        createdAt: be.createdAt.toISOString(),
        updatedAt: be.updatedAt.toISOString(),
      })),
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        tenantId: log.tenantId,
        actorId: log.actorId,
        actor: log.actor,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        metadata: (log.metadata as Record<string, unknown>) || {},
        previousHash: log.previousHash,
        hash: log.hash,
        sequenceNumber: log.sequenceNumber,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Executes an approval action (APPROVE, REJECT, REQUEST_CHANGES) with concurrency safety,
   * role checks, state transition rules, and atomic audit logging.
   */
  async submitAction(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    id: string,
    dto: ApprovalActionDto,
  ) {
    // 1. Fetch request with strict tenant isolation
    const request = await this.prisma.approvalRequest.findUnique({
      where: {
        tenant_request_id_unique: {
          tenantId,
          id,
        },
      },
      include: {
        steps: {
          include: { assignees: true },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found in this tenant`);
    }

    const isDag = Boolean(request.currentNodeId);

    if (isDag) {
      if (dto.action === 'CANCEL') {
        throw new BadRequestException('Use POST /api/v1/requests/:id/cancel to cancel a request');
      }

      if (request.status !== 'IN_PROGRESS') {
        throw new ConflictException(
          `Cannot perform action '${dto.action}' on request with status '${request.status}'`,
        );
      }

      let targetStepId = dto.stepId;
      if (!targetStepId) {
        const currentRound = request.currentReviewRound || 1;
        const activeSteps = request.steps.filter(
          (s) =>
            s.status === 'IN_REVIEW' &&
            (s.reviewRound === undefined || s.reviewRound === currentRound),
        );

        if (activeSteps.length === 0) {
          throw new ConflictException('No active step is currently awaiting review');
        }

        const userStep = activeSteps.find(
          (s) =>
            s.assignedToId === userId ||
            (s.assignees &&
              s.assignees.some((a) => a.assignedToId === userId && a.status === 'PENDING')),
        );

        if (userStep) {
          targetStepId = userStep.id;
        } else if (activeSteps.length === 1) {
          targetStepId = activeSteps[0].id;
        } else {
          const roleStep = activeSteps.find((s) => s.assignedRole === userRole);
          targetStepId = roleStep ? roleStep.id : activeSteps[0].id;
        }
      }

      await this.graphEngine.submitGraphAction(tenantId, userId, userRole, id, targetStepId, {
        action: dto.action,
        comments: dto.comments,
        delegationId: dto.delegationId,
      });

      this.outboxPublisher.trigger();
      return this.findOne(tenantId, id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // 2. Validate current request status
      if (request.status !== 'IN_PROGRESS') {
        throw new ConflictException(
          `Cannot perform action '${dto.action}' on request with status '${request.status}'`,
        );
      }

      // 3. Find the current active step in review
      const currentStep = request.steps.find((s) => s.status === 'IN_REVIEW');
      if (!currentStep) {
        throw new ConflictException('No active step is currently awaiting review');
      }

      // 4. Validate user permission to act on this step
      const isTenantAdmin = userRole === 'TENANT_ADMIN' || userRole === 'SUPER_ADMIN';
      const isAssignedUser = currentStep.assignedToId === userId;
      const hasAssignedRole = currentStep.assignedRole && currentStep.assignedRole === userRole;
      const isEligibleApprover =
        !currentStep.assignedToId &&
        !currentStep.assignedRole &&
        (userRole === 'APPROVER' || userRole === 'MANAGER');

      if (!isTenantAdmin && !isAssignedUser && !hasAssignedRole && !isEligibleApprover) {
        throw new ForbiddenException(
          'You are not authorized to perform approval actions on this step',
        );
      }

      // 5. Prevent requester self-approval unless tenant admin
      if (request.requestedById === userId && !isTenantAdmin) {
        throw new ForbiddenException('Requesters cannot review or approve their own submissions');
      }

      const now = new Date();

      // 6. Execute state machine transition with database-level concurrency protection
      if (dto.action === 'APPROVE') {
        // Atomic conditional update on current step: prevents race condition where two concurrent
        // requests try to approve or act on the same step simultaneously.
        const stepUpdateResult = await tx.approvalStep.updateMany({
          where: {
            id: currentStep.id,
            approvalRequestId: id,
            tenantId,
            status: 'IN_REVIEW', // Strict atomic conditional guard!
          },
          data: {
            status: 'APPROVED',
            comments: dto.comments?.trim() || null,
            actionedById: userId,
            actionedAt: now,
          },
        });

        if (stepUpdateResult.count === 0) {
          throw new ConflictException(
            'This approval step is no longer awaiting review or has already been concurrently actioned by another approver',
          );
        }

        const nextStep = request.steps.find((s) => s.stepOrder === currentStep.stepOrder + 1);

        if (nextStep) {
          // Advance to next step
          await tx.approvalStep.update({
            where: { id: nextStep.id },
            data: { status: 'IN_REVIEW' },
          });

          await this.auditService.log(
            {
              tenantId,
              actorId: userId,
              entityType: 'ApprovalRequest',
              entityId: id,
              action: 'STEP_APPROVED',
              metadata: {
                stepOrder: currentStep.stepOrder,
                stepName: currentStep.stepName,
                nextStepOrder: nextStep.stepOrder,
                nextStepName: nextStep.stepName,
                comments: dto.comments,
              },
            },
            tx,
          );
        } else {
          // Final step approved -> Entire request APPROVED
          const reqUpdateResult = await tx.approvalRequest.updateMany({
            where: {
              id,
              tenantId,
              status: 'IN_PROGRESS',
            },
            data: { status: 'APPROVED' },
          });

          if (reqUpdateResult.count === 0) {
            throw new ConflictException(
              'Request is no longer in IN_PROGRESS status or has been concurrently modified',
            );
          }

          await this.auditService.log(
            {
              tenantId,
              actorId: userId,
              entityType: 'ApprovalRequest',
              entityId: id,
              action: 'STEP_APPROVED',
              metadata: {
                stepOrder: currentStep.stepOrder,
                stepName: currentStep.stepName,
                isFinalStep: true,
                comments: dto.comments,
              },
            },
            tx,
          );

          await this.auditService.log(
            {
              tenantId,
              actorId: userId,
              entityType: 'ApprovalRequest',
              entityId: id,
              action: 'REQUEST_APPROVED',
              metadata: {
                totalSteps: request.steps.length,
                comments: dto.comments,
              },
            },
            tx,
          );
        }
      } else if (dto.action === 'REJECT') {
        const stepUpdateResult = await tx.approvalStep.updateMany({
          where: {
            id: currentStep.id,
            approvalRequestId: id,
            tenantId,
            status: 'IN_REVIEW', // Strict atomic conditional guard!
          },
          data: {
            status: 'REJECTED',
            comments: dto.comments?.trim() || null,
            actionedById: userId,
            actionedAt: now,
          },
        });

        if (stepUpdateResult.count === 0) {
          throw new ConflictException(
            'This approval step is no longer awaiting review or has already been concurrently actioned by another approver',
          );
        }

        // Mark all future steps SKIPPED
        await tx.approvalStep.updateMany({
          where: {
            approvalRequestId: id,
            stepOrder: { gt: currentStep.stepOrder },
          },
          data: {
            status: 'SKIPPED',
          },
        });

        // Mark request REJECTED
        const reqUpdateResult = await tx.approvalRequest.updateMany({
          where: {
            id,
            tenantId,
            status: 'IN_PROGRESS',
          },
          data: { status: 'REJECTED' },
        });

        if (reqUpdateResult.count === 0) {
          throw new ConflictException(
            'Request is no longer in IN_PROGRESS status or has been concurrently modified',
          );
        }

        await this.auditService.log(
          {
            tenantId,
            actorId: userId,
            entityType: 'ApprovalRequest',
            entityId: id,
            action: 'REQUEST_REJECTED',
            metadata: {
              rejectedAtStepOrder: currentStep.stepOrder,
              stepName: currentStep.stepName,
              comments: dto.comments,
            },
          },
          tx,
        );
      } else if (dto.action === 'REQUEST_CHANGES') {
        const stepUpdateResult = await tx.approvalStep.updateMany({
          where: {
            id: currentStep.id,
            approvalRequestId: id,
            tenantId,
            status: 'IN_REVIEW', // Strict atomic conditional guard!
          },
          data: {
            comments: dto.comments?.trim() || null,
            actionedById: userId,
            actionedAt: now,
          },
        });

        if (stepUpdateResult.count === 0) {
          throw new ConflictException(
            'This approval step is no longer awaiting review or has already been concurrently actioned by another approver',
          );
        }

        // Move request to CHANGES_REQUESTED
        const reqUpdateResult = await tx.approvalRequest.updateMany({
          where: {
            id,
            tenantId,
            status: 'IN_PROGRESS',
          },
          data: { status: 'CHANGES_REQUESTED' },
        });

        if (reqUpdateResult.count === 0) {
          throw new ConflictException(
            'Request is no longer in IN_PROGRESS status or has been concurrently modified',
          );
        }

        await this.auditService.log(
          {
            tenantId,
            actorId: userId,
            entityType: 'ApprovalRequest',
            entityId: id,
            action: 'REQUEST_CHANGES_REQUESTED',
            metadata: {
              stepOrder: currentStep.stepOrder,
              stepName: currentStep.stepName,
              comments: dto.comments,
            },
          },
          tx,
        );
      }

      // --- TRANSACTIONAL OUTBOX: Atomic writes inside business transaction ---
      const txSteps = await tx.approvalStep.findMany({
        where: { approvalRequestId: id },
        orderBy: { stepOrder: 'asc' },
        include: { assignedTo: true },
      });
      const txReq = await tx.approvalRequest.findUnique({
        where: { id },
        include: { requestedBy: true },
      });
      const requesterEmail = txReq?.requestedBy?.email || `requester@flowgate.local`;

      if (dto.action === 'APPROVE') {
        const currentActive = txSteps.find((s) => s.status === 'IN_REVIEW');
        const previousStep = currentStep;

        if (previousStep) {
          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_ESCALATION_CANCEL,
            entityType: 'ApprovalStep',
            entityId: previousStep.id,
            idempotencyKey: `esc_cancel_${previousStep.id}_${Date.now()}`,
            payload: { tenantId, stepId: previousStep.id },
          });
        }

        if (currentActive) {
          const workflowConfig = (request.workflowSnapshot ||
            (
              await tx.workflowDefinition.findUnique({
                where: { id: request.workflowDefinitionId },
              })
            )?.configuration) as any;
          const nextStepConfig = workflowConfig?.steps?.find(
            (s: any) => s.stepOrder === currentActive.stepOrder,
          );

          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_ESCALATION_SCHEDULE,
            entityType: 'ApprovalStep',
            entityId: currentActive.id,
            idempotencyKey: `esc_sched_${currentActive.id}_${currentActive.stepOrder}`,
            payload: {
              tenantId,
              approvalRequestId: id,
              stepId: currentActive.id,
              stepOrder: currentActive.stepOrder,
              config: nextStepConfig,
            },
          });

          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_WEBHOOK,
            entityType: 'ApprovalRequest',
            entityId: id,
            idempotencyKey: `wh_step_appr_${id}_${previousStep?.stepOrder}`,
            payload: {
              tenantId,
              eventType: 'step.approved',
              data: {
                event: 'step.approved',
                tenantId,
                requestId: id,
                stepOrder: previousStep?.stepOrder,
                actionedById: userId,
              },
            },
          });

          const nextEmail =
            currentActive.assignedTo?.email ||
            `approvers@${currentActive.assignedRole?.toLowerCase() || 'approver'}.flowgate.local`;

          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_NOTIFICATION,
            entityType: 'ApprovalStep',
            entityId: currentActive.id,
            idempotencyKey: `notif_step_assign_${currentActive.id}`,
            payload: {
              tenantId,
              recipientEmail: nextEmail,
              recipientUserId: currentActive.assignedToId,
              eventType: 'STEP_ASSIGNED',
              subject: `Approval Required: "${request.title}"`,
              content: `You have been assigned Step ${currentActive.stepOrder} for approval request "${request.title}".`,
              idempotencyKey: `step-assigned:${currentActive.id}`,
              metadata: { requestId: id, stepId: currentActive.id },
            },
          });
        } else {
          // Final approval
          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_WEBHOOK,
            entityType: 'ApprovalRequest',
            entityId: id,
            idempotencyKey: `wh_req_appr_${id}`,
            payload: {
              tenantId,
              eventType: 'request.approved',
              data: {
                event: 'request.approved',
                tenantId,
                requestId: id,
                title: request.title,
                actionedById: userId,
              },
            },
          });

          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_NOTIFICATION,
            entityType: 'ApprovalRequest',
            entityId: id,
            idempotencyKey: `notif_req_appr_${id}`,
            payload: {
              tenantId,
              recipientEmail: requesterEmail,
              recipientUserId: txReq?.requestedById,
              eventType: 'REQUEST_APPROVED',
              subject: `Approved: "${request.title}"`,
              content: `Your approval request "${request.title}" has received final sign-off and is APPROVED.`,
              idempotencyKey: `req-approved:${id}`,
              metadata: { requestId: id },
            },
          });
        }
      } else if (dto.action === 'REJECT') {
        for (const step of txSteps) {
          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_ESCALATION_CANCEL,
            entityType: 'ApprovalStep',
            entityId: step.id,
            idempotencyKey: `esc_cancel_rej_${step.id}`,
            payload: { tenantId, stepId: step.id },
          });
        }

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_WEBHOOK,
          entityType: 'ApprovalRequest',
          entityId: id,
          idempotencyKey: `wh_req_rej_${id}`,
          payload: {
            tenantId,
            eventType: 'request.rejected',
            data: {
              event: 'request.rejected',
              tenantId,
              requestId: id,
              title: request.title,
              actionedById: userId,
              comments: dto.comments,
            },
          },
        });

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_NOTIFICATION,
          entityType: 'ApprovalRequest',
          entityId: id,
          idempotencyKey: `notif_req_rej_${id}`,
          payload: {
            tenantId,
            recipientEmail: requesterEmail,
            recipientUserId: txReq?.requestedById,
            eventType: 'REQUEST_REJECTED',
            subject: `Rejected: "${request.title}"`,
            content: `Your approval request "${request.title}" was REJECTED: ${dto.comments || 'No comments provided'}.`,
            idempotencyKey: `req-rejected:${id}`,
            metadata: { requestId: id },
          },
        });
      } else if (dto.action === 'REQUEST_CHANGES') {
        const activeStep = txSteps.find((s) => s.id === currentStep.id);
        if (activeStep) {
          await this.outboxService.createEvent(tx, {
            tenantId,
            eventType: OUTBOX_EVENT_ESCALATION_CANCEL,
            entityType: 'ApprovalStep',
            entityId: activeStep.id,
            idempotencyKey: `esc_cancel_chg_${activeStep.id}`,
            payload: { tenantId, stepId: activeStep.id },
          });
        }

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_WEBHOOK,
          entityType: 'ApprovalRequest',
          entityId: id,
          idempotencyKey: `wh_req_chg_${id}`,
          payload: {
            tenantId,
            eventType: 'request.changes_requested',
            data: {
              event: 'request.changes_requested',
              tenantId,
              requestId: id,
              title: request.title,
              actionedById: userId,
              comments: dto.comments,
            },
          },
        });

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_NOTIFICATION,
          entityType: 'ApprovalRequest',
          entityId: id,
          idempotencyKey: `notif_req_chg_${id}`,
          payload: {
            tenantId,
            recipientEmail: requesterEmail,
            recipientUserId: txReq?.requestedById,
            eventType: 'CHANGES_REQUESTED',
            subject: `Changes Requested: "${request.title}"`,
            content: `Changes have been requested on "${request.title}": ${dto.comments || 'Please revise your submission'}.`,
            idempotencyKey: `req-changes:${id}`,
            metadata: { requestId: id },
          },
        });
      }

      return this.findOne(tenantId, id, tx);
    });

    // Trigger immediate outbox publication sweep (non-blocking)
    this.outboxPublisher.trigger();

    return updated;
  }

  /**
   * Resubmits a request after the requester has made requested modifications.
   */
  async resubmit(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    id: string,
    dto: ResubmitRequestDto,
  ) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: {
        tenant_request_id_unique: {
          tenantId,
          id,
        },
      },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found in this tenant`);
    }

    const isDag = Boolean(request.currentNodeId);

    if (isDag) {
      if (request.status !== 'CHANGES_REQUESTED') {
        throw new ConflictException(
          `Cannot resubmit a request with status '${request.status}'. Must be in 'CHANGES_REQUESTED'`,
        );
      }

      const isTenantAdmin = userRole === 'TENANT_ADMIN' || userRole === 'SUPER_ADMIN';
      if (request.requestedById !== userId && !isTenantAdmin) {
        throw new ForbiddenException('Only the original requester can resubmit changes');
      }

      await this.graphEngine.resubmitGraphRequest(tenantId, userId, id, {
        updatedData: dto.updatedData || dto.requestData,
        comments: dto.comments,
        resubmissionPolicy: dto.resubmissionPolicy,
      });

      this.outboxPublisher.trigger();
      return this.findOne(tenantId, id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (request.status !== 'CHANGES_REQUESTED') {
        throw new ConflictException(
          `Cannot resubmit a request with status '${request.status}'. Must be in 'CHANGES_REQUESTED'`,
        );
      }

      const isTenantAdmin = userRole === 'TENANT_ADMIN' || userRole === 'SUPER_ADMIN';
      if (request.requestedById !== userId && !isTenantAdmin) {
        throw new ForbiddenException('Only the original requester can resubmit changes');
      }

      const resubmitResult = await tx.approvalRequest.updateMany({
        where: {
          id,
          tenantId,
          status: 'CHANGES_REQUESTED', // Atomic condition!
        },
        data: {
          status: 'IN_PROGRESS',
          title: dto.title ? dto.title.trim() : undefined,
          description: dto.description !== undefined ? dto.description?.trim() : undefined,
        },
      });

      if (resubmitResult.count === 0) {
        throw new ConflictException(
          'Request is no longer in CHANGES_REQUESTED status or was modified concurrently',
        );
      }

      await this.auditService.log(
        {
          tenantId,
          actorId: userId,
          entityType: 'ApprovalRequest',
          entityId: id,
          action: 'REQUEST_RESUBMITTED',
          metadata: {
            comments: dto.comments,
          },
        },
        tx,
      );

      // --- TRANSACTIONAL OUTBOX: Atomic writes inside business transaction ---
      const txSteps = await tx.approvalStep.findMany({
        where: { approvalRequestId: id },
        orderBy: { stepOrder: 'asc' },
        include: { assignedTo: true },
      });
      const activeStep = txSteps.find((s) => s.status === 'IN_REVIEW');
      if (activeStep) {
        const workflowConfig = (request.workflowSnapshot ||
          (await tx.workflowDefinition.findUnique({ where: { id: request.workflowDefinitionId } }))
            ?.configuration) as any;
        const stepConfig = workflowConfig?.steps?.find(
          (s: any) => s.stepOrder === activeStep.stepOrder,
        );

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_ESCALATION_SCHEDULE,
          entityType: 'ApprovalStep',
          entityId: activeStep.id,
          idempotencyKey: `esc_sched_resub_${activeStep.id}_${Date.now()}`,
          payload: {
            tenantId,
            approvalRequestId: id,
            stepId: activeStep.id,
            stepOrder: activeStep.stepOrder,
            config: stepConfig,
          },
        });

        const recipientEmail =
          activeStep.assignedTo?.email ||
          `approvers@${activeStep.assignedRole?.toLowerCase() || 'approver'}.flowgate.local`;

        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_NOTIFICATION,
          entityType: 'ApprovalStep',
          entityId: activeStep.id,
          idempotencyKey: `notif_resub_${activeStep.id}_${Date.now()}`,
          payload: {
            tenantId,
            recipientEmail,
            recipientUserId: activeStep.assignedToId,
            eventType: 'REQUEST_RESUBMITTED',
            subject: `Request Resubmitted: "${request.title}"`,
            content: `Approval request "${request.title}" has been revised and resubmitted for your review: ${dto.comments || 'No comments provided'}.`,
            idempotencyKey: `req-resubmitted:${id}:${Date.now()}`,
            metadata: { requestId: id, stepId: activeStep.id },
          },
        });
      }

      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_WEBHOOK,
        entityType: 'ApprovalRequest',
        entityId: id,
        idempotencyKey: `wh_req_resub_${id}_${Date.now()}`,
        payload: {
          tenantId,
          eventType: 'request.resubmitted',
          data: {
            event: 'request.resubmitted',
            tenantId,
            requestId: id,
            title: request.title,
            resubmittedById: userId,
            comments: dto.comments,
          },
        },
      });

      return this.findOne(tenantId, id, tx);
    });

    // Trigger immediate outbox publication sweep (non-blocking)
    this.outboxPublisher.trigger();

    return updated;
  }

  /**
   * Cancels a pending or in-progress approval request.
   */
  async cancel(tenantId: string, userId: string, userRole: UserRole, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findUnique({
        where: {
          tenant_request_id_unique: {
            tenantId,
            id,
          },
        },
      });

      if (!request) {
        throw new NotFoundException(`Approval request '${id}' not found in this tenant`);
      }

      if (
        request.status === 'APPROVED' ||
        request.status === 'REJECTED' ||
        request.status === 'CANCELLED'
      ) {
        throw new ConflictException(
          `Cannot cancel an approval request that is already in '${request.status}' state`,
        );
      }

      const isTenantAdmin = userRole === 'TENANT_ADMIN' || userRole === 'SUPER_ADMIN';
      if (request.requestedById !== userId && !isTenantAdmin) {
        throw new ForbiddenException(
          'Only the original requester or an administrator can cancel a request',
        );
      }

      await tx.approvalStep.updateMany({
        where: {
          approvalRequestId: id,
          status: { in: ['PENDING', 'IN_REVIEW'] },
        },
        data: {
          status: 'SKIPPED',
        },
      });

      const cancelResult = await tx.approvalRequest.updateMany({
        where: {
          id,
          tenantId,
          status: { in: ['PENDING', 'IN_PROGRESS', 'CHANGES_REQUESTED'] }, // Atomic condition!
        },
        data: {
          status: 'CANCELLED',
        },
      });

      if (cancelResult.count === 0) {
        throw new ConflictException(
          'Request cannot be cancelled in its current state or was modified concurrently',
        );
      }

      await this.auditService.log(
        {
          tenantId,
          actorId: userId,
          entityType: 'ApprovalRequest',
          entityId: id,
          action: 'REQUEST_CANCELLED',
        },
        tx,
      );

      // --- TRANSACTIONAL OUTBOX: Atomic writes inside business transaction ---
      const txSteps = await tx.approvalStep.findMany({
        where: { approvalRequestId: id },
      });
      for (const step of txSteps) {
        await this.outboxService.createEvent(tx, {
          tenantId,
          eventType: OUTBOX_EVENT_ESCALATION_CANCEL,
          entityType: 'ApprovalStep',
          entityId: step.id,
          idempotencyKey: `esc_cancel_canc_${step.id}`,
          payload: { tenantId, stepId: step.id },
        });
      }

      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_WEBHOOK,
        entityType: 'ApprovalRequest',
        entityId: id,
        idempotencyKey: `wh_req_cancel_${id}`,
        payload: {
          tenantId,
          eventType: 'request.cancelled',
          data: {
            event: 'request.cancelled',
            tenantId,
            requestId: id,
            title: request.title,
            cancelledById: userId,
          },
        },
      });

      return this.findOne(tenantId, id, tx);
    });

    // Trigger immediate outbox publication sweep (non-blocking)
    this.outboxPublisher.trigger();

    return updated;
  }

  /**
   * Retrieves the normalized execution graph / tree for visual DAG rendering
   */
  async getExecutionGraph(tenantId: string, requestId: string) {
    return this.graphEngine.getExecutionGraph(tenantId, requestId);
  }
}

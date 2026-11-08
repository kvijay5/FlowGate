import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, StepPolicy, RejectionPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { OUTBOX_EVENT_NOTIFICATION, OUTBOX_EVENT_WEBHOOK } from '../outbox/outbox.constants';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import {
  WorkflowGraphValidatorService,
  ValidatedWorkflowGraph,
} from './workflow-graph-validator.service';
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraphConfiguration,
  ConditionRule,
} from '@flowgate/shared-types';

export interface InitializeGraphDto {
  title: string;
  description?: string;
  requestData?: Record<string, unknown>;
}

export interface SubmitGraphActionDto {
  action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  comments?: string;
  delegationId?: string;
}

export interface ResubmitGraphDto {
  updatedData?: Record<string, unknown>;
  comments?: string;
  resubmissionPolicy?: 'REOPEN_ALL' | 'SELECTIVE_FAST_FORWARD';
}

@Injectable()
export class WorkflowGraphEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly astEvaluator: AstConditionEvaluatorService,
    private readonly graphValidator: WorkflowGraphValidatorService,
  ) {}

  /**
   * Initializes and submits an approval request backed by a DAG workflow definition.
   * Validates payload against trigger schema, creates immutable snapshot, and initiates traversal.
   */
  public async initializeGraphExecution(
    tenantId: string,
    userId: string,
    workflowId: string,
    dto: InitializeGraphDto,
  ) {
    // 1. Fetch workflow definition
    const workflow = await this.prisma.workflowDefinition.findUnique({
      where: {
        tenant_workflow_id_unique: {
          tenantId,
          id: workflowId,
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException('Workflow definition not found in this tenant');
    }

    if (workflow.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot create request using an inactive or archived workflow');
    }

    const rawConfig = workflow.configuration as unknown as WorkflowGraphConfiguration;

    // 2. Validate DAG configuration
    const validatedGraph = this.graphValidator.validateDAG(rawConfig);

    // 3. Validate requestData against trigger schema and byte limit
    const requestData = dto.requestData || {};
    this.astEvaluator.assertPayloadSize(requestData);

    if (validatedGraph.inputSchema) {
      this.validatePayloadAgainstSchema(requestData, validatedGraph.inputSchema);
    }

    // 4. Execute creation and initial traversal inside transaction
    return this.prisma.$transaction(async (tx) => {
      const triggerNode = validatedGraph.triggerNode;

      const request = await tx.approvalRequest.create({
        data: {
          tenantId,
          workflowDefinitionId: workflow.id,
          workflowVersion: workflow.version,
          workflowSnapshot: validatedGraph as unknown as Prisma.InputJsonValue,
          requestedById: userId,
          title: dto.title.trim(),
          description: dto.description?.trim(),
          requestData: requestData as Prisma.InputJsonValue,
          status: 'IN_PROGRESS',
          currentReviewRound: 1,
          currentNodeId: triggerNode.id,
        },
      });

      // Initialize all Node Execution rows for Round 1
      for (const node of validatedGraph.nodes) {
        const isTrigger = node.id === triggerNode.id;
        await tx.workflowNodeExecution.create({
          data: {
            tenantId,
            approvalRequestId: request.id,
            reviewRound: 1,
            nodeId: node.id,
            nodeType: node.type,
            status: isTrigger ? 'COMPLETED' : 'PENDING',
            activatedAt: isTrigger ? new Date() : null,
            completedAt: isTrigger ? new Date() : null,
          },
        });
      }

      // Initialize all Branch Execution rows for Round 1
      for (const edge of validatedGraph.edges) {
        const isTriggerOutgoing = edge.sourceNodeId === triggerNode.id;
        await tx.workflowBranchExecution.create({
          data: {
            tenantId,
            approvalRequestId: request.id,
            reviewRound: 1,
            branchKey: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            status: isTriggerOutgoing ? 'ACTIVE' : 'NOT_EVALUATED',
            activatedAt: isTriggerOutgoing ? new Date() : null,
          },
        });
      }

      // Record Audit Log
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
            version: workflow.version,
            reviewRound: 1,
          },
        },
        tx,
      );

      // Publish Outbox Webhook & Notification
      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_WEBHOOK,
        entityType: 'ApprovalRequest',
        entityId: request.id,
        idempotencyKey: `wh_graph_req_created_${request.id}`,
        payload: {
          tenantId,
          eventType: 'request.created',
          data: {
            event: 'request.created',
            tenantId,
            requestId: request.id,
            title: request.title,
            workflowId: workflow.id,
          },
        },
      });

      // Advance execution from TRIGGER's active outgoing edges
      await this.advanceExecution(tenantId, request.id, 1, validatedGraph, tx);

      // Return fully hydrated request
      return tx.approvalRequest.findUnique({
        where: { id: request.id },
        include: {
          steps: {
            where: { reviewRound: 1 },
            include: { assignees: true },
            orderBy: { stepOrder: 'asc' },
          },
          nodeExecutions: {
            where: { reviewRound: 1 },
          },
          branchExecutions: {
            where: { reviewRound: 1 },
          },
        },
      });
    });
  }

  /**
   * Submits an approval action on a step/assignee with parallel voting & reachability invariants.
   */
  public async submitGraphAction(
    tenantId: string,
    userId: string,
    userRole: string,
    requestId: string,
    stepId: string,
    dto: SubmitGraphActionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Acquire row locks via FOR UPDATE
      await tx.$queryRaw`
        SELECT id FROM approval_requests WHERE id = ${requestId}::uuid FOR UPDATE;
      `;
      await tx.$queryRaw`
        SELECT id FROM approval_steps WHERE id = ${stepId}::uuid FOR UPDATE;
      `;

      // 2. Fetch locked request
      const request = await tx.approvalRequest.findUnique({
        where: { id: requestId },
      });

      if (!request || request.tenantId !== tenantId) {
        throw new NotFoundException('Approval request not found');
      }

      if (request.status !== 'IN_PROGRESS') {
        throw new BadRequestException(
          `Cannot perform action on request in '${request.status}' status`,
        );
      }

      const currentRound = request.currentReviewRound;

      // 3. Fetch locked step
      const step = await tx.approvalStep.findUnique({
        where: { id: stepId },
        include: { assignees: true },
      });

      if (!step || step.approvalRequestId !== requestId || step.reviewRound !== currentRound) {
        throw new NotFoundException('Approval step not found in current review round');
      }

      if (step.status !== 'IN_REVIEW') {
        throw new BadRequestException(`Cannot perform action on step in '${step.status}' status`);
      }

      // 3. Authorize voter (direct assignment, role match, or valid delegation)
      const { effectiveVoterId, delegatorId } = await this.resolveVoterAuthorization(
        tenantId,
        userId,
        userRole,
        step,
        dto.delegationId,
        tx,
      );

      // Check for duplicate vote
      const existingAssignee = step.assignees.find((a) => a.assignedToId === effectiveVoterId);

      if (existingAssignee && existingAssignee.status !== 'PENDING') {
        throw new BadRequestException(
          'User has already submitted a decision for this approval step',
        );
      }

      const validatedGraph = request.workflowSnapshot as unknown as ValidatedWorkflowGraph;

      // 4. Handle REQUEST_CHANGES
      if (dto.action === 'REQUEST_CHANGES') {
        if (existingAssignee) {
          await tx.approvalStepAssignee.update({
            where: { id: existingAssignee.id },
            data: {
              status: 'REJECTED',
              actionedById: userId,
              delegatedFromUserId: delegatorId || null,
              actionedAt: new Date(),
              comments: dto.comments || 'Changes requested',
            },
          });
        }

        await tx.approvalStep.update({
          where: { id: step.id },
          data: {
            status: 'REJECTED',
            comments: dto.comments || 'Changes requested',
          },
        });

        await tx.approvalRequest.update({
          where: { id: requestId },
          data: {
            status: 'CHANGES_REQUESTED',
          },
        });

        await this.auditService.log(
          {
            tenantId,
            actorId: userId,
            entityType: 'ApprovalRequest',
            entityId: requestId,
            action: 'REQUEST_CHANGES_REQUESTED',
            metadata: {
              stepId: step.id,
              nodeId: step.nodeId,
              comments: dto.comments,
              reviewRound: currentRound,
            },
          },
          tx,
        );

        return { success: true, stepStatus: 'REJECTED', requestStatus: 'CHANGES_REQUESTED' };
      }

      // 5. Update Assignee row for APPROVE / REJECT
      const isApproved = dto.action === 'APPROVE';
      const newAssigneeStatus = isApproved ? 'APPROVED' : 'REJECTED';

      if (existingAssignee) {
        await tx.approvalStepAssignee.update({
          where: { id: existingAssignee.id },
          data: {
            status: newAssigneeStatus,
            actionedById: userId,
            delegatedFromUserId: delegatorId || null,
            actionedAt: new Date(),
            comments: dto.comments || null,
          },
        });
      }

      // Update counters atomically
      const newApprovedCount = isApproved ? step.approvedCount + 1 : step.approvedCount;
      const newRejectedCount = !isApproved ? step.rejectedCount + 1 : step.rejectedCount;

      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          approvedCount: newApprovedCount,
          rejectedCount: newRejectedCount,
        },
      });

      // 6. Evaluate Parallel Reachability & Quorum Math
      const totalAssigned = step.totalAssigned;
      const requiredApprovals = step.requiredApprovals;
      const policy = step.policy as StepPolicy;
      const rejectionPolicy = step.rejectionPolicy as RejectionPolicy;

      const pendingEligibleCount = totalAssigned - (newApprovedCount + newRejectedCount);
      const maxAchievableApprovals = newApprovedCount + pendingEligibleCount;

      let stepApproved = false;
      let stepRejected = false;
      let rejectionReason = '';

      if (policy === 'PARALLEL_AND') {
        if (!isApproved) {
          // In PARALLEL_AND, a single rejection rejects immediately
          stepRejected = true;
          rejectionReason = 'PARALLEL_AND unanimous consent failed: individual rejection recorded';
        } else if (newApprovedCount >= totalAssigned) {
          stepApproved = true;
        }
      } else if (policy === 'PARALLEL_OR') {
        if (rejectionPolicy === 'STRICT_VETO' && newRejectedCount >= 1) {
          stepRejected = true;
          rejectionReason = 'PARALLEL_OR stage terminated by STRICT_VETO';
        } else if (newApprovedCount >= requiredApprovals) {
          stepApproved = true;
        } else if (maxAchievableApprovals < requiredApprovals) {
          // QUORUM LOST!
          stepRejected = true;
          rejectionReason = `QUORUM_LOST: Max achievable approvals (${maxAchievableApprovals}) is less than required (${requiredApprovals})`;
        }
      } else {
        // SEQUENTIAL
        if (isApproved) {
          stepApproved = true;
        } else {
          stepRejected = true;
          rejectionReason = 'Sequential step rejected';
        }
      }

      // 7. Apply Outcome
      if (stepRejected) {
        // Mark step REJECTED
        await tx.approvalStep.update({
          where: { id: step.id },
          data: {
            status: 'REJECTED',
            comments: rejectionReason,
          },
        });

        // Mark remaining pending assignees SKIPPED
        await tx.approvalStepAssignee.updateMany({
          where: { stepId: step.id, status: 'PENDING' },
          data: {
            status: 'SKIPPED',
            comments: 'Stage aborted due to rejection or quorum loss',
          },
        });

        // Mark node execution FAILED
        await tx.workflowNodeExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound: currentRound,
            nodeId: step.nodeId,
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
          },
        });

        // Mark request REJECTED
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'REJECTED' },
        });

        await this.auditService.log(
          {
            tenantId,
            actorId: userId,
            entityType: 'ApprovalStep',
            entityId: step.id,
            action: rejectionReason.includes('QUORUM_LOST')
              ? 'STEP_REJECTED_QUORUM_LOST'
              : 'STEP_REJECTED',
            metadata: {
              rejectionReason,
              approvedCount: newApprovedCount,
              rejectedCount: newRejectedCount,
              totalAssigned,
              requiredApprovals,
              reviewRound: currentRound,
            },
          },
          tx,
        );

        return { success: true, stepStatus: 'REJECTED', requestStatus: 'REJECTED' };
      }

      if (stepApproved) {
        // Mark step APPROVED
        await tx.approvalStep.update({
          where: { id: step.id },
          data: { status: 'APPROVED' },
        });

        // Mark remaining pending assignees SKIPPED (resolved by peer quorum)
        await tx.approvalStepAssignee.updateMany({
          where: { stepId: step.id, status: 'PENDING' },
          data: {
            status: 'SKIPPED',
            comments: 'Resolved by peer approval',
          },
        });

        // Mark node execution COMPLETED
        await tx.workflowNodeExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound: currentRound,
            nodeId: step.nodeId,
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Activate outgoing edges from this node
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound: currentRound,
            sourceNodeId: step.nodeId,
          },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        });

        await this.auditService.log(
          {
            tenantId,
            actorId: userId,
            entityType: 'ApprovalStep',
            entityId: step.id,
            action: 'STEP_APPROVED',
            metadata: {
              approvedCount: newApprovedCount,
              requiredApprovals,
              reviewRound: currentRound,
            },
          },
          tx,
        );

        // Advance execution into downstream nodes
        await this.advanceExecution(tenantId, requestId, currentRound, validatedGraph, tx);

        return { success: true, stepStatus: 'APPROVED', requestStatus: 'IN_PROGRESS' };
      }

      // Still in review (e.g. 1-of-3 approved in PARALLEL_AND)
      return { success: true, stepStatus: 'IN_REVIEW', requestStatus: 'IN_PROGRESS' };
    });
  }

  /**
   * Resubmits a request in CHANGES_REQUESTED with updated payload into a new Review Round.
   * Preserves previous round records immutable and supports REOPEN_ALL or SELECTIVE_FAST_FORWARD.
   */
  public async resubmitGraphRequest(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: ResubmitGraphDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Acquire row lock
      const request = await tx.approvalRequest.findUnique({
        where: { id: requestId },
      });

      if (!request || request.tenantId !== tenantId) {
        throw new NotFoundException('Approval request not found');
      }

      if (request.status !== 'CHANGES_REQUESTED') {
        throw new BadRequestException(
          `Only requests in 'CHANGES_REQUESTED' status can be resubmitted (current: ${request.status})`,
        );
      }

      const previousRound = request.currentReviewRound;
      const newRound = previousRound + 1;

      // 2. Merge requestData
      const previousData = (request.requestData as Record<string, unknown>) || {};
      const updatedData = { ...previousData, ...(dto.updatedData || {}) };
      this.astEvaluator.assertPayloadSize(updatedData);

      const validatedGraph = request.workflowSnapshot as unknown as ValidatedWorkflowGraph;
      if (validatedGraph.inputSchema) {
        this.validatePayloadAgainstSchema(updatedData, validatedGraph.inputSchema);
      }

      const policy = dto.resubmissionPolicy || 'REOPEN_ALL';

      // 3. Update request with new review round
      const triggerNode = validatedGraph.triggerNode;
      await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          currentReviewRound: newRound,
          requestData: updatedData as Prisma.InputJsonValue,
          status: 'IN_PROGRESS',
          currentNodeId: triggerNode.id,
        },
      });

      // 4. Initialize Node and Branch Execution rows for the new round
      for (const node of validatedGraph.nodes) {
        const isTrigger = node.id === triggerNode.id;
        await tx.workflowNodeExecution.create({
          data: {
            tenantId,
            approvalRequestId: requestId,
            reviewRound: newRound,
            nodeId: node.id,
            nodeType: node.type,
            status: isTrigger ? 'COMPLETED' : 'PENDING',
            activatedAt: isTrigger ? new Date() : null,
            completedAt: isTrigger ? new Date() : null,
          },
        });
      }

      for (const edge of validatedGraph.edges) {
        const isTriggerOutgoing = edge.sourceNodeId === triggerNode.id;
        await tx.workflowBranchExecution.create({
          data: {
            tenantId,
            approvalRequestId: requestId,
            reviewRound: newRound,
            branchKey: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            status: isTriggerOutgoing ? 'ACTIVE' : 'NOT_EVALUATED',
            activatedAt: isTriggerOutgoing ? new Date() : null,
          },
        });
      }

      // Log Resubmission to Audit Chain
      await this.auditService.log(
        {
          tenantId,
          actorId: userId,
          entityType: 'ApprovalRequest',
          entityId: requestId,
          action: 'REQUEST_RESUBMITTED',
          metadata: {
            fromRound: previousRound,
            toRound: newRound,
            policy,
            comments: dto.comments,
          },
        },
        tx,
      );

      // Publish Outbox Event
      await this.outboxService.createEvent(tx, {
        tenantId,
        eventType: OUTBOX_EVENT_NOTIFICATION,
        entityType: 'ApprovalRequest',
        entityId: requestId,
        idempotencyKey: `notif_graph_resub_${requestId}_r${newRound}`,
        payload: {
          tenantId,
          eventType: 'REQUEST_RESUBMITTED',
          subject: `Request Resubmitted (Round ${newRound}): "${request.title}"`,
          content: `Approval request "${request.title}" has been resubmitted for Review Round ${newRound}.`,
          metadata: { requestId, reviewRound: newRound },
        },
      });

      // 5. Advance execution in Round newRound
      await this.advanceExecution(tenantId, requestId, newRound, validatedGraph, tx);

      return tx.approvalRequest.findUnique({
        where: { id: requestId },
        include: {
          steps: {
            where: { reviewRound: newRound },
            include: { assignees: true },
          },
          nodeExecutions: {
            where: { reviewRound: newRound },
          },
          branchExecutions: {
            where: { reviewRound: newRound },
          },
        },
      });
    });
  }

  /**
   * Recursive automated node traversal engine. Handles CONDITION routing, recursive pruning,
   * ALL_INCOMING Join synchronization with row locking, and approval stage activation.
   */
  public async advanceExecution(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    graph: ValidatedWorkflowGraph,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node);
    }

    // Find all ACTIVE branches in this review round
    const activeBranches = await tx.workflowBranchExecution.findMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        status: 'ACTIVE',
      },
    });

    if (activeBranches.length === 0) {
      return;
    }

    for (const branch of activeBranches) {
      // Transition branch to COMPLETED
      await tx.workflowBranchExecution.update({
        where: { id: branch.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      const targetNode = nodeMap.get(branch.targetNodeId);
      if (!targetNode) continue;

      const nodeType = this.normalizeNodeType(targetNode.type);

      if (nodeType === 'APPROVAL_STEP' || nodeType === 'PARALLEL_APPROVAL') {
        // Activate approval stage
        await this.activateApprovalStage(tenantId, requestId, reviewRound, targetNode, tx);
      } else if (nodeType === 'CONDITION') {
        // Evaluate condition and prune alternative branches
        await this.evaluateConditionNode(tenantId, requestId, reviewRound, targetNode, graph, tx);
      } else if (nodeType === 'JOIN') {
        // Concurrency-safe join resolution
        await this.resolveJoinNode(tenantId, requestId, reviewRound, targetNode, graph, tx);
      } else if (nodeType === 'END') {
        // Terminal node reached
        await this.completeWorkflowExecution(tenantId, requestId, reviewRound, targetNode, tx);
      }
    }
  }

  /**
   * Activates an APPROVAL_STEP or PARALLEL_APPROVAL node, creates ApprovalStep & Assignee rows.
   */
  private async activateApprovalStage(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    node: WorkflowNode,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // 1. Mark node execution IN_REVIEW
    await tx.workflowNodeExecution.updateMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        nodeId: node.id,
      },
      data: {
        status: 'IN_REVIEW',
        activatedAt: new Date(),
      },
    });

    // Update request currentNodeId
    await tx.approvalRequest.update({
      where: { id: requestId },
      data: { currentNodeId: node.id },
    });

    const isParallel = this.normalizeNodeType(node.type) === 'PARALLEL_APPROVAL';
    const config = node.config || {};

    const policy: StepPolicy = isParallel
      ? (config.policy as StepPolicy) || 'PARALLEL_AND'
      : 'SEQUENTIAL';
    const rejectionPolicy: RejectionPolicy =
      (config.rejectionPolicy as RejectionPolicy) || 'SOFT_REJECTION';

    // 2. Resolve assignees
    const distinctUsers = await this.resolveEligibleAssignees(tenantId, node, tx);

    const totalAssigned = Math.max(1, distinctUsers.length);
    const requiredApprovals = isParallel
      ? policy === 'PARALLEL_AND'
        ? totalAssigned
        : typeof config.requiredApprovals === 'number'
          ? config.requiredApprovals
          : 1
      : 1;

    // Check step count
    const existingStepCount = await tx.approvalStep.count({
      where: { approvalRequestId: requestId, reviewRound },
    });
    const stepOrder = existingStepCount + 1;

    // 3. Create ApprovalStep
    const step = await tx.approvalStep.create({
      data: {
        tenantId,
        approvalRequestId: requestId,
        reviewRound,
        nodeId: node.id,
        nodeType: node.type,
        stepName: node.name || 'Approval Step',
        stepOrder,
        status: 'IN_REVIEW',
        policy,
        rejectionPolicy,
        totalAssigned,
        requiredApprovals,
        approvedCount: 0,
        rejectedCount: 0,
        assignedToId: !isParallel && distinctUsers.length === 1 ? distinctUsers[0].id : null,
        assignedRole: config.role ? (config.role as any) : null,
      },
    });

    // 4. Create ApprovalStepAssignee rows
    for (const u of distinctUsers) {
      await tx.approvalStepAssignee.create({
        data: {
          tenantId,
          stepId: step.id,
          assignedToId: u.id,
          assignedRole: u.role as any,
          status: 'PENDING',
        },
      });
    }

    // Record Audit Log
    await this.auditService.log(
      {
        tenantId,
        entityType: 'ApprovalStep',
        entityId: step.id,
        action: 'STEP_ACTIVATED',
        metadata: {
          nodeId: node.id,
          policy,
          totalAssigned,
          requiredApprovals,
          reviewRound,
        },
      },
      tx,
    );
  }

  /**
   * Evaluates a CONDITION node using AST evaluator, activates winning branch, and recursively prunes alternatives.
   */
  private async evaluateConditionNode(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    node: WorkflowNode,
    graph: ValidatedWorkflowGraph,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const request = await tx.approvalRequest.findUnique({
      where: { id: requestId },
    });
    const requestData = (request?.requestData as Record<string, unknown>) || {};

    const config = node.config || {};
    const rules: ConditionRule[] = config.rules || [];

    const outgoingEdges = graph.edges.filter((e) => e.sourceNodeId === node.id);
    const winningEdgeIds = new Set<string>();
    let matchedBranchKey: string | null = null;
    let matchedTargetNodeId: string | null = null;
    let evaluationTrace: unknown = null;

    // Evaluate rules in order
    for (const rule of rules) {
      if (rule.expression) {
        const evalResult = this.astEvaluator.evaluate(rule.expression, requestData);
        if (evalResult.result) {
          // Rule matched
          matchedBranchKey = rule.branchKey || rule.id;
          matchedTargetNodeId = rule.targetNodeId;
          evaluationTrace = evalResult.trace;
          break;
        }
      }
    }

    if (matchedBranchKey) {
      for (const edge of outgoingEdges) {
        if (
          edge.id === matchedBranchKey ||
          edge.sourceHandle === matchedBranchKey ||
          edge.targetNodeId === matchedTargetNodeId
        ) {
          winningEdgeIds.add(edge.id);
        }
      }
    } else if (config.defaultTargetNodeId) {
      for (const edge of outgoingEdges) {
        if (edge.targetNodeId === config.defaultTargetNodeId || edge.sourceHandle === 'default') {
          winningEdgeIds.add(edge.id);
        }
      }
    }

    // Safety fallback: if no winning edges matched, activate first edge
    if (winningEdgeIds.size === 0 && outgoingEdges.length > 0) {
      winningEdgeIds.add(outgoingEdges[0].id);
    }

    // Mark CONDITION node COMPLETED
    await tx.workflowNodeExecution.updateMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        nodeId: node.id,
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        executionData: (evaluationTrace ? { trace: evaluationTrace } : {}) as Prisma.InputJsonValue,
      },
    });

    // Process outgoing edges: winning edges -> ACTIVE; all others -> PRUNED_SKIPPED
    const prunedEdges: WorkflowEdge[] = [];

    for (const edge of outgoingEdges) {
      if (winningEdgeIds.has(edge.id)) {
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            branchKey: edge.id,
          },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        });
      } else {
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            branchKey: edge.id,
          },
          data: {
            status: 'PRUNED_SKIPPED',
          },
        });
        prunedEdges.push(edge);
      }
    }

    // Recursive downstream branch pruning
    for (const edge of prunedEdges) {
      await this.recursivelyPruneDownstream(
        tenantId,
        requestId,
        reviewRound,
        edge.targetNodeId,
        graph,
        tx,
      );
    }

    // Continue automated execution along winning branch
    await this.advanceExecution(tenantId, requestId, reviewRound, graph, tx);
  }

  /**
   * Recursively marks nodes and edges as PRUNED_SKIPPED when all incoming paths are pruned.
   */
  private async recursivelyPruneDownstream(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    nodeId: string,
    graph: ValidatedWorkflowGraph,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const nodeType = this.normalizeNodeType(node.type);
    if (nodeType === 'JOIN') {
      // JOIN nodes wait to be evaluated by resolveJoinNode
      return;
    }

    // Check all incoming branches targeting this node in this round
    const incomingBranches = await tx.workflowBranchExecution.findMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        targetNodeId: nodeId,
      },
    });

    const allPruned = incomingBranches.every((b) => b.status === 'PRUNED_SKIPPED');

    if (allPruned && incomingBranches.length > 0) {
      // Mark node SKIPPED
      await tx.workflowNodeExecution.updateMany({
        where: {
          approvalRequestId: requestId,
          reviewRound,
          nodeId,
        },
        data: {
          status: 'SKIPPED',
          completedAt: new Date(),
        },
      });

      // Mark all outgoing branches PRUNED_SKIPPED
      const outgoingEdges = graph.edges.filter((e) => e.sourceNodeId === nodeId);
      for (const edge of outgoingEdges) {
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            branchKey: edge.id,
          },
          data: {
            status: 'PRUNED_SKIPPED',
          },
        });

        // Recurse downstream
        await this.recursivelyPruneDownstream(
          tenantId,
          requestId,
          reviewRound,
          edge.targetNodeId,
          graph,
          tx,
        );
      }
    }
  }

  /**
   * Resolves a JOIN node under PostgreSQL transactional row lock (`SELECT ... FOR UPDATE`).
   */
  private async resolveJoinNode(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    joinNode: WorkflowNode,
    graph: ValidatedWorkflowGraph,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // 1. Acquire row lock on the JOIN node execution row
    await tx.$queryRaw`
      SELECT id FROM workflow_node_executions
      WHERE approval_request_id = ${requestId}::uuid
        AND review_round = ${reviewRound}
        AND node_id = ${joinNode.id}
      FOR UPDATE;
    `;

    // Check if JOIN is already completed (idempotency guard)
    const joinExec = await tx.workflowNodeExecution.findFirst({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        nodeId: joinNode.id,
      },
    });

    if (joinExec && (joinExec.status === 'COMPLETED' || joinExec.status === 'SKIPPED')) {
      return;
    }

    // 2. Fetch all incoming branch executions for this join
    const incomingBranches = await tx.workflowBranchExecution.findMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        targetNodeId: joinNode.id,
      },
    });

    const joinPolicy = joinNode.config?.joinPolicy || 'ALL_INCOMING';

    if (joinPolicy === 'ALL_INCOMING') {
      // Invariant: Zero unevaluated branches
      const hasUnevaluated = incomingBranches.some((b) => b.status === 'NOT_EVALUATED');
      const hasActive = incomingBranches.some((b) => b.status === 'ACTIVE');

      if (hasUnevaluated || hasActive) {
        // Zero False Skips: Must wait
        return;
      }

      const allResolved = incomingBranches.every(
        (b) => b.status === 'COMPLETED' || b.status === 'PRUNED_SKIPPED',
      );
      const hasAtLeastOneCompleted = incomingBranches.some((b) => b.status === 'COMPLETED');

      if (allResolved && hasAtLeastOneCompleted) {
        // Join is satisfied! Mark COMPLETED
        await tx.workflowNodeExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            nodeId: joinNode.id,
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Activate outgoing branch from Join
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            sourceNodeId: joinNode.id,
          },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        });

        // Advance execution
        await this.advanceExecution(tenantId, requestId, reviewRound, graph, tx);
      } else if (allResolved && !hasAtLeastOneCompleted) {
        // All incoming branches were PRUNED_SKIPPED
        await tx.workflowNodeExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            nodeId: joinNode.id,
          },
          data: {
            status: 'SKIPPED',
            completedAt: new Date(),
          },
        });

        // Propagate PRUNED_SKIPPED to outgoing branches
        const outgoingEdges = graph.edges.filter((e) => e.sourceNodeId === joinNode.id);
        for (const edge of outgoingEdges) {
          await tx.workflowBranchExecution.updateMany({
            where: {
              approvalRequestId: requestId,
              reviewRound,
              branchKey: edge.id,
            },
            data: { status: 'PRUNED_SKIPPED' },
          });
          await this.recursivelyPruneDownstream(
            tenantId,
            requestId,
            reviewRound,
            edge.targetNodeId,
            graph,
            tx,
          );
        }
      }
    } else {
      // ANY_INCOMING: Advances on the first COMPLETED branch
      const firstCompleted = incomingBranches.find((b) => b.status === 'COMPLETED');
      if (firstCompleted) {
        await tx.workflowNodeExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            nodeId: joinNode.id,
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Mark other sibling branches PRUNED_SKIPPED
        for (const b of incomingBranches) {
          if (
            b.id !== firstCompleted.id &&
            (b.status === 'ACTIVE' || b.status === 'NOT_EVALUATED')
          ) {
            await tx.workflowBranchExecution.update({
              where: { id: b.id },
              data: { status: 'PRUNED_SKIPPED' },
            });
          }
        }

        // Activate outgoing branch
        await tx.workflowBranchExecution.updateMany({
          where: {
            approvalRequestId: requestId,
            reviewRound,
            sourceNodeId: joinNode.id,
          },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        });

        await this.advanceExecution(tenantId, requestId, reviewRound, graph, tx);
      }
    }
  }

  /**
   * Terminal END node handler. Completes approval request and records audit entries.
   */
  private async completeWorkflowExecution(
    tenantId: string,
    requestId: string,
    reviewRound: number,
    endNode: WorkflowNode,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.workflowNodeExecution.updateMany({
      where: {
        approvalRequestId: requestId,
        reviewRound,
        nodeId: endNode.id,
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    const outcome = endNode.config?.outcome || 'APPROVED';
    const requestStatus = outcome === 'REJECTED' ? 'REJECTED' : 'APPROVED';

    await tx.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: requestStatus,
      },
    });

    await this.auditService.log(
      {
        tenantId,
        entityType: 'ApprovalRequest',
        entityId: requestId,
        action: requestStatus === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
        metadata: {
          endNodeId: endNode.id,
          outcome,
          reviewRound,
        },
      },
      tx,
    );

    // Webhook and Notification events
    await this.outboxService.createEvent(tx, {
      tenantId,
      eventType: OUTBOX_EVENT_WEBHOOK,
      entityType: 'ApprovalRequest',
      entityId: requestId,
      idempotencyKey: `wh_req_completed_${requestId}_${Date.now()}`,
      payload: {
        tenantId,
        eventType: requestStatus === 'APPROVED' ? 'request.approved' : 'request.rejected',
        data: {
          event: requestStatus === 'APPROVED' ? 'request.approved' : 'request.rejected',
          tenantId,
          requestId,
          status: requestStatus,
        },
      },
    });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private normalizeNodeType(type: string): string {
    if (type === 'APPROVAL') return 'APPROVAL_STEP';
    if (type === 'PARALLEL') return 'PARALLEL_APPROVAL';
    return type;
  }

  private validatePayloadAgainstSchema(
    data: Record<string, unknown>,
    schema: {
      fields: Array<{
        name: string;
        type: string;
        required: boolean;
        minimum?: number;
        maximum?: number;
        allowedValues?: string[];
      }>;
    },
  ): void {
    for (const field of schema.fields) {
      const val = data[field.name];
      if (field.required && (val === undefined || val === null || val === '')) {
        throw new BadRequestException(`Missing required input field '${field.name}'`);
      }
      if (val !== undefined && val !== null) {
        if (field.type === 'NUMBER') {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            throw new BadRequestException(`Field '${field.name}' must be a finite number`);
          }
          if (typeof field.minimum === 'number' && val < field.minimum) {
            throw new BadRequestException(`Field '${field.name}' must be >= ${field.minimum}`);
          }
          if (typeof field.maximum === 'number' && val > field.maximum) {
            throw new BadRequestException(`Field '${field.name}' must be <= ${field.maximum}`);
          }
        }
        if (field.type === 'STRING' && typeof val !== 'string') {
          throw new BadRequestException(`Field '${field.name}' must be a string`);
        }
        if (field.type === 'BOOLEAN' && typeof val !== 'boolean') {
          throw new BadRequestException(`Field '${field.name}' must be a boolean`);
        }
      }
    }
  }

  private async resolveEligibleAssignees(
    tenantId: string,
    node: WorkflowNode,
    tx: Prisma.TransactionClient,
  ): Promise<Array<{ id: string; role: string }>> {
    const config = node.config || {};
    const assignees = config.assignees || [];
    const userMap = new Map<string, { id: string; role: string }>();

    // Single step direct assignees
    if (config.userId) {
      const u = await tx.user.findFirst({
        where: { id: config.userId, tenantId, status: 'ACTIVE' },
      });
      if (u) userMap.set(u.id, { id: u.id, role: u.role });
    }

    if (config.role) {
      const users = await tx.user.findMany({
        where: { tenantId, role: config.role as any, status: 'ACTIVE' },
      });
      for (const u of users) {
        userMap.set(u.id, { id: u.id, role: u.role });
      }
    }

    // Parallel step assignees list
    for (const a of assignees) {
      if (a.userId) {
        const u = await tx.user.findFirst({
          where: { id: a.userId, tenantId, status: 'ACTIVE' },
        });
        if (u) userMap.set(u.id, { id: u.id, role: u.role });
      } else if (a.role) {
        const users = await tx.user.findMany({
          where: { tenantId, role: a.role as any, status: 'ACTIVE' },
        });
        for (const u of users) {
          userMap.set(u.id, { id: u.id, role: u.role });
        }
      }
    }

    return Array.from(userMap.values());
  }

  private async resolveVoterAuthorization(
    tenantId: string,
    userId: string,
    userRole: string,
    step: {
      id: string;
      assignedToId: string | null;
      assignedRole: string | null;
      assignees: Array<{ assignedToId: string; status: string }>;
    },
    delegationId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ effectiveVoterId: string; delegatorId?: string }> {
    // 1. Check if user is directly assigned
    const directAssignee = step.assignees.find((a) => a.assignedToId === userId);
    if (directAssignee || step.assignedToId === userId) {
      return { effectiveVoterId: userId };
    }

    // 2. Check if acting via valid delegation
    if (delegationId) {
      const now = new Date();
      const delegation = await tx.userDelegation.findFirst({
        where: {
          id: delegationId,
          tenantId,
          delegateeId: userId,
          status: 'ACTIVE',
          startDate: { lte: now },
          endDate: { gte: now },
        },
      });

      if (!delegation) {
        throw new ForbiddenException('Invalid or expired delegation authority');
      }

      // Check if delegator is an assigned voter
      const delegatorAssignee = step.assignees.find(
        (a) => a.assignedToId === delegation.delegatorId,
      );
      if (delegatorAssignee || step.assignedToId === delegation.delegatorId) {
        return {
          effectiveVoterId: delegation.delegatorId,
          delegatorId: delegation.delegatorId,
        };
      }
    }

    // 3. Check role assignment fallback
    if (step.assignedRole && step.assignedRole === userRole) {
      return { effectiveVoterId: userId };
    }

    throw new ForbiddenException(
      'You are not authorized to perform an action on this approval step',
    );
  }
}

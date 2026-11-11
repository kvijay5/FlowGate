import {
  PrismaClient,
  StepPolicy,
  RejectionPolicy,
  NodeExecutionStatus,
  BranchExecutionStatus,
  DelegationStatus,
} from '@prisma/client';

describe('Milestone 6 Core Data Layer & DAG Models (Integration)', () => {
  let prisma: PrismaClient;
  let acmeTenantId: string;
  let globexTenantId: string;
  let acmeAdminId: string;
  let acmeManagerId: string;
  let acmeRequesterId: string;
  let globexRequesterId: string;
  let testWorkflowId: string;
  let testRequestId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
    const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

    expect(acme).toBeDefined();
    expect(globex).toBeDefined();

    acmeTenantId = acme!.id;
    globexTenantId = globex!.id;

    const acmeUsers = await prisma.user.findMany({ where: { tenantId: acmeTenantId } });
    acmeAdminId = acmeUsers.find((u) => u.role === 'TENANT_ADMIN')!.id;
    acmeManagerId = acmeUsers.find((u) => u.role === 'APPROVER')!.id;
    acmeRequesterId = acmeUsers.find((u) => u.role === 'REQUESTER')!.id;

    const globexUsers = await prisma.user.findMany({ where: { tenantId: globexTenantId } });
    globexRequesterId = globexUsers.find((u) => u.role === 'REQUESTER')!.id;

    // Create a test workflow and approval request for data layer testing
    const workflow = await prisma.workflowDefinition.create({
      data: {
        tenantId: acmeTenantId,
        name: 'DAG Test Workflow',
        status: 'ACTIVE',
        version: 1,
        configuration: {
          nodes: [{ id: 'trigger_1', type: 'TRIGGER', name: 'Start', config: {} }],
          edges: [],
        },
      },
    });
    testWorkflowId = workflow.id;

    const request = await prisma.approvalRequest.create({
      data: {
        tenantId: acmeTenantId,
        workflowDefinitionId: testWorkflowId,
        requestedById: acmeRequesterId,
        title: 'M6 Data Layer Test Request',
        requestData: { amount: 15000, department: 'FINANCE' },
        currentReviewRound: 1,
      },
    });
    testRequestId = request.id;
  });

  afterAll(async () => {
    // Clean up test data in reverse order of dependencies
    await prisma.workflowBranchExecution.deleteMany({
      where: { approvalRequestId: testRequestId },
    });
    await prisma.workflowNodeExecution.deleteMany({
      where: { approvalRequestId: testRequestId },
    });
    await prisma.approvalStepAssignee.deleteMany({
      where: { tenantId: acmeTenantId },
    });
    await prisma.approvalStep.deleteMany({
      where: { approvalRequestId: testRequestId },
    });
    await prisma.approvalRequest.deleteMany({
      where: { id: testRequestId },
    });
    await prisma.userDelegation.deleteMany({
      where: {
        tenantId: acmeTenantId,
        reason: 'Executive annual leave delegation',
      },
    });
    await prisma.workflowDefinition.deleteMany({
      where: { id: testWorkflowId },
    });

    await prisma.$disconnect();
  });

  // ===========================================================================
  // 1. APPROVAL STEP MULTI-ROUND UNIQUE CONSTRAINT & DEFAULTS
  // ===========================================================================
  describe('1. ApprovalStep Review Rounds & Unique Constraint', () => {
    it('creates steps across multiple review rounds with identical stepOrder', async () => {
      // Round 1 step
      const stepRound1 = await prisma.approvalStep.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 1,
          stepOrder: 99,
          stepName: 'Review Round 1 Step',
          assignedToId: acmeManagerId,
          policy: StepPolicy.SEQUENTIAL,
        },
      });

      expect(stepRound1.reviewRound).toBe(1);
      expect(stepRound1.stepOrder).toBe(99);
      expect(stepRound1.policy).toBe('SEQUENTIAL');
      expect(stepRound1.rejectionPolicy).toBe('SOFT_REJECTION');
      expect(stepRound1.approvedCount).toBe(0);
      expect(stepRound1.rejectedCount).toBe(0);
      expect(stepRound1.totalAssigned).toBe(1);
      expect(stepRound1.requiredApprovals).toBe(1);

      // Round 2 step with same stepOrder (allowed because reviewRound is 2!)
      const stepRound2 = await prisma.approvalStep.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 2,
          stepOrder: 99,
          stepName: 'Review Round 2 Step',
          assignedToId: acmeManagerId,
          policy: StepPolicy.PARALLEL_AND,
          rejectionPolicy: RejectionPolicy.STRICT_VETO,
        },
      });

      expect(stepRound2.reviewRound).toBe(2);
      expect(stepRound2.stepOrder).toBe(99);
      expect(stepRound2.policy).toBe('PARALLEL_AND');
      expect(stepRound2.rejectionPolicy).toBe('STRICT_VETO');
    });

    it('rejects duplicate stepOrder within the same review round with unique constraint violation', async () => {
      // Attempt duplicate stepOrder 99 in reviewRound 1
      await expect(
        prisma.approvalStep.create({
          data: {
            tenantId: acmeTenantId,
            approvalRequestId: testRequestId,
            reviewRound: 1,
            stepOrder: 99,
            stepName: 'Duplicate Step',
            assignedToId: acmeAdminId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // 2. APPROVAL STEP ASSIGNEES & MULTI-APPROVER SUPPORT
  // ===========================================================================
  describe('2. ApprovalStepAssignee Model & Multi-Approver Tracking', () => {
    it('creates multiple assignees for a parallel approval stage', async () => {
      const parallelStep = await prisma.approvalStep.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 1,
          stepOrder: 100,
          stepName: 'Parallel Executive Board',
          policy: StepPolicy.PARALLEL_OR,
          rejectionPolicy: RejectionPolicy.SOFT_REJECTION,
          totalAssigned: 2,
          requiredApprovals: 1,
        },
      });

      const assignee1 = await prisma.approvalStepAssignee.create({
        data: {
          tenantId: acmeTenantId,
          stepId: parallelStep.id,
          reviewRound: 1,
          assignedToId: acmeManagerId,
          status: 'PENDING',
        },
      });

      const assignee2 = await prisma.approvalStepAssignee.create({
        data: {
          tenantId: acmeTenantId,
          stepId: parallelStep.id,
          reviewRound: 1,
          assignedToId: acmeAdminId,
          status: 'PENDING',
        },
      });

      expect(assignee1.id).toBeDefined();
      expect(assignee2.id).toBeDefined();

      const assignees = await prisma.approvalStepAssignee.findMany({
        where: { tenantId: acmeTenantId, stepId: parallelStep.id },
      });

      expect(assignees).toHaveLength(2);

      // Verify tenant isolation: Globex tenant cannot see Acme step assignees
      const globexQuery = await prisma.approvalStepAssignee.findMany({
        where: { tenantId: globexTenantId, stepId: parallelStep.id },
      });
      expect(globexQuery).toHaveLength(0);
    });

    it('supports delegated vote attribution on ApprovalStepAssignee', async () => {
      const step = await prisma.approvalStep.findFirst({
        where: { approvalRequestId: testRequestId, stepOrder: 100 },
      });
      expect(step).toBeDefined();

      const delegatedAssignee = await prisma.approvalStepAssignee.create({
        data: {
          tenantId: acmeTenantId,
          stepId: step!.id,
          reviewRound: 1,
          assignedToId: acmeManagerId,
          status: 'APPROVED',
          actionedById: acmeRequesterId, // Acted by delegate
          delegatedFromUserId: acmeManagerId, // Delegated from Manager
          actionedAt: new Date(),
          comments: 'Approved under authorized executive delegation',
        },
      });

      expect(delegatedAssignee.status).toBe('APPROVED');
      expect(delegatedAssignee.actionedById).toBe(acmeRequesterId);
      expect(delegatedAssignee.delegatedFromUserId).toBe(acmeManagerId);
    });
  });

  // ===========================================================================
  // 3. WORKFLOW NODE EXECUTIONS
  // ===========================================================================
  describe('3. WorkflowNodeExecution Model & State Lifecycle', () => {
    it('creates and tracks node execution lifecycle with unique constraint per round', async () => {
      const nodeExecRound1 = await prisma.workflowNodeExecution.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 1,
          nodeId: 'node_finance_review',
          nodeType: 'PARALLEL_APPROVAL',
          status: NodeExecutionStatus.IN_REVIEW,
          activatedAt: new Date(),
        },
      });

      expect(nodeExecRound1.status).toBe('IN_REVIEW');
      expect(nodeExecRound1.reviewRound).toBe(1);

      // Round 2 node execution with same nodeId is allowed
      const nodeExecRound2 = await prisma.workflowNodeExecution.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 2,
          nodeId: 'node_finance_review',
          nodeType: 'PARALLEL_APPROVAL',
          status: NodeExecutionStatus.PENDING,
        },
      });

      expect(nodeExecRound2.reviewRound).toBe(2);

      // Duplicate nodeId in Round 1 fails
      await expect(
        prisma.workflowNodeExecution.create({
          data: {
            tenantId: acmeTenantId,
            approvalRequestId: testRequestId,
            reviewRound: 1,
            nodeId: 'node_finance_review',
            nodeType: 'PARALLEL_APPROVAL',
            status: NodeExecutionStatus.COMPLETED,
          },
        }),
      ).rejects.toThrow();
    });

    it('enforces tenant isolation on WorkflowNodeExecution queries', async () => {
      const acmeExecs = await prisma.workflowNodeExecution.findMany({
        where: { tenantId: acmeTenantId, approvalRequestId: testRequestId },
      });
      expect(acmeExecs.length).toBeGreaterThan(0);

      const globexExecs = await prisma.workflowNodeExecution.findMany({
        where: { tenantId: globexTenantId, approvalRequestId: testRequestId },
      });
      expect(globexExecs).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 4. WORKFLOW BRANCH EXECUTIONS
  // ===========================================================================
  describe('4. WorkflowBranchExecution Model & Branch Lifecycle', () => {
    it('tracks branch execution transitions from NOT_EVALUATED to COMPLETED', async () => {
      const branchExec = await prisma.workflowBranchExecution.create({
        data: {
          tenantId: acmeTenantId,
          approvalRequestId: testRequestId,
          reviewRound: 1,
          branchKey: 'branch_amount_over_10k',
          sourceNodeId: 'cond_amount_check',
          targetNodeId: 'join_node_1',
          status: BranchExecutionStatus.NOT_EVALUATED,
        },
      });

      expect(branchExec.status).toBe('NOT_EVALUATED');

      // Transition to ACTIVE
      const activeBranch = await prisma.workflowBranchExecution.update({
        where: { id: branchExec.id },
        data: {
          status: BranchExecutionStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
      expect(activeBranch.status).toBe('ACTIVE');

      // Transition to COMPLETED
      const completedBranch = await prisma.workflowBranchExecution.update({
        where: { id: branchExec.id },
        data: {
          status: BranchExecutionStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      expect(completedBranch.status).toBe('COMPLETED');
    });

    it('enforces unique branchKey per review round', async () => {
      await expect(
        prisma.workflowBranchExecution.create({
          data: {
            tenantId: acmeTenantId,
            approvalRequestId: testRequestId,
            reviewRound: 1,
            branchKey: 'branch_amount_over_10k', // duplicate!
            sourceNodeId: 'cond_amount_check',
            targetNodeId: 'join_node_1',
            status: BranchExecutionStatus.NOT_EVALUATED,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // 5. USER DELEGATION MODEL & TENANT ISOLATION
  // ===========================================================================
  describe('5. UserDelegation Model & Scoping', () => {
    it('creates an active user delegation with temporal validity window', async () => {
      const now = new Date();
      const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const delegation = await prisma.userDelegation.create({
        data: {
          tenantId: acmeTenantId,
          delegatorId: acmeManagerId,
          delegateeId: acmeRequesterId,
          workflowDefinitionId: testWorkflowId,
          delegateRoles: true,
          startDate: now,
          endDate: inSevenDays,
          status: DelegationStatus.ACTIVE,
          reason: 'Executive annual leave delegation',
        },
      });

      expect(delegation.id).toBeDefined();
      expect(delegation.status).toBe('ACTIVE');
      expect(delegation.delegateRoles).toBe(true);

      const delegations = await prisma.userDelegation.findMany({
        where: { tenantId: acmeTenantId, delegatorId: acmeManagerId },
      });
      expect(delegations.length).toBeGreaterThanOrEqual(1);
      expect(delegations.some((d) => d.id === delegation.id)).toBe(true);

      // Verify tenant isolation: Globex tenant cannot query Acme delegation
      const globexQuery = await prisma.userDelegation.findMany({
        where: { tenantId: globexTenantId, delegatorId: acmeManagerId },
      });
      expect(globexQuery).toHaveLength(0);
    });

    it('strictly isolates delegations from cross-tenant user assignment', async () => {
      const now = new Date();
      const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Attempt to delegate from Acme user to Globex user under Acme tenant
      await expect(
        prisma.userDelegation.create({
          data: {
            tenantId: acmeTenantId,
            delegatorId: acmeManagerId,
            delegateeId: globexRequesterId, // Foreign tenant user!
            startDate: now,
            endDate: inSevenDays,
            status: DelegationStatus.ACTIVE,
          },
        }),
      ).rejects.toThrow();
    });
  });
});

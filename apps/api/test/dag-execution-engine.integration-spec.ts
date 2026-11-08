import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { WorkflowGraphEngineService } from '../src/workflows/workflow-graph-engine.service';
import { WorkflowGraphValidatorService } from '../src/workflows/workflow-graph-validator.service';
import { WorkflowNode, WorkflowEdge, InputSchema } from '@flowgate/shared-types';

describe('Milestone 6.2: DAG Execution Engine & Join Concurrency (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;
  let graphEngine: WorkflowGraphEngineService;
  let graphValidator: WorkflowGraphValidatorService;

  let acmeTenantId: string;
  let user1Id: string;
  let user2Id: string;
  let user3Id: string;
  let testWorkflowId: string;
  const createdRequestIds: string[] = [];

  const diamondSchema: InputSchema = {
    fields: [
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true, minimum: 0 },
      { name: 'department', label: 'Department', type: 'STRING', required: true },
    ],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);
    graphEngine = app.get(WorkflowGraphEngineService);
    graphValidator = app.get(WorkflowGraphValidatorService);

    const publisher = app.get(OutboxPublisherService);
    publisher.stop(); // Stop poller interval for deterministic tests

    // Retrieve Acme Tenant
    const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
    expect(acme).toBeDefined();
    acmeTenantId = acme!.id;

    // Retrieve Acme users
    const acmeUsers = await prisma.user.findMany({ where: { tenantId: acmeTenantId } });
    expect(acmeUsers.length).toBeGreaterThanOrEqual(3);
    user1Id = acmeUsers[0].id;
    user2Id = acmeUsers[1].id;
    user3Id = acmeUsers[2].id;

    // Define Complex Diamond Graph:
    // TRIGGER -> CONDITION -> [HIGH: PARALLEL (2-of-3) & LEGAL (single)] + [LOW: FAST_TRACK] -> JOIN -> END
    const diamondNodes: WorkflowNode[] = [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'CAPEX Request Initiation',
        config: { inputSchema: diamondSchema },
      },
      {
        id: 'node_cond',
        type: 'CONDITION',
        name: 'Budget Threshold Evaluation',
        config: {
          rules: [
            {
              id: 'rule_high',
              branchKey: 'branch_high',
              targetNodeId: 'node_parallel',
              expression: { field: 'amount', operator: 'GT', value: 10000 },
            },
          ],
          defaultTargetNodeId: 'node_fast_track',
        },
      },
      {
        id: 'node_parallel',
        type: 'PARALLEL_APPROVAL',
        name: 'Finance Board Signoff (2-of-3)',
        config: {
          policy: 'PARALLEL_OR',
          rejectionPolicy: 'SOFT_REJECTION',
          requiredApprovals: 2,
          assignees: [
            { assigneeType: 'USER', userId: user1Id },
            { assigneeType: 'USER', userId: user2Id },
            { assigneeType: 'USER', userId: user3Id },
          ],
        },
      },
      {
        id: 'node_legal',
        type: 'APPROVAL_STEP',
        name: 'Legal Counsel Review',
        config: {
          assigneeType: 'USER',
          userId: user1Id,
        },
      },
      {
        id: 'node_fast_track',
        type: 'APPROVAL_STEP',
        name: 'Automated Fast Track',
        config: {
          assigneeType: 'USER',
          userId: user2Id,
        },
      },
      {
        id: 'node_join',
        type: 'JOIN',
        name: 'Parallel Convergence Gate',
        config: { joinPolicy: 'ALL_INCOMING' },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Workflow Completion',
        config: { outcome: 'APPROVED' },
      },
    ];

    const diamondEdges: WorkflowEdge[] = [
      { id: 'e_trig_cond', sourceNodeId: 'node_trigger', targetNodeId: 'node_cond' },
      {
        id: 'e_cond_parallel',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_parallel',
        sourceHandle: 'branch_high',
      },
      {
        id: 'e_cond_legal',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_legal',
        sourceHandle: 'branch_high',
      },
      {
        id: 'e_cond_fast',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_fast_track',
        sourceHandle: 'default',
      },
      { id: 'e_par_join', sourceNodeId: 'node_parallel', targetNodeId: 'node_join' },
      { id: 'e_leg_join', sourceNodeId: 'node_legal', targetNodeId: 'node_join' },
      { id: 'e_fast_join', sourceNodeId: 'node_fast_track', targetNodeId: 'node_join' },
      { id: 'e_join_end', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
    ];

    const validated = graphValidator.validateDAG({
      nodes: diamondNodes,
      edges: diamondEdges,
      inputSchema: diamondSchema,
    });
    expect(validated.topologicalOrder).toBeDefined();

    const wf = await prisma.workflowDefinition.create({
      data: {
        tenantId: acmeTenantId,
        name: 'Diamond DAG Enterprise Workflow',
        description: 'Multi-branch conditional split and parallel join synchronization',
        status: 'ACTIVE',
        version: 1,
        configuration: {
          nodes: diamondNodes,
          edges: diamondEdges,
          inputSchema: diamondSchema,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    testWorkflowId = wf.id;
  });

  afterAll(async () => {
    // Clean up created requests and workflows in reverse order
    for (const reqId of createdRequestIds) {
      await prisma.workflowBranchExecution.deleteMany({ where: { approvalRequestId: reqId } });
      await prisma.workflowNodeExecution.deleteMany({ where: { approvalRequestId: reqId } });
      const steps = await prisma.approvalStep.findMany({ where: { approvalRequestId: reqId } });
      for (const step of steps) {
        await prisma.approvalStepAssignee.deleteMany({ where: { stepId: step.id } });
      }
      await prisma.approvalStep.deleteMany({ where: { approvalRequestId: reqId } });
      await prisma.approvalRequest.deleteMany({ where: { id: reqId } });
    }

    if (testWorkflowId) {
      await prisma.workflowDefinition.deleteMany({ where: { id: testWorkflowId } });
    }

    if (app) {
      await app.close();
    }
  });

  // ===========================================================================
  // 1. END-TO-END DIAMOND WORKFLOW EXECUTION
  // ===========================================================================
  describe('1. End-to-End Diamond DAG Execution with Condition Routing & Pruning', () => {
    let requestId: string;

    it('initializes graph execution, evaluates condition, and prunes low-value branch', async () => {
      const initResult = await graphEngine.initializeGraphExecution(
        acmeTenantId,
        user1Id,
        testWorkflowId,
        {
          title: 'Data Center Expansion Servers',
          requestData: { amount: 75000, department: 'FINANCE' },
        },
      );

      expect(initResult).toBeDefined();
      requestId = initResult!.id;
      createdRequestIds.push(requestId);

      expect(initResult!.status).toBe('IN_PROGRESS');
      expect(initResult!.currentReviewRound).toBe(1);

      // Verify that condition evaluated true (amount 75000 > 10000)
      // Check branch execution statuses
      const branches = await prisma.workflowBranchExecution.findMany({
        where: { approvalRequestId: requestId, reviewRound: 1 },
      });

      const fastTrackBranch = branches.find((b) => b.branchKey === 'e_cond_fast');
      expect(fastTrackBranch).toBeDefined();
      expect(fastTrackBranch!.status).toBe('PRUNED_SKIPPED');

      // Verify recursive downstream pruning: node_fast_track is SKIPPED
      const fastTrackNode = await prisma.workflowNodeExecution.findFirst({
        where: { approvalRequestId: requestId, reviewRound: 1, nodeId: 'node_fast_track' },
      });
      expect(fastTrackNode).toBeDefined();
      expect(fastTrackNode!.status).toBe('SKIPPED');

      // Verify parallel node and legal node are IN_REVIEW
      const parNode = await prisma.workflowNodeExecution.findFirst({
        where: { approvalRequestId: requestId, reviewRound: 1, nodeId: 'node_parallel' },
      });
      expect(parNode!.status).toBe('IN_REVIEW');

      const legNode = await prisma.workflowNodeExecution.findFirst({
        where: { approvalRequestId: requestId, reviewRound: 1, nodeId: 'node_legal' },
      });
      expect(legNode!.status).toBe('IN_REVIEW');

      // Verify instantiated steps
      const steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId, reviewRound: 1 },
        include: { assignees: true },
      });
      expect(steps).toHaveLength(2);

      const parStep = steps.find((s) => s.nodeId === 'node_parallel');
      expect(parStep).toBeDefined();
      expect(parStep!.policy).toBe('PARALLEL_OR');
      expect(parStep!.totalAssigned).toBe(3);
      expect(parStep!.requiredApprovals).toBe(2);
      expect(parStep!.assignees).toHaveLength(3);
    });

    it('demonstrates concurrency control via Promise.all when parallel approvers submit simultaneously', async () => {
      const steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId, reviewRound: 1 },
      });
      const parStep = steps.find((s) => s.nodeId === 'node_parallel')!;
      const legStep = steps.find((s) => s.nodeId === 'node_legal')!;

      // Concurrently submit votes from User 1 and User 2 on the parallel stage
      const [res1, res2] = await Promise.all([
        graphEngine.submitGraphAction(acmeTenantId, user1Id, 'APPROVER', requestId, parStep.id, {
          action: 'APPROVE',
          comments: 'Finance Vote 1 (Concurrent)',
        }),
        graphEngine.submitGraphAction(acmeTenantId, user2Id, 'APPROVER', requestId, parStep.id, {
          action: 'APPROVE',
          comments: 'Finance Vote 2 (Concurrent)',
        }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      // Verify parallel step is now APPROVED (2 of 3 quorum satisfied)
      const updatedParStep = await prisma.approvalStep.findUnique({
        where: { id: parStep.id },
      });
      expect(updatedParStep!.status).toBe('APPROVED');
      expect(updatedParStep!.approvedCount).toBe(2);

      // Verify 3rd user's pending assignment was marked SKIPPED (resolved by peer quorum)
      const assignees = await prisma.approvalStepAssignee.findMany({
        where: { stepId: parStep.id },
      });
      const user3Assignee = assignees.find((a) => a.assignedToId === user3Id);
      expect(user3Assignee!.status).toBe('SKIPPED');
      expect(user3Assignee!.comments).toContain('Resolved by peer approval');

      // Approve the concurrent Legal Counsel step
      const legalRes = await graphEngine.submitGraphAction(
        acmeTenantId,
        user1Id,
        'APPROVER',
        requestId,
        legStep.id,
        { action: 'APPROVE', comments: 'Legal contract verified' },
      );
      expect(legalRes.stepStatus).toBe('APPROVED');

      // Both branches (parallel and legal) are now COMPLETED!
      // The ALL_INCOMING Join node evaluates:
      // - e_par_join: COMPLETED
      // - e_leg_join: COMPLETED
      // - e_fast_join: PRUNED_SKIPPED
      // All incoming resolved, at least one COMPLETED -> JOIN fires and completes END node!
      const finalRequest = await prisma.approvalRequest.findUnique({
        where: { id: requestId },
      });
      expect(finalRequest!.status).toBe('APPROVED');

      // Verify cryptographic audit chain integrity
      const chainVerification = await auditService.verifyChain(acmeTenantId);
      expect(chainVerification.valid).toBe(true);
    });
  });

  // ===========================================================================
  // 2. QUORUM-LOSS TERMINATION
  // ===========================================================================
  describe('2. Parallel Quorum-Loss Immediate Termination', () => {
    it('aborts step and request immediately when max achievable approvals falls below threshold', async () => {
      const initResult = await graphEngine.initializeGraphExecution(
        acmeTenantId,
        user1Id,
        testWorkflowId,
        {
          title: 'Budget Allocation Cluster',
          requestData: { amount: 50000, department: 'FINANCE' },
        },
      );
      const reqId = initResult!.id;
      createdRequestIds.push(reqId);

      const steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: reqId, reviewRound: 1 },
      });
      const parStep = steps.find((s) => s.nodeId === 'node_parallel')!;

      // Approver 1 rejects
      const rej1 = await graphEngine.submitGraphAction(
        acmeTenantId,
        user1Id,
        'APPROVER',
        reqId,
        parStep.id,
        { action: 'REJECT', comments: 'Cost too high' },
      );
      // Soft rejection: 1st rejection keeps IN_REVIEW because 2 approvals are still achievable
      expect(rej1.stepStatus).toBe('IN_REVIEW');

      // Approver 2 rejects -> now 2 rejections out of 3. Max achievable is 1 < 2!
      const rej2 = await graphEngine.submitGraphAction(
        acmeTenantId,
        user2Id,
        'APPROVER',
        reqId,
        parStep.id,
        { action: 'REJECT', comments: 'No ROI evident' },
      );

      // QUORUM LOST triggers immediately!
      expect(rej2.stepStatus).toBe('REJECTED');
      expect(rej2.requestStatus).toBe('REJECTED');

      const failedRequest = await prisma.approvalRequest.findUnique({
        where: { id: reqId },
      });
      expect(failedRequest!.status).toBe('REJECTED');

      // Verify User 3 was marked SKIPPED without hanging indefinitely
      const assignees = await prisma.approvalStepAssignee.findMany({
        where: { stepId: parStep.id },
      });
      const user3Assignee = assignees.find((a) => a.assignedToId === user3Id);
      expect(user3Assignee!.status).toBe('SKIPPED');
    });
  });
});

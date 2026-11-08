import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { WorkflowGraphEngineService } from '../src/workflows/workflow-graph-engine.service';
import { WorkflowGraphValidatorService } from '../src/workflows/workflow-graph-validator.service';
import { DelegationService } from '../src/workflows/delegation.service';
import { WorkflowNode, WorkflowEdge, InputSchema } from '@flowgate/shared-types';

describe('Milestone 6.3: Out-of-Office Approval Delegation Engine (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;
  let graphEngine: WorkflowGraphEngineService;
  let graphValidator: WorkflowGraphValidatorService;
  let delegationService: DelegationService;

  let acmeTenantId: string;
  let userAId: string; // Delegator
  let userBId: string; // Delegatee
  let userCId: string; // Third party
  let testWorkflowId: string;
  const createdRequestIds: string[] = [];
  const createdDelegationIds: string[] = [];

  const simpleSchema: InputSchema = {
    fields: [
      { name: 'justification', label: 'Justification', type: 'STRING', required: true },
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true },
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
    delegationService = app.get(DelegationService);

    const publisher = app.get(OutboxPublisherService);
    publisher.stop(); // Stop poller interval for deterministic tests

    // Retrieve Acme Tenant
    const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
    expect(acme).toBeDefined();
    acmeTenantId = acme!.id;

    // Retrieve Acme users
    const acmeUsers = await prisma.user.findMany({
      where: { tenantId: acmeTenantId, status: 'ACTIVE' },
    });
    expect(acmeUsers.length).toBeGreaterThanOrEqual(3);
    userAId = acmeUsers[0].id;
    userBId = acmeUsers[1].id;
    userCId = acmeUsers[2].id;

    // Build Linear DAG Workflow: TRIGGER -> APPROVAL (User A) -> END
    const nodes: WorkflowNode[] = [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'Equipment Purchase Request',
        config: { inputSchema: simpleSchema },
      },
      {
        id: 'node_step_a',
        type: 'APPROVAL_STEP',
        name: 'Manager Review (User A)',
        config: {
          assigneeType: 'USER',
          userId: userAId,
        },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Completed Request',
        config: { outcome: 'APPROVED' },
      },
    ];

    const edges: WorkflowEdge[] = [
      {
        id: 'edge_trig_a',
        sourceNodeId: 'node_trigger',
        targetNodeId: 'node_step_a',
      },
      {
        id: 'edge_a_end',
        sourceNodeId: 'node_step_a',
        targetNodeId: 'node_end',
      },
    ];

    const validation = graphValidator.validateDAG({
      nodes,
      edges,
      inputSchema: simpleSchema,
    });
    expect(validation.topologicalOrder.length).toBeGreaterThan(0);

    const workflow = await prisma.workflowDefinition.create({
      data: {
        tenantId: acmeTenantId,
        name: 'Equipment Purchase DAG',
        description: 'Single-approver DAG workflow for delegation testing',
        status: 'ACTIVE',
        version: 1,
        configuration: {
          nodes,
          edges,
          inputSchema: simpleSchema,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    testWorkflowId = workflow.id;
  });

  afterAll(async () => {
    // Clean up created entities
    if (createdRequestIds.length > 0) {
      await prisma.approvalStepAssignee.deleteMany({
        where: { step: { approvalRequestId: { in: createdRequestIds } } },
      });
      await prisma.approvalStep.deleteMany({
        where: { approvalRequestId: { in: createdRequestIds } },
      });
      await prisma.workflowBranchExecution.deleteMany({
        where: { approvalRequestId: { in: createdRequestIds } },
      });
      await prisma.workflowNodeExecution.deleteMany({
        where: { approvalRequestId: { in: createdRequestIds } },
      });
      await prisma.approvalRequest.deleteMany({
        where: { id: { in: createdRequestIds } },
      });
    }

    if (createdDelegationIds.length > 0) {
      await prisma.userDelegation.deleteMany({
        where: { id: { in: createdDelegationIds } },
      });
    }

    if (testWorkflowId) {
      await prisma.workflowDefinition.delete({
        where: { id: testWorkflowId },
      });
    }

    await app.close();
  });

  describe('1. Active Delegation Execution & Dual-Actor Attribution', () => {
    let activeDelegationId: string;
    let requestId: string;
    let stepId: string;

    it('creates an active delegation from User A to User B', async () => {
      const start = new Date(Date.now() - 3600000); // 1 hour ago
      const end = new Date(Date.now() + 86400000); // 24 hours in future

      const delegation = await delegationService.createDelegation(acmeTenantId, userAId, {
        delegateeId: userBId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        workflowDefinitionId: testWorkflowId,
        reason: 'Out of office on conference',
      });

      expect(delegation).toBeDefined();
      expect(delegation.status).toBe('ACTIVE');
      expect(delegation.delegatorId).toBe(userAId);
      expect(delegation.delegateeId).toBe(userBId);
      activeDelegationId = delegation.id;
      createdDelegationIds.push(delegation.id);
    });

    it('initializes a workflow request assigned to User A', async () => {
      const initResult = await graphEngine.initializeGraphExecution(
        acmeTenantId,
        userCId,
        testWorkflowId,
        {
          title: 'MacBook Pro Purchase Request',
          description: 'Developer laptop replacement',
          requestData: { justification: 'Hardware upgrade', amount: 3500 },
        },
      );

      expect(initResult).toBeDefined();
      expect(initResult.status).toBe('IN_PROGRESS');
      requestId = initResult.id;
      createdRequestIds.push(requestId);

      const steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId, reviewRound: 1 },
        include: { assignees: true },
      });

      expect(steps.length).toBe(1);
      stepId = steps[0].id;
      expect(steps[0].assignees.length).toBe(1);
      expect(steps[0].assignees[0].assignedToId).toBe(userAId);
      expect(steps[0].assignees[0].status).toBe('PENDING');
    });

    it('allows User B (delegatee) to approve User A step with dual-actor attribution', async () => {
      // User B votes on behalf of User A
      const actionResult = await graphEngine.submitGraphAction(
        acmeTenantId,
        userBId,
        'APPROVER',
        requestId,
        stepId,
        {
          action: 'APPROVE',
          comments: 'Approved on behalf of User A (out of office)',
        },
      );

      expect(actionResult.success).toBe(true);
      expect(actionResult.stepStatus).toBe('APPROVED');
      expect(actionResult.requestStatus).toBe('APPROVED');

      // Verify DB Assignee row attribution
      const updatedAssignee = await prisma.approvalStepAssignee.findFirst({
        where: { stepId },
      });

      expect(updatedAssignee).toBeDefined();
      expect(updatedAssignee!.status).toBe('APPROVED');
      expect(updatedAssignee!.actionedById).toBe(userBId); // Acting user
      expect(updatedAssignee!.delegatedFromUserId).toBe(userAId); // Delegator user
      expect(updatedAssignee!.comments).toBe('Approved on behalf of User A (out of office)');

      // Verify Request Completed
      const completedRequest = await prisma.approvalRequest.findUnique({
        where: { id: requestId },
      });
      expect(completedRequest!.status).toBe('APPROVED');
    });

    it('verifies SHA-256 Audit Log records STEP_APPROVED_DELEGATED and chain integrity holds', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          tenantId: acmeTenantId,
          entityId: stepId,
          action: 'STEP_APPROVED_DELEGATED',
        },
      });

      expect(auditLogs.length).toBe(1);
      const log = auditLogs[0];
      expect(log.actorId).toBe(userBId); // Delegatee is the actor

      const meta = log.metadata as Record<string, unknown>;
      expect(meta.delegatedFromUserId).toBe(userAId); // Dual-actor attribution
      expect(meta.delegationId).toBe(activeDelegationId);

      // Verify cryptographic audit chain integrity
      const chainVerification = await auditService.verifyChain(acmeTenantId);
      expect(chainVerification.valid).toBe(true);
      expect(chainVerification.brokenAtId).toBeUndefined();

      // Revoke this completed delegation so subsequent tests can create new windows without overlapping
      await delegationService.revokeDelegation(
        acmeTenantId,
        userAId,
        'MANAGER',
        activeDelegationId,
      );
    });
  });

  describe('2. Revoked & Expired Delegation Safeguards', () => {
    let secondRequestId: string;
    let secondStepId: string;
    let revocableDelegationId: string;

    it('revokes an active delegation and blocks delegatee from acting', async () => {
      // Create new delegation from User A to User B
      const start = new Date(Date.now() - 3600000);
      const end = new Date(Date.now() + 86400000);

      const delegation = await delegationService.createDelegation(acmeTenantId, userAId, {
        delegateeId: userBId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        workflowDefinitionId: testWorkflowId,
        reason: 'Temporary delegation',
      });

      revocableDelegationId = delegation.id;
      createdDelegationIds.push(delegation.id);

      // Initialize second request
      const initResult = await graphEngine.initializeGraphExecution(
        acmeTenantId,
        userCId,
        testWorkflowId,
        {
          title: 'Office Monitor Request',
          requestData: { justification: 'Monitor upgrade', amount: 800 },
        },
      );
      secondRequestId = initResult.id;
      createdRequestIds.push(secondRequestId);

      const step = await prisma.approvalStep.findFirst({
        where: { approvalRequestId: secondRequestId, reviewRound: 1 },
      });
      secondStepId = step!.id;

      // Revoke the delegation by delegator User A
      const revoked = await delegationService.revokeDelegation(
        acmeTenantId,
        userAId,
        'MANAGER',
        revocableDelegationId,
      );
      expect(revoked.status).toBe('REVOKED');

      // User B attempts to approve -> Must be rejected with ForbiddenException!
      await expect(
        graphEngine.submitGraphAction(
          acmeTenantId,
          userBId,
          'APPROVER',
          secondRequestId,
          secondStepId,
          { action: 'APPROVE', comments: 'Attempting post-revocation vote' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks delegatee from acting once delegation window has expired', async () => {
      // Create delegation and force expiration
      const start = new Date(Date.now() - 7200000); // 2 hours ago
      const end = new Date(Date.now() + 3600000); // 1 hour ahead

      const expDelegation = await delegationService.createDelegation(acmeTenantId, userAId, {
        delegateeId: userBId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        workflowDefinitionId: testWorkflowId,
        reason: 'Quick delegation',
      });
      createdDelegationIds.push(expDelegation.id);

      // Force endDate into the past directly in DB to simulate passage of time
      await prisma.userDelegation.update({
        where: { id: expDelegation.id },
        data: { endDate: new Date(Date.now() - 1000) },
      });

      // Synchronize lifecycle
      const syncResult = await delegationService.checkAndExpireDelegations(acmeTenantId);
      expect(syncResult.expiredCount).toBeGreaterThanOrEqual(1);

      // User B attempts to approve -> Must be rejected with ForbiddenException!
      await expect(
        graphEngine.submitGraphAction(
          acmeTenantId,
          userBId,
          'APPROVER',
          secondRequestId,
          secondStepId,
          { action: 'APPROVE', comments: 'Attempting post-expiration vote' },
        ),
      ).rejects.toThrow(ForbiddenException);

      // Verify User A can still approve their own step directly
      const directApproval = await graphEngine.submitGraphAction(
        acmeTenantId,
        userAId,
        'MANAGER',
        secondRequestId,
        secondStepId,
        { action: 'APPROVE', comments: 'Approved directly by User A' },
      );

      expect(directApproval.success).toBe(true);
      expect(directApproval.stepStatus).toBe('APPROVED');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { WorkflowNode, WorkflowEdge, InputSchema } from '@flowgate/shared-types';

describe('Milestone 6.4: Workflow Publishing, Version Cloning & DAG Request APIs (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Tokens
  let acmeAdminToken: string;
  let acmeApproverToken: string;
  let acmeRequesterToken: string;
  let globexAdminToken: string;

  // Users & Tenant IDs
  let acmeTenantId: string;
  let acmeAdminUserId: string;

  const testWorkflowIds: string[] = [];
  const testRequestIds: string[] = [];

  const sampleSchema: InputSchema = {
    fields: [
      { name: 'justification', label: 'Justification', type: 'STRING', required: true },
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true },
      { name: 'department', label: 'Department', type: 'STRING', required: false },
    ],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Stop background outbox poller for deterministic assertions
    const publisher = app.get(OutboxPublisherService);
    publisher.stop();

    // Logins
    const acmeAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeAdminLogin.body.accessToken;
    acmeTenantId = acmeAdminLogin.body.user.tenantId;
    acmeAdminUserId = acmeAdminLogin.body.user.id;

    const acmeApproverLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'finance@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeApproverToken = acmeApproverLogin.body.accessToken;

    const acmeRequesterLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'engineer@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeRequesterToken = acmeRequesterLogin.body.accessToken;

    const globexAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'admin@globex.com',
      password: 'FlowGatePass123!',
    });
    globexAdminToken = globexAdminLogin.body.accessToken;
  });

  afterAll(async () => {
    // Allow any in-flight asynchronous outbox sweeps to complete before cleanup
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Clean up created requests and workflows (never delete append-only audit logs)
    if (testRequestIds.length > 0) {
      await prisma.workflowBranchExecution.deleteMany({
        where: { approvalRequestId: { in: testRequestIds } },
      });
      await prisma.workflowNodeExecution.deleteMany({
        where: { approvalRequestId: { in: testRequestIds } },
      });
      await prisma.approvalStepAssignee.deleteMany({
        where: { step: { approvalRequestId: { in: testRequestIds } } },
      });
      await prisma.approvalStep.deleteMany({
        where: { approvalRequestId: { in: testRequestIds } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { entityType: 'ApprovalRequest', entityId: { in: testRequestIds } },
      });
      await prisma.approvalRequest.deleteMany({
        where: { id: { in: testRequestIds } },
      });
    }

    if (testWorkflowIds.length > 0) {
      await prisma.workflowDefinition.deleteMany({
        where: { id: { in: testWorkflowIds } },
      });
    }

    await app.close();
  });

  describe('1. Workflow Creation & DAG Validation', () => {
    it('should reject workflow creation if DAG has a cycle', async () => {
      const cyclicNodes: WorkflowNode[] = [
        { id: 'node_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'node_a',
          type: 'APPROVAL_STEP',
          name: 'Step A',
          config: { assigneeType: 'ROLE', role: 'APPROVER' },
        },
        {
          id: 'node_b',
          type: 'APPROVAL_STEP',
          name: 'Step B',
          config: { assigneeType: 'ROLE', role: 'APPROVER' },
        },
        { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
      ];
      const cyclicEdges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_a' },
        { id: 'e2', sourceNodeId: 'node_a', targetNodeId: 'node_b' },
        { id: 'e3', sourceNodeId: 'node_b', targetNodeId: 'node_a' }, // Cycle!
        { id: 'e4', sourceNodeId: 'node_b', targetNodeId: 'node_end' },
      ];

      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Cyclic Workflow',
          nodes: cyclicNodes,
          edges: cyclicEdges,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cycle');
    });

    it('should create a valid DAG workflow in DRAFT status', async () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'node_trig',
          type: 'TRIGGER',
          name: 'Purchase Trigger',
          config: { inputSchema: sampleSchema },
        },
        {
          id: 'node_appr',
          type: 'APPROVAL_STEP',
          name: 'Finance Approval',
          config: {
            assigneeType: 'ROLE',
            role: 'APPROVER',
            escalationTimeoutMinutes: 1440,
          },
        },
        {
          id: 'node_end',
          type: 'END',
          name: 'Final Approved',
          config: { outcome: 'APPROVED' },
        },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_appr' },
        { id: 'e2', sourceNodeId: 'node_appr', targetNodeId: 'node_end' },
      ];

      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Server Infrastructure Approval',
          description: 'Production server procurement workflow',
          status: 'DRAFT',
          nodes,
          edges,
          inputSchema: sampleSchema,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.version).toBe(1);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.configuration.nodes).toHaveLength(3);
      expect(res.body.configuration.edges).toHaveLength(2);

      testWorkflowIds.push(res.body.id);
    });

    it('should reject request submission against DRAFT workflow', async () => {
      const draftWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: draftWorkflowId,
          title: 'Attempt on Draft Workflow',
          requestData: { justification: 'Need new server', amount: 5000 },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inactive or archived');
    });
  });

  describe('2. Workflow Publishing', () => {
    it('should forbid non-admin/manager from publishing a workflow', async () => {
      const draftWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${draftWorkflowId}/publish`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`);

      expect(res.status).toBe(403);
    });

    it('should enforce tenant isolation when publishing a workflow', async () => {
      const draftWorkflowId = testWorkflowIds[0];

      // Globex admin attempts to publish Acme's workflow
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${draftWorkflowId}/publish`)
        .set('Authorization', `Bearer ${globexAdminToken}`);

      expect(res.status).toBe(404);
    });

    it('should publish draft workflow to ACTIVE status and log WORKFLOW_PUBLISHED', async () => {
      const draftWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${draftWorkflowId}/publish`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(draftWorkflowId);
      expect(res.body.status).toBe('ACTIVE');

      // Verify audit trail entry
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          tenantId: acmeTenantId,
          entityType: 'WorkflowDefinition',
          entityId: draftWorkflowId,
          action: 'WORKFLOW_PUBLISHED',
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.actorId).toBe(acmeAdminUserId);
    });
  });

  describe('3. Draft Version Cloning (vN -> vN+1)', () => {
    let clonedWorkflowId: string;

    it('should clone published workflow v1 to v2 in DRAFT status', async () => {
      const sourceWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${sourceWorkflowId}/clone-draft`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe(sourceWorkflowId);
      expect(res.body.name).toBe('Server Infrastructure Approval');
      expect(res.body.version).toBe(2);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.configuration.nodes).toHaveLength(3);

      clonedWorkflowId = res.body.id;
      testWorkflowIds.push(clonedWorkflowId);

      // Verify source workflow v1 is completely preserved in ACTIVE state
      const sourceAfter = await prisma.workflowDefinition.findUnique({
        where: { id: sourceWorkflowId },
      });
      expect(sourceAfter?.status).toBe('ACTIVE');
      expect(sourceAfter?.version).toBe(1);

      // Verify audit log for cloning
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          tenantId: acmeTenantId,
          entityType: 'WorkflowDefinition',
          entityId: clonedWorkflowId,
          action: 'WORKFLOW_DRAFT_CLONED',
        },
      });
      expect(auditLog).toBeDefined();
      expect((auditLog?.metadata as any)?.sourceWorkflowId).toBe(sourceWorkflowId);
      expect((auditLog?.metadata as any)?.sourceVersion).toBe(1);
      expect((auditLog?.metadata as any)?.newVersion).toBe(2);
    });

    it('should support clone via alias endpoint POST /api/v1/workflows/:id/versions', async () => {
      const sourceWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${sourceWorkflowId}/versions`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(3);
      expect(res.body.status).toBe('DRAFT');

      testWorkflowIds.push(res.body.id);
    });
  });

  describe('4. DAG Request Submission & AST Payload Validation', () => {
    it('should reject request creation when payload violates inputSchema', async () => {
      const publishedWorkflowId = testWorkflowIds[0];

      // Missing required field 'amount'
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: publishedWorkflowId,
          title: 'Invalid Request',
          requestData: { justification: 'Only text, no amount' },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("required input field 'amount'");
    });

    it('should submit request, snapshot workflow definition, and advance to first approval stage', async () => {
      const publishedWorkflowId = testWorkflowIds[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: publishedWorkflowId,
          title: 'Upgrade Database Clusters',
          description: 'Prod DB capacity expansion',
          requestData: {
            justification: 'Current DB IOPS at 92%',
            amount: 7200,
            department: 'Core Infrastructure',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.workflowDefinitionId).toBe(publishedWorkflowId);
      expect(res.body.workflowVersion).toBe(1);

      const requestId = res.body.id;
      testRequestIds.push(requestId);

      // Verify steps were instantiated in review round 1
      expect(res.body.steps).toHaveLength(1);
      expect(res.body.steps[0].stepName).toBe('Finance Approval');
      expect(res.body.steps[0].status).toBe('IN_REVIEW');
    });
  });

  describe('5. Execution Graph & Tree Query Endpoints', () => {
    it('should return normalized execution graph via GET /api/v1/requests/:id/execution-tree', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/requests/${requestId}/execution-tree`)
        .set('Authorization', `Bearer ${acmeApproverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe(requestId);
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.currentReviewRound).toBe(1);
      expect(res.body.nodeExecutions).toBeDefined();
      expect(res.body.branchExecutions).toBeDefined();
      expect(res.body.steps).toBeDefined();

      // Trigger node should be COMPLETED, Approval node should be IN_REVIEW / PENDING
      const triggerExec = res.body.nodeExecutions.find((n: any) => n.nodeId === 'node_trig');
      expect(triggerExec).toBeDefined();
      expect(triggerExec.status).toBe('COMPLETED');

      const outgoingBranch = res.body.branchExecutions.find(
        (b: any) => b.sourceNodeId === 'node_trig',
      );
      expect(outgoingBranch).toBeDefined();
      expect(outgoingBranch.status).toBe('COMPLETED');
    });

    it('should return identical topology via GET /api/v1/workflows/requests/:id/execution-graph', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/workflows/requests/${requestId}/execution-graph`)
        .set('Authorization', `Bearer ${acmeApproverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe(requestId);
      expect(res.body.nodeExecutions.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('6. Approval Action, Changes Request & Resubmission Cycle', () => {
    it('should request changes on active step via POST /api/v1/requests/:id/actions', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          action: 'REQUEST_CHANGES',
          comments: 'Please verify vendor pricing discount',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CHANGES_REQUESTED');

      // Verify step status
      const updatedReq = await prisma.approvalRequest.findUnique({
        where: { id: requestId },
        include: { steps: true },
      });
      expect(updatedReq?.status).toBe('CHANGES_REQUESTED');
      expect(updatedReq?.steps[0].status).toBe('REJECTED');
    });

    it('should forbid non-requester from resubmitting changes', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/resubmit`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          updatedData: { amount: 6500 },
          comments: 'Approver trying to resubmit',
        });

      expect(res.status).toBe(403);
    });

    it('should resubmit request with updated data advancing reviewRound to 2', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/resubmit`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          updatedData: {
            justification: 'Vendor discount applied (10%)',
            amount: 6480,
          },
          comments: 'Applied 10% volume discount',
          resubmissionPolicy: 'REOPEN_ALL',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_PROGRESS');

      // Verify review round advanced to 2 in DB
      const dbRequest = await prisma.approvalRequest.findUnique({
        where: { id: requestId },
      });
      expect(dbRequest?.currentReviewRound).toBe(2);
      expect((dbRequest?.requestData as any)?.amount).toBe(6480);

      // Verify Round 1 steps remain intact and Round 2 steps are created
      const round1Steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId, reviewRound: 1 },
      });
      expect(round1Steps).toHaveLength(1);
      expect(round1Steps[0].status).toBe('REJECTED');

      const round2Steps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId, reviewRound: 2 },
      });
      expect(round2Steps).toHaveLength(1);
      expect(round2Steps[0].status).toBe('IN_REVIEW');
    });

    it('should execute final APPROVE action and transition request to APPROVED', async () => {
      const requestId = testRequestIds[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          action: 'APPROVE',
          comments: 'Discount confirmed. Approved.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      // Verify execution tree shows END node COMPLETED
      const treeRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${requestId}/execution-tree`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`);

      expect(treeRes.status).toBe(200);
      expect(treeRes.body.status).toBe('APPROVED');

      const endNodeExec = treeRes.body.nodeExecutions.find(
        (n: any) => n.nodeId === 'node_end' && n.reviewRound === 2,
      );
      expect(endNodeExec).toBeDefined();
      expect(endNodeExec.status).toBe('COMPLETED');
    });
  });
});

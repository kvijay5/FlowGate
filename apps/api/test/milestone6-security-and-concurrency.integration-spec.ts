import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { WorkflowNode, WorkflowEdge, InputSchema } from '@flowgate/shared-types';

describe('Milestone 6.7: Concurrency, Security Hardening, Audit Tamper-Detection & Multi-Tenant Isolation (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Authentication Tokens
  let acmeAdminToken: string;
  let acmeApproverToken: string;
  let acmeRequesterToken: string;
  let globexAdminToken: string;
  let globexApproverToken: string;

  // Tenant & User IDs
  let acmeTenantId: string;
  let acmeApproverUserId: string;

  // Dedicated test voter users for high-concurrency race test
  const voterUserIds: string[] = [];
  const voterTokens: string[] = [];

  // Cleanup tracking
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

    // 1. Log in standard seed users for Acme Corp
    const acmeAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeAdminLogin.body.accessToken;
    acmeTenantId = acmeAdminLogin.body.user.tenantId;

    const acmeApproverLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'finance@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeApproverToken = acmeApproverLogin.body.accessToken;
    acmeApproverUserId = acmeApproverLogin.body.user.id;

    const acmeRequesterLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'engineer@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeRequesterToken = acmeRequesterLogin.body.accessToken;

    // 2. Log in Globex Industries users
    const globexAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'admin@globex.com',
      password: 'FlowGatePass123!',
    });
    globexAdminToken = globexAdminLogin.body.accessToken;

    const globexApproverLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'hr-lead@globex.com',
      password: 'FlowGatePass123!',
    });
    globexApproverToken = globexApproverLogin.body.accessToken;

    // 3. Upsert 5 dedicated test approvers in Acme Corp for concurrent voting tests
    const passwordHash = await bcrypt.hash('FlowGatePass123!', 10);
    for (let i = 1; i <= 5; i++) {
      const email = `sec-voter-${i}@acme.com`;
      const user = await prisma.user.upsert({
        where: { tenant_user_email_unique: { tenantId: acmeTenantId, email } },
        update: { status: 'ACTIVE', role: 'APPROVER' },
        create: {
          tenantId: acmeTenantId,
          email,
          name: `Concurrency Approver ${i}`,
          passwordHash,
          role: 'APPROVER',
          status: 'ACTIVE',
        },
      });
      voterUserIds.push(user.id);

      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        tenantSlug: 'acme-corp',
        email,
        password: 'FlowGatePass123!',
      });
      voterTokens.push(loginRes.body.accessToken);
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Clean up created requests and steps
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

    // Clean up created workflow definitions and all associated requests
    if (testWorkflowIds.length > 0) {
      await prisma.workflowBranchExecution.deleteMany({
        where: { approvalRequest: { workflowDefinitionId: { in: testWorkflowIds } } },
      });
      await prisma.workflowNodeExecution.deleteMany({
        where: { approvalRequest: { workflowDefinitionId: { in: testWorkflowIds } } },
      });
      await prisma.approvalStepAssignee.deleteMany({
        where: { step: { approvalRequest: { workflowDefinitionId: { in: testWorkflowIds } } } },
      });
      await prisma.approvalStep.deleteMany({
        where: { approvalRequest: { workflowDefinitionId: { in: testWorkflowIds } } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          entityType: 'ApprovalRequest',
          entityId: { in: testRequestIds },
        },
      });
      await prisma.approvalRequest.deleteMany({
        where: {
          OR: [{ id: { in: testRequestIds } }, { workflowDefinitionId: { in: testWorkflowIds } }],
        },
      });
      await prisma.workflowDefinition.deleteMany({
        where: { id: { in: testWorkflowIds } },
      });
    }

    await app.close();
  });

  describe('1. Multi-Tenant DAG & Delegation Isolation', () => {
    let acmeWorkflowId: string;
    let acmeRequestId: string;

    beforeAll(async () => {
      // Create and publish a workflow in Acme Corp
      const wfRes = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Acme Secret Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Start',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_appr',
              type: 'APPROVAL_STEP',
              name: 'Acme Finance Approval',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_appr' },
            { id: 'e2', sourceNodeId: 'node_appr', targetNodeId: 'node_end' },
          ],
        });

      acmeWorkflowId = wfRes.body.id;
      testWorkflowIds.push(acmeWorkflowId);

      // Publish workflow
      await request(app.getHttpServer())
        .post(`/api/v1/workflows/${acmeWorkflowId}/publish`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      // Create an approval request
      const reqRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: acmeWorkflowId,
          title: 'Acme Purchase Order #9901',
          requestData: { justification: 'Confidential equipment', amount: 5000 },
        });

      acmeRequestId = reqRes.body.id;
      testRequestIds.push(acmeRequestId);
    });

    it("should prevent Tenant B from viewing, modifying, publishing, or cloning Tenant A's workflow", async () => {
      // 1. GET workflow
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/workflows/${acmeWorkflowId}`)
        .set('Authorization', `Bearer ${globexAdminToken}`);
      expect(getRes.status).toBe(404);

      // 2. PATCH workflow
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/workflows/${acmeWorkflowId}`)
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .send({ name: 'Hacked Workflow' });
      expect(patchRes.status).toBe(404);

      // 3. POST /publish
      const publishRes = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${acmeWorkflowId}/publish`)
        .set('Authorization', `Bearer ${globexAdminToken}`);
      expect(publishRes.status).toBe(404);

      // 4. POST /clone-draft
      const cloneRes = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${acmeWorkflowId}/clone-draft`)
        .set('Authorization', `Bearer ${globexAdminToken}`);
      expect(cloneRes.status).toBe(404);
    });

    it("should prevent Tenant B from viewing or voting on Tenant A's requests and execution graphs", async () => {
      // 1. GET request detail
      const reqRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${acmeRequestId}`)
        .set('Authorization', `Bearer ${globexApproverToken}`);
      expect(reqRes.status).toBe(404);

      // 2. GET execution tree
      const treeRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${acmeRequestId}/execution-tree`)
        .set('Authorization', `Bearer ${globexApproverToken}`);
      expect(treeRes.status).toBe(404);

      // 3. GET execution graph
      const graphRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${acmeRequestId}/execution-graph`)
        .set('Authorization', `Bearer ${globexApproverToken}`);
      expect(graphRes.status).toBe(404);

      // 4. POST vote action
      const actionRes = await request(app.getHttpServer())
        .post(`/api/v1/requests/${acmeRequestId}/actions`)
        .set('Authorization', `Bearer ${globexApproverToken}`)
        .send({ stepId: 'a0000000-0000-4000-8000-000000000000', action: 'APPROVE' });
      expect(actionRes.status).toBe(404);
    });

    it("should block cross-tenant delegation creation when targeting another tenant's user", async () => {
      // Globex Admin attempts to create delegation designating Acme's Approver as delegatee
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const res = await request(app.getHttpServer())
        .post('/api/v1/delegations')
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .send({
          delegateeId: acmeApproverUserId,
          startDate: now.toISOString(),
          endDate: nextWeek.toISOString(),
          reason: 'Attempted cross-tenant privilege usurpation',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Delegatee user not found or is not active in this tenant/i);
    });

    it('should strictly isolate cryptographic audit chain verification by tenant', async () => {
      // Verify Acme chain
      const acmeVerify = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      expect(acmeVerify.status).toBe(200);
      expect(acmeVerify.body.valid).toBe(true);

      // Verify Globex chain
      const globexVerify = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${globexAdminToken}`);
      expect(globexVerify.status).toBe(200);
      expect(globexVerify.body.valid).toBe(true);
    });
  });

  describe('2. High-Concurrency Race Condition & Row Serialization', () => {
    let parallelWorkflowId: string;

    beforeAll(async () => {
      // Create a 3-of-5 PARALLEL_OR workflow
      const wfRes = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Concurrent Parallel Quorum Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Quorum Trigger',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_par',
              type: 'PARALLEL_APPROVAL',
              name: 'Executive Committee (3 of 5)',
              config: {
                policy: 'PARALLEL_OR',
                rejectionPolicy: 'SOFT_REJECTION',
                requiredApprovals: 3,
                assignees: voterUserIds.map((id) => ({ assigneeType: 'USER', userId: id })),
              },
            },
            {
              id: 'node_end',
              type: 'END',
              name: 'Workflow Approved',
              config: { outcome: 'APPROVED' },
            },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_par' },
            { id: 'e2', sourceNodeId: 'node_par', targetNodeId: 'node_end' },
          ],
        });

      parallelWorkflowId = wfRes.body.id;
      testWorkflowIds.push(parallelWorkflowId);

      await request(app.getHttpServer())
        .post(`/api/v1/workflows/${parallelWorkflowId}/publish`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);
    });

    it('should serialize 5 simultaneous votes on a 3-of-5 PARALLEL_OR step without race conditions or counter corruption', async () => {
      // 1. Submit request
      const reqRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: parallelWorkflowId,
          title: 'High-Concurrency Capital Outlay',
          requestData: { justification: 'Server farm expansion', amount: 75000 },
        });

      expect(reqRes.status).toBe(201);
      const requestId = reqRes.body.id;
      testRequestIds.push(requestId);

      const step = reqRes.body.steps[0];
      expect(step).toBeDefined();
      expect(step.policy).toBe('PARALLEL_OR');
      expect(step.requiredApprovals).toBe(3);
      expect(step.assignees).toHaveLength(5);
      const stepId = step.id;

      // 2. Fire 5 simultaneous votes concurrently using Promise.all
      const votePromises = voterTokens.map((token, idx) =>
        request(app.getHttpServer())
          .post(`/api/v1/requests/${requestId}/actions`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            stepId,
            action: 'APPROVE',
            comments: `Concurrent vote by voter #${idx + 1}`,
          }),
      );

      const responses = await Promise.all(votePromises);

      // Exactly 3 votes should succeed (satisfying the 3-of-5 threshold)
      const successfulVotes = responses.filter((r) => r.status === 200);
      const rejectedVotes = responses.filter((r) => r.status === 400);

      expect(successfulVotes.length).toBe(3);
      expect(rejectedVotes.length).toBe(2);

      // The 2 excess votes should be rejected because step is already APPROVED or voter is SKIPPED
      for (const rej of rejectedVotes) {
        expect(rej.body.message).toMatch(
          /Cannot perform action on (step|request) in 'APPROVED' status|User has already submitted a decision|not authorized/i,
        );
      }

      // 3. Inspect database state
      const stepInDb = await prisma.approvalStep.findUnique({
        where: { id: stepId },
        include: { assignees: true },
      });

      expect(stepInDb?.status).toBe('APPROVED');
      expect(stepInDb?.approvedCount).toBe(3);
      expect(stepInDb?.rejectedCount).toBe(0);

      const approvedAssignees = stepInDb?.assignees.filter((a) => a.status === 'APPROVED');
      const skippedAssignees = stepInDb?.assignees.filter((a) => a.status === 'SKIPPED');
      const pendingAssignees = stepInDb?.assignees.filter((a) => a.status === 'PENDING');

      expect(approvedAssignees?.length).toBe(3);
      expect(skippedAssignees?.length).toBe(2);
      expect(pendingAssignees?.length).toBe(0); // All 5 assignees conclusively resolved!

      // Skipped assignees have explicit quorum resolution note
      for (const skipped of skippedAssignees!) {
        expect(skipped.comments).toBe('Resolved by peer approval');
      }

      // 4. Assert downstream node activated ONCE (zero duplicate steps)
      const nodeExecutions = await prisma.workflowNodeExecution.findMany({
        where: { approvalRequestId: requestId },
      });
      const endExecutions = nodeExecutions.filter((n) => n.nodeId === 'node_end');
      expect(endExecutions).toHaveLength(1);
      expect(endExecutions[0].status).toBe('COMPLETED');

      // 5. Assert cryptographic audit log remains fully continuous
      const verifyRes = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.valid).toBe(true);
    });

    it('should reject duplicate double-voting race when the same voter submits concurrent requests on locked rows', async () => {
      // 1. Submit request
      const reqRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: parallelWorkflowId,
          title: 'Duplicate Vote Race Attempt',
          requestData: { justification: 'Testing double-spend protection', amount: 12000 },
        });

      const requestId = reqRes.body.id;
      testRequestIds.push(requestId);
      const stepId = reqRes.body.steps[0].id;

      // 2. Voter 1 submits 2 simultaneous identical approval votes
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/requests/${requestId}/actions`)
          .set('Authorization', `Bearer ${voterTokens[0]}`)
          .send({ stepId, action: 'APPROVE', comments: 'Simultaneous Vote A' }),
        request(app.getHttpServer())
          .post(`/api/v1/requests/${requestId}/actions`)
          .set('Authorization', `Bearer ${voterTokens[0]}`)
          .send({ stepId, action: 'APPROVE', comments: 'Simultaneous Vote B' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 400]);

      const failedResponse = resA.status === 400 ? resA : resB;
      expect(failedResponse.body.message).toMatch(
        /User has already submitted a decision for this approval step/i,
      );

      // Verify step approved count is strictly 1 (no double increment)
      const stepInDb = await prisma.approvalStep.findUnique({
        where: { id: stepId },
      });
      expect(stepInDb?.approvedCount).toBe(1);
    });
  });

  describe('3. Cryptographic SHA-256 Audit Chain Tamper-Detection', () => {
    it('should detect raw database tampering in the historical audit ledger and restore upon correction', async () => {
      // 1. Verify initial audit chain state is valid
      const initialVerify = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(initialVerify.status).toBe(200);
      expect(initialVerify.body.valid).toBe(true);

      // 2. Locate an existing hashed audit log entry for Acme Corp
      const targetLog = await prisma.auditLog.findFirst({
        where: { tenantId: acmeTenantId, hash: { not: null } },
        orderBy: { sequenceNumber: 'desc' },
      });
      expect(targetLog).toBeDefined();

      const originalMetadata = targetLog!.metadata;

      try {
        // 3. Perform raw SQL tampering simulating rogue DB admin or compromised SQL injection
        await prisma.$executeRaw`
          UPDATE "audit_logs"
          SET "metadata" = '{"tampered": true, "unauthorized": "rogue modification"}'::jsonb
          WHERE "id" = ${targetLog!.id}::uuid
        `;

        // 4. Verify chain detection detects payload tampering
        const tamperedVerify = await request(app.getHttpServer())
          .get('/api/v1/audit/verify')
          .set('Authorization', `Bearer ${acmeAdminToken}`);

        expect(tamperedVerify.status).toBe(200);
        expect(tamperedVerify.body.valid).toBe(false);
        expect(tamperedVerify.body.brokenAtId).toBe(targetLog!.id);
        expect(tamperedVerify.body.details).toMatch(/Tampered content|does not match stored hash/i);
      } finally {
        // 5. Restore original metadata cleanly
        await prisma.auditLog.update({
          where: { id: targetLog!.id },
          data: { metadata: originalMetadata as any },
        });
      }

      // 6. Verify chain returns to mathematically valid status
      const restoredVerify = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(restoredVerify.status).toBe(200);
      expect(restoredVerify.body.valid).toBe(true);
    });
  });

  describe('4. Adversarial AST Evaluator & Edge Cases', () => {
    it('should reject workflow creation if AST condition depth exceeds maximum allowed limit (depth > 5)', async () => {
      const nestedAstDepth6 = {
        operator: 'AND',
        children: [
          {
            operator: 'AND',
            children: [
              {
                operator: 'AND',
                children: [
                  {
                    operator: 'AND',
                    children: [
                      {
                        operator: 'AND',
                        children: [
                          {
                            operator: 'AND',
                            children: [{ field: 'amount', operator: 'GT', value: 100 }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Excessive Depth Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Start',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_cond',
              type: 'CONDITION',
              name: 'Deep Condition',
              config: {
                rules: [
                  {
                    id: 'r1',
                    branchKey: 'branch_deep',
                    targetNodeId: 'node_high',
                    expression: nestedAstDepth6 as any,
                  },
                ],
                defaultTargetNodeId: 'node_low',
              },
            },
            {
              id: 'node_high',
              type: 'APPROVAL_STEP',
              name: 'High Step',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            {
              id: 'node_low',
              type: 'APPROVAL_STEP',
              name: 'Low Step',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_cond' },
            { id: 'e2', sourceNodeId: 'node_cond', targetNodeId: 'node_high' },
            { id: 'e3', sourceNodeId: 'node_cond', targetNodeId: 'node_low' },
            { id: 'e4', sourceNodeId: 'node_high', targetNodeId: 'node_end' },
            { id: 'e5', sourceNodeId: 'node_low', targetNodeId: 'node_end' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/tree depth \(6\) exceeds maximum allowed limit of 5/i);
    });

    it('should block prototype pollution in AST condition expression fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Prototype Pollution Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Start',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_cond',
              type: 'CONDITION',
              name: 'Exploit Condition',
              config: {
                rules: [
                  {
                    id: 'r1',
                    branchKey: 'branch_exploit',
                    targetNodeId: 'node_high',
                    expression: { field: '__proto__', operator: 'EQ', value: 'admin' },
                  },
                ],
                defaultTargetNodeId: 'node_low',
              },
            },
            {
              id: 'node_high',
              type: 'APPROVAL_STEP',
              name: 'High Step',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            {
              id: 'node_low',
              type: 'APPROVAL_STEP',
              name: 'Low Step',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_cond' },
            { id: 'e2', sourceNodeId: 'node_cond', targetNodeId: 'node_high' },
            { id: 'e3', sourceNodeId: 'node_cond', targetNodeId: 'node_low' },
            { id: 'e4', sourceNodeId: 'node_high', targetNodeId: 'node_end' },
            { id: 'e5', sourceNodeId: 'node_low', targetNodeId: 'node_end' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/prototype pollution attempt detected/i);
    });

    it('should block prototype pollution attempts in request submission payload', async () => {
      // Create and publish a simple workflow
      const wfRes = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Payload Test Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Start',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_appr',
              type: 'APPROVAL_STEP',
              name: 'Step',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_appr' },
            { id: 'e2', sourceNodeId: 'node_appr', targetNodeId: 'node_end' },
          ],
        });
      testWorkflowIds.push(wfRes.body.id);

      await request(app.getHttpServer())
        .post(`/api/v1/workflows/${wfRes.body.id}/publish`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      // Attempt 1: prototype key
      const protoRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wfRes.body.id,
          title: 'Pollution Attempt 1',
          requestData: {
            prototype: { isAdmin: true },
            justification: 'Attempting exploit',
            amount: 50,
          },
        });

      if (protoRes.body?.id) {
        testRequestIds.push(protoRes.body.id);
      }
      expect(protoRes.status).toBe(400);
      expect(protoRes.body.message).toMatch(/prototype pollution attempt detected/i);

      // Attempt 2: __proto__ injection via property name
      const ctorRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wfRes.body.id,
          title: 'Pollution Attempt 2',
          requestData: {
            'user.__proto__': true,
            justification: 'Attempting exploit 2',
            amount: 50,
          },
        });

      if (ctorRes.body?.id) {
        testRequestIds.push(ctorRes.body.id);
      }
      expect(ctorRes.status).toBe(400);
      expect(ctorRes.body.message).toMatch(/prototype pollution attempt detected/i);
    });

    it('should reject request payload exceeding the 32 KB maximum size limit', async () => {
      const activeWorkflowId = testWorkflowIds[testWorkflowIds.length - 1];

      // Generate a string exceeding 32 KB (32,768 bytes)
      const oversizedString = 'A'.repeat(33 * 1024);

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: activeWorkflowId,
          title: 'Oversized Payload Request',
          requestData: {
            justification: oversizedString,
            amount: 100,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/exceeds maximum allowed limit of 32768 bytes \(32 KB\)/i);
    });

    it('should reject static join deadlock when an ALL_INCOMING join is fed exclusively by mutually exclusive condition branches', async () => {
      const deadlockNodes: WorkflowNode[] = [
        {
          id: 'node_trig',
          type: 'TRIGGER',
          name: 'Start',
          config: { inputSchema: sampleSchema },
        },
        {
          id: 'node_cond',
          type: 'CONDITION',
          name: 'Exclusive Branch Splitter',
          config: {
            rules: [
              {
                id: 'r_high',
                branchKey: 'branch_high',
                targetNodeId: 'node_high_appr',
                expression: { field: 'amount', operator: 'GT', value: 1000 },
              },
            ],
            defaultTargetNodeId: 'node_low_appr',
          },
        },
        {
          id: 'node_high_appr',
          type: 'APPROVAL_STEP',
          name: 'High Value Approval',
          config: { assigneeType: 'USER', userId: acmeApproverUserId },
        },
        {
          id: 'node_low_appr',
          type: 'APPROVAL_STEP',
          name: 'Low Value Approval',
          config: { assigneeType: 'USER', userId: acmeApproverUserId },
        },
        {
          id: 'node_join',
          type: 'JOIN',
          name: 'Deadlocked Convergence Gate',
          config: { joinPolicy: 'ALL_INCOMING' },
        },
        {
          id: 'node_end',
          type: 'END',
          name: 'Completed',
          config: { outcome: 'APPROVED' },
        },
      ];

      const deadlockEdges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_cond' },
        { id: 'e2', sourceNodeId: 'node_cond', targetNodeId: 'node_high_appr' },
        { id: 'e3', sourceNodeId: 'node_cond', targetNodeId: 'node_low_appr' },
        { id: 'e4', sourceNodeId: 'node_high_appr', targetNodeId: 'node_join' },
        { id: 'e5', sourceNodeId: 'node_low_appr', targetNodeId: 'node_join' },
        { id: 'e6', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
      ];

      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Deadlocked Join Workflow',
          nodes: deadlockNodes,
          edges: deadlockEdges,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(
        /Static Join Deadlock: Join node 'Deadlocked Convergence Gate' with ALL_INCOMING policy cannot be fed exclusively by mutually exclusive branches/i,
      );
    });

    it('should retain Round 1 execution records, steps, and audit logs when a request is resubmitted for Round 2', async () => {
      // 1. Create and publish a sequential workflow
      const wfRes = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Resubmission Audit Retention Workflow',
          nodes: [
            {
              id: 'node_trig',
              type: 'TRIGGER',
              name: 'Start',
              config: { inputSchema: sampleSchema },
            },
            {
              id: 'node_appr',
              type: 'APPROVAL_STEP',
              name: 'Initial Review',
              config: { assigneeType: 'USER', userId: acmeApproverUserId },
            },
            { id: 'node_end', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'node_trig', targetNodeId: 'node_appr' },
            { id: 'e2', sourceNodeId: 'node_appr', targetNodeId: 'node_end' },
          ],
        });
      testWorkflowIds.push(wfRes.body.id);

      await request(app.getHttpServer())
        .post(`/api/v1/workflows/${wfRes.body.id}/publish`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      // 2. Submit initial request (Review Round 1)
      const reqRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wfRes.body.id,
          title: 'Initial Proposal for Review',
          requestData: { justification: 'Initial draft proposal', amount: 1500 },
        });

      const requestId = reqRes.body.id;
      testRequestIds.push(requestId);
      const step1Id = reqRes.body.steps[0].id;

      // 3. Approver submits REQUEST_CHANGES
      const changeRes = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          stepId: step1Id,
          action: 'REQUEST_CHANGES',
          comments: 'Please attach competitive vendor bids and departmental charge code.',
        });

      expect(changeRes.status).toBe(200);

      // Verify request is in CHANGES_REQUESTED status
      const updatedReq = await prisma.approvalRequest.findUnique({
        where: { id: requestId },
      });
      expect(updatedReq?.status).toBe('CHANGES_REQUESTED');
      expect(updatedReq?.currentReviewRound).toBe(1);

      // 4. Requester resubmits request for Review Round 2
      const resubmitRes = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/resubmit`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          comments: 'Added 3 vendor bids and assigned cost center 4022.',
          updatedData: {
            justification: 'Revised proposal with 3 vendor bids',
            amount: 1450,
            department: 'ENGINEERING',
          },
          resubmissionPolicy: 'REOPEN_ALL',
        });

      expect(resubmitRes.status).toBe(200);
      expect(resubmitRes.body.currentReviewRound).toBe(2);
      expect(resubmitRes.body.status).toBe('IN_PROGRESS');

      // 5. Database Verification: Ensure Round 1 historical records are strictly preserved
      const allNodeExecutions = await prisma.workflowNodeExecution.findMany({
        where: { approvalRequestId: requestId },
        orderBy: [{ reviewRound: 'asc' }, { nodeId: 'asc' }],
      });

      const round1Nodes = allNodeExecutions.filter((n) => n.reviewRound === 1);
      const round2Nodes = allNodeExecutions.filter((n) => n.reviewRound === 2);

      expect(round1Nodes.length).toBeGreaterThan(0);
      expect(round2Nodes.length).toBeGreaterThan(0);

      // Verify Round 1 Step vs Round 2 Step
      const allSteps = await prisma.approvalStep.findMany({
        where: { approvalRequestId: requestId },
        orderBy: { reviewRound: 'asc' },
      });

      expect(allSteps).toHaveLength(2);
      expect(allSteps[0].reviewRound).toBe(1);
      expect(allSteps[0].status).toBe('REJECTED'); // Marked REJECTED/CHANGES_REQUESTED in round 1
      expect(allSteps[1].reviewRound).toBe(2);
      expect(allSteps[1].status).toBe('IN_REVIEW');

      // Verify Audit Trail has both REQUEST_CHANGES and REQUEST_RESUBMITTED entries
      const auditEntries = await prisma.auditLog.findMany({
        where: {
          tenantId: acmeTenantId,
          entityId: requestId,
        },
        orderBy: { sequenceNumber: 'asc' },
      });

      const resubmittedAudit = auditEntries.find((a) => a.action === 'REQUEST_RESUBMITTED');
      expect(resubmittedAudit).toBeDefined();
      expect(resubmittedAudit?.metadata).toMatchObject({
        fromRound: 1,
        toRound: 2,
        policy: 'REOPEN_ALL',
      });

      // Verify overall audit chain validity
      const finalAuditVerify = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      expect(finalAuditVerify.status).toBe(200);
      expect(finalAuditVerify.body.valid).toBe(true);
    });
  });
});

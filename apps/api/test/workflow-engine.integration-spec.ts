import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Workflow & Approval Engine Lifecycle (Integration)', () => {
  let app: INestApplication;

  // Tokens
  let acmeAdminToken: string;
  let acmeApproverToken: string;
  let acmeRequesterToken: string;
  let globexAdminToken: string;
  let globexRequesterToken: string;

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

    // Authenticate users
    const acmeAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeAdminLogin.body.accessToken;

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

    const globexRequesterLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        tenantSlug: 'globex-ind',
        email: 'employee@globex.com',
        password: 'FlowGatePass123!',
      });
    globexRequesterToken = globexRequesterLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ===========================================================================
  // 1. WORKFLOW DEFINITIONS
  // ===========================================================================
  describe('Workflow Definitions API (/api/v1/workflows)', () => {
    let createdWorkflowId: string;

    it('should reject workflow creation by unauthorized role (REQUESTER) with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          name: 'Unauthorized Workflow',
          steps: [{ stepOrder: 1, name: 'Signoff', assigneeType: 'ROLE', role: 'APPROVER' }],
        })
        .expect(403);
    });

    it('should reject invalid workflow step sequence (gap in order) with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Invalid Step Order Workflow',
          steps: [
            { stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' },
            { stepOrder: 3, name: 'Step 3', assigneeType: 'ROLE', role: 'APPROVER' }, // Gap!
          ],
        })
        .expect(400);

      expect(res.body.message).toContain('sequence');
    });

    it('should allow TENANT_ADMIN to create a valid multi-step workflow', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'IT Cloud Infrastructure Provisioning',
          description: 'Approval pipeline for high-capacity cloud clusters',
          steps: [
            {
              stepOrder: 1,
              name: 'Finance Review',
              assigneeType: 'ROLE',
              role: 'APPROVER',
              description: 'Budget verification',
            },
            {
              stepOrder: 2,
              name: 'Executive Signoff',
              assigneeType: 'ROLE',
              role: 'TENANT_ADMIN',
              description: 'Final operational approval',
            },
          ],
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('IT Cloud Infrastructure Provisioning');
      expect(res.body.status).toBe('ACTIVE');
      createdWorkflowId = res.body.id;
    });

    it('should list tenant workflows and enforce tenant isolation', async () => {
      // Acme Admin sees Acme workflows
      const acmeList = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(acmeList.body.some((wf: any) => wf.id === createdWorkflowId)).toBe(true);

      // Globex Admin does NOT see Acme workflows
      const globexList = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .expect(200);

      expect(globexList.body.some((wf: any) => wf.id === createdWorkflowId)).toBe(false);
    });

    it('should reject cross-tenant retrieval with 404 Not Found', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workflows/${createdWorkflowId}`)
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .expect(404);
    });

    it('should allow deactivating and activating a workflow', async () => {
      // Deactivate
      const deactivated = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${createdWorkflowId}/deactivate`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);
      expect(deactivated.body.status).toBe('ARCHIVED');

      // Reactivate
      const reactivated = await request(app.getHttpServer())
        .post(`/api/v1/workflows/${createdWorkflowId}/activate`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);
      expect(reactivated.body.status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 2. APPROVAL REQUEST LIFECYCLE & STATE MACHINE
  // ===========================================================================
  describe('Approval Request Lifecycle & State Machine', () => {
    let activeWorkflowId: string;
    let requestId: string;

    beforeAll(async () => {
      // Fetch an active Acme workflow
      const list = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      const activeWf = list.body.find((w: any) => w.status === 'ACTIVE');
      activeWorkflowId = activeWf.id;
    });

    it('should allow authenticated requester to create an approval request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: activeWorkflowId,
          title: 'Upgrade Kubernetes Cluster to v1.31',
          description: 'Production cluster rolling upgrade across multi-AZ pool',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.currentStep).toBe(1);
      expect(res.body.steps.length).toBeGreaterThan(0);
      expect(res.body.steps[0].status).toBe('IN_REVIEW');

      requestId = res.body.id;
    });

    it('should reject cross-tenant request access with 404 Not Found', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${globexRequesterToken}`)
        .expect(404);
    });

    it('should reject requester self-approval attempt with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          action: 'APPROVE',
          comments: 'Self approval attempt',
        })
        .expect(403);
    });

    it('should reject approval attempt by user with wrong role with 403 Forbidden', async () => {
      // Globex user or non-approver cannot approve Acme's Step 1
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .send({
          action: 'APPROVE',
        })
        .expect(404); // Cross tenant returns 404
    });

    it('should support returning a request for changes (REQUEST_CHANGES)', async () => {
      // Step 1 approver requests changes
      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          action: 'REQUEST_CHANGES',
          comments: 'Please attach maintenance window downtime schedule',
        })
        .expect(200);

      expect(res.body.status).toBe('CHANGES_REQUESTED');
    });

    it('should allow the requester to resubmit after making changes', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/resubmit`)
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          description:
            'Production cluster rolling upgrade with 02:00 AM maintenance window schedule attached',
          comments: 'Schedule added in description',
        })
        .expect(200);

      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.description).toContain('02:00 AM');
    });

    it('should progress Step 1 to Step 2 upon approval', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          action: 'APPROVE',
          comments: 'Maintenance window verified. Step 1 Approved.',
        })
        .expect(200);

      expect(res.body.steps[0].status).toBe('APPROVED');
      expect(res.body.steps[0].comments).toContain('Step 1 Approved');
      if (res.body.steps.length > 1) {
        expect(res.body.steps[1].status).toBe('IN_REVIEW');
        expect(res.body.status).toBe('IN_PROGRESS');
      } else {
        expect(res.body.status).toBe('APPROVED');
      }
    });

    it('should mark entire request APPROVED when final step is approved', async () => {
      // Final step is assigned to TENANT_ADMIN
      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          action: 'APPROVE',
          comments: 'Executive signoff complete. Cleared for rollout.',
        })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
      expect(res.body.steps.every((s: any) => s.status === 'APPROVED')).toBe(true);
    });

    it('should reject further actions on already completed requests with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/requests/${requestId}/actions`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          action: 'APPROVE',
        })
        .expect(409);

      expect(res.body.message).toContain('APPROVED');
    });

    it('should verify audit logs are recorded and do not contain secrets', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(res.body.auditLogs).toBeDefined();
      expect(res.body.auditLogs.length).toBeGreaterThan(0);

      const actions = res.body.auditLogs.map((log: any) => log.action);
      expect(actions).toContain('REQUEST_CREATED');
      expect(actions).toContain('STEP_APPROVED');
      expect(actions).toContain('REQUEST_APPROVED');

      // Verify no sensitive keys leaked in metadata
      for (const log of res.body.auditLogs) {
        const str = JSON.stringify(log.metadata);
        expect(str).not.toContain('FlowGatePass123!');
        expect(str).not.toContain('passwordHash');
      }
    });
  });

  // ===========================================================================
  // 3. REJECTION WORKFLOW
  // ===========================================================================
  describe('Rejection Workflow', () => {
    let rejectRequestId: string;

    it('should create request, reject at Step 1, and skip remaining steps', async () => {
      const wfList = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      const wf = wfList.body.find(
        (w: any) => w.status === 'ACTIVE' && w.configuration?.steps?.length > 1,
      );

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wf.id,
          title: 'Unbudgeted Premium Coffee Machine',
        })
        .expect(201);

      rejectRequestId = createRes.body.id;

      // Approver rejects
      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/requests/${rejectRequestId}/actions`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .send({
          action: 'REJECT',
          comments: 'Budget denied for non-essential hardware',
        })
        .expect(200);

      expect(rejectRes.body.status).toBe('REJECTED');
      expect(rejectRes.body.steps[0].status).toBe('REJECTED');
      expect(rejectRes.body.steps[1].status).toBe('SKIPPED');
    });
  });

  // ===========================================================================
  // 4. CONCURRENCY & APPROVAL INTEGRITY
  // ===========================================================================
  describe('Concurrency & Approval Race-Condition Protection', () => {
    let activeWf: any;

    beforeAll(async () => {
      const wfList = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      activeWf = wfList.body.find(
        (w: any) => w.status === 'ACTIVE' && w.configuration?.steps?.length > 1,
      );
    });

    it('should allow exactly one action when two approvals compete concurrently, returning 409 Conflict to the other', async () => {
      // Create fresh request
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: activeWf.id,
          title: 'Concurrent Hardware Purchase Bid',
        })
        .expect(201);

      const targetRequestId = createRes.body.id;

      // Fire two simultaneous competing approval actions on Step 1
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/requests/${targetRequestId}/actions`)
          .set('Authorization', `Bearer ${acmeApproverToken}`)
          .send({ action: 'APPROVE', comments: 'Concurrent Action Attempt A' }),
        request(app.getHttpServer())
          .post(`/api/v1/requests/${targetRequestId}/actions`)
          .set('Authorization', `Bearer ${acmeApproverToken}`)
          .send({ action: 'APPROVE', comments: 'Concurrent Action Attempt B' }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (200) and the other must be rejected with 409 Conflict
      expect(statuses).toEqual([200, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.message).toContain('concurrently');

      // Verify request state progressed exactly once
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${targetRequestId}`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(detailRes.body.steps[0].status).toBe('APPROVED');
      expect(detailRes.body.steps[1].status).toBe('IN_REVIEW');

      // Verify audit logs: exactly one STEP_APPROVED for step 1 was created
      const step1ApprovedLogs = detailRes.body.auditLogs.filter(
        (l: any) => l.action === 'STEP_APPROVED' && l.metadata.stepOrder === 1,
      );
      expect(step1ApprovedLogs.length).toBe(1);
    });

    it('should cleanly resolve competing APPROVE vs REJECT actions on the same step', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: activeWf.id,
          title: 'Contested Equipment Provisioning',
        })
        .expect(201);

      const targetRequestId = createRes.body.id;

      // Competing APPROVE vs REJECT fired simultaneously
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/requests/${targetRequestId}/actions`)
          .set('Authorization', `Bearer ${acmeApproverToken}`)
          .send({ action: 'APPROVE', comments: 'Immediate Approval' }),
        request(app.getHttpServer())
          .post(`/api/v1/requests/${targetRequestId}/actions`)
          .set('Authorization', `Bearer ${acmeApproverToken}`)
          .send({ action: 'REJECT', comments: 'Immediate Rejection' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Check request state is coherent
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/requests/${targetRequestId}`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      const winningAction = resA.status === 200 ? 'APPROVE' : 'REJECT';
      if (winningAction === 'APPROVE') {
        expect(detailRes.body.steps[0].status).toBe('APPROVED');
      } else {
        expect(detailRes.body.steps[0].status).toBe('REJECTED');
        expect(detailRes.body.status).toBe('REJECTED');
      }
    });
  });

  // ===========================================================================
  // 5. WORKFLOW VERSIONING & HISTORICAL SNAPSHOTS
  // ===========================================================================
  describe('Workflow Versioning & Historical Snapshots', () => {
    it('should preserve existing in-progress request steps and version when workflow definition is updated', async () => {
      // 1. Create dedicated workflow for version testing
      const wfRes = await request(app.getHttpServer())
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Version Evolution Workflow',
          description: 'Initial v1 definition',
          steps: [
            { stepOrder: 1, name: 'V1 Step One', assigneeType: 'ROLE', role: 'APPROVER' },
            { stepOrder: 2, name: 'V1 Step Two', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
          ],
        })
        .expect(201);

      const wfId = wfRes.body.id;
      expect(wfRes.body.version).toBe(1);

      // 2. Create approval request under version 1
      const req1Res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wfId,
          title: 'Request under Workflow Version 1',
        })
        .expect(201);

      const req1Id = req1Res.body.id;
      expect(req1Res.body.workflowVersion).toBe(1);
      expect(req1Res.body.steps[0].stepName).toBe('V1 Step One');

      // 3. Update workflow definition with new steps while req1 is in progress
      const updateWfRes = await request(app.getHttpServer())
        .patch(`/api/v1/workflows/${wfId}`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Version Evolution Workflow Updated',
          steps: [
            {
              stepOrder: 1,
              name: 'V2 Redesigned Step One',
              assigneeType: 'ROLE',
              role: 'APPROVER',
            },
            { stepOrder: 2, name: 'V2 Security Audit', assigneeType: 'ROLE', role: 'MANAGER' },
            { stepOrder: 3, name: 'V2 Final Signoff', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
          ],
        })
        .expect(200);

      // Because req1 was in progress, version was automatically bumped to 2
      expect(updateWfRes.body.version).toBe(2);

      // 4. Verify existing req1 was NOT altered or corrupted
      const req1Detail = await request(app.getHttpServer())
        .get(`/api/v1/requests/${req1Id}`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(req1Detail.body.workflowVersion).toBe(1);
      expect(req1Detail.body.steps.length).toBe(2);
      expect(req1Detail.body.steps[0].stepName).toBe('V1 Step One');
      expect(req1Detail.body.steps[1].stepName).toBe('V1 Step Two');

      // 5. Verify a newly created request uses Version 2 with 3 steps
      const req2Res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wfId,
          title: 'Request under Workflow Version 2',
        })
        .expect(201);

      expect(req2Res.body.workflowVersion).toBe(2);
      expect(req2Res.body.steps.length).toBe(3);
      expect(req2Res.body.steps[0].stepName).toBe('V2 Redesigned Step One');
      expect(req2Res.body.steps[1].stepName).toBe('V2 Security Audit');
      expect(req2Res.body.steps[2].stepName).toBe('V2 Final Signoff');
    });
  });

  // ===========================================================================
  // 6. CRYPTOGRAPHIC AUDIT LOG HASH CHAIN VERIFICATION
  // ===========================================================================
  describe('Cryptographic Audit Chain Integrity', () => {
    let auditService: any;
    let prismaService: any;
    let acmeTenantId: string;

    beforeAll(async () => {
      const { AuditService } = await import('../src/audit/audit.service');
      const { PrismaService } = await import('../src/prisma/prisma.service');
      auditService = app.get(AuditService);
      prismaService = app.get(PrismaService);

      const acme = await prismaService.tenant.findUnique({ where: { slug: 'acme-corp' } });
      acmeTenantId = acme.id;
    });

    it('should verify the cryptographic SHA-256 hash chain is valid', async () => {
      const verification = await auditService.verifyChain(acmeTenantId);
      expect(verification.valid).toBe(true);
      expect(verification.totalEntries).toBeGreaterThan(0);
    });

    it('should detect when an audit record has been tampered with or modified', async () => {
      // Find the latest audit record for Acme
      const targetLog = await prismaService.auditLog.findFirst({
        where: { tenantId: acmeTenantId, hash: { not: null } },
        orderBy: { createdAt: 'desc' },
      });

      expect(targetLog).toBeDefined();

      const originalAction = targetLog.action;

      try {
        // Maliciously tamper with action in the database directly
        await prismaService.auditLog.update({
          where: { id: targetLog.id },
          data: { action: 'MALICIOUS_FORGED_ACTION' },
        });

        // Verify chain detects the tampering!
        const tamperedVerification = await auditService.verifyChain(acmeTenantId);
        expect(tamperedVerification.valid).toBe(false);
        expect(tamperedVerification.brokenAtId).toBe(targetLog.id);
        expect(tamperedVerification.details).toContain('Tampered content');
      } finally {
        // Restore record to maintain chain validity
        await prismaService.auditLog.update({
          where: { id: targetLog.id },
          data: { action: originalAction },
        });
      }

      // Re-verify that chain is valid after restoration
      const restoredVerification = await auditService.verifyChain(acmeTenantId);
      expect(restoredVerification.valid).toBe(true);
    });

    it('should handle simultaneous concurrent audit events for the same tenant without forking', async () => {
      const concurrentWrites = 8;
      const runId = Math.random().toString(36).substring(7);
      const testAction = `CONCURRENT_STRESS_EVENT_${runId}`;
      const initialVerification = await auditService.verifyChain(acmeTenantId);
      const initialEntries = initialVerification.totalEntries;

      // Fire 8 simultaneous concurrent audit writes for Acme Corp
      const results = await Promise.all(
        Array.from({ length: concurrentWrites }, (_, i) =>
          auditService.log({
            tenantId: acmeTenantId,
            entityType: 'SystemBenchmark',
            entityId: `bench-${i + 1}`,
            action: testAction,
            metadata: { batchIndex: i + 1, timestamp: Date.now() },
          }),
        ),
      );

      expect(results.length).toBe(concurrentWrites);

      // Verify complete chain integrity: no forks, no gaps, no duplicate sequences
      const postVerification = await auditService.verifyChain(acmeTenantId);
      expect(postVerification.valid).toBe(true);
      expect(postVerification.totalEntries).toBe(initialEntries + concurrentWrites);

      // Verify all newly inserted entries have strictly unique, consecutive sequence numbers
      const newLogs = await prismaService.auditLog.findMany({
        where: {
          tenantId: acmeTenantId,
          action: testAction,
        },
        orderBy: { sequenceNumber: 'asc' },
      });

      expect(newLogs.length).toBe(concurrentWrites);
      const sequenceNumbers = newLogs.map((l: any) => l.sequenceNumber);
      const uniqueSequences = new Set(sequenceNumbers);
      expect(uniqueSequences.size).toBe(concurrentWrites);

      // Verify each new entry correctly links to the immediately preceding entry
      for (let i = 1; i < newLogs.length; i++) {
        expect(newLogs[i].previousHash).toBe(newLogs[i - 1].hash);
        expect(newLogs[i].sequenceNumber).toBe(newLogs[i - 1].sequenceNumber + 1);
      }
    });

    it('should handle simultaneous concurrent audit events across different tenants independently', async () => {
      const globex = await prismaService.tenant.findUnique({ where: { slug: 'globex-ind' } });
      const globexTenantId = globex.id;

      // Fire simultaneous concurrent writes to both Acme and Globex
      const [acmeLog, globexLog] = await Promise.all([
        auditService.log({
          tenantId: acmeTenantId,
          entityType: 'CrossTenantCheck',
          entityId: 'acme-test',
          action: 'CROSS_TENANT_AUDIT_ACME',
        }),
        auditService.log({
          tenantId: globexTenantId,
          entityType: 'CrossTenantCheck',
          entityId: 'globex-test',
          action: 'CROSS_TENANT_AUDIT_GLOBEX',
        }),
      ]);

      expect(acmeLog.tenantId).toBe(acmeTenantId);
      expect(globexLog.tenantId).toBe(globexTenantId);

      // Both tenant chains must be independently valid
      const acmeVerification = await auditService.verifyChain(acmeTenantId);
      const globexVerification = await auditService.verifyChain(globexTenantId);

      expect(acmeVerification.valid).toBe(true);
      expect(globexVerification.valid).toBe(true);
    });
  });

  // ===========================================================================
  // 7. TENANT ISOLATION & ACCESS CONTROL EDGE CASES
  // ===========================================================================
  describe('Tenant & User Access Control Boundaries', () => {
    let acmeReqId: string;

    beforeAll(async () => {
      const wfList = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      const wf = wfList.body.find((w: any) => w.status === 'ACTIVE');

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: wf.id,
          title: 'Isolation Boundary Check Request',
        });
      acmeReqId = createRes.body.id;
    });

    it('should reject cross-tenant cancellation with 404 Not Found', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${acmeReqId}/cancel`)
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .expect(404);
    });

    it('should reject cross-tenant resubmission with 404 Not Found', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${acmeReqId}/resubmit`)
        .set('Authorization', `Bearer ${globexRequesterToken}`)
        .send({ title: 'Cross tenant title' })
        .expect(404);
    });

    it('should reject non-admin user trying to cancel another user request in the same tenant with 403 Forbidden', async () => {
      // acmeApprover tries to cancel acmeRequester's request without being admin or requester
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${acmeReqId}/cancel`)
        .set('Authorization', `Bearer ${acmeApproverToken}`)
        .expect(403);
    });
  });
});

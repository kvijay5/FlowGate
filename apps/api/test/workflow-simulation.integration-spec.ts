import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { WorkflowNode, WorkflowEdge, InputSchema } from '@flowgate/shared-types';

describe('Workflow Simulator API & Pure Dry-Run Verification (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let acmeAdminToken: string;
  let globexAdminToken: string;

  let acmeTenantId: string;
  let testWorkflowId: string;

  const sampleSchema: InputSchema = {
    fields: [
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true, minimum: 1 },
      { name: 'department', label: 'Department', type: 'STRING', required: true },
    ],
  };

  const sampleNodes: WorkflowNode[] = [
    {
      id: 'node_trigger',
      type: 'TRIGGER',
      name: 'Simulation Start',
      config: { inputSchema: sampleSchema },
    },
    {
      id: 'node_cond',
      type: 'CONDITION',
      name: 'Amount > 10000',
      config: {
        rules: [
          {
            id: 'r_high',
            targetNodeId: 'node_exec_approval',
            branchKey: 'high_value',
            expression: {
              field: 'amount',
              operator: 'GT',
              value: 10000,
            },
          },
        ],
        defaultTargetNodeId: 'node_std_approval',
      },
    },
    {
      id: 'node_exec_approval',
      type: 'APPROVAL_STEP',
      name: 'Executive Sign-Off',
      config: { role: 'TENANT_ADMIN' },
    },
    {
      id: 'node_std_approval',
      type: 'APPROVAL_STEP',
      name: 'Standard Manager Review',
      config: { role: 'MANAGER' },
    },
    {
      id: 'node_join',
      type: 'JOIN',
      name: 'Convergence Join',
      config: { joinPolicy: 'ANY_INCOMING' },
    },
    {
      id: 'node_end',
      type: 'END',
      name: 'Final Approval',
      config: { outcome: 'APPROVED' },
    },
  ];

  const sampleEdges: WorkflowEdge[] = [
    { id: 'e1', sourceNodeId: 'node_trigger', targetNodeId: 'node_cond' },
    {
      id: 'e2',
      sourceNodeId: 'node_cond',
      targetNodeId: 'node_exec_approval',
      sourceHandle: 'high_value',
    },
    {
      id: 'e3',
      sourceNodeId: 'node_cond',
      targetNodeId: 'node_std_approval',
      sourceHandle: 'default',
    },
    { id: 'e4', sourceNodeId: 'node_exec_approval', targetNodeId: 'node_join' },
    { id: 'e5', sourceNodeId: 'node_std_approval', targetNodeId: 'node_join' },
    { id: 'e6', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
  ];

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
    const publisher = app.get(OutboxPublisherService);
    publisher.stop();

    // Login Acme Admin
    const acmeLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeLogin.body.accessToken;
    acmeTenantId = acmeLogin.body.user.tenantId;

    // Login Globex Admin (Tenant Isolation Check)
    const globexLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'admin@globex.com',
      password: 'FlowGatePass123!',
    });
    globexAdminToken = globexLogin.body.accessToken;

    // Create Acme Test Workflow
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${acmeAdminToken}`)
      .send({
        name: 'Simulation Test DAG Workflow',
        description: 'Testing pure dry-run simulation endpoint',
        nodes: sampleNodes,
        edges: sampleEdges,
        inputSchema: sampleSchema,
      });

    expect(createRes.status).toBe(201);
    testWorkflowId = createRes.body.id;
  });

  afterAll(async () => {
    if (testWorkflowId) {
      await prisma.workflowDefinition.deleteMany({
        where: { id: testWorkflowId },
      });
    }
    await app.close();
  });

  it('POST /api/v1/workflows/:id/simulate returns simulation trace and performs ZERO database writes', async () => {
    const initialAuditCount = await prisma.auditLog.count({
      where: { tenantId: acmeTenantId },
    });
    const initialOutboxCount = await prisma.outboxEvent.count({
      where: { tenantId: acmeTenantId },
    });
    const initialRequestCount = await prisma.approvalRequest.count({
      where: { tenantId: acmeTenantId },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${testWorkflowId}/simulate`)
      .set('Authorization', `Bearer ${acmeAdminToken}`)
      .send({
        requestData: {
          amount: 25000,
          department: 'ENGINEERING',
        },
      });

    expect(response.status).toBe(200);
    const body = response.body;

    expect(body.success).toBe(true);
    expect(body.workflowId).toBe(testWorkflowId);
    expect(body.finalOutcome).toBe('APPROVED');
    expect(body.activatedNodeIds).toContain('node_exec_approval');
    expect(body.prunedNodeIds).toContain('node_std_approval');
    expect(body.activatedNodeIds).toContain('node_join');
    expect(body.activatedNodeIds).toContain('node_end');

    // Strict invariant: ZERO new rows written to AuditLog, OutboxEvent, or ApprovalRequest
    const finalAuditCount = await prisma.auditLog.count({
      where: { tenantId: acmeTenantId },
    });
    const finalOutboxCount = await prisma.outboxEvent.count({
      where: { tenantId: acmeTenantId },
    });
    const finalRequestCount = await prisma.approvalRequest.count({
      where: { tenantId: acmeTenantId },
    });

    expect(finalAuditCount).toBe(initialAuditCount);
    expect(finalOutboxCount).toBe(initialOutboxCount);
    expect(finalRequestCount).toBe(initialRequestCount);
  });

  it('correctly simulates fallback standard branch when amount <= 10000', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${testWorkflowId}/simulate`)
      .set('Authorization', `Bearer ${acmeAdminToken}`)
      .send({
        requestData: {
          amount: 5000,
          department: 'MARKETING',
        },
      });

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body.success).toBe(true);
    expect(body.activatedNodeIds).toContain('node_std_approval');
    expect(body.prunedNodeIds).toContain('node_exec_approval');
  });

  it('enforces multi-tenant isolation (Globex admin cannot simulate Acme workflow)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${testWorkflowId}/simulate`)
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .send({
        requestData: {
          amount: 50000,
          department: 'SECURITY',
        },
      });

    expect(response.status).toBe(404);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/outbox/outbox.service';

describe('Milestone 5.1: Transactional Outbox, Replay Deduplication & SSRF Protection (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outboxService: OutboxService;

  let superAdminToken: string;
  let acmeAdminToken: string;
  let acmeRequesterToken: string;
  let acmeTenantId: string;
  let globexAdminToken: string;
  let acmeWorkflowId: string;

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
    outboxService = app.get(OutboxService);

    // Authenticate Acme Admin & Requester
    const acmeAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeAdminLogin.body.accessToken;
    acmeTenantId = acmeAdminLogin.body.tenant.id;

    const acmeReqLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'engineer@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeRequesterToken = acmeReqLogin.body.accessToken;

    // Authenticate Globex Admin
    const globexAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'admin@globex.com',
      password: 'FlowGatePass123!',
    });
    globexAdminToken = globexAdminLogin.body.accessToken;

    // Retrieve active Acme workflow
    const workflowsRes = await request(app.getHttpServer())
      .get('/api/v1/workflows')
      .set('Authorization', `Bearer ${acmeAdminToken}`);
    acmeWorkflowId = workflowsRes.body[0].id;

    // Create & authenticate SUPER_ADMIN
    const superAdmin = await prisma.user.upsert({
      where: {
        tenant_user_email_unique: {
          tenantId: acmeTenantId,
          email: 'superadmin.m51@acme.com',
        },
      },
      update: {
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      create: {
        tenantId: acmeTenantId,
        name: 'Super Admin M5.1',
        email: 'superadmin.m51@acme.com',
        passwordHash: 'seeded_hash',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });

    const jwtService = app.get(JwtService);
    superAdminToken = jwtService.sign({
      sub: superAdmin.id,
      email: superAdmin.email,
      tenantId: superAdmin.tenantId,
      role: superAdmin.role,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Transactional Outbox Pattern & Atomicity', () => {
    it('should atomically create outbox events within the same transaction as request creation', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: acmeWorkflowId,
          title: 'Transactional Outbox Verification Cluster',
          description: 'Testing in-transaction outbox recording',
        });

      expect(createRes.status).toBe(201);
      const requestId = createRes.body.id;

      // Verify outbox events are in the database for this entity
      const events = await prisma.outboxEvent.findMany({
        where: {
          tenantId: acmeTenantId,
          entityId: requestId,
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      const eventTypes = events.map((e) => e.eventType);
      expect(eventTypes).toContain('OUTBOX_WEBHOOK');

      for (const evt of events) {
        expect(['PENDING', 'PROCESSING', 'PUBLISHED']).toContain(evt.status);
        expect(evt.tenantId).toBe(acmeTenantId);
        expect(evt.entityType).toBe('ApprovalRequest');
        expect(evt.idempotencyKey).toBeDefined();
        expect(evt.payload).toBeDefined();
      }
    });

    it('should rollback outbox events if the request transaction fails', async () => {
      const countBefore = await prisma.outboxEvent.count({
        where: { tenantId: acmeTenantId },
      });

      // Submit request with a valid-format UUID that does not exist in DB
      const failedRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: 'a0000000-0000-4000-8000-000000000000',
          title: 'Will fail due to nonexistent workflow',
        });

      expect(failedRes.status).toBe(404);

      const countAfter = await prisma.outboxEvent.count({
        where: { tenantId: acmeTenantId },
      });

      // No new outbox events should have been committed
      expect(countAfter).toBe(countBefore);
    });

    it('should support outbox claiming and status transitions', async () => {
      // Create a manual test outbox event directly in PENDING state
      const idempotencyKey = `manual-test-${Date.now()}`;
      await prisma.outboxEvent.create({
        data: {
          tenantId: acmeTenantId,
          eventType: 'OUTBOX_WEBHOOK',
          entityType: 'TestEntity',
          entityId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey,
          payload: { test: true },
          status: 'PENDING',
          scheduledFor: new Date(),
        },
      });

      // Claim pending events using row-level locking
      const claimed = await outboxService.claimPendingEvents(10);
      const ourEvent = claimed.find((e) => e.idempotencyKey === idempotencyKey);
      expect(ourEvent).toBeDefined();
      expect(ourEvent?.status).toBe('PROCESSING');

      // Mark published
      await outboxService.markPublished(ourEvent!.id);
      const published = await prisma.outboxEvent.findUnique({
        where: { id: ourEvent!.id },
      });
      expect(published?.status).toBe('PUBLISHED');
      expect(published?.publishedAt).toBeDefined();
    });
  });

  describe('2. Webhook Inbound Deduplication & Replay Protection', () => {
    it('should accept first arrival of an inbound webhook event', async () => {
      const eventId = `evt-dedup-${Date.now()}-1`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          eventId,
          eventType: 'request.created',
          payload: { action: 'initial' },
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.duplicate).toBe(false);
      expect(res.body.eventId).toBe(eventId);
    });

    it('should flag subsequent arrivals of the same eventId as duplicate', async () => {
      const eventId = `evt-dedup-${Date.now()}-2`;

      // 1st delivery
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          eventId,
          eventType: 'request.created',
          payload: { action: 'initial' },
        });

      expect(res1.status).toBe(200);
      expect(res1.body.duplicate).toBe(false);

      // 2nd delivery with same eventId
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          eventId,
          eventType: 'request.created',
          payload: { action: 'replayed' },
        });

      expect(res2.status).toBe(200);
      expect(res2.body.received).toBe(true);
      expect(res2.body.duplicate).toBe(true);
      expect(res2.body.eventId).toBe(eventId);
    });

    it('should isolate duplicate detection per tenant (different tenant can receive same eventId without collision)', async () => {
      const eventId = `evt-shared-${Date.now()}`;

      // Acme records event
      const resAcme = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          eventId,
          eventType: 'request.created',
          payload: { org: 'acme' },
        });

      expect(resAcme.status).toBe(200);
      expect(resAcme.body.duplicate).toBe(false);

      // Globex records event with same eventId
      const resGlobex = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${globexAdminToken}`)
        .send({
          eventId,
          eventType: 'request.created',
          payload: { org: 'globex' },
        });

      expect(resGlobex.status).toBe(200);
      expect(resGlobex.body.duplicate).toBe(false);
    });

    it('should reject inbound webhook requests missing eventId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks/inbound')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          eventType: 'request.created',
          payload: {},
        });

      expect(res.status).toBe(400);
    });
  });

  describe('3. Webhook SSRF Guard Protection', () => {
    it('should reject unencrypted HTTP destinations when HTTPS is required', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Insecure HTTP Webhook',
          url: 'http://example.com/webhook',
          eventTypes: ['request.created'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Insecure HTTP scheme is not allowed/i);
    });

    it('should reject webhook registration pointing to cloud metadata IP 169.254.169.254', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'AWS Metadata Probe',
          url: 'https://169.254.169.254/latest/meta-data/',
          eventTypes: ['request.created'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/SSRF|forbidden|private|metadata/i);
    });

    it('should reject webhook registration pointing to GCP metadata host', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'GCP Metadata Probe',
          url: 'http://metadata.google.internal/computeMetadata/v1/',
          eventTypes: ['request.created'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/SSRF|forbidden|metadata/i);
    });

    it('should reject webhook registration pointing to private IP addresses (RFC 1918)', async () => {
      const targets = [
        'https://10.0.0.1/webhook',
        'https://172.16.0.1/webhook',
        'https://192.168.1.1/webhook',
      ];

      for (const target of targets) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/webhooks')
          .set('Authorization', `Bearer ${acmeAdminToken}`)
          .send({
            name: 'Private Network Probe',
            url: target,
            eventTypes: ['request.created'],
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/SSRF|forbidden|private/i);
      }
    });

    it('should reject test ping to an SSRF destination without initiating network traffic', async () => {
      // Create a subscription with an SSRF URL directly in DB to test ping validation
      const ssrfSub = await prisma.webhookSubscription.create({
        data: {
          tenantId: acmeTenantId,
          name: 'Direct Injected SSRF Target',
          url: 'https://169.254.169.254/latest/meta-data',
          secret: 'whsec_testsecret12345678901234567890',
          eventTypes: ['request.created'],
          status: 'ACTIVE',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/webhooks/${ssrfSub.id}/test`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/SSRF|forbidden|private|metadata/i);
    });
  });

  describe('4. Queue Health Authorization & Tenant Isolation', () => {
    it('should reject unauthenticated requests to global queue status with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/queues/status');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin requester requests to global status with 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${acmeRequesterToken}`);
      expect(res.status).toBe(403);
    });

    it('should reject TENANT_ADMIN requests to global status with 403 (restricted strictly to SUPER_ADMIN)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${acmeAdminToken}`);
      expect(res.status).toBe(403);
    });

    it('should permit SUPER_ADMIN requests to global queue status with 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.redisConnected).toBe(true);
      expect(res.body.queues).toBeDefined();
      expect(res.body.queues.notifications).toBeDefined();
      expect(res.body.queues.escalations).toBeDefined();
      expect(res.body.queues.webhooks).toBeDefined();
    });

    it('should permit TENANT_ADMIN requests to tenant-status with 200 and isolate metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/tenant-status')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.redisConnected).toBe(true);
      expect(res.body.tenantId).toBe(acmeTenantId);
      expect(res.body.outbox).toBeDefined();
      expect(typeof res.body.outbox.published).toBe('number');
      expect(res.body.notifications).toBeDefined();
      expect(res.body.webhooks).toBeDefined();

      // Verify that global queue internals are NOT exposed to TENANT_ADMIN
      expect((res.body as any).queues).toBeUndefined();
    });

    it('should reject non-admin requester requests to tenant-status with 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/tenant-status')
        .set('Authorization', `Bearer ${acmeRequesterToken}`);
      expect(res.status).toBe(403);
    });
  });
});

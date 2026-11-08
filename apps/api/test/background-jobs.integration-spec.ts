import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as http from 'http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifyWebhookSignature } from '../src/webhooks/webhook-signature.util';

describe('Background Processing & Escalation Engine (Integration)', () => {
  jest.setTimeout(20000);

  let app: INestApplication;

  let superAdminToken: string;
  let acmeAdminToken: string;
  let acmeRequesterToken: string;
  let globexAdminToken: string;

  // Local HTTP server to simulate third-party webhook destination
  let webhookServer: http.Server;
  let webhookServerPort: number;
  let receivedWebhooks: Array<{
    headers: http.IncomingHttpHeaders;
    body: string;
    parsed: any;
  }> = [];

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_HTTP_WEBHOOKS = 'true';
    process.env.ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS = 'true';

    // 1. Start local webhook receiver server
    await new Promise<void>((resolve) => {
      webhookServer = http.createServer((req, res) => {
        let data = '';
        req.on('data', (chunk) => {
          data += chunk;
        });
        req.on('end', () => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(data);
          } catch {}
          receivedWebhooks.push({
            headers: req.headers,
            body: data,
            parsed,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        });
      });

      webhookServer.listen(0, '127.0.0.1', () => {
        const addr = webhookServer.address() as any;
        webhookServerPort = addr.port;
        resolve();
      });
    });

    // 2. Start Nest application
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

    // 3. Authenticate
    const acmeAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeAdminToken = acmeAdminLogin.body.accessToken;
    const acmeTenantId = acmeAdminLogin.body.tenant.id;

    const acmeReqLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'acme-corp',
      email: 'engineer@acme.com',
      password: 'FlowGatePass123!',
    });
    acmeRequesterToken = acmeReqLogin.body.accessToken;

    const globexAdminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      tenantSlug: 'globex-ind',
      email: 'admin@globex.com',
      password: 'FlowGatePass123!',
    });
    globexAdminToken = globexAdminLogin.body.accessToken;

    // Generate SUPER_ADMIN token with real DB user
    const prisma = app.get(PrismaService);
    const superAdmin = await prisma.user.upsert({
      where: {
        tenant_user_email_unique: {
          tenantId: acmeTenantId,
          email: 'superadmin@acme.com',
        },
      },
      update: {
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      create: {
        tenantId: acmeTenantId,
        name: 'Super Administrator',
        email: 'superadmin@acme.com',
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
    if (webhookServer) {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
    if (app) {
      await app.close();
    }
  });

  describe('1. Queue Health Authorization & Tenant Isolation', () => {
    it('should return 401 when accessed without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/queues/status');
      expect(res.status).toBe(401);
    });

    it('should return 403 when global status is accessed by non-admin requester', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${acmeRequesterToken}`);

      expect(res.status).toBe(403);
    });

    it('should return 403 when global status is accessed by TENANT_ADMIN (restricted strictly to SUPER_ADMIN)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(403);
    });

    it('should return global queue metrics when accessed by SUPER_ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/status')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.redisConnected).toBe(true);
      expect(res.body.queues).toBeDefined();
      expect(res.body.queues.notifications).toBeDefined();
      expect(res.body.queues.escalations).toBeDefined();
      expect(res.body.queues.webhooks).toBeDefined();
      expect(typeof res.body.queues.notifications.waiting).toBe('number');
    });

    it('should return tenant-scoped metrics to TENANT_ADMIN without global queue totals', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/tenant-status')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.redisConnected).toBe(true);
      expect(res.body.tenantId).toBeDefined();
      expect(res.body.outbox).toBeDefined();
      expect(typeof res.body.outbox.published).toBe('number');
      expect(res.body.notifications).toBeDefined();
      expect(res.body.webhooks).toBeDefined();
      expect(res.body.queues).toBeUndefined(); // Guarantees global queue counts are omitted
    });

    it('should return 403 when tenant-status is accessed by ordinary REQUESTER', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/queues/tenant-status')
        .set('Authorization', `Bearer ${acmeRequesterToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. Webhook Subscriptions Management & Tenant Isolation', () => {
    let createdSubId: string;
    let createdSubSecret: string;

    it('should create a webhook subscription and return raw secret only once', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Test Local Webhook',
          url: `http://127.0.0.1:${webhookServerPort}/webhook`,
          eventTypes: ['request.created', 'request.approved'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Test Local Webhook');
      expect(res.body.secret).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(res.body.status).toBe('ACTIVE');

      createdSubId = res.body.id;
      createdSubSecret = res.body.secret;
    });

    it('should list subscriptions without exposing secrets', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/webhooks')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const sub = res.body.find((s: any) => s.id === createdSubId);
      expect(sub).toBeDefined();
      expect(sub.secret).toBeUndefined();
    });

    it('should enforce tenant isolation (Globex cannot see or modify Acme webhook)', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/webhooks/${createdSubId}`)
        .set('Authorization', `Bearer ${globexAdminToken}`);

      expect(getRes.status).toBe(404);

      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/webhooks/${createdSubId}`)
        .set('Authorization', `Bearer ${globexAdminToken}`);

      expect(delRes.status).toBe(404);
    });

    it('should dispatch test ping event to webhook endpoint', async () => {
      const pingRes = await request(app.getHttpServer())
        .post(`/api/v1/webhooks/${createdSubId}/test`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(pingRes.status).toBe(200);
      expect(pingRes.body.event).toBe('webhook.test_ping');

      // Wait for BullMQ worker to process the delivery
      let received: any = null;
      const startPing = Date.now();
      while (Date.now() - startPing < 5000) {
        received = receivedWebhooks.find((w) => w.parsed?.event === 'webhook.test_ping');
        if (received) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(received).toBeDefined();

      const sigHeader = (received!.headers['x-flowgate-signature'] as string) || '';
      expect(sigHeader).toBeDefined();

      const verification = verifyWebhookSignature(received!.body, sigHeader, createdSubSecret);
      expect(verification.valid).toBe(true);
    });
  });

  describe('3. End-to-End Request Creation -> Webhook & Notification Dispatch', () => {
    it('should trigger signed outbound webhook and notification on request creation', async () => {
      // Find an active workflow in Acme
      const wfRes = await request(app.getHttpServer())
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      const activeWf = wfRes.body.find((w: any) => w.status === 'ACTIVE');
      expect(activeWf).toBeDefined();

      // Clear received webhooks buffer
      receivedWebhooks = [];

      // Create approval request as engineer
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${acmeRequesterToken}`)
        .send({
          workflowDefinitionId: activeWf.id,
          title: 'Automated CI Hardware Purchase',
          description: 'Background processing test request',
        });

      expect(createRes.status).toBe(201);
      const requestId = createRes.body.id;

      // Wait for BullMQ workers to process the notification and webhook jobs (poll with timeout)
      let reqNotif: any = null;
      let delivery: any = null;
      const startWait = Date.now();

      while (Date.now() - startWait < 8000) {
        if (!reqNotif) {
          const notifsRes = await request(app.getHttpServer())
            .get('/api/v1/notifications')
            .set('Authorization', `Bearer ${acmeAdminToken}`);
          reqNotif = notifsRes.body.data?.find(
            (n: any) =>
              n.metadata?.requestId === requestId &&
              n.eventType === 'REQUEST_SUBMITTED' &&
              n.status === 'SENT',
          );
        }

        if (!delivery) {
          const deliveriesRes = await request(app.getHttpServer())
            .get('/api/v1/webhooks/deliveries')
            .set('Authorization', `Bearer ${acmeAdminToken}`);
          if (deliveriesRes.status !== 200) {
            console.error('Deliveries endpoint error:', deliveriesRes.status, deliveriesRes.body);
          }
          delivery = deliveriesRes.body.data?.find(
            (d: any) =>
              d.payload?.requestId === requestId &&
              d.eventType === 'request.created' &&
              d.status === 'SENT',
          );
        }

        if (reqNotif && delivery && receivedWebhooks.length > 0) {
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      // 1. Verify notification was logged and delivered via mock email provider
      expect(reqNotif).toBeDefined();
      expect(reqNotif.channel).toBe('EMAIL');
      expect(reqNotif.status).toBe('SENT');
      expect(reqNotif.sentAt).toBeDefined();

      // 2. Verify webhook delivery reached local test server
      const createdWebhook = receivedWebhooks.find(
        (w) => w.parsed?.event === 'request.created' && w.parsed?.requestId === requestId,
      );
      expect(createdWebhook).toBeDefined();
      expect(createdWebhook!.headers['x-flowgate-signature']).toBeDefined();
      expect(createdWebhook!.headers['x-flowgate-timestamp']).toBeDefined();
      expect(createdWebhook!.headers['x-flowgate-event-id']).toBeDefined();

      // 3. Verify webhook delivery record in database
      expect(delivery).toBeDefined();
      expect(delivery.status).toBe('SENT');
      expect(delivery.httpStatusCode).toBe(200);
      expect(typeof delivery.durationMs).toBe('number');
    });
  });

  describe('4. Notification Statistics', () => {
    it('should return aggregated notification delivery stats', async () => {
      const statsRes = await request(app.getHttpServer())
        .get('/api/v1/notifications/stats')
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.sent).toBeGreaterThanOrEqual(1);
      expect(typeof statsRes.body.pending).toBe('number');
      expect(typeof statsRes.body.failed).toBe('number');
      expect(statsRes.body.total).toBeGreaterThanOrEqual(1);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Authentication & RBAC Lifecycle (Integration)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;

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
    jwtService = app.get(JwtService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /api/v1/auth/login', () => {
    it('should successfully authenticate an Acme admin and return JWT access token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'acme-corp',
          email: 'admin@acme.com',
          password: 'FlowGatePass123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.user).toMatchObject({
        email: 'admin@acme.com',
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
      });
      expect(response.body.tenant).toMatchObject({
        slug: 'acme-corp',
        name: 'Acme Corporation',
      });
      expect(response.body.user).not.toHaveProperty('passwordHash');
    });

    it('should successfully authenticate a Globex requester', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'globex-ind',
          email: 'employee@globex.com',
          password: 'FlowGatePass123!',
        })
        .expect(200);

      expect(response.body.user).toMatchObject({
        email: 'employee@globex.com',
        role: 'REQUESTER',
      });
      expect(response.body.tenant.slug).toBe('globex-ind');
    });

    it('should reject invalid password with generic error message', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'acme-corp',
          email: 'admin@acme.com',
          password: 'WrongPassword999!',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject nonexistent tenant slug with generic error message', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'fake-tenant-slug',
          email: 'admin@acme.com',
          password: 'FlowGatePass123!',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject malformed payload with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'acme-corp',
          // missing email and password
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let acmeAdminToken: string;
    let globexUserToken: string;

    beforeAll(async () => {
      const acmeLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        tenantSlug: 'acme-corp',
        email: 'admin@acme.com',
        password: 'FlowGatePass123!',
      });
      acmeAdminToken = acmeLogin.body.accessToken;

      const globexLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        tenantSlug: 'globex-ind',
        email: 'employee@globex.com',
        password: 'FlowGatePass123!',
      });
      globexUserToken = globexLogin.body.accessToken;
    });

    it('should return trusted user identity and tenant context for Acme Admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(response.body.user.email).toBe('admin@acme.com');
      expect(response.body.user.role).toBe('TENANT_ADMIN');
      expect(response.body.tenant.slug).toBe('acme-corp');
    });

    it('should return trusted user identity and tenant context for Globex User', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${globexUserToken}`)
        .expect(200);

      expect(response.body.user.email).toBe('employee@globex.com');
      expect(response.body.user.role).toBe('REQUESTER');
      expect(response.body.tenant.slug).toBe('globex-ind');
    });

    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('should reject tampered or corrupted token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.token')
        .expect(401);
    });
  });

  describe('Role-Based Access Control (RBAC) - GET /api/v1/auth/admin-only', () => {
    let acmeAdminToken: string;
    let globexRequesterToken: string;

    beforeAll(async () => {
      const acmeLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        tenantSlug: 'acme-corp',
        email: 'admin@acme.com',
        password: 'FlowGatePass123!',
      });
      acmeAdminToken = acmeLogin.body.accessToken;

      const globexLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        tenantSlug: 'globex-ind',
        email: 'employee@globex.com',
        password: 'FlowGatePass123!',
      });
      globexRequesterToken = globexLogin.body.accessToken;
    });

    it('should allow access to admin-only endpoint for TENANT_ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .expect(200);

      expect(response.body.message).toContain('Access granted');
      expect(response.body.user.role).toBe('TENANT_ADMIN');
    });

    it('should reject access with 403 Forbidden for REQUESTER role', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${globexRequesterToken}`)
        .expect(403);

      expect(response.body.message).toContain('Access denied');
    });
  });

  describe('Security Regression Checks', () => {
    let acmeTenant: any;
    let acmeAdmin: any;

    beforeAll(async () => {
      acmeTenant = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      acmeAdmin = await prisma.user.findFirst({
        where: { tenantId: acmeTenant.id, email: 'admin@acme.com' },
      });
    });

    it('should reject expired JWT access tokens with 401 Unauthorized', async () => {
      const expiredToken = await jwtService.signAsync(
        {
          sub: acmeAdmin.id,
          tenantId: acmeTenant.id,
          email: acmeAdmin.email,
          role: acmeAdmin.role,
        },
        { expiresIn: '-5s' },
      );

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should reject JWT with invalid signature with 401 Unauthorized', async () => {
      const forgedToken = await jwtService.signAsync(
        {
          sub: acmeAdmin.id,
          tenantId: acmeTenant.id,
          email: acmeAdmin.email,
          role: acmeAdmin.role,
        },
        { secret: 'completely_different_forged_secret_key_12345' },
      );

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`)
        .expect(401);
    });

    it('should reject login and route access for suspended users', async () => {
      const email = `suspended-${Date.now()}@acme.com`;
      const suspendedUser = await prisma.user.create({
        data: {
          tenantId: acmeTenant.id,
          name: 'Suspended Worker',
          email,
          passwordHash: acmeAdmin.passwordHash,
          role: 'REQUESTER',
          status: 'SUSPENDED',
        },
      });

      try {
        // 1. Login attempt fails with 401 generic error
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            tenantSlug: 'acme-corp',
            email,
            password: 'FlowGatePass123!',
          })
          .expect(401);

        // 2. Access with token forged or previously issued for suspended user fails with 401
        const suspendedToken = await jwtService.signAsync({
          sub: suspendedUser.id,
          tenantId: acmeTenant.id,
          email: suspendedUser.email,
          role: suspendedUser.role,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${suspendedToken}`)
          .expect(401);

        expect(res.body.message).toContain('suspended');
      } finally {
        await prisma.user.deleteMany({ where: { id: suspendedUser.id } });
      }
    });

    it('should reject login and route access for suspended tenants', async () => {
      const uniqueSuffix = Date.now().toString();
      const slug = `suspended-org-${uniqueSuffix}`;
      const email = `member-${uniqueSuffix}@suspended.com`;

      const suspendedTenant = await prisma.tenant.create({
        data: {
          name: 'Suspended Org',
          slug,
          status: 'SUSPENDED',
        },
      });

      const userInSuspended = await prisma.user.create({
        data: {
          tenantId: suspendedTenant.id,
          name: 'Org Member',
          email,
          passwordHash: acmeAdmin.passwordHash,
          role: 'REQUESTER',
          status: 'ACTIVE',
        },
      });

      try {
        // 1. Login attempt fails with 401
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            tenantSlug: slug,
            email,
            password: 'FlowGatePass123!',
          })
          .expect(401);

        // 2. Route access with token fails with 401
        const suspendedTenantToken = await jwtService.signAsync({
          sub: userInSuspended.id,
          tenantId: suspendedTenant.id,
          email: userInSuspended.email,
          role: userInSuspended.role,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${suspendedTenantToken}`)
          .expect(401);

        expect(res.body.message).toContain('suspended');
      } finally {
        await prisma.user.deleteMany({ where: { id: userInSuspended.id } });
        await prisma.tenant.deleteMany({ where: { id: suspendedTenant.id } });
      }
    });
  });
});

import { PrismaClient, UserRole, UserStatus, WorkflowStatus } from '@prisma/client';

describe('Multi-Tenant Data Isolation & Database Constraints (Integration)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Tenant Data Scoping Isolation', () => {
    it('should strictly isolate users by tenantId', async () => {
      const acme = await prisma.tenant.findUnique({
        where: { slug: 'acme-corp' },
      });
      const globex = await prisma.tenant.findUnique({
        where: { slug: 'globex-ind' },
      });

      expect(acme).toBeDefined();
      expect(globex).toBeDefined();

      // Query Acme users using tenant scoping
      const acmeUsers = await prisma.user.findMany({
        where: { tenantId: acme!.id },
      });

      // Query Globex users using tenant scoping
      const globexUsers = await prisma.user.findMany({
        where: { tenantId: globex!.id },
      });

      expect(acmeUsers.length).toBeGreaterThan(0);
      expect(globexUsers.length).toBeGreaterThan(0);

      // Verify zero overlap: No Acme user has globex tenantId
      for (const u of acmeUsers) {
        expect(u.tenantId).toBe(acme!.id);
        expect(u.tenantId).not.toBe(globex!.id);
      }

      // Verify zero overlap: No Globex user has acme tenantId
      for (const u of globexUsers) {
        expect(u.tenantId).toBe(globex!.id);
        expect(u.tenantId).not.toBe(acme!.id);
      }
    });

    it('should strictly isolate approval requests by tenantId', async () => {
      const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

      const acmeRequests = await prisma.approvalRequest.findMany({
        where: { tenantId: acme!.id },
      });
      const globexRequests = await prisma.approvalRequest.findMany({
        where: { tenantId: globex!.id },
      });

      expect(acmeRequests.length).toBeGreaterThan(0);
      expect(globexRequests.length).toBeGreaterThan(0);

      for (const r of acmeRequests) {
        expect(r.tenantId).toBe(acme!.id);
      }

      for (const r of globexRequests) {
        expect(r.tenantId).toBe(globex!.id);
      }
    });
  });

  describe('Composite Foreign Key Database-Level Tenant Enforcement', () => {
    it('should prevent a Tenant A request from referencing a Tenant B workflow', async () => {
      const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

      const acmeUser = await prisma.user.findFirst({ where: { tenantId: acme!.id } });
      const globexWorkflow = await prisma.workflowDefinition.findFirst({
        where: { tenantId: globex!.id },
      });

      expect(acmeUser).toBeDefined();
      expect(globexWorkflow).toBeDefined();

      // Attempting to create an Acme approval request with Globex workflow must fail at PostgreSQL level
      await expect(
        prisma.approvalRequest.create({
          data: {
            tenantId: acme!.id,
            requestedById: acmeUser!.id,
            workflowDefinitionId: globexWorkflow!.id, // Cross-tenant violation!
            title: 'Malicious Cross-Tenant Workflow Reference',
          },
        }),
      ).rejects.toThrow();
    });

    it('should prevent a Tenant A request from referencing a Tenant B requester', async () => {
      const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

      const acmeWorkflow = await prisma.workflowDefinition.findFirst({
        where: { tenantId: acme!.id },
      });
      const globexUser = await prisma.user.findFirst({ where: { tenantId: globex!.id } });

      expect(acmeWorkflow).toBeDefined();
      expect(globexUser).toBeDefined();

      // Attempting to create an Acme request with a Globex requester must fail at PostgreSQL level
      await expect(
        prisma.approvalRequest.create({
          data: {
            tenantId: acme!.id,
            workflowDefinitionId: acmeWorkflow!.id,
            requestedById: globexUser!.id, // Cross-tenant violation!
            title: 'Malicious Cross-Tenant Requester Reference',
          },
        }),
      ).rejects.toThrow();
    });

    it('should prevent a Tenant A approval step from being assigned to a Tenant B user', async () => {
      const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

      const acmeRequest = await prisma.approvalRequest.findFirst({
        where: { tenantId: acme!.id },
      });
      const globexUser = await prisma.user.findFirst({ where: { tenantId: globex!.id } });

      expect(acmeRequest).toBeDefined();
      expect(globexUser).toBeDefined();

      // Attempting to assign an Acme approval step to a Globex user must fail at PostgreSQL level
      await expect(
        prisma.approvalStep.create({
          data: {
            tenantId: acme!.id,
            approvalRequestId: acmeRequest!.id,
            assignedToId: globexUser!.id, // Cross-tenant violation!
            stepOrder: 99,
            status: 'PENDING',
          },
        }),
      ).rejects.toThrow();
    });

    it('should prevent a Tenant A audit log from referencing a Tenant B actor', async () => {
      const acme = await prisma.tenant.findUnique({ where: { slug: 'acme-corp' } });
      const globex = await prisma.tenant.findUnique({ where: { slug: 'globex-ind' } });

      const globexUser = await prisma.user.findFirst({ where: { tenantId: globex!.id } });
      expect(globexUser).toBeDefined();

      // Attempting to create an Acme audit log with Globex actor must fail at PostgreSQL level
      await expect(
        prisma.auditLog.create({
          data: {
            tenantId: acme!.id,
            actorId: globexUser!.id, // Cross-tenant violation!
            entityType: 'TEST',
            entityId: 'dummy-entity-id',
            action: 'TAMPER_ATTEMPT',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Multi-Tenant Email Scoping & Unique Constraints', () => {
    const testEmail = 'cross-tenant-shared@enterprise.com';
    let tempTenantAId: string;
    let tempTenantBId: string;

    beforeAll(async () => {
      const tA = await prisma.tenant.create({
        data: { name: 'Isolation Test A', slug: 'iso-test-a' },
      });
      const tB = await prisma.tenant.create({
        data: { name: 'Isolation Test B', slug: 'iso-test-b' },
      });
      tempTenantAId = tA.id;
      tempTenantBId = tB.id;
    });

    afterAll(async () => {
      await prisma.tenant.deleteMany({
        where: { id: { in: [tempTenantAId, tempTenantBId] } },
      });
    });

    it('should permit identical email addresses in DIFFERENT tenants', async () => {
      const userA = await prisma.user.create({
        data: {
          tenantId: tempTenantAId,
          name: 'User In Tenant A',
          email: testEmail,
          passwordHash: 'dummy-hash-a',
          role: UserRole.REQUESTER,
          status: UserStatus.ACTIVE,
        },
      });

      const userB = await prisma.user.create({
        data: {
          tenantId: tempTenantBId,
          name: 'User In Tenant B',
          email: testEmail,
          passwordHash: 'dummy-hash-b',
          role: UserRole.APPROVER,
          status: UserStatus.ACTIVE,
        },
      });

      expect(userA.id).toBeDefined();
      expect(userB.id).toBeDefined();
      expect(userA.email).toEqual(userB.email);
      expect(userA.tenantId).not.toEqual(userB.tenantId);
    });

    it('should reject duplicate email addresses in the SAME tenant', async () => {
      await expect(
        prisma.user.create({
          data: {
            tenantId: tempTenantAId,
            name: 'Duplicate User in Tenant A',
            email: testEmail,
            passwordHash: 'dummy-hash-duplicate',
            role: UserRole.REQUESTER,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Step Sequence Unique Constraints', () => {
    it('should enforce unique stepOrder within an approval request', async () => {
      const acmeRequest = await prisma.approvalRequest.findFirst({
        where: { title: { contains: 'GPU Server' } },
      });
      expect(acmeRequest).toBeDefined();

      await expect(
        prisma.approvalStep.create({
          data: {
            tenantId: acmeRequest!.tenantId,
            approvalRequestId: acmeRequest!.id,
            stepOrder: 1, // Step 1 already exists
            status: 'PENDING',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Tenant Boundary Cascade Deletion', () => {
    it('should delete tenant child records without affecting other tenants', async () => {
      const disposableTenant = await prisma.tenant.create({
        data: { name: 'Disposable Corp', slug: 'disposable-corp' },
      });

      const disposableUser = await prisma.user.create({
        data: {
          tenantId: disposableTenant.id,
          name: 'Disposable User',
          email: 'disposable@disposable.com',
          passwordHash: 'dummy-hash',
        },
      });

      const disposableWorkflow = await prisma.workflowDefinition.create({
        data: {
          tenantId: disposableTenant.id,
          name: 'Disposable Workflow',
          status: WorkflowStatus.ACTIVE,
        },
      });

      const disposableRequest = await prisma.approvalRequest.create({
        data: {
          tenantId: disposableTenant.id,
          workflowDefinitionId: disposableWorkflow.id,
          requestedById: disposableUser.id,
          title: 'Disposable Request',
        },
      });

      await prisma.approvalStep.create({
        data: {
          tenantId: disposableTenant.id,
          approvalRequestId: disposableRequest.id,
          stepOrder: 1,
          status: 'PENDING',
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: disposableTenant.id,
          actorId: disposableUser.id,
          entityType: 'TEST',
          entityId: disposableRequest.id,
          action: 'CREATED',
        },
      });

      const beforeAcmeCount = await prisma.user.count({
        where: { tenant: { slug: 'acme-corp' } },
      });

      await prisma.tenant.delete({
        where: { id: disposableTenant.id },
      });

      const remainingUsers = await prisma.user.count({
        where: { tenantId: disposableTenant.id },
      });
      const remainingWorkflows = await prisma.workflowDefinition.count({
        where: { tenantId: disposableTenant.id },
      });
      const remainingRequests = await prisma.approvalRequest.count({
        where: { tenantId: disposableTenant.id },
      });
      const remainingSteps = await prisma.approvalStep.count({
        where: { tenantId: disposableTenant.id },
      });
      const remainingAudit = await prisma.auditLog.count({
        where: { tenantId: disposableTenant.id },
      });

      expect(remainingUsers).toBe(0);
      expect(remainingWorkflows).toBe(0);
      expect(remainingRequests).toBe(0);
      expect(remainingSteps).toBe(0);
      expect(remainingAudit).toBe(0);

      const afterAcmeCount = await prisma.user.count({
        where: { tenant: { slug: 'acme-corp' } },
      });
      expect(afterAcmeCount).toBe(beforeAcmeCount);
    });
  });
});

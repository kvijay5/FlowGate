import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

describe('DelegationService (Unit)', () => {
  let service: DelegationService;
  let mockPrisma: any;
  let mockAudit: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userA = '22222222-2222-2222-2222-222222222222';
  const userB = '33333333-3333-3333-3333-333333333333';
  const userC = '44444444-4444-4444-4444-444444444444';
  const workflowId = '55555555-5555-5555-5555-555555555555';

  beforeEach(() => {
    mockAudit = {
      log: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    mockPrisma = {
      user: {
        findFirst: jest.fn(),
      },
      workflowDefinition: {
        findFirst: jest.fn(),
      },
      userDelegation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    service = new DelegationService(mockPrisma, mockAudit);
  });

  describe('createDelegation', () => {
    it('creates an ACTIVE delegation when startDate is now or in the past', async () => {
      const start = new Date(Date.now() - 1000);
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === userA)
          return Promise.resolve({ id: userA, role: 'MANAGER', status: 'ACTIVE' });
        if (where.id === userB)
          return Promise.resolve({ id: userB, role: 'APPROVER', status: 'ACTIVE' });
        return Promise.resolve(null);
      });

      mockPrisma.userDelegation.findFirst.mockResolvedValue(null);
      mockPrisma.userDelegation.findMany.mockResolvedValue([]);

      mockPrisma.userDelegation.create.mockImplementation(({ data }: any) => {
        return Promise.resolve({
          id: 'del-1',
          ...data,
          delegator: { id: userA, name: 'User A', email: 'a@example.com', role: 'MANAGER' },
          delegatee: { id: userB, name: 'User B', email: 'b@example.com', role: 'APPROVER' },
        });
      });

      const result = await service.createDelegation(tenantId, userA, {
        delegateeId: userB,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        reason: 'Vacation',
      });

      expect(result.id).toBe('del-1');
      expect(result.status).toBe('ACTIVE');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          actorId: userA,
          action: 'DELEGATION_CREATED',
          metadata: expect.objectContaining({ status: 'ACTIVE' }),
        }),
        undefined,
      );
    });

    it('creates an INACTIVE delegation when startDate is in the future', async () => {
      const start = new Date(Date.now() + 86400000);
      const end = new Date(Date.now() + 172800000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === userA)
          return Promise.resolve({ id: userA, role: 'MANAGER', status: 'ACTIVE' });
        if (where.id === userB)
          return Promise.resolve({ id: userB, role: 'APPROVER', status: 'ACTIVE' });
        return Promise.resolve(null);
      });

      mockPrisma.userDelegation.findFirst.mockResolvedValue(null);
      mockPrisma.userDelegation.findMany.mockResolvedValue([]);

      mockPrisma.userDelegation.create.mockImplementation(({ data }: any) => {
        return Promise.resolve({
          id: 'del-future',
          ...data,
        });
      });

      const result = await service.createDelegation(tenantId, userA, {
        delegateeId: userB,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      expect(result.status).toBe('INACTIVE');
    });

    it('rejects self-delegation (delegator === delegatee)', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000);

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userA,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects inverted dates (endDate <= startDate)', async () => {
      const start = new Date(Date.now() + 86400000);
      const end = new Date(Date.now() + 3600000); // end before start

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userB,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects expired end dates in the past (endDate <= now)', async () => {
      const start = new Date(Date.now() - 172800000);
      const end = new Date(Date.now() - 86400000);

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userB,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when delegator or delegatee is inactive or missing', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockResolvedValue(null); // not found

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userB,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects circular delegation (A -> B when B -> A already exists)', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        return Promise.resolve({ id: where.id, role: 'MANAGER', status: 'ACTIVE' });
      });

      // Existing B -> A delegation found
      mockPrisma.userDelegation.findFirst.mockResolvedValue({
        id: 'del-circular',
        delegatorId: userB,
        delegateeId: userA,
        status: 'ACTIVE',
      });

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userB,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(/Circular delegation detected/);
    });

    it('rejects transitive delegation when delegatee is already acting as delegator (A -> B when B -> C exists)', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        return Promise.resolve({ id: where.id, role: 'MANAGER', status: 'ACTIVE' });
      });

      // Circular check returns null
      mockPrisma.userDelegation.findFirst
        .mockResolvedValueOnce(null)
        // Transitive check 1: delegatee userB is already a delegator
        .mockResolvedValueOnce({
          id: 'del-b-to-c',
          delegatorId: userB,
          delegateeId: userC,
          status: 'ACTIVE',
        });

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userB,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(
        /Transitive delegation is not permitted: delegatee is already acting as a delegator/,
      );
    });

    it('rejects transitive delegation when delegator is already acting as delegatee (B -> C when A -> B exists)', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        return Promise.resolve({ id: where.id, role: 'MANAGER', status: 'ACTIVE' });
      });

      // Circular check returns null, delegatee is not delegator, but delegator is already delegatee
      mockPrisma.userDelegation.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'del-a-to-b',
          delegatorId: userA,
          delegateeId: userB,
          status: 'ACTIVE',
        });

      await expect(
        service.createDelegation(tenantId, userB, {
          delegateeId: userC,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(
        /Transitive delegation is not permitted: delegator is already acting as a delegatee/,
      );
    });

    it('rejects overlapping delegation windows for the same delegator and workflow scope', async () => {
      const start = new Date(Date.now() + 3600000);
      const end = new Date(Date.now() + 86400000);

      mockPrisma.user.findFirst.mockImplementation(({ where }: any) => {
        return Promise.resolve({ id: where.id, role: 'MANAGER', status: 'ACTIVE' });
      });

      mockPrisma.userDelegation.findFirst.mockResolvedValue(null);

      // Existing overlapping delegation
      mockPrisma.userDelegation.findMany.mockResolvedValue([
        {
          id: 'del-existing',
          delegatorId: userA,
          delegateeId: userB,
          startDate: new Date(Date.now()),
          endDate: new Date(Date.now() + 172800000), // overlaps with start-end
          workflowDefinitionId: null, // global scope
          status: 'ACTIVE',
        },
      ]);

      await expect(
        service.createDelegation(tenantId, userA, {
          delegateeId: userC,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      ).rejects.toThrow(/overlapping active delegation already exists/);
    });
  });

  describe('checkAndExpireDelegations', () => {
    it('expires closed delegations and activates pending delegations whose start date has arrived', async () => {
      mockPrisma.userDelegation.updateMany
        .mockResolvedValueOnce({ count: 2 }) // expired count
        .mockResolvedValueOnce({ count: 1 }); // activated count

      const result = await service.checkAndExpireDelegations(tenantId);
      expect(result.expiredCount).toBe(2);
      expect(result.activatedCount).toBe(1);
    });
  });

  describe('revokeDelegation', () => {
    it('allows delegator to revoke their active delegation', async () => {
      mockPrisma.userDelegation.findFirst.mockResolvedValue({
        id: 'del-1',
        delegatorId: userA,
        delegateeId: userB,
        status: 'ACTIVE',
      });

      mockPrisma.userDelegation.update.mockResolvedValue({
        id: 'del-1',
        status: 'REVOKED',
      });

      const result = await service.revokeDelegation(tenantId, userA, 'MANAGER', 'del-1');
      expect(result.status).toBe('REVOKED');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          actorId: userA,
          action: 'DELEGATION_REVOKED',
        }),
        undefined,
      );
    });

    it('allows TENANT_ADMIN to revoke delegation', async () => {
      mockPrisma.userDelegation.findFirst.mockResolvedValue({
        id: 'del-1',
        delegatorId: userA,
        delegateeId: userB,
        status: 'ACTIVE',
      });

      mockPrisma.userDelegation.update.mockResolvedValue({
        id: 'del-1',
        status: 'REVOKED',
      });

      const result = await service.revokeDelegation(tenantId, 'admin-1', 'TENANT_ADMIN', 'del-1');
      expect(result.status).toBe('REVOKED');
    });

    it('rejects revocation by unauthorized third party', async () => {
      mockPrisma.userDelegation.findFirst.mockResolvedValue({
        id: 'del-1',
        delegatorId: userA,
        delegateeId: userB,
        status: 'ACTIVE',
      });

      await expect(service.revokeDelegation(tenantId, userC, 'APPROVER', 'del-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects revoking an already REVOKED or EXPIRED delegation', async () => {
      mockPrisma.userDelegation.findFirst.mockResolvedValue({
        id: 'del-1',
        delegatorId: userA,
        status: 'EXPIRED',
      });

      await expect(service.revokeDelegation(tenantId, userA, 'MANAGER', 'del-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveActiveDelegation', () => {
    it('resolves active delegation for delegator within valid window', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: userA,
        role: 'MANAGER',
        status: 'ACTIVE',
      });

      mockPrisma.userDelegation.findMany.mockResolvedValue([
        {
          id: 'del-1',
          delegatorId: userA,
          delegateeId: userB,
          workflowDefinitionId: null,
          delegateRoles: true,
          roles: [],
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 3600000),
          endDate: new Date(Date.now() + 3600000),
          delegatee: { id: userB, status: 'ACTIVE', role: 'APPROVER' },
        },
      ]);

      const result = await service.resolveActiveDelegation(tenantId, userA, workflowId, 'MANAGER');
      expect(result).not.toBeNull();
      expect(result?.delegateeId).toBe(userB);
    });

    it('returns null if delegator was demoted and no longer holds required role', async () => {
      // Delegator was demoted to REQUESTER
      mockPrisma.user.findFirst.mockResolvedValue({
        id: userA,
        role: 'REQUESTER',
        status: 'ACTIVE',
      });

      const result = await service.resolveActiveDelegation(tenantId, userA, workflowId, 'MANAGER');
      expect(result).toBeNull();
    });

    it('prioritizes workflow-specific delegation over global delegation', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: userA,
        role: 'MANAGER',
        status: 'ACTIVE',
      });

      mockPrisma.userDelegation.findMany.mockResolvedValue([
        {
          id: 'del-global',
          delegatorId: userA,
          delegateeId: userB,
          workflowDefinitionId: null,
          delegateRoles: true,
          status: 'ACTIVE',
          delegatee: { id: userB, status: 'ACTIVE' },
        },
        {
          id: 'del-wf-specific',
          delegatorId: userA,
          delegateeId: userC,
          workflowDefinitionId: workflowId,
          delegateRoles: true,
          status: 'ACTIVE',
          delegatee: { id: userC, status: 'ACTIVE' },
        },
      ]);

      const result = await service.resolveActiveDelegation(tenantId, userA, workflowId, 'MANAGER');
      expect(result?.id).toBe('del-wf-specific');
      expect(result?.delegateeId).toBe(userC);
    });

    it('returns null if delegatee account is not ACTIVE', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: userA,
        role: 'MANAGER',
        status: 'ACTIVE',
      });

      mockPrisma.userDelegation.findMany.mockResolvedValue([
        {
          id: 'del-1',
          delegatorId: userA,
          delegateeId: userB,
          workflowDefinitionId: null,
          delegateRoles: true,
          status: 'ACTIVE',
          delegatee: { id: userB, status: 'SUSPENDED' }, // Suspended delegatee
        },
      ]);

      const result = await service.resolveActiveDelegation(tenantId, userA, workflowId, 'MANAGER');
      expect(result).toBeNull();
    });
  });
});

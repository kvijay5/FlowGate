import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          tenant_id: 'tenant-1',
          last_hash: 'GENESIS',
          sequence_number: 0,
          last_created_at: null,
        },
      ]),
      auditLog: {
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'audit-123', ...args.data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditChainHead: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should redact sensitive keys from metadata', async () => {
    await service.log({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'User',
      entityId: 'user-1',
      action: 'LOGIN',
      metadata: {
        password: 'SuperSecretPassword!',
        token: 'jwt.token.here',
        safeInfo: 'Safe Details',
        nested: {
          secretKey: 'top-secret',
          info: 'ok',
        },
      },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          actorId: 'user-1',
          metadata: {
            password: '[REDACTED]',
            token: '[REDACTED]',
            safeInfo: 'Safe Details',
            nested: {
              secretKey: '[REDACTED]',
              info: 'ok',
            },
          },
        }),
      }),
    );
  });

  it('should cryptographically chain audit log records with sequence numbers and row locking', async () => {
    // 1. First record has previousHash GENESIS and seq 1
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        tenant_id: 'tenant-1',
        last_hash: 'GENESIS',
        sequence_number: 0,
        last_created_at: null,
      },
    ]);

    await service.log({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'CREATED',
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          previousHash: 'GENESIS',
          sequenceNumber: 1,
          hash: expect.any(String),
        }),
      }),
    );

    // 2. Second record chains from first record's hash with seq 2
    const prevHash = 'abc123def456';
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        tenant_id: 'tenant-1',
        last_hash: prevHash,
        sequence_number: 1,
        last_created_at: new Date('2026-11-07T12:00:00Z'),
      },
    ]);

    await service.log({
      tenantId: 'tenant-1',
      actorId: 'user-2',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'APPROVED',
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          previousHash: prevHash,
          sequenceNumber: 2,
          hash: expect.any(String),
        }),
      }),
    );
  });

  it('should verify a valid cryptographic audit chain', async () => {
    const time1 = new Date('2026-11-07T12:00:00Z');
    const time2 = new Date('2026-11-07T12:05:00Z');

    const hash1 = service.computeHash('GENESIS', {
      sequenceNumber: 1,
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'CREATED',
      metadata: {},
      createdAt: time1.toISOString(),
    });

    const hash2 = service.computeHash(hash1, {
      sequenceNumber: 2,
      tenantId: 'tenant-1',
      actorId: 'user-2',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'STEP_APPROVED',
      metadata: { stepOrder: 1 },
      createdAt: time2.toISOString(),
    });

    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        tenantId: 'tenant-1',
        actorId: 'user-1',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'CREATED',
        metadata: {},
        previousHash: 'GENESIS',
        hash: hash1,
        sequenceNumber: 1,
        createdAt: time1,
      },
      {
        id: 'log-2',
        tenantId: 'tenant-1',
        actorId: 'user-2',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'STEP_APPROVED',
        metadata: { stepOrder: 1 },
        previousHash: hash1,
        hash: hash2,
        sequenceNumber: 2,
        createdAt: time2,
      },
    ]);

    mockPrisma.auditChainHead.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      lastHash: hash2,
      sequenceNumber: 2,
      lastCreatedAt: time2,
    });

    const result = await service.verifyChain('tenant-1');
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(2);
  });

  it('should detect when an audit record has been tampered with', async () => {
    const time1 = new Date('2026-11-07T12:00:00Z');
    const hash1 = service.computeHash('GENESIS', {
      sequenceNumber: 1,
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'CREATED',
      metadata: {},
      createdAt: time1.toISOString(),
    });

    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        tenantId: 'tenant-1',
        actorId: 'user-1',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'FORGED_ACTION', // Tampered!
        metadata: {},
        previousHash: 'GENESIS',
        hash: hash1, // Doesn't match tampered content
        sequenceNumber: 1,
        createdAt: time1,
      },
    ]);

    const result = await service.verifyChain('tenant-1');
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe('log-1');
    expect(result.details).toContain('Tampered');
  });

  it('should detect missing or reordered records via sequence numbering', async () => {
    const time1 = new Date('2026-11-07T12:00:00Z');
    const time3 = new Date('2026-11-07T12:10:00Z');

    const hash1 = service.computeHash('GENESIS', {
      sequenceNumber: 1,
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'CREATED',
      metadata: {},
      createdAt: time1.toISOString(),
    });

    const hash3 = service.computeHash(hash1, {
      sequenceNumber: 3,
      tenantId: 'tenant-1',
      actorId: 'user-1',
      entityType: 'ApprovalRequest',
      entityId: 'req-1',
      action: 'CREATED',
      metadata: {},
      createdAt: time3.toISOString(),
    });

    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        tenantId: 'tenant-1',
        actorId: 'user-1',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'CREATED',
        metadata: {},
        previousHash: 'GENESIS',
        hash: hash1,
        sequenceNumber: 1,
        createdAt: time1,
      },
      {
        id: 'log-3',
        tenantId: 'tenant-1',
        actorId: 'user-1',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'CREATED',
        metadata: {},
        previousHash: hash1,
        hash: hash3,
        sequenceNumber: 3, // Missing sequence 2!
        createdAt: time3,
      },
    ]);

    const result = await service.verifyChain('tenant-1');
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe('log-3');
    expect(result.details).toContain('Sequence gap');
  });

  it('should support executing within a transaction client', async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          tenant_id: 'tenant-1',
          last_hash: 'GENESIS',
          sequence_number: 0,
          last_created_at: null,
        },
      ]),
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-tx-1' }),
      },
    };

    await service.log(
      {
        tenantId: 'tenant-1',
        actorId: 'user-1',
        entityType: 'ApprovalRequest',
        entityId: 'req-1',
        action: 'CREATED',
      },
      mockTx as any,
    );

    expect(mockTx.auditLog.create).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});

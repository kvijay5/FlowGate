import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditChainVerificationResult } from '@flowgate/shared-types';

export interface CreateAuditLogParams {
  tenantId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recursively serializes a value into canonical JSON (RFC 8785 subset)
   * with deterministic alphabetical object key sorting.
   */
  static canonicalJsonStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((item) => AuditService.canonicalJsonStringify(item)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${AuditService.canonicalJsonStringify(obj[key])}`,
    );
    return '{' + pairs.join(',') + '}';
  }

  /**
   * Sanitizes metadata to strictly remove any credentials or sensitive tokens.
   */
  sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    if (!metadata) return {};
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'passwordHash', 'token', 'secret', 'jwt', 'authorization'];

    for (const [key, value] of Object.entries(metadata)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Computes the deterministic SHA-256 hash for an audit log entry.
   */
  computeHash(
    previousHash: string,
    entry: {
      sequenceNumber: number;
      tenantId: string;
      actorId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    },
  ): string {
    const canonicalPayload = AuditService.canonicalJsonStringify({
      previousHash,
      sequenceNumber: entry.sequenceNumber,
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    });
    return createHash('sha256').update(canonicalPayload).digest('hex');
  }

  /**
   * Appends an immutable, cryptographically chained audit log entry.
   * Can run within an existing Prisma transaction client or standalone.
   * Uses per-tenant chain-head row locking (SELECT ... FOR UPDATE) to ensure
   * strictly sequential, branch-free, concurrent audit log writes.
   */
  async log(params: CreateAuditLogParams, tx?: Prisma.TransactionClient) {
    if (!tx) {
      return this.prisma.$transaction(async (innerTx) => {
        return this.executeLog(params, innerTx);
      });
    }
    return this.executeLog(params, tx);
  }

  private async executeLog(params: CreateAuditLogParams, client: Prisma.TransactionClient) {
    const sanitizedMetadata = this.sanitizeMetadata(params.metadata);
    let now = new Date();

    // 1. Concurrency-safe initialization: ensure tenant has a chain head record
    await client.$executeRaw`
      INSERT INTO "audit_chain_heads" ("tenant_id", "last_hash", "sequence_number", "last_created_at", "updated_at")
      VALUES (${params.tenantId}::uuid, 'GENESIS', 0, NULL, NOW())
      ON CONFLICT ("tenant_id") DO NOTHING
    `;

    // 2. Acquire transactional row-level lock (FOR UPDATE) on this specific tenant's chain head.
    // Concurrent attempts for the same tenant queue here; different tenants execute in parallel.
    interface ChainHeadRecord {
      tenant_id: string;
      last_hash: string;
      sequence_number: number;
      last_created_at: Date | null;
    }

    const heads: ChainHeadRecord[] = await client.$queryRaw`
      SELECT "tenant_id", "last_hash", "sequence_number", "last_created_at"
      FROM "audit_chain_heads"
      WHERE "tenant_id" = ${params.tenantId}::uuid
      FOR UPDATE
    `;

    const head = heads[0];
    const previousHash = head.last_hash || 'GENESIS';
    const nextSeq = (head.sequence_number || 0) + 1;

    // Ensure strictly monotonically increasing timestamps for deterministic chronological ordering
    if (head.last_created_at) {
      const lastTime = new Date(head.last_created_at).getTime();
      if (now.getTime() <= lastTime) {
        now = new Date(lastTime + 1);
      }
    }

    // 3. Compute deterministic cryptographic SHA-256 hash
    const hash = this.computeHash(previousHash, {
      sequenceNumber: nextSeq,
      tenantId: params.tenantId,
      actorId: params.actorId || null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      metadata: sanitizedMetadata,
      createdAt: now.toISOString(),
    });

    // 4. Update chain head with new state inside the locked transaction
    await client.$executeRaw`
      UPDATE "audit_chain_heads"
      SET "last_hash" = ${hash},
          "sequence_number" = ${nextSeq},
          "last_created_at" = ${now},
          "updated_at" = NOW()
      WHERE "tenant_id" = ${params.tenantId}::uuid
    `;

    // 5. Insert immutable chained audit entry
    const entry = await client.auditLog.create({
      data: {
        tenantId: params.tenantId,
        actorId: params.actorId || null,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        metadata: sanitizedMetadata as Prisma.InputJsonValue,
        previousHash,
        hash,
        sequenceNumber: nextSeq,
        createdAt: now,
      },
    });

    this.logger.log(
      `[AUDIT] Tenant: ${params.tenantId} | Seq: #${nextSeq} | Action: ${params.action} | Hash: ${hash.substring(0, 12)}...`,
    );

    return entry;
  }

  /**
   * Fetches audit history for a specific entity within a tenant.
   * Scoped strictly to the authenticated tenant.
   */
  async getEntityAuditTrail(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType,
        entityId,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ sequenceNumber: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Mathematically verifies the cryptographic hash chain for a tenant.
   * Detects any altered records, deletions, gaps, or out-of-order insertions.
   */
  async verifyChain(tenantId: string): Promise<AuditChainVerificationResult> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        hash: { not: null },
      },
      orderBy: [{ sequenceNumber: 'asc' }, { createdAt: 'asc' }],
    });

    if (logs.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        details: 'No hashed audit entries found for this tenant.',
      };
    }

    let expectedPrevHash = 'GENESIS';
    let expectedSeq = 1;
    let prevCreatedAt: Date | null = null;

    for (const log of logs) {
      // 1. Verify sequence order and detect missing/deleted entries (sequence gaps)
      if (log.sequenceNumber !== null && log.sequenceNumber !== expectedSeq) {
        return {
          valid: false,
          totalEntries: logs.length,
          brokenAtId: log.id,
          details: `Sequence gap or reordering: Expected sequence #${expectedSeq}, but found #${log.sequenceNumber} on record ${log.id}`,
        };
      }

      // 2. Check previousHash link (detect forks or orphaned blocks)
      if (log.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: logs.length,
          brokenAtId: log.id,
          details: `Broken link: Expected previousHash '${expectedPrevHash}', but found '${log.previousHash}' on record ${log.id}`,
        };
      }

      // 3. Recompute hash (detect modified/forged metadata or payload)
      const computed = this.computeHash(log.previousHash, {
        sequenceNumber: log.sequenceNumber ?? expectedSeq,
        tenantId: log.tenantId,
        actorId: log.actorId,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        metadata: (log.metadata as Record<string, unknown>) || {},
        createdAt: log.createdAt.toISOString(),
      });

      if (log.hash !== computed) {
        return {
          valid: false,
          totalEntries: logs.length,
          brokenAtId: log.id,
          details: `Tampered content: Computed hash '${computed}' does not match stored hash '${log.hash}' on record ${log.id}`,
        };
      }

      // 4. Chronological check (detect timestamps altered out-of-order)
      if (prevCreatedAt && log.createdAt < prevCreatedAt) {
        return {
          valid: false,
          totalEntries: logs.length,
          brokenAtId: log.id,
          details: `Chronological inversion: Record ${log.id} (${log.createdAt.toISOString()}) predates prior record (${prevCreatedAt.toISOString()})`,
        };
      }

      expectedPrevHash = log.hash;
      expectedSeq++;
      prevCreatedAt = log.createdAt;
    }

    // 5. Verify synchronization with the tenant's chain-head record
    const head = await this.prisma.auditChainHead.findUnique({
      where: { tenantId },
    });

    if (head) {
      if (head.sequenceNumber !== logs.length) {
        return {
          valid: false,
          totalEntries: logs.length,
          details: `Chain head sequence mismatch: Chain head reports sequence #${head.sequenceNumber}, but log table contains ${logs.length} entries.`,
        };
      }
      if (head.lastHash !== logs[logs.length - 1].hash) {
        return {
          valid: false,
          totalEntries: logs.length,
          details: `Chain head hash mismatch: Chain head reports hash '${head.lastHash}', but latest log has '${logs[logs.length - 1].hash}'.`,
        };
      }
    }

    return {
      valid: true,
      totalEntries: logs.length,
      details:
        'Audit chain integrity verified. Zero forks, gaps, reorderings, modifications, or deletions detected.',
    };
  }
}

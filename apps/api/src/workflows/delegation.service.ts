import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DelegationStatus, Prisma } from '@prisma/client';

export interface CreateDelegationInput {
  tenantId?: string;
  delegatorId?: string;
  delegateeId: string;
  startDate: Date | string;
  endDate: Date | string;
  workflowDefinitionId?: string | null;
  delegateRoles?: boolean | string[];
  roles?: string[];
  reason?: string | null;
}

export interface DelegationQueryFilters {
  delegatorId?: string;
  delegateeId?: string;
  status?: DelegationStatus;
}

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates and configures a new out-of-office approval delegation with strict security invariants.
   */
  public async createDelegation(
    tenantId: string,
    delegatorId: string,
    dto: CreateDelegationInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;
    const now = new Date();

    // 1. Self-delegation check
    if (delegatorId === dto.delegateeId) {
      throw new BadRequestException('Self-delegation is not permitted');
    }

    // 2. Date parsing and validation
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid start or end date format');
    }

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be strictly after start date');
    }

    if (endDate <= now) {
      throw new BadRequestException('End date must be in the future');
    }

    // 3. User existence and active status in the same tenant
    const delegator = await db.user.findFirst({
      where: { id: delegatorId, tenantId, status: 'ACTIVE' },
    });
    if (!delegator) {
      throw new BadRequestException('Delegator user not found or is not active in this tenant');
    }

    const delegatee = await db.user.findFirst({
      where: { id: dto.delegateeId, tenantId, status: 'ACTIVE' },
    });
    if (!delegatee) {
      throw new BadRequestException('Delegatee user not found or is not active in this tenant');
    }

    // 4. Workflow definition scope check (if provided)
    if (dto.workflowDefinitionId) {
      const workflow = await db.workflowDefinition.findFirst({
        where: { id: dto.workflowDefinitionId, tenantId },
      });
      if (!workflow) {
        throw new BadRequestException('Workflow definition not found in this tenant');
      }
    }

    // 5. Circular Delegation Check: Block if delegatee already delegates to delegator (A -> B -> A)
    const circularDelegation = await db.userDelegation.findFirst({
      where: {
        tenantId,
        delegatorId: dto.delegateeId,
        delegateeId: delegatorId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        endDate: { gt: now },
      },
    });
    if (circularDelegation) {
      throw new BadRequestException(
        'Circular delegation detected: delegatee already has an active delegation to the delegator',
      );
    }

    // 6. Transitive / Chain Delegation Check (Single-hop only; A -> B -> C forbidden)
    // 6a. Block if delegatee is already acting as a delegator in an active delegation
    const delegateeIsDelegator = await db.userDelegation.findFirst({
      where: {
        tenantId,
        delegatorId: dto.delegateeId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        endDate: { gt: now },
      },
    });
    if (delegateeIsDelegator) {
      throw new BadRequestException(
        'Transitive delegation is not permitted: delegatee is already acting as a delegator in an active delegation',
      );
    }

    // 6b. Block if delegator is already acting as a delegatee in an active delegation
    const delegatorIsDelegatee = await db.userDelegation.findFirst({
      where: {
        tenantId,
        delegateeId: delegatorId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        endDate: { gt: now },
      },
    });
    if (delegatorIsDelegatee) {
      throw new BadRequestException(
        'Transitive delegation is not permitted: delegator is already acting as a delegatee in an active delegation',
      );
    }

    // 7. Overlapping Window Check: Delegator cannot create overlapping active delegations for same scope
    const existingDelegations = await db.userDelegation.findMany({
      where: {
        tenantId,
        delegatorId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        endDate: { gt: now },
      },
    });

    for (const existing of existingDelegations) {
      const windowOverlaps = existing.startDate < endDate && existing.endDate > startDate;
      if (!windowOverlaps) continue;

      const scopeOverlaps =
        existing.workflowDefinitionId === null ||
        !dto.workflowDefinitionId ||
        existing.workflowDefinitionId === dto.workflowDefinitionId;

      if (scopeOverlaps) {
        throw new BadRequestException(
          'An overlapping active delegation already exists for this delegator and workflow scope',
        );
      }
    }

    // 8. Determine initial status based on temporal window
    const initialStatus: DelegationStatus = startDate <= now ? 'ACTIVE' : 'INACTIVE';

    // 9. Format role attributes
    let delegateRolesBool = true;
    let rolesArray: string[] = [];

    if (Array.isArray(dto.delegateRoles)) {
      rolesArray = dto.delegateRoles;
      delegateRolesBool = rolesArray.length > 0;
    } else if (typeof dto.delegateRoles === 'boolean') {
      delegateRolesBool = dto.delegateRoles;
    }

    if (Array.isArray(dto.roles) && dto.roles.length > 0) {
      rolesArray = dto.roles;
    }

    // 10. Persist delegation record
    const delegation = await db.userDelegation.create({
      data: {
        tenantId,
        delegatorId,
        delegateeId: dto.delegateeId,
        workflowDefinitionId: dto.workflowDefinitionId || null,
        delegateRoles: delegateRolesBool,
        roles: rolesArray,
        startDate,
        endDate,
        status: initialStatus,
        reason: dto.reason?.trim() || null,
      },
      include: {
        delegator: {
          select: { id: true, name: true, email: true, role: true, status: true },
        },
        delegatee: {
          select: { id: true, name: true, email: true, role: true, status: true },
        },
        workflowDefinition: {
          select: { id: true, name: true },
        },
      },
    });

    // 11. Append-only cryptographic audit logging
    await this.auditService.log(
      {
        tenantId,
        actorId: delegatorId,
        entityType: 'UserDelegation',
        entityId: delegation.id,
        action: 'DELEGATION_CREATED',
        metadata: {
          delegateeId: dto.delegateeId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          workflowDefinitionId: dto.workflowDefinitionId || null,
          status: initialStatus,
          roles: rolesArray,
        },
      },
      tx,
    );

    return delegation;
  }

  /**
   * Evaluates and updates delegation lifecycle statuses across the tenant or system.
   * - ACTIVE delegations whose endDate has passed are marked EXPIRED.
   * - INACTIVE delegations whose startDate has arrived are marked ACTIVE.
   */
  public async checkAndExpireDelegations(tenantId?: string, tx?: Prisma.TransactionClient) {
    const db = tx || this.prisma;
    const now = new Date();
    const tenantFilter = tenantId ? { tenantId } : {};

    // 1. Expire delegations whose window has closed
    const expiredResult = await db.userDelegation.updateMany({
      where: {
        ...tenantFilter,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        endDate: { lte: now },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    // 2. Activate pending delegations whose start date has arrived
    const activatedResult = await db.userDelegation.updateMany({
      where: {
        ...tenantFilter,
        status: 'INACTIVE',
        startDate: { lte: now },
        endDate: { gt: now },
      },
      data: {
        status: 'ACTIVE',
      },
    });

    return {
      expiredCount: expiredResult.count,
      activatedCount: activatedResult.count,
    };
  }

  /**
   * Manually revokes an active or inactive delegation.
   * Allowed only for the delegator or tenant/super admins.
   */
  public async revokeDelegation(
    tenantId: string,
    actorId: string,
    actorRole: string,
    delegationId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;

    const delegation = await db.userDelegation.findFirst({
      where: { id: delegationId, tenantId },
    });

    if (!delegation) {
      throw new NotFoundException('Delegation not found in this tenant');
    }

    const isDelegator = delegation.delegatorId === actorId;
    const isAdmin = actorRole === 'TENANT_ADMIN' || actorRole === 'SUPER_ADMIN';

    if (!isDelegator && !isAdmin) {
      throw new ForbiddenException('Only the delegator or a tenant admin can revoke a delegation');
    }

    if (delegation.status === 'REVOKED' || delegation.status === 'EXPIRED') {
      throw new BadRequestException(`Cannot revoke delegation with status '${delegation.status}'`);
    }

    const updated = await db.userDelegation.update({
      where: { id: delegationId },
      data: { status: 'REVOKED' },
      include: {
        delegator: {
          select: { id: true, name: true, email: true, role: true },
        },
        delegatee: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.auditService.log(
      {
        tenantId,
        actorId,
        entityType: 'UserDelegation',
        entityId: delegationId,
        action: 'DELEGATION_REVOKED',
        metadata: {
          previousStatus: delegation.status,
          revokedBy: actorId,
        },
      },
      tx,
    );

    return updated;
  }

  /**
   * Retrieves delegations within a tenant matching optional filters.
   */
  public async getDelegations(
    tenantId: string,
    filters?: DelegationQueryFilters,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;

    // Refresh state before reading
    await this.checkAndExpireDelegations(tenantId, tx);

    const where: Prisma.UserDelegationWhereInput = {
      tenantId,
      ...(filters?.delegatorId ? { delegatorId: filters.delegatorId } : {}),
      ...(filters?.delegateeId ? { delegateeId: filters.delegateeId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    };

    return db.userDelegation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        delegator: {
          select: { id: true, name: true, email: true, role: true, status: true },
        },
        delegatee: {
          select: { id: true, name: true, email: true, role: true, status: true },
        },
        workflowDefinition: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Resolves whether an active delegation exists for a target user (delegator)
   * covering the specified workflow and required role.
   *
   * Invariants:
   * 1. Window must be active: startDate <= now < endDate.
   * 2. Delegator must remain ACTIVE.
   * 3. Delegator must hold the requiredRole (dynamic role verification).
   * 4. Delegatee must remain ACTIVE.
   * 5. Workflow-specific delegation takes precedence over global delegation.
   */
  public async resolveActiveDelegation(
    tenantId: string,
    targetUserId: string,
    workflowDefinitionId?: string | null,
    requiredRole?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;
    const now = new Date();

    // 1. Verify delegator is active
    const delegator = await db.user.findFirst({
      where: { id: targetUserId, tenantId },
    });

    if (!delegator || delegator.status !== 'ACTIVE') {
      return null;
    }

    // 2. Dynamic role check: delegator must hold the required role (if role-scoped)
    if (
      requiredRole &&
      delegator.role !== requiredRole &&
      !['TENANT_ADMIN', 'SUPER_ADMIN'].includes(delegator.role)
    ) {
      return null;
    }

    // 3. Find candidates matching active window
    const candidates = await db.userDelegation.findMany({
      where: {
        tenantId,
        delegatorId: targetUserId,
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gt: now },
      },
      include: {
        delegatee: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (candidates.length === 0) {
      return null;
    }

    // 4. Scope precedence: workflow-specific > global
    let matching = candidates.find(
      (c) => workflowDefinitionId && c.workflowDefinitionId === workflowDefinitionId,
    );

    if (!matching) {
      matching = candidates.find((c) => c.workflowDefinitionId === null);
    }

    if (!matching) {
      return null;
    }

    // 5. Delegatee account state invariant: delegatee must be ACTIVE
    if (!matching.delegatee || matching.delegatee.status !== 'ACTIVE') {
      return null;
    }

    // 6. Role scope verification (if delegation specifies restricted roles)
    if (requiredRole) {
      if (!matching.delegateRoles) {
        return null;
      }
      if (matching.roles && matching.roles.length > 0 && !matching.roles.includes(requiredRole)) {
        return null;
      }
    }

    return matching;
  }

  /**
   * Checks if delegateeId is authorized to act on behalf of delegatorId.
   */
  public async findActiveDelegationForDelegatee(
    tenantId: string,
    delegateeId: string,
    delegatorId: string,
    workflowDefinitionId?: string | null,
    requiredRole?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const activeDelegation = await this.resolveActiveDelegation(
      tenantId,
      delegatorId,
      workflowDefinitionId,
      requiredRole,
      tx,
    );

    if (activeDelegation && activeDelegation.delegateeId === delegateeId) {
      return activeDelegation;
    }

    return null;
  }

  /**
   * Finds an active delegation by ID with tenant and temporal checks.
   */
  public async findActiveDelegationById(
    tenantId: string,
    delegationId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;
    const now = new Date();

    return db.userDelegation.findFirst({
      where: {
        id: delegationId,
        tenantId,
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gt: now },
      },
      include: {
        delegator: true,
        delegatee: true,
      },
    });
  }
}

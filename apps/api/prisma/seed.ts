import {
  PrismaClient,
  TenantStatus,
  UserRole,
  UserStatus,
  WorkflowStatus,
  ApprovalRequestStatus,
  StepStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting FlowGate database seed...');

  // 1. Password hashing (shared standard seed password)
  const passwordHash = await bcrypt.hash('FlowGatePass123!', 10);

  // 2. Clear existing demo data cleanly in reverse dependency order
  console.log('🧹 Cleaning existing data...');
  await prisma.auditLog.deleteMany({});
  await prisma.approvalStep.deleteMany({});
  await prisma.approvalRequest.deleteMany({});
  await prisma.workflowDefinition.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  // ---------------------------------------------------------------------------
  // TENANT 1: Acme Corporation
  // ---------------------------------------------------------------------------
  console.log('🏢 Seeding Tenant 1: Acme Corporation...');
  const acmeTenant = await prisma.tenant.create({
    data: {
      name: 'Acme Corporation',
      slug: 'acme-corp',
      status: TenantStatus.ACTIVE,
      settings: {
        tier: 'enterprise',
        enforceTwoFactor: true,
        defaultCurrency: 'USD',
        notifications: {
          email: true,
          slack: false,
        },
      },
    },
  });

  const acmeAdmin = await prisma.user.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Alice Vance (Acme Admin)',
      email: 'admin@acme.com',
      passwordHash,
      role: UserRole.TENANT_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  const acmeApprover = await prisma.user.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Bob Finance (Acme CFO)',
      email: 'finance@acme.com',
      passwordHash,
      role: UserRole.APPROVER,
      status: UserStatus.ACTIVE,
    },
  });

  const acmeRequester = await prisma.user.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Charlie Dev (Acme Engineer)',
      email: 'engineer@acme.com',
      passwordHash,
      role: UserRole.REQUESTER,
      status: UserStatus.ACTIVE,
    },
  });

  const acmeWorkflow = await prisma.workflowDefinition.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Capex Hardware Approval',
      description: 'Multi-stage signoff required for IT purchases exceeding $10,000.',
      status: WorkflowStatus.ACTIVE,
      version: 1,
      configuration: {
        approvalThresholdUsd: 10000,
        steps: [
          {
            stepOrder: 1,
            name: 'Finance Verification',
            assigneeType: 'ROLE',
            role: 'APPROVER',
            description: 'Review budget allocation and cost-benefit analysis',
          },
          {
            stepOrder: 2,
            name: 'Executive Signoff',
            assigneeType: 'ROLE',
            role: 'TENANT_ADMIN',
            description: 'Final organizational signoff for expenditures above threshold',
          },
        ],
      },
    },
  });

  const acmeRequest = await prisma.approvalRequest.create({
    data: {
      tenantId: acmeTenant.id,
      workflowDefinitionId: acmeWorkflow.id,
      requestedById: acmeRequester.id,
      title: 'H100 GPU Server Cluster for Machine Learning Training',
      description: 'Acquisition of 4x NVIDIA H100 servers for model fine-tuning.',
      status: ApprovalRequestStatus.IN_PROGRESS,
    },
  });

  await prisma.approvalStep.create({
    data: {
      tenantId: acmeTenant.id,
      approvalRequestId: acmeRequest.id,
      stepName: 'Finance Verification',
      assignedRole: UserRole.APPROVER,
      assignedToId: acmeApprover.id,
      stepOrder: 1,
      status: StepStatus.IN_REVIEW,
      comments: 'Reviewing Q4 CAPEX budget allocation before signing off.',
    },
  });

  await prisma.approvalStep.create({
    data: {
      tenantId: acmeTenant.id,
      approvalRequestId: acmeRequest.id,
      stepName: 'Executive Signoff',
      assignedRole: UserRole.TENANT_ADMIN,
      stepOrder: 2,
      status: StepStatus.PENDING,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: acmeTenant.id,
      actorId: acmeRequester.id,
      entityType: 'APPROVAL_REQUEST',
      entityId: acmeRequest.id,
      action: 'CREATED',
      metadata: {
        amountUsd: 125000,
        department: 'Infrastructure & AI',
      },
    },
  });

  // ---------------------------------------------------------------------------
  // TENANT 2: Globex Industries
  // ---------------------------------------------------------------------------
  console.log('🏢 Seeding Tenant 2: Globex Industries...');
  const globexTenant = await prisma.tenant.create({
    data: {
      name: 'Globex Industries',
      slug: 'globex-ind',
      status: TenantStatus.ACTIVE,
      settings: {
        tier: 'business',
        enforceTwoFactor: false,
        defaultCurrency: 'EUR',
        notifications: {
          email: true,
          webhook: true,
        },
      },
    },
  });

  const globexAdmin = await prisma.user.create({
    data: {
      tenantId: globexTenant.id,
      name: 'David Mercer (Globex Admin)',
      email: 'admin@globex.com',
      passwordHash,
      role: UserRole.TENANT_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  const globexApprover = await prisma.user.create({
    data: {
      tenantId: globexTenant.id,
      name: 'Elena Rostova (Globex HR Director)',
      email: 'hr-lead@globex.com',
      passwordHash,
      role: UserRole.APPROVER,
      status: UserStatus.ACTIVE,
    },
  });

  const globexRequester = await prisma.user.create({
    data: {
      tenantId: globexTenant.id,
      name: 'Frank Miller (Globex Specialist)',
      email: 'employee@globex.com',
      passwordHash,
      role: UserRole.REQUESTER,
      status: UserStatus.ACTIVE,
    },
  });

  const globexWorkflow = await prisma.workflowDefinition.create({
    data: {
      tenantId: globexTenant.id,
      name: 'Ergonomic Equipment Allowance',
      description: 'Standard HR process for home office ergonomic upgrades.',
      status: WorkflowStatus.ACTIVE,
      version: 1,
      configuration: {
        maxAllowanceEur: 1500,
        steps: [
          {
            stepOrder: 1,
            name: 'HR Approval',
            assigneeType: 'ROLE',
            role: 'APPROVER',
            description: 'Verify ergonomics assessment and employee eligibility',
          },
        ],
      },
    },
  });

  const globexRequest = await prisma.approvalRequest.create({
    data: {
      tenantId: globexTenant.id,
      workflowDefinitionId: globexWorkflow.id,
      requestedById: globexRequester.id,
      title: 'Motorized Standing Desk & Ergonomic Chair',
      description: 'Dual monitor ergonomic standing desk setup for remote work.',
      status: ApprovalRequestStatus.PENDING,
    },
  });

  await prisma.approvalStep.create({
    data: {
      tenantId: globexTenant.id,
      approvalRequestId: globexRequest.id,
      stepName: 'HR Approval',
      assignedRole: UserRole.APPROVER,
      assignedToId: globexApprover.id,
      stepOrder: 1,
      status: StepStatus.PENDING,
      comments: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: globexTenant.id,
      actorId: globexRequester.id,
      entityType: 'APPROVAL_REQUEST',
      entityId: globexRequest.id,
      action: 'CREATED',
      metadata: {
        amountEur: 1100,
        category: 'Ergonomic Office',
      },
    },
  });

  console.log('✅ FlowGate seed completed successfully:');
  console.log(
    `   - Acme Corp: Tenant ID ${acmeTenant.id}, 3 users, 1 workflow, 1 request, 1 audit log`,
  );
  console.log(
    `   - Globex Ind: Tenant ID ${globexTenant.id}, 3 users, 1 workflow, 1 request, 1 audit log`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import {
  PrismaClient,
  TenantStatus,
  UserRole,
  UserStatus,
  WorkflowStatus,
  ApprovalRequestStatus,
  StepStatus,
  DelegationStatus,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`,
  );
  return '{' + pairs.join(',') + '}';
}

function computeAuditHash(
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
  const payload = canonicalJsonStringify({
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
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function main() {
  console.log('🌱 Starting FlowGate showcase database seed...');

  // 1. Password hashing (shared standard seed password)
  const passwordHash = await bcrypt.hash('FlowGatePass123!', 10);

  // 2. Clear existing demo data cleanly in reverse dependency order
  console.log('🧹 Cleaning existing data...');
  await prisma.outboxEvent.deleteMany({});
  await prisma.webhookDelivery.deleteMany({});
  await prisma.webhookSubscription.deleteMany({});
  await prisma.inboundWebhookEvent.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.auditChainHead.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.workflowBranchExecution.deleteMany({});
  await prisma.workflowNodeExecution.deleteMany({});
  await prisma.approvalStepAssignee.deleteMany({});
  await prisma.approvalStep.deleteMany({});
  await prisma.userDelegation.deleteMany({});
  await prisma.approvalRequest.deleteMany({});
  await prisma.workflowDefinition.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  // ---------------------------------------------------------------------------
  // TENANT 1: Acme Corporation
  // ---------------------------------------------------------------------------
  console.log('🏢 Seeding Tenant 1: Acme Corporation (Flagship Enterprise Realm)...');
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

  const acmeLegal = await prisma.user.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Linda Legal (Acme General Counsel)',
      email: 'legal@acme.com',
      passwordHash,
      role: UserRole.APPROVER,
      status: UserStatus.ACTIVE,
    },
  });

  const acmeRequester = await prisma.user.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Charlie Dev (Acme Principal Engineer)',
      email: 'engineer@acme.com',
      passwordHash,
      role: UserRole.REQUESTER,
      status: UserStatus.ACTIVE,
    },
  });

  // ---------------------------------------------------------------------------
  // WORKFLOW 1A: Legacy Sequential Capex Hardware Approval (Backwards Compatibility)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // WORKFLOW 1B: FLAGSHIP DAG WORKFLOW (Milestone 6 Showcase)
  // ---------------------------------------------------------------------------
  console.log('⚡ Seeding Flagship DAG: Enterprise Capital Expenditure & Security Review DAG...');

  const flagSchema = {
    fields: [
      { name: 'amount', label: 'Expenditure Amount (USD)', type: 'NUMBER', required: true },
      {
        name: 'department',
        label: 'Requesting Department',
        type: 'STRING',
        required: true,
        options: ['Engineering', 'Infrastructure', 'Security', 'Operations'],
      },
      {
        name: 'vendorRisk',
        label: 'Vendor Security Risk Tier',
        type: 'STRING',
        required: false,
        options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      },
    ],
  };

  const flagNodes = [
    {
      id: 'node_trigger',
      type: 'TRIGGER',
      name: 'Capex Request Intake',
      position: { x: 100, y: 220 },
      config: { inputSchema: flagSchema },
    },
    {
      id: 'node_cond',
      type: 'CONDITION',
      name: 'High-Value Asset Gate ($10,000+)',
      position: { x: 340, y: 220 },
      config: {
        rules: [
          {
            id: 'rule_high_capex',
            branchKey: 'branch_high',
            targetNodeId: 'node_parallel',
            expression: { field: 'amount', operator: 'GT', value: 10000 },
            description: 'Purchases > $10K require parallel committee quorum & legal signoff',
          },
        ],
        defaultTargetNodeId: 'node_fast_track',
      },
    },
    {
      id: 'node_parallel',
      type: 'PARALLEL_APPROVAL',
      name: 'Executive Capex Committee (2 of 3 Quorum)',
      position: { x: 640, y: 120 },
      config: {
        policy: 'PARALLEL_OR',
        rejectionPolicy: 'SOFT_REJECTION',
        requiredApprovals: 2,
        assignees: [
          { assigneeType: 'USER', userId: acmeApprover.id },
          { assigneeType: 'USER', userId: acmeLegal.id },
          { assigneeType: 'USER', userId: acmeAdmin.id },
        ],
      },
    },
    {
      id: 'node_legal',
      type: 'APPROVAL_STEP',
      name: 'Legal & Export Compliance Review',
      position: { x: 640, y: 240 },
      config: {
        assigneeType: 'USER',
        userId: acmeLegal.id,
      },
    },
    {
      id: 'node_fast_track',
      type: 'APPROVAL_STEP',
      name: 'Departmental Fast-Track Signoff',
      position: { x: 640, y: 360 },
      config: {
        assigneeType: 'ROLE',
        role: 'APPROVER',
      },
    },
    {
      id: 'node_join',
      type: 'JOIN',
      name: 'Governance Convergence Gate',
      position: { x: 960, y: 220 },
      config: { joinPolicy: 'ALL_INCOMING' },
    },
    {
      id: 'node_end',
      type: 'END',
      name: 'Procurement Authorized',
      position: { x: 1180, y: 220 },
      config: { outcome: 'APPROVED' },
    },
  ];

  const flagEdges = [
    { id: 'e_trig_cond', sourceNodeId: 'node_trigger', targetNodeId: 'node_cond' },
    {
      id: 'e_cond_par',
      sourceNodeId: 'node_cond',
      targetNodeId: 'node_parallel',
      sourceHandle: 'branch_high',
    },
    {
      id: 'e_cond_leg',
      sourceNodeId: 'node_cond',
      targetNodeId: 'node_legal',
      sourceHandle: 'branch_high',
    },
    {
      id: 'e_cond_fast',
      sourceNodeId: 'node_cond',
      targetNodeId: 'node_fast_track',
      sourceHandle: 'default',
    },
    { id: 'e_par_join', sourceNodeId: 'node_parallel', targetNodeId: 'node_join' },
    { id: 'e_leg_join', sourceNodeId: 'node_legal', targetNodeId: 'node_join' },
    { id: 'e_fast_join', sourceNodeId: 'node_fast_track', targetNodeId: 'node_join' },
    { id: 'e_join_end', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
  ];

  const acmeDagWorkflow = await prisma.workflowDefinition.create({
    data: {
      tenantId: acmeTenant.id,
      name: 'Enterprise Capital Expenditure & Security Review DAG',
      description:
        'Production DAG routing high-value (> $10,000) assets to a 2-of-3 parallel executive committee and legal export review, with fast-track routing for minor operational spend.',
      status: WorkflowStatus.ACTIVE,
      version: 1,
      configuration: {
        nodes: flagNodes,
        edges: flagEdges,
        inputSchema: flagSchema,
        triggerNode: flagNodes[0],
      },
    },
  });

  // ---------------------------------------------------------------------------
  // DEMO DAG REQUEST 1: Live Interactive In-Review Request (Waiting for deciding vote)
  // ---------------------------------------------------------------------------
  console.log('📌 Seeding Demo DAG Request 1 (Interactive In-Review Parallel Quorum)...');
  const now = new Date();
  const tMinus10m = new Date(now.getTime() - 10 * 60 * 1000);
  const tMinus8m = new Date(now.getTime() - 8 * 60 * 1000);
  const tMinus5m = new Date(now.getTime() - 5 * 60 * 1000);

  const inReviewDagRequest = await prisma.approvalRequest.create({
    data: {
      tenantId: acmeTenant.id,
      workflowDefinitionId: acmeDagWorkflow.id,
      workflowVersion: 1,
      workflowSnapshot: acmeDagWorkflow.configuration as unknown as Prisma.InputJsonValue,
      requestedById: acmeRequester.id,
      title: 'NVIDIA H100 AI Supercluster Acquisition (4x 8-GPU Nodes)',
      description:
        'Procurement of 4x HGX H100 GPU nodes for high-throughput fine-tuning and inference. Requires dual executive quorum signoff.',
      status: ApprovalRequestStatus.IN_PROGRESS,
      currentReviewRound: 1,
      currentNodeId: 'node_parallel',
      requestData: {
        amount: 145000,
        department: 'Infrastructure',
        vendorRisk: 'LOW',
      },
      createdAt: tMinus10m,
      updatedAt: tMinus5m,
    },
  });

  // Seed node execution rows for DAG visualizer
  await prisma.workflowNodeExecution.createMany({
    data: [
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_trigger',
        nodeType: 'TRIGGER',
        status: 'COMPLETED',
        activatedAt: tMinus10m,
        completedAt: tMinus10m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_cond',
        nodeType: 'CONDITION',
        status: 'COMPLETED',
        activatedAt: tMinus10m,
        completedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_parallel',
        nodeType: 'PARALLEL_APPROVAL',
        status: 'IN_REVIEW',
        activatedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_legal',
        nodeType: 'APPROVAL_STEP',
        status: 'IN_REVIEW',
        activatedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_fast_track',
        nodeType: 'APPROVAL_STEP',
        status: 'SKIPPED',
        activatedAt: tMinus8m,
        completedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_join',
        nodeType: 'JOIN',
        status: 'PENDING',
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_end',
        nodeType: 'END',
        status: 'PENDING',
      },
    ],
  });

  // Seed branch execution rows
  await prisma.workflowBranchExecution.createMany({
    data: [
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_trig_cond',
        sourceNodeId: 'node_trigger',
        targetNodeId: 'node_cond',
        status: 'COMPLETED',
        activatedAt: tMinus10m,
        completedAt: tMinus10m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_cond_par',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_parallel',
        status: 'ACTIVE',
        activatedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_cond_leg',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_legal',
        status: 'ACTIVE',
        activatedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_cond_fast',
        sourceNodeId: 'node_cond',
        targetNodeId: 'node_fast_track',
        status: 'PRUNED_SKIPPED',
        activatedAt: tMinus8m,
        completedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_par_join',
        sourceNodeId: 'node_parallel',
        targetNodeId: 'node_join',
        status: 'NOT_EVALUATED',
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_leg_join',
        sourceNodeId: 'node_legal',
        targetNodeId: 'node_join',
        status: 'NOT_EVALUATED',
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_fast_join',
        sourceNodeId: 'node_fast_track',
        targetNodeId: 'node_join',
        status: 'PRUNED_SKIPPED',
        activatedAt: tMinus8m,
        completedAt: tMinus8m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: inReviewDagRequest.id,
        reviewRound: 1,
        branchKey: 'e_join_end',
        sourceNodeId: 'node_join',
        targetNodeId: 'node_end',
        status: 'NOT_EVALUATED',
      },
    ],
  });

  // Seed Parallel Step & Assignees (1 of 2 approved, 2 pending)
  const parallelStep = await prisma.approvalStep.create({
    data: {
      tenantId: acmeTenant.id,
      approvalRequestId: inReviewDagRequest.id,
      nodeId: 'node_parallel',
      stepName: 'Executive Capex Committee (2 of 3 Quorum)',
      nodeType: 'PARALLEL_APPROVAL',
      policy: 'PARALLEL_OR',
      rejectionPolicy: 'SOFT_REJECTION',
      requiredApprovals: 2,
      totalAssigned: 3,
      approvedCount: 1,
      rejectedCount: 0,
      stepOrder: 1,
      status: StepStatus.IN_REVIEW,
      reviewRound: 1,
      comments: '1 of 2 approvals recorded. Awaiting 1 additional signoff to achieve quorum.',
    },
  });

  await prisma.approvalStepAssignee.createMany({
    data: [
      {
        tenantId: acmeTenant.id,
        stepId: parallelStep.id,
        assignedToId: acmeApprover.id,
        status: 'APPROVED',
        actionedById: acmeApprover.id,
        actionedAt: tMinus5m,
        comments:
          'Capex allocation confirmed against Q4 Infrastructure reserves. Quorum progress: 1/2.',
      },
      {
        tenantId: acmeTenant.id,
        stepId: parallelStep.id,
        assignedToId: acmeLegal.id,
        status: 'PENDING',
      },
      {
        tenantId: acmeTenant.id,
        stepId: parallelStep.id,
        assignedToId: acmeAdmin.id,
        status: 'PENDING',
      },
    ],
  });

  // Seed Legal Step (In Review)
  const legalStep = await prisma.approvalStep.create({
    data: {
      tenantId: acmeTenant.id,
      approvalRequestId: inReviewDagRequest.id,
      nodeId: 'node_legal',
      stepName: 'Legal & Export Compliance Review',
      nodeType: 'APPROVAL_STEP',
      assignedToId: acmeLegal.id,
      stepOrder: 2,
      status: StepStatus.IN_REVIEW,
      reviewRound: 1,
      comments: 'Export control classification verification in progress.',
    },
  });

  await prisma.approvalStepAssignee.create({
    data: {
      tenantId: acmeTenant.id,
      stepId: legalStep.id,
      assignedToId: acmeLegal.id,
      status: 'PENDING',
    },
  });

  // ---------------------------------------------------------------------------
  // DEMO DAG REQUEST 2: Completed Request with Cryptographic SHA-256 Audit Chain
  // ---------------------------------------------------------------------------
  console.log(
    '🛡️ Seeding Demo DAG Request 2 (Completed with Verified SHA-256 Audit Hash Chain)...',
  );
  const tMinus2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const tMinus1h50m = new Date(now.getTime() - 110 * 60 * 1000);
  const tMinus1h40m = new Date(now.getTime() - 100 * 60 * 1000);
  const tMinus1h30m = new Date(now.getTime() - 90 * 60 * 1000);

  const completedDagRequest = await prisma.approvalRequest.create({
    data: {
      tenantId: acmeTenant.id,
      workflowDefinitionId: acmeDagWorkflow.id,
      workflowVersion: 1,
      workflowSnapshot: acmeDagWorkflow.configuration as unknown as Prisma.InputJsonValue,
      requestedById: acmeRequester.id,
      title: 'SOC-2 Type II Annual Security Audit & Pen-Testing Retainer',
      description:
        'Standard annual compliance audit retainer with NCC Group ($8,500). Routed through departmental fast-track.',
      status: ApprovalRequestStatus.APPROVED,
      currentReviewRound: 1,
      currentNodeId: 'node_end',
      requestData: {
        amount: 8500,
        department: 'Security',
        vendorRisk: 'LOW',
      },
      createdAt: tMinus2h,
      updatedAt: tMinus1h30m,
    },
  });

  // Complete node executions for Request 2
  await prisma.workflowNodeExecution.createMany({
    data: [
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_trigger',
        nodeType: 'TRIGGER',
        status: 'COMPLETED',
        activatedAt: tMinus2h,
        completedAt: tMinus2h,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_cond',
        nodeType: 'CONDITION',
        status: 'COMPLETED',
        activatedAt: tMinus2h,
        completedAt: tMinus1h50m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_parallel',
        nodeType: 'PARALLEL_APPROVAL',
        status: 'SKIPPED',
        activatedAt: tMinus1h50m,
        completedAt: tMinus1h50m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_legal',
        nodeType: 'APPROVAL_STEP',
        status: 'SKIPPED',
        activatedAt: tMinus1h50m,
        completedAt: tMinus1h50m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_fast_track',
        nodeType: 'APPROVAL_STEP',
        status: 'COMPLETED',
        activatedAt: tMinus1h50m,
        completedAt: tMinus1h40m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_join',
        nodeType: 'JOIN',
        status: 'COMPLETED',
        activatedAt: tMinus1h40m,
        completedAt: tMinus1h40m,
      },
      {
        tenantId: acmeTenant.id,
        approvalRequestId: completedDagRequest.id,
        reviewRound: 1,
        nodeId: 'node_end',
        nodeType: 'END',
        status: 'COMPLETED',
        activatedAt: tMinus1h40m,
        completedAt: tMinus1h30m,
      },
    ],
  });

  const completedStep = await prisma.approvalStep.create({
    data: {
      tenantId: acmeTenant.id,
      approvalRequestId: completedDagRequest.id,
      nodeId: 'node_fast_track',
      stepName: 'Departmental Fast-Track Signoff',
      nodeType: 'APPROVAL_STEP',
      assignedRole: UserRole.APPROVER,
      assignedToId: acmeApprover.id,
      actionedById: acmeApprover.id,
      actionedAt: tMinus1h40m,
      stepOrder: 1,
      status: StepStatus.APPROVED,
      reviewRound: 1,
      approvedCount: 1,
      requiredApprovals: 1,
      comments: 'Expedited fast-track approval granted for standard annual compliance audit.',
    },
  });

  await prisma.approvalStepAssignee.create({
    data: {
      tenantId: acmeTenant.id,
      stepId: completedStep.id,
      assignedToId: acmeApprover.id,
      actionedById: acmeApprover.id,
      actionedAt: tMinus1h40m,
      status: 'APPROVED',
      comments: 'Expedited fast-track approval granted.',
    },
  });

  // Seed cryptographic SHA-256 audit log hash chain for Acme Corporation
  const auditEntries = [
    {
      sequenceNumber: 1,
      tenantId: acmeTenant.id,
      actorId: acmeRequester.id,
      entityType: 'ApprovalRequest',
      entityId: completedDagRequest.id,
      action: 'REQUEST_CREATED',
      metadata: {
        title: completedDagRequest.title,
        amount: 8500,
        department: 'Security',
      },
      createdAt: tMinus2h.toISOString(),
    },
    {
      sequenceNumber: 2,
      tenantId: acmeTenant.id,
      actorId: null,
      entityType: 'ApprovalStep',
      entityId: completedStep.id,
      action: 'STEP_ACTIVATED',
      metadata: {
        nodeId: 'node_fast_track',
        policy: 'SEQUENTIAL',
        totalAssigned: 1,
        requiredApprovals: 1,
        reviewRound: 1,
      },
      createdAt: tMinus1h50m.toISOString(),
    },
    {
      sequenceNumber: 3,
      tenantId: acmeTenant.id,
      actorId: acmeApprover.id,
      entityType: 'ApprovalStep',
      entityId: completedStep.id,
      action: 'STEP_APPROVED',
      metadata: {
        approvedCount: 1,
        requiredApprovals: 1,
        reviewRound: 1,
        comments: 'Expedited fast-track approval granted.',
      },
      createdAt: tMinus1h40m.toISOString(),
    },
    {
      sequenceNumber: 4,
      tenantId: acmeTenant.id,
      actorId: acmeApprover.id,
      entityType: 'ApprovalRequest',
      entityId: completedDagRequest.id,
      action: 'REQUEST_APPROVED',
      metadata: {
        finalOutcome: 'APPROVED',
        completedAt: tMinus1h30m.toISOString(),
      },
      createdAt: tMinus1h30m.toISOString(),
    },
  ];

  let prevHash = 'GENESIS';
  for (const entry of auditEntries) {
    const currentHash = computeAuditHash(prevHash, entry);
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        metadata: entry.metadata as Prisma.InputJsonValue,
        previousHash: prevHash,
        hash: currentHash,
        sequenceNumber: entry.sequenceNumber,
        createdAt: new Date(entry.createdAt),
      },
    });
    prevHash = currentHash;
  }

  // Update Acme chain head
  await prisma.auditChainHead.create({
    data: {
      tenantId: acmeTenant.id,
      lastHash: prevHash,
      sequenceNumber: 4,
      lastCreatedAt: tMinus1h30m,
    },
  });

  // ---------------------------------------------------------------------------
  // OUT-OF-OFFICE DELEGATION RECORD
  // ---------------------------------------------------------------------------
  console.log('✈️ Seeding Active Out-of-Office Approval Delegation...');
  const delegationStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const delegationEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  await prisma.userDelegation.create({
    data: {
      tenantId: acmeTenant.id,
      delegatorId: acmeApprover.id,
      delegateeId: acmeLegal.id,
      workflowDefinitionId: null, // Covers all workflows
      delegateRoles: true,
      roles: ['APPROVER'],
      startDate: delegationStart,
      endDate: delegationEnd,
      status: DelegationStatus.ACTIVE,
      reason:
        'Attending annual FinOps World Summit in Zurich. Linda Legal is delegated to cover department capex signoffs.',
    },
  });

  // ---------------------------------------------------------------------------
  // TENANT 2: Globex Industries (Multi-Tenant Isolation Showcase)
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

  // Seed genesis audit log for Globex
  const globexGenesisHash = computeAuditHash('GENESIS', {
    sequenceNumber: 1,
    tenantId: globexTenant.id,
    actorId: globexRequester.id,
    entityType: 'ApprovalRequest',
    entityId: globexRequest.id,
    action: 'REQUEST_CREATED',
    metadata: {
      amountEur: 1100,
      category: 'Ergonomic Office',
    },
    createdAt: tMinus2h.toISOString(),
  });

  await prisma.auditLog.create({
    data: {
      tenantId: globexTenant.id,
      actorId: globexRequester.id,
      entityType: 'ApprovalRequest',
      entityId: globexRequest.id,
      action: 'REQUEST_CREATED',
      metadata: {
        amountEur: 1100,
        category: 'Ergonomic Office',
      },
      previousHash: 'GENESIS',
      hash: globexGenesisHash,
      sequenceNumber: 1,
      createdAt: tMinus2h,
    },
  });

  await prisma.auditChainHead.create({
    data: {
      tenantId: globexTenant.id,
      lastHash: globexGenesisHash,
      sequenceNumber: 1,
      lastCreatedAt: tMinus2h,
    },
  });

  console.log('✅ FlowGate showcase seed completed successfully!');
  console.log('   - Acme Corp:');
  console.log('     * Users: admin@acme.com, finance@acme.com, legal@acme.com, engineer@acme.com');
  console.log('     * Workflows: Flagship DAG Workflow + Capex Hardware Approval');
  console.log(
    `     * Requests: 1 Live Interactive IN_REVIEW (ID: ${inReviewDagRequest.id}) + 1 COMPLETED with verified SHA-256 audit ledger (ID: ${completedDagRequest.id})`,
  );
  console.log('     * Delegation: Bob Finance -> Linda Legal (Active 7-day window)');
  console.log('   - Globex Industries:');
  console.log('     * Users: admin@globex.com, hr-lead@globex.com, employee@globex.com');
  console.log('     * Workflows: Ergonomic Equipment Allowance');
  console.log(`     * Requests: 1 PENDING (ID: ${globexRequest.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

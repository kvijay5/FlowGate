import { WorkflowNode, WorkflowEdge, InputSchema } from './index';

export interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  category: 'FINANCE' | 'HR' | 'LEGAL' | 'OPERATIONS' | 'SECURITY';
  categoryLabel: string;
  description: string;
  estimatedTime: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema: InputSchema;
  samplePayload: Record<string, unknown>;
}

export type WorkflowTemplate = WorkflowTemplateDefinition;

export const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    id: 'template-fintech-capex',
    name: 'FinTech CapEx & Vendor Risk Approval',
    category: 'FINANCE',
    categoryLabel: 'Finance & CapEx',
    description:
      'High-value capital expenditure routing with dynamic committee quorum for expenditures over $50,000.',
    estimatedTime: '24–48 hours',
    inputSchema: {
      fields: [
        {
          name: 'amount',
          label: 'Expenditure Amount (USD)',
          type: 'NUMBER',
          required: true,
          minimum: 1,
        },
        {
          name: 'department',
          label: 'Requesting Department',
          type: 'STRING',
          required: true,
          allowedValues: ['ENGINEERING', 'FINANCE', 'MARKETING', 'OPERATIONS'],
        },
        {
          name: 'vendorRisk',
          label: 'Vendor Risk Tier',
          type: 'STRING',
          required: true,
          allowedValues: ['LOW', 'MEDIUM', 'HIGH'],
        },
      ],
    },
    samplePayload: {
      amount: 75000,
      department: 'ENGINEERING',
      vendorRisk: 'MEDIUM',
    },
    nodes: [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'CapEx Request Submitted',
        position: { x: 250, y: 50 },
        config: {
          inputSchema: {
            fields: [
              {
                name: 'amount',
                label: 'Expenditure Amount (USD)',
                type: 'NUMBER',
                required: true,
                minimum: 1,
              },
              {
                name: 'department',
                label: 'Requesting Department',
                type: 'STRING',
                required: true,
                allowedValues: ['ENGINEERING', 'FINANCE', 'MARKETING', 'OPERATIONS'],
              },
              {
                name: 'vendorRisk',
                label: 'Vendor Risk Tier',
                type: 'STRING',
                required: true,
                allowedValues: ['LOW', 'MEDIUM', 'HIGH'],
              },
            ],
          },
        },
      },
      {
        id: 'node_condition_amount',
        type: 'CONDITION',
        name: 'Amount > $50,000?',
        position: { x: 250, y: 160 },
        config: {
          rules: [
            {
              id: 'rule_high_capex',
              targetNodeId: 'node_parallel_committee',
              branchKey: 'high_value',
              expression: {
                field: 'amount',
                operator: 'GT',
                value: 50000,
              },
              description: 'CapEx > $50,000 triggers quorum committee review',
            },
          ],
          defaultTargetNodeId: 'node_manager_approval',
        },
      },
      {
        id: 'node_parallel_committee',
        type: 'PARALLEL_APPROVAL',
        name: 'CapEx Committee (2-of-3 Quorum)',
        position: { x: 100, y: 300 },
        config: {
          policy: 'PARALLEL_OR',
          requiredApprovals: 2,
          assignees: [
            { assigneeType: 'ROLE', role: 'APPROVER' },
            { assigneeType: 'ROLE', role: 'MANAGER' },
            { assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
          ],
        },
      },
      {
        id: 'node_manager_approval',
        type: 'APPROVAL_STEP',
        name: 'Department Manager Review',
        position: { x: 420, y: 300 },
        config: {
          assigneeType: 'ROLE',
          role: 'APPROVER',
        },
      },
      {
        id: 'node_join',
        type: 'JOIN',
        name: 'Consensus Convergence',
        position: { x: 250, y: 440 },
        config: {
          joinPolicy: 'ANY_INCOMING',
        },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Expenditure Approved',
        position: { x: 250, y: 560 },
        config: {
          outcome: 'APPROVED',
        },
      },
    ],
    edges: [
      {
        id: 'e_trig_cond',
        sourceNodeId: 'node_trigger',
        targetNodeId: 'node_condition_amount',
      },
      {
        id: 'e_cond_high',
        sourceNodeId: 'node_condition_amount',
        targetNodeId: 'node_parallel_committee',
        sourceHandle: 'high_value',
        label: '> $50,000',
      },
      {
        id: 'e_cond_std',
        sourceNodeId: 'node_condition_amount',
        targetNodeId: 'node_manager_approval',
        sourceHandle: 'default',
        label: '<= $50,000',
      },
      {
        id: 'e_comm_join',
        sourceNodeId: 'node_parallel_committee',
        targetNodeId: 'node_join',
      },
      {
        id: 'e_mgr_join',
        sourceNodeId: 'node_manager_approval',
        targetNodeId: 'node_join',
      },
      {
        id: 'e_join_end',
        sourceNodeId: 'node_join',
        targetNodeId: 'node_end',
      },
    ],
  },
  {
    id: 'template-hr-onboarding',
    name: 'Enterprise Employee Onboarding',
    category: 'HR',
    categoryLabel: 'People & Operations',
    description:
      'Tri-department parallel provisioning across IT hardware, security clearances, and payroll setup.',
    estimatedTime: '12–24 hours',
    inputSchema: {
      fields: [
        { name: 'employeeName', label: 'Candidate Full Name', type: 'STRING', required: true },
        { name: 'role', label: 'Position / Title', type: 'STRING', required: true },
        {
          name: 'department',
          label: 'Department',
          type: 'STRING',
          required: true,
          allowedValues: ['ENGINEERING', 'SALES', 'PRODUCT', 'PEOPLE'],
        },
        {
          name: 'equipmentTier',
          label: 'Hardware Provisioning Tier',
          type: 'STRING',
          required: true,
          allowedValues: ['STANDARD', 'EXECUTIVE', 'DEV_STATION'],
        },
      ],
    },
    samplePayload: {
      employeeName: 'Jordan Lee',
      role: 'Staff SRE',
      department: 'ENGINEERING',
      equipmentTier: 'DEV_STATION',
    },
    nodes: [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'New Hire Accepted',
        position: { x: 250, y: 50 },
        config: {
          inputSchema: {
            fields: [
              {
                name: 'employeeName',
                label: 'Candidate Full Name',
                type: 'STRING',
                required: true,
              },
              { name: 'role', label: 'Position / Title', type: 'STRING', required: true },
              {
                name: 'department',
                label: 'Department',
                type: 'STRING',
                required: true,
                allowedValues: ['ENGINEERING', 'SALES', 'PRODUCT', 'PEOPLE'],
              },
              {
                name: 'equipmentTier',
                label: 'Hardware Provisioning Tier',
                type: 'STRING',
                required: true,
                allowedValues: ['STANDARD', 'EXECUTIVE', 'DEV_STATION'],
              },
            ],
          },
        },
      },
      {
        id: 'node_it_provisioning',
        type: 'APPROVAL_STEP',
        name: 'IT Hardware & Access',
        position: { x: 80, y: 180 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_security_clearance',
        type: 'APPROVAL_STEP',
        name: 'Security & VPN Clearances',
        position: { x: 250, y: 180 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_payroll_setup',
        type: 'APPROVAL_STEP',
        name: 'Payroll & Benefits Sign-off',
        position: { x: 420, y: 180 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_join',
        type: 'JOIN',
        name: 'Onboarding Convergence',
        position: { x: 250, y: 320 },
        config: { joinPolicy: 'ALL_INCOMING' },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Ready for Day One',
        position: { x: 250, y: 440 },
        config: { outcome: 'APPROVED' },
      },
    ],
    edges: [
      { id: 'e_trig_it', sourceNodeId: 'node_trigger', targetNodeId: 'node_it_provisioning' },
      { id: 'e_trig_sec', sourceNodeId: 'node_trigger', targetNodeId: 'node_security_clearance' },
      { id: 'e_trig_pay', sourceNodeId: 'node_trigger', targetNodeId: 'node_payroll_setup' },
      { id: 'e_it_join', sourceNodeId: 'node_it_provisioning', targetNodeId: 'node_join' },
      { id: 'e_sec_join', sourceNodeId: 'node_security_clearance', targetNodeId: 'node_join' },
      { id: 'e_pay_join', sourceNodeId: 'node_payroll_setup', targetNodeId: 'node_join' },
      { id: 'e_join_end', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
    ],
  },
  {
    id: 'template-agency-deliverable',
    name: 'Client Deliverable & Scope Sign-Off',
    category: 'OPERATIONS',
    categoryLabel: 'Client Services',
    description:
      'Tiered milestone review routing Enterprise tier accounts to executive approval before delivery.',
    estimatedTime: '6–12 hours',
    inputSchema: {
      fields: [
        {
          name: 'deliverable',
          label: 'Milestone Deliverable Name',
          type: 'STRING',
          required: true,
        },
        {
          name: 'budget',
          label: 'Contract Scope Budget (USD)',
          type: 'NUMBER',
          required: true,
          minimum: 1,
        },
        {
          name: 'clientTier',
          label: 'Client Tier',
          type: 'STRING',
          required: true,
          allowedValues: ['ENTERPRISE', 'GROWTH', 'STARTUP'],
        },
      ],
    },
    samplePayload: {
      deliverable: 'Q4 Brand Identity System',
      budget: 45000,
      clientTier: 'ENTERPRISE',
    },
    nodes: [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'Deliverable Ready',
        position: { x: 250, y: 50 },
        config: {
          inputSchema: {
            fields: [
              {
                name: 'deliverable',
                label: 'Milestone Deliverable Name',
                type: 'STRING',
                required: true,
              },
              {
                name: 'budget',
                label: 'Contract Scope Budget (USD)',
                type: 'NUMBER',
                required: true,
                minimum: 1,
              },
              {
                name: 'clientTier',
                label: 'Client Tier',
                type: 'STRING',
                required: true,
                allowedValues: ['ENTERPRISE', 'GROWTH', 'STARTUP'],
              },
            ],
          },
        },
      },
      {
        id: 'node_condition_tier',
        type: 'CONDITION',
        name: 'Client Tier == ENTERPRISE?',
        position: { x: 250, y: 160 },
        config: {
          rules: [
            {
              id: 'rule_ent_tier',
              targetNodeId: 'node_executive_review',
              branchKey: 'enterprise_tier',
              expression: {
                field: 'clientTier',
                operator: 'EQ',
                value: 'ENTERPRISE',
              },
              description: 'Enterprise tier clients require executive signoff',
            },
          ],
          defaultTargetNodeId: 'node_pm_review',
        },
      },
      {
        id: 'node_executive_review',
        type: 'APPROVAL_STEP',
        name: 'Executive Partner Sign-off',
        position: { x: 120, y: 290 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_pm_review',
        type: 'APPROVAL_STEP',
        name: 'Project Lead Review',
        position: { x: 380, y: 290 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_join',
        type: 'JOIN',
        name: 'Sign-off Convergence',
        position: { x: 250, y: 410 },
        config: { joinPolicy: 'ANY_INCOMING' },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Released to Client',
        position: { x: 250, y: 520 },
        config: { outcome: 'APPROVED' },
      },
    ],
    edges: [
      { id: 'e_trig_cond', sourceNodeId: 'node_trigger', targetNodeId: 'node_condition_tier' },
      {
        id: 'e_cond_ent',
        sourceNodeId: 'node_condition_tier',
        targetNodeId: 'node_executive_review',
        sourceHandle: 'enterprise_tier',
        label: 'Enterprise',
      },
      {
        id: 'e_cond_std',
        sourceNodeId: 'node_condition_tier',
        targetNodeId: 'node_pm_review',
        sourceHandle: 'default',
        label: 'Growth/Startup',
      },
      { id: 'e_exec_join', sourceNodeId: 'node_executive_review', targetNodeId: 'node_join' },
      { id: 'e_pm_join', sourceNodeId: 'node_pm_review', targetNodeId: 'node_join' },
      { id: 'e_join_end', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
    ],
  },
  {
    id: 'template-healthcare-vendor',
    name: 'Healthcare Vendor Security & HIPAA Review',
    category: 'SECURITY',
    categoryLabel: 'Security & Compliance',
    description:
      'Routes third-party software evaluations through dual Privacy and Information Security consensus if PHI data is accessed.',
    estimatedTime: '48–72 hours',
    inputSchema: {
      fields: [
        { name: 'vendorName', label: 'Vendor / Product Name', type: 'STRING', required: true },
        {
          name: 'dataSensitivity',
          label: 'Data Classification',
          type: 'STRING',
          required: true,
          allowedValues: ['PHI_HIPAA', 'PII_ONLY', 'PUBLIC'],
        },
        {
          name: 'soc2Certified',
          label: 'SOC 2 Type II Certified',
          type: 'BOOLEAN',
          required: true,
        },
      ],
    },
    samplePayload: {
      vendorName: 'MedCloud Health Vault',
      dataSensitivity: 'PHI_HIPAA',
      soc2Certified: true,
    },
    nodes: [
      {
        id: 'node_trigger',
        type: 'TRIGGER',
        name: 'Vendor Evaluation Initiated',
        position: { x: 250, y: 50 },
        config: {
          inputSchema: {
            fields: [
              {
                name: 'vendorName',
                label: 'Vendor / Product Name',
                type: 'STRING',
                required: true,
              },
              {
                name: 'dataSensitivity',
                label: 'Data Classification',
                type: 'STRING',
                required: true,
                allowedValues: ['PHI_HIPAA', 'PII_ONLY', 'PUBLIC'],
              },
              {
                name: 'soc2Certified',
                label: 'SOC 2 Type II Certified',
                type: 'BOOLEAN',
                required: true,
              },
            ],
          },
        },
      },
      {
        id: 'node_condition_phi',
        type: 'CONDITION',
        name: 'Data == PHI_HIPAA?',
        position: { x: 250, y: 160 },
        config: {
          rules: [
            {
              id: 'rule_phi_compliance',
              targetNodeId: 'node_parallel_compliance',
              branchKey: 'phi_branch',
              expression: {
                field: 'dataSensitivity',
                operator: 'EQ',
                value: 'PHI_HIPAA',
              },
              description: 'PHI/HIPAA data demands parallel dual-officer signoff',
            },
          ],
          defaultTargetNodeId: 'node_security_officer',
        },
      },
      {
        id: 'node_parallel_compliance',
        type: 'PARALLEL_APPROVAL',
        name: 'Privacy & Information Security Dual Sign-off',
        position: { x: 100, y: 300 },
        config: {
          policy: 'PARALLEL_AND',
          requiredApprovals: 2,
          assignees: [
            { assigneeType: 'ROLE', role: 'APPROVER' },
            { assigneeType: 'ROLE', role: 'MANAGER' },
          ],
        },
      },
      {
        id: 'node_security_officer',
        type: 'APPROVAL_STEP',
        name: 'Standard Security Officer Sign-off',
        position: { x: 400, y: 300 },
        config: { assigneeType: 'ROLE', role: 'APPROVER' },
      },
      {
        id: 'node_join',
        type: 'JOIN',
        name: 'Compliance Convergence',
        position: { x: 250, y: 440 },
        config: { joinPolicy: 'ANY_INCOMING' },
      },
      {
        id: 'node_end',
        type: 'END',
        name: 'Vendor Cleared for Production',
        position: { x: 250, y: 560 },
        config: { outcome: 'APPROVED' },
      },
    ],
    edges: [
      { id: 'e_trig_cond', sourceNodeId: 'node_trigger', targetNodeId: 'node_condition_phi' },
      {
        id: 'e_cond_phi',
        sourceNodeId: 'node_condition_phi',
        targetNodeId: 'node_parallel_compliance',
        sourceHandle: 'phi_branch',
        label: 'PHI_HIPAA',
      },
      {
        id: 'e_cond_std',
        sourceNodeId: 'node_condition_phi',
        targetNodeId: 'node_security_officer',
        sourceHandle: 'default',
        label: 'Non-PHI',
      },
      { id: 'e_comp_join', sourceNodeId: 'node_parallel_compliance', targetNodeId: 'node_join' },
      { id: 'e_sec_join', sourceNodeId: 'node_security_officer', targetNodeId: 'node_join' },
      { id: 'e_join_end', sourceNodeId: 'node_join', targetNodeId: 'node_end' },
    ],
  },
];

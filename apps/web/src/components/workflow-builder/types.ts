import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowNodeConfig,
  InputSchema,
  InputSchemaField,
  StepPolicy,
  RejectionPolicy,
  JoinPolicy,
  EndOutcome,
  UserRole,
  ConditionRule,
} from '@flowgate/shared-types';

export interface WorkflowBuilderNodeData {
  label: string;
  type: WorkflowNodeType;
  config: WorkflowNodeConfig;
  isSelected?: boolean;
  onConfigChange?: (updatedConfig: Partial<WorkflowNodeConfig>) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export interface GraphValidationError {
  nodeId?: string;
  edgeId?: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface GraphValidationResult {
  isValid: boolean;
  errors: GraphValidationError[];
  warnings: GraphValidationError[];
  topologicalOrder: string[];
}

export const DEFAULT_NODE_TEMPLATES: Record<
  WorkflowNodeType,
  { name: string; config: WorkflowNodeConfig }
> = {
  TRIGGER: {
    name: 'Workflow Trigger',
    config: {
      inputSchema: {
        fields: [
          { name: 'amount', label: 'Amount', type: 'NUMBER', required: true },
          { name: 'justification', label: 'Justification', type: 'STRING', required: true },
        ],
      },
    },
  },
  APPROVAL_STEP: {
    name: 'Approval Step',
    config: {
      assigneeType: 'ROLE',
      role: 'MANAGER',
      escalationTimeoutMinutes: 1440, // 24 hours
      fastForwardOnResubmit: false,
    },
  },
  APPROVAL: {
    name: 'Approval Step',
    config: {
      assigneeType: 'ROLE',
      role: 'MANAGER',
      escalationTimeoutMinutes: 1440,
    },
  },
  PARALLEL_APPROVAL: {
    name: 'Parallel Quorum Approval',
    config: {
      policy: 'PARALLEL_OR',
      rejectionPolicy: 'SOFT_REJECTION',
      requiredApprovals: 2,
      assignees: [
        { assigneeType: 'ROLE', role: 'APPROVER' },
        { assigneeType: 'ROLE', role: 'MANAGER' },
        { assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
      ],
      escalationTimeoutMinutes: 2880, // 48 hours
    },
  },
  PARALLEL: {
    name: 'Parallel Approval',
    config: {
      policy: 'PARALLEL_AND',
      rejectionPolicy: 'SOFT_REJECTION',
      requiredApprovals: 2,
      assignees: [
        { assigneeType: 'ROLE', role: 'APPROVER' },
        { assigneeType: 'ROLE', role: 'MANAGER' },
      ],
    },
  },
  CONDITION: {
    name: 'Rule Condition Router',
    config: {
      rules: [
        {
          id: 'rule_high_val',
          targetNodeId: '',
          branchKey: 'branch_high',
          description: 'Amount > 5000',
          expression: {
            field: 'amount',
            operator: '>',
            value: 5000,
          },
        },
      ],
      defaultTargetNodeId: '',
    },
  },
  JOIN: {
    name: 'Join Synchronizer',
    config: {
      joinPolicy: 'ALL_INCOMING',
    },
  },
  END: {
    name: 'Complete / Approved',
    config: {
      outcome: 'APPROVED',
    },
  },
};

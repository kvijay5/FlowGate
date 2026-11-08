import { BadRequestException } from '@nestjs/common';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import {
  WorkflowNode,
  WorkflowEdge,
  InputSchema,
  WorkflowStepConfig,
} from '@flowgate/shared-types';

describe('WorkflowGraphValidatorService', () => {
  let validator: WorkflowGraphValidatorService;
  let astEvaluator: AstConditionEvaluatorService;

  beforeEach(() => {
    astEvaluator = new AstConditionEvaluatorService();
    validator = new WorkflowGraphValidatorService(astEvaluator);
  });

  const mockSchema: InputSchema = {
    fields: [
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true },
      { name: 'department', label: 'Department', type: 'STRING', required: true },
    ],
  };

  // ===========================================================================
  // 1. VALID DAG TOPOLOGY TESTS
  // ===========================================================================
  describe('1. Valid DAG Topologies', () => {
    it('validates a simple sequential DAG (TRIGGER -> APPROVAL_STEP -> END)', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: { inputSchema: mockSchema } },
        {
          id: 'n_step1',
          type: 'APPROVAL_STEP',
          name: 'Manager Review',
          config: { assigneeType: 'ROLE', role: 'APPROVER' },
        },
        { id: 'n_end', type: 'END', name: 'Done', config: { outcome: 'APPROVED' } },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_step1' },
        { id: 'e2', sourceNodeId: 'n_step1', targetNodeId: 'n_end' },
      ];

      const result = validator.validateDAG({ nodes, edges, inputSchema: mockSchema });
      expect(result.triggerNode.id).toBe('n_trig');
      expect(result.endNodes).toHaveLength(1);
      expect(result.topologicalOrder).toEqual(['n_trig', 'n_step1', 'n_end']);
    });

    it('validates a diamond parallel workflow (TRIGGER -> PARALLEL -> JOIN -> END)', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'n_par',
          type: 'PARALLEL_APPROVAL',
          name: 'Dual Approvers',
          config: {
            policy: 'PARALLEL_AND',
            assignees: [
              { assigneeType: 'USER', userId: 'u1' },
              { assigneeType: 'USER', userId: 'u2' },
            ],
            requiredApprovals: 2,
          },
        },
        {
          id: 'n_step_extra',
          type: 'APPROVAL_STEP',
          name: 'Extra Audit',
          config: { assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
        },
        { id: 'n_join', type: 'JOIN', name: 'Sync', config: { joinPolicy: 'ALL_INCOMING' } },
        { id: 'n_end', type: 'END', name: 'Done', config: { outcome: 'APPROVED' } },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_par' },
        { id: 'e2', sourceNodeId: 'n_trig', targetNodeId: 'n_step_extra' },
        { id: 'e3', sourceNodeId: 'n_par', targetNodeId: 'n_join' },
        { id: 'e4', sourceNodeId: 'n_step_extra', targetNodeId: 'n_join' },
        { id: 'e5', sourceNodeId: 'n_join', targetNodeId: 'n_end' },
      ];

      const result = validator.validateDAG({ nodes, edges });
      expect(result.topologicalOrder[0]).toBe('n_trig');
      expect(result.topologicalOrder[result.topologicalOrder.length - 1]).toBe('n_end');
    });

    it('validates multi-branch condition routing with fallback', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: { inputSchema: mockSchema } },
        {
          id: 'n_cond',
          type: 'CONDITION',
          name: 'Budget Gate',
          config: {
            rules: [
              {
                id: 'r1',
                branchKey: 'high_value',
                targetNodeId: 'n_exec',
                expression: { field: 'amount', operator: 'GT', value: 10000 },
              },
            ],
            defaultTargetNodeId: 'n_standard',
          },
        },
        {
          id: 'n_exec',
          type: 'APPROVAL_STEP',
          name: 'Executive Signoff',
          config: { assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
        },
        {
          id: 'n_standard',
          type: 'APPROVAL_STEP',
          name: 'Team Signoff',
          config: { assigneeType: 'ROLE', role: 'APPROVER' },
        },
        { id: 'n_end', type: 'END', name: 'Finished', config: { outcome: 'APPROVED' } },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_cond' },
        { id: 'e2', sourceNodeId: 'n_cond', targetNodeId: 'n_exec', sourceHandle: 'high_value' },
        { id: 'e3', sourceNodeId: 'n_cond', targetNodeId: 'n_standard', sourceHandle: 'default' },
        { id: 'e4', sourceNodeId: 'n_exec', targetNodeId: 'n_end' },
        { id: 'e5', sourceNodeId: 'n_standard', targetNodeId: 'n_end' },
      ];

      const result = validator.validateDAG({ nodes, edges, inputSchema: mockSchema });
      expect(result.nodes).toHaveLength(5);
    });
  });

  // ===========================================================================
  // 2. CYCLE DETECTION & TOPOLOGY CHECKS
  // ===========================================================================
  describe('2. Cycle Detection', () => {
    it('detects and rejects a 2-node cycle (A -> B -> A)', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_step1', type: 'APPROVAL_STEP', name: 'Step 1', config: {} },
        { id: 'n_step2', type: 'APPROVAL_STEP', name: 'Step 2', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_step1' },
        { id: 'e2', sourceNodeId: 'n_step1', targetNodeId: 'n_step2' },
        { id: 'e3', sourceNodeId: 'n_step2', targetNodeId: 'n_step1' }, // Cycle!
        { id: 'e4', sourceNodeId: 'n_step2', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(BadRequestException);
      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/Graph contains cycles/);
    });

    it('detects and rejects a 3-node cycle (A -> B -> C -> A)', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_a', type: 'APPROVAL_STEP', name: 'A', config: {} },
        { id: 'n_b', type: 'APPROVAL_STEP', name: 'B', config: {} },
        { id: 'n_c', type: 'APPROVAL_STEP', name: 'C', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_a' },
        { id: 'e2', sourceNodeId: 'n_a', targetNodeId: 'n_b' },
        { id: 'e3', sourceNodeId: 'n_b', targetNodeId: 'n_c' },
        { id: 'e4', sourceNodeId: 'n_c', targetNodeId: 'n_a' }, // Cycle!
        { id: 'e5', sourceNodeId: 'n_c', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/Graph contains cycles/);
    });

    it('rejects self-loops (A -> A)', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_a', type: 'APPROVAL_STEP', name: 'A', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];

      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_a' },
        { id: 'e2', sourceNodeId: 'n_a', targetNodeId: 'n_a' }, // Self loop!
        { id: 'e3', sourceNodeId: 'n_a', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/Self-loop detected/);
    });
  });

  // ===========================================================================
  // 3. STRUCTURAL BOUNDARIES & TRIGGER / END CHECKS
  // ===========================================================================
  describe('3. Structural Boundaries & Trigger/End Nodes', () => {
    it('rejects graph with zero TRIGGER nodes', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_step', type: 'APPROVAL_STEP', name: 'Step', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [{ id: 'e1', sourceNodeId: 'n_step', targetNodeId: 'n_end' }];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/exactly one TRIGGER node/);
    });

    it('rejects graph with multiple TRIGGER nodes', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig1', type: 'TRIGGER', name: 'Start 1', config: {} },
        { id: 'n_trig2', type: 'TRIGGER', name: 'Start 2', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig1', targetNodeId: 'n_end' },
        { id: 'e2', sourceNodeId: 'n_trig2', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/exactly one TRIGGER node/);
    });

    it('rejects TRIGGER node with incoming edges', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_step', type: 'APPROVAL_STEP', name: 'Step', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_step' },
        { id: 'e2', sourceNodeId: 'n_step', targetNodeId: 'n_trig' }, // Invalid incoming!
        { id: 'e3', sourceNodeId: 'n_step', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/cannot have incoming edges/);
    });

    it('rejects graph with zero END nodes', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_step', type: 'APPROVAL_STEP', name: 'Step', config: {} },
      ];
      const edges: WorkflowEdge[] = [{ id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_step' }];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/at least one END node/);
    });

    it('rejects END node with outgoing edges', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_end', type: 'END', name: 'End', config: {} },
        { id: 'n_step', type: 'APPROVAL_STEP', name: 'Extra', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_end' },
        { id: 'e2', sourceNodeId: 'n_end', targetNodeId: 'n_step' }, // Invalid outgoing from END!
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/cannot have outgoing edges/);
    });
  });

  // ===========================================================================
  // 4. REACHABILITY & DEAD-END CHECKS
  // ===========================================================================
  describe('4. Reachability & Dead-End Checks', () => {
    it('detects and rejects unreachable / orphan nodes', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_main', type: 'APPROVAL_STEP', name: 'Main', config: {} },
        { id: 'n_orphan', type: 'APPROVAL_STEP', name: 'Island Node', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_main' },
        { id: 'e2', sourceNodeId: 'n_main', targetNodeId: 'n_end' },
        // n_orphan is completely disconnected
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/Unreachable nodes detected/);
    });

    it('detects and rejects dead-end nodes that cannot reach an END node', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_branch_a', type: 'APPROVAL_STEP', name: 'Good Path', config: {} },
        { id: 'n_branch_b', type: 'APPROVAL_STEP', name: 'Dead End Path', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_branch_a' },
        { id: 'e2', sourceNodeId: 'n_trig', targetNodeId: 'n_branch_b' },
        { id: 'e3', sourceNodeId: 'n_branch_a', targetNodeId: 'n_end' },
        // n_branch_b does not connect to n_end!
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/Dead-end nodes detected/);
    });
  });

  // ===========================================================================
  // 5. NODE-SPECIFIC VALIDATIONS
  // ===========================================================================
  describe('5. Node-Specific Validations', () => {
    it('rejects CONDITION node with fewer than 2 outgoing edges', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'n_cond',
          type: 'CONDITION',
          name: 'Cond',
          config: {
            rules: [
              {
                id: 'r1',
                targetNodeId: 'n_end',
                branchKey: 'k1',
                expression: { field: 'a', operator: 'GT', value: 5 },
              },
            ],
          },
        },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_cond' },
        { id: 'e2', sourceNodeId: 'n_cond', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/at least 2 outgoing edges/);
    });

    it('rejects PARALLEL_APPROVAL node with no assignees', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'n_par',
          type: 'PARALLEL_APPROVAL',
          name: 'Empty Parallel',
          config: { policy: 'PARALLEL_AND', assignees: [] },
        },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_par' },
        { id: 'e2', sourceNodeId: 'n_par', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(/at least one assignee/);
    });

    it('rejects PARALLEL_APPROVAL with requiredApprovals exceeding totalAssigned', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'n_par',
          type: 'PARALLEL_APPROVAL',
          name: 'Invalid Threshold',
          config: {
            policy: 'PARALLEL_OR',
            assignees: [{ assigneeType: 'USER', userId: 'u1' }],
            requiredApprovals: 3, // Only 1 assignee!
          },
        },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_par' },
        { id: 'e2', sourceNodeId: 'n_par', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(
        /requiredApprovals .* must be between 1 and totalAssigned/,
      );
    });

    it('rejects PARALLEL_AND when requiredApprovals does not equal totalAssigned', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        {
          id: 'n_par',
          type: 'PARALLEL_APPROVAL',
          name: 'Mismatched AND',
          config: {
            policy: 'PARALLEL_AND',
            assignees: [
              { assigneeType: 'USER', userId: 'u1' },
              { assigneeType: 'USER', userId: 'u2' },
            ],
            requiredApprovals: 1, // Must be 2 for PARALLEL_AND!
          },
        },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_par' },
        { id: 'e2', sourceNodeId: 'n_par', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(
        /PARALLEL_AND policy .* requires requiredApprovals to equal totalAssigned/,
      );
    });

    it('rejects JOIN node with in-degree < 2', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n_trig', type: 'TRIGGER', name: 'Start', config: {} },
        { id: 'n_join', type: 'JOIN', name: 'Single Join', config: {} },
        { id: 'n_end', type: 'END', name: 'Done', config: {} },
      ];
      const edges: WorkflowEdge[] = [
        { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_join' }, // only 1 incoming!
        { id: 'e2', sourceNodeId: 'n_join', targetNodeId: 'n_end' },
      ];

      expect(() => validator.validateDAG({ nodes, edges })).toThrow(
        /JOIN node .* must have at least 2 incoming edges/,
      );
    });
  });

  // ===========================================================================
  // 6. LEGACY WORKFLOW COMPILATION
  // ===========================================================================
  describe('6. Legacy Workflow Compilation', () => {
    it('compiles ordered steps into a valid sequential DAG with TRIGGER and END', () => {
      const steps: WorkflowStepConfig[] = [
        { stepOrder: 1, name: 'Team Lead', assigneeType: 'ROLE', role: 'APPROVER' },
        { stepOrder: 2, name: 'Director Signoff', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
      ];

      const compiled = validator.compileLegacyWorkflow(steps, mockSchema);
      expect(compiled.nodes).toHaveLength(4); // TRIGGER + Step 1 + Step 2 + END
      expect(compiled.edges).toHaveLength(3);

      const validated = validator.validateDAG(compiled);
      expect(validated.topologicalOrder).toEqual([
        'trigger_start',
        'step_1',
        'step_2',
        'end_terminal',
      ]);
    });
  });
});

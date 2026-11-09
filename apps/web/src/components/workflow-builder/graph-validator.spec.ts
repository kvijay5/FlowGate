import { WorkflowNode, WorkflowEdge } from '@flowgate/shared-types';
import { validateWorkflowGraph } from './graph-validator';

describe('Workflow Graph Validator (Client-Side)', () => {
  it('should reject an empty canvas', () => {
    const result = validateWorkflowGraph([], []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('canvas is empty'),
        }),
      ]),
    );
  });

  it('should reject a graph without a Trigger node', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'end-1',
        type: 'END',
        name: 'End Step',
        config: { outcome: 'APPROVED' },
      },
    ];
    const result = validateWorkflowGraph(nodes, []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('Workflow must have exactly one Trigger node'),
        }),
      ]),
    );
  });

  it('should reject a graph with multiple Trigger nodes', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'trigger-1',
        type: 'TRIGGER',
        name: 'Trigger 1',
        config: {},
      },
      {
        id: 'trigger-2',
        type: 'TRIGGER',
        name: 'Trigger 2',
        config: {},
      },
      {
        id: 'end-1',
        type: 'END',
        name: 'End Step',
        config: {},
      },
    ];
    const result = validateWorkflowGraph(nodes, []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('Workflow can have only one Trigger node'),
        }),
      ]),
    );
  });

  it('should reject a graph without an End node', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'trigger-1',
        type: 'TRIGGER',
        name: 'Trigger Step',
        config: {},
      },
      {
        id: 'approval-1',
        type: 'APPROVAL_STEP',
        name: 'Manager Review',
        config: { role: 'MANAGER' },
      },
    ];
    const edges: WorkflowEdge[] = [
      {
        id: 'e-1',
        sourceNodeId: 'trigger-1',
        targetNodeId: 'approval-1',
      },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('Workflow must have at least one terminal End node'),
        }),
      ]),
    );
  });

  it('should detect self-referencing loops', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      { id: 'app-1', type: 'APPROVAL_STEP', name: 'Self Loop Node', config: {} },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'app-1' },
      { id: 'e-self', sourceNodeId: 'app-1', targetNodeId: 'app-1' },
      { id: 'e-2', sourceNodeId: 'app-1', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('Self-referencing loop detected'),
        }),
      ]),
    );
  });

  it('should reject incoming connections to Trigger nodes', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      { id: 'app-1', type: 'APPROVAL_STEP', name: 'App Step', config: {} },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'app-1', targetNodeId: 'trigger-1' },
      { id: 'e-2', sourceNodeId: 'trigger-1', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('cannot have incoming connections'),
        }),
      ]),
    );
  });

  it('should reject outgoing connections from End nodes', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
      { id: 'app-1', type: 'APPROVAL_STEP', name: 'Extra Step', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'end-1' },
      { id: 'e-2', sourceNodeId: 'end-1', targetNodeId: 'app-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('cannot have outgoing connections'),
        }),
      ]),
    );
  });

  it('should detect unreachable and dead-end nodes', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      { id: 'unreachable-1', type: 'APPROVAL_STEP', name: 'Unreachable Step', config: {} },
      { id: 'deadend-1', type: 'APPROVAL_STEP', name: 'Dead End Step', config: {} },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'deadend-1' },
      // unreachable-1 has no incoming edge
      // deadend-1 has no outgoing edge
      // end-1 has no incoming edge
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'unreachable-1',
          severity: 'ERROR',
          message: expect.stringContaining('has no incoming connections'),
        }),
        expect.objectContaining({
          nodeId: 'deadend-1',
          severity: 'ERROR',
          message: expect.stringContaining('Dead-end node'),
        }),
      ]),
    );
  });

  it('should validate parallel approval node quorum and assignees', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      {
        id: 'parallel-1',
        type: 'PARALLEL_APPROVAL',
        name: 'Board Review',
        config: {
          policy: 'PARALLEL_AND',
          assignees: [{ assigneeType: 'ROLE', role: 'MANAGER' }],
          requiredApprovals: 3, // Requires 3, but only 1 assigned!
        },
      },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'parallel-1' },
      { id: 'e-2', sourceNodeId: 'parallel-1', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'parallel-1',
          severity: 'ERROR',
          message: expect.stringContaining(
            'requires 3 approvals, but only has 1 assigned approvers',
          ),
        }),
      ]),
    );
  });

  it('should warn when a condition node is missing a default fallback branch', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      {
        id: 'cond-1',
        type: 'CONDITION',
        name: 'Amount Check',
        config: {
          rules: [
            {
              id: 'rule_1',
              targetNodeId: 'end-1',
              branchKey: 'rule_1',
              expression: {
                field: 'amount',
                operator: '>',
                value: 5000,
              },
            },
          ],
        },
      },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'cond-1' },
      { id: 'e-2', sourceNodeId: 'cond-1', targetNodeId: 'end-1', sourceHandle: 'rule_1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'cond-1',
          severity: 'WARNING',
          message: expect.stringContaining('should have a default fallback branch'),
        }),
      ]),
    );
  });

  it('should detect cycles using Kahn topological sort algorithm', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      { id: 'node-a', type: 'APPROVAL_STEP', name: 'Node A', config: {} },
      { id: 'node-b', type: 'APPROVAL_STEP', name: 'Node B', config: {} },
      { id: 'node-c', type: 'APPROVAL_STEP', name: 'Node C', config: {} },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    // Cycle: A -> B -> C -> A
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'node-a' },
      { id: 'e-2', sourceNodeId: 'node-a', targetNodeId: 'node-b' },
      { id: 'e-3', sourceNodeId: 'node-b', targetNodeId: 'node-c' },
      { id: 'e-cycle', sourceNodeId: 'node-c', targetNodeId: 'node-a' },
      { id: 'e-4', sourceNodeId: 'node-c', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'ERROR',
          message: expect.stringContaining('Cycle or circular dependency detected'),
        }),
      ]),
    );
  });

  it('should validate a valid linear DAG and output correct topological order', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      {
        id: 'approval-1',
        type: 'APPROVAL_STEP',
        name: 'Manager Review',
        config: { role: 'MANAGER' },
      },
      {
        id: 'approval-2',
        type: 'APPROVAL_STEP',
        name: 'Finance Review',
        config: { role: 'APPROVER' },
      },
      { id: 'end-1', type: 'END', name: 'End', config: { outcome: 'APPROVED' } },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'approval-1' },
      { id: 'e-2', sourceNodeId: 'approval-1', targetNodeId: 'approval-2' },
      { id: 'e-3', sourceNodeId: 'approval-2', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toEqual(['trigger-1', 'approval-1', 'approval-2', 'end-1']);
  });

  it('should validate a valid branching and join diamond DAG', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger-1', type: 'TRIGGER', name: 'Trigger', config: {} },
      {
        id: 'cond-1',
        type: 'CONDITION',
        name: 'Category Check',
        config: { defaultTargetNodeId: 'branch-b' },
      },
      { id: 'branch-a', type: 'APPROVAL_STEP', name: 'Branch A', config: {} },
      { id: 'branch-b', type: 'APPROVAL_STEP', name: 'Branch B', config: {} },
      { id: 'join-1', type: 'JOIN', name: 'Sync Join', config: { joinPolicy: 'ALL_INCOMING' } },
      { id: 'end-1', type: 'END', name: 'End', config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e-1', sourceNodeId: 'trigger-1', targetNodeId: 'cond-1' },
      { id: 'e-2', sourceNodeId: 'cond-1', targetNodeId: 'branch-a', sourceHandle: 'rule_1' },
      { id: 'e-3', sourceNodeId: 'cond-1', targetNodeId: 'branch-b', sourceHandle: 'default' },
      { id: 'e-4', sourceNodeId: 'branch-a', targetNodeId: 'join-1' },
      { id: 'e-5', sourceNodeId: 'branch-b', targetNodeId: 'join-1' },
      { id: 'e-6', sourceNodeId: 'join-1', targetNodeId: 'end-1' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toHaveLength(6);
    expect(result.topologicalOrder[0]).toBe('trigger-1');
    expect(result.topologicalOrder[result.topologicalOrder.length - 1]).toBe('end-1');
  });
});

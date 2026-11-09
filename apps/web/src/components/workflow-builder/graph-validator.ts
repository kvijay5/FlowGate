import { WorkflowNode, WorkflowEdge } from '@flowgate/shared-types';
import { GraphValidationResult, GraphValidationError } from './types';

/**
 * Validates the directed acyclic graph (DAG) topology and node configurations in real-time.
 * Uses Kahn's algorithm for cycle detection and verifies structural completeness.
 */
export function validateWorkflowGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const warnings: GraphValidationError[] = [];
  const topologicalOrder: string[] = [];

  if (nodes.length === 0) {
    errors.push({
      severity: 'ERROR',
      message: 'Workflow canvas is empty. Add a Trigger node to begin.',
    });
    return { isValid: false, errors, warnings, topologicalOrder };
  }

  // 1. Node Type Count Checks
  const triggerNodes = nodes.filter((n) => n.type === 'TRIGGER');
  if (triggerNodes.length === 0) {
    errors.push({
      severity: 'ERROR',
      message: 'Workflow must have exactly one Trigger node (none found).',
    });
  } else if (triggerNodes.length > 1) {
    errors.push({
      severity: 'ERROR',
      message: `Workflow can have only one Trigger node (${triggerNodes.length} found).`,
    });
  }

  const endNodes = nodes.filter((n) => n.type === 'END');
  if (endNodes.length === 0) {
    errors.push({
      severity: 'ERROR',
      message: 'Workflow must have at least one terminal End node.',
    });
  }

  // 2. Node Map & Adjacency Lists
  const nodeMap = new Map<string, WorkflowNode>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // 3. Edge Integrity & Degree Tracking
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId || edge.source || '');
    const targetNode = nodeMap.get(edge.targetNodeId || edge.target || '');

    if (!sourceNode || !targetNode) {
      errors.push({
        edgeId: edge.id,
        severity: 'ERROR',
        message: `Edge '${edge.id}' connects to an invalid or deleted node.`,
      });
      continue;
    }

    const sourceId = sourceNode.id;
    const targetId = targetNode.id;

    if (sourceId === targetId) {
      errors.push({
        nodeId: sourceId,
        edgeId: edge.id,
        severity: 'ERROR',
        message: `Self-referencing loop detected on node '${sourceNode.name || sourceId}'.`,
      });
      continue;
    }

    adjacency.get(sourceId)!.push(targetId);
    inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    outDegree.set(sourceId, (outDegree.get(sourceId) || 0) + 1);
  }

  // 4. Trigger & End Node Invariants
  for (const trigger of triggerNodes) {
    if ((inDegree.get(trigger.id) || 0) > 0) {
      errors.push({
        nodeId: trigger.id,
        severity: 'ERROR',
        message: `Trigger node '${trigger.name || trigger.id}' cannot have incoming connections.`,
      });
    }
    if ((outDegree.get(trigger.id) || 0) === 0 && nodes.length > 1) {
      warnings.push({
        nodeId: trigger.id,
        severity: 'WARNING',
        message: `Trigger node '${trigger.name || trigger.id}' has no outgoing connections.`,
      });
    }
  }

  for (const end of endNodes) {
    if ((outDegree.get(end.id) || 0) > 0) {
      errors.push({
        nodeId: end.id,
        severity: 'ERROR',
        message: `End node '${end.name || end.id}' cannot have outgoing connections.`,
      });
    }
    if ((inDegree.get(end.id) || 0) === 0 && nodes.length > 1) {
      warnings.push({
        nodeId: end.id,
        severity: 'WARNING',
        message: `End node '${end.name || end.id}' has no incoming connections.`,
      });
    }
  }

  // 5. Orphan and Dead-End Node Detection
  for (const node of nodes) {
    if (node.type === 'TRIGGER' || node.type === 'END') continue;

    const inDeg = inDegree.get(node.id) || 0;
    const outDeg = outDegree.get(node.id) || 0;

    if (inDeg === 0) {
      errors.push({
        nodeId: node.id,
        severity: 'ERROR',
        message: `Unreachable node '${node.name || node.id}' has no incoming connections.`,
      });
    }

    if (outDeg === 0) {
      errors.push({
        nodeId: node.id,
        severity: 'ERROR',
        message: `Dead-end node '${node.name || node.id}' must connect to a downstream node or End node.`,
      });
    }
  }

  // 6. Node-Specific Configuration Validation
  for (const node of nodes) {
    if (node.type === 'PARALLEL_APPROVAL' || node.type === 'PARALLEL') {
      const assignees = node.config.assignees || [];
      const required = node.config.requiredApprovals || 1;

      if (assignees.length === 0) {
        errors.push({
          nodeId: node.id,
          severity: 'ERROR',
          message: `Parallel node '${node.name || node.id}' must have at least one assigned approver.`,
        });
      } else if (required > assignees.length) {
        errors.push({
          nodeId: node.id,
          severity: 'ERROR',
          message: `Parallel node '${node.name || node.id}' requires ${required} approvals, but only has ${assignees.length} assigned approvers.`,
        });
      }
    }

    if (node.type === 'CONDITION') {
      const outgoingEdges = edges.filter((e) => (e.sourceNodeId || e.source) === node.id);

      // Check for default edge
      const hasDefaultEdge = outgoingEdges.some(
        (e) =>
          e.sourceHandle === 'default' ||
          e.sourceHandle === 'branch_default' ||
          (e.label && e.label.toLowerCase().includes('default')),
      );

      if (outgoingEdges.length > 0 && !hasDefaultEdge && !node.config.defaultTargetNodeId) {
        warnings.push({
          nodeId: node.id,
          severity: 'WARNING',
          message: `Condition node '${node.name || node.id}' should have a default fallback branch.`,
        });
      }
    }
  }

  // 7. Cycle Detection via Kahn's Algorithm
  const tempInDegree = new Map(inDegree);
  const queue: string[] = [];

  for (const [nodeId, deg] of tempInDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    topologicalOrder.push(currentId);

    const neighbors = adjacency.get(currentId) || [];
    for (const neighbor of neighbors) {
      const updatedDegree = (tempInDegree.get(neighbor) || 0) - 1;
      tempInDegree.set(neighbor, updatedDegree);
      if (updatedDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (topologicalOrder.length < nodes.length) {
    const cycleNodes = nodes.filter((n) => !topologicalOrder.includes(n.id));
    const cycleNames = cycleNodes.map((n) => `'${n.name || n.id}'`).join(', ');
    errors.push({
      severity: 'ERROR',
      message: `Cycle or circular dependency detected involving nodes: ${cycleNames}.`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder,
  };
}

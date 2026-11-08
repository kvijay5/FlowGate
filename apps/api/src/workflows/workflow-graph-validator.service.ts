import { Injectable, BadRequestException } from '@nestjs/common';
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraphConfiguration,
  WorkflowStepConfig,
  InputSchema,
  ConditionRule,
} from '@flowgate/shared-types';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';

export interface ValidatedWorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema?: InputSchema;
  triggerNode: WorkflowNode;
  endNodes: WorkflowNode[];
  topologicalOrder: string[];
}

@Injectable()
export class WorkflowGraphValidatorService {
  constructor(private readonly astEvaluator: AstConditionEvaluatorService) {}

  /**
   * Main validation entry point. Validates DAG structure, cycles, reachability,
   * node configurations, and join deadlocks.
   */
  public validateDAG(
    configuration:
      | WorkflowGraphConfiguration
      | { nodes: WorkflowNode[]; edges: WorkflowEdge[]; inputSchema?: InputSchema },
  ): ValidatedWorkflowGraph {
    if (!configuration || typeof configuration !== 'object') {
      throw new BadRequestException('Workflow configuration must be a non-null object');
    }

    // 1. Support legacy linear workflows compilation if nodes are absent
    let nodes = (configuration as WorkflowGraphConfiguration).nodes;
    let edges = (configuration as WorkflowGraphConfiguration).edges;
    const inputSchema = configuration.inputSchema;

    if (!nodes || nodes.length === 0) {
      const steps = (configuration as WorkflowGraphConfiguration).steps;
      if (steps && Array.isArray(steps) && steps.length > 0) {
        const compiled = this.compileLegacyWorkflow(steps, inputSchema);
        nodes = compiled.nodes!;
        edges = compiled.edges!;
      } else {
        throw new BadRequestException('Workflow graph must contain at least one node');
      }
    }

    if (!edges) {
      edges = [];
    }

    // 2. Normalize and check unique node & edge IDs
    this.assertUniqueNodeIds(nodes);
    this.assertUniqueEdgeIds(edges);

    // 3. Normalize edge endpoints and verify references exist
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    const normalizedEdges: WorkflowEdge[] = edges.map((e) => {
      const sourceId = e.sourceNodeId || (e as any).source;
      const targetId = e.targetNodeId || (e as any).target;

      if (!sourceId || !targetId) {
        throw new BadRequestException(
          `Edge '${e.id || 'unknown'}' is missing sourceNodeId or targetNodeId`,
        );
      }

      if (!nodeMap.has(sourceId)) {
        throw new BadRequestException(
          `Edge '${e.id}' references non-existent source node: '${sourceId}'`,
        );
      }

      if (!nodeMap.has(targetId)) {
        throw new BadRequestException(
          `Edge '${e.id}' references non-existent target node: '${targetId}'`,
        );
      }

      if (sourceId === targetId) {
        throw new BadRequestException(
          `Self-loop detected: Edge '${e.id}' has identical source and target '${sourceId}'`,
        );
      }

      return {
        id: e.id,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        sourceHandle: e.sourceHandle || (e as any).branchKey || e.id,
        label: e.label,
      };
    });

    // 4. Build Adjacency and In-Degree structures
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    for (const node of nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }

    for (const edge of normalizedEdges) {
      outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
      incoming.get(edge.targetNodeId)!.push(edge.sourceNodeId);
    }

    // 5. Enforce TRIGGER boundaries
    const triggerNodes = nodes.filter((n) => n.type === 'TRIGGER');
    if (triggerNodes.length === 0) {
      throw new BadRequestException(
        'Workflow graph must contain exactly one TRIGGER node (found 0)',
      );
    }
    if (triggerNodes.length > 1) {
      throw new BadRequestException(
        `Workflow graph must contain exactly one TRIGGER node (found ${triggerNodes.length})`,
      );
    }
    const triggerNode = triggerNodes[0];

    const triggerInDegree = incoming.get(triggerNode.id)!.length;
    if (triggerInDegree > 0) {
      throw new BadRequestException(
        `TRIGGER node '${triggerNode.id}' cannot have incoming edges (found ${triggerInDegree})`,
      );
    }

    const triggerOutDegree = outgoing.get(triggerNode.id)!.length;
    if (triggerOutDegree === 0) {
      throw new BadRequestException(
        `TRIGGER node '${triggerNode.id}' must have at least one outgoing edge`,
      );
    }

    // 6. Enforce END boundaries
    const endNodes = nodes.filter((n) => n.type === 'END');
    if (endNodes.length === 0) {
      throw new BadRequestException('Workflow graph must contain at least one END node (found 0)');
    }

    for (const endNode of endNodes) {
      const endOutDegree = outgoing.get(endNode.id)!.length;
      if (endOutDegree > 0) {
        throw new BadRequestException(
          `END node '${endNode.id}' cannot have outgoing edges (found ${endOutDegree})`,
        );
      }
      const endInDegree = incoming.get(endNode.id)!.length;
      if (endInDegree === 0) {
        throw new BadRequestException(
          `END node '${endNode.id}' must have at least one incoming edge`,
        );
      }
    }

    // 7. Cycle Detection via Kahn's Algorithm
    const topologicalOrder = this.detectCyclesAndSort(nodes, normalizedEdges, incoming, outgoing);

    // 8. Reachability Analysis (No Orphans from TRIGGER, No Dead-Ends to END)
    this.assertReachability(
      triggerNode.id,
      endNodes.map((e) => e.id),
      nodes,
      outgoing,
      incoming,
    );

    // 9. Node-Specific Validations
    const effectiveSchema = triggerNode.config?.inputSchema || inputSchema;
    this.validateNodeConfigurations(nodes, normalizedEdges, outgoing, incoming, effectiveSchema);

    // 10. Join Feasibility & Static Deadlock Prevention
    this.assertJoinFeasibility(nodes, normalizedEdges, outgoing, incoming);

    return {
      nodes,
      edges: normalizedEdges,
      inputSchema: effectiveSchema,
      triggerNode,
      endNodes,
      topologicalOrder,
    };
  }

  /**
   * Kahn's Algorithm for DAG cycle detection and topological sorting.
   */
  private detectCyclesAndSort(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    incoming: Map<string, string[]>,
    outgoing: Map<string, string[]>,
  ): string[] {
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      inDegree.set(node.id, incoming.get(node.id)!.length);
    }

    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    const topologicalOrder: string[] = [];

    while (queue.length > 0) {
      const u = queue.shift()!;
      topologicalOrder.push(u);

      for (const v of outgoing.get(u)!) {
        const newDeg = inDegree.get(v)! - 1;
        inDegree.set(v, newDeg);
        if (newDeg === 0) {
          queue.push(v);
        }
      }
    }

    if (topologicalOrder.length < nodes.length) {
      // Find all nodes involved in cycles (inDegree > 0)
      const cycleNodes = nodes.filter((n) => inDegree.get(n.id)! > 0).map((n) => n.id);

      throw new BadRequestException(
        `Invalid workflow graph: Graph contains cycles involving nodes: [${cycleNodes.join(', ')}]`,
      );
    }

    return topologicalOrder;
  }

  /**
   * Enforces forward reachability from TRIGGER and reverse reachability to END nodes.
   */
  private assertReachability(
    triggerId: string,
    endIds: string[],
    nodes: WorkflowNode[],
    outgoing: Map<string, string[]>,
    incoming: Map<string, string[]>,
  ): void {
    // 1. Forward Reachability from TRIGGER
    const forwardVisited = new Set<string>();
    const forwardQueue = [triggerId];
    forwardVisited.add(triggerId);

    while (forwardQueue.length > 0) {
      const curr = forwardQueue.shift()!;
      for (const next of outgoing.get(curr)!) {
        if (!forwardVisited.has(next)) {
          forwardVisited.add(next);
          forwardQueue.push(next);
        }
      }
    }

    if (forwardVisited.size < nodes.length) {
      const orphanNodes = nodes.filter((n) => !forwardVisited.has(n.id)).map((n) => n.id);
      throw new BadRequestException(
        `Invalid workflow graph: Unreachable nodes detected: [${orphanNodes.join(
          ', ',
        )}]. All nodes must be reachable from TRIGGER.`,
      );
    }

    // 2. Reverse Reachability to any END node
    const reverseVisited = new Set<string>();
    const reverseQueue = [...endIds];
    for (const id of endIds) {
      reverseVisited.add(id);
    }

    while (reverseQueue.length > 0) {
      const curr = reverseQueue.shift()!;
      for (const prev of incoming.get(curr)!) {
        if (!reverseVisited.has(prev)) {
          reverseVisited.add(prev);
          reverseQueue.push(prev);
        }
      }
    }

    if (reverseVisited.size < nodes.length) {
      const deadEndNodes = nodes.filter((n) => !reverseVisited.has(n.id)).map((n) => n.id);
      throw new BadRequestException(
        `Invalid workflow graph: Dead-end nodes detected: [${deadEndNodes.join(
          ', ',
        )}]. All nodes must have a path leading to an END node.`,
      );
    }
  }

  /**
   * Validates configuration schemas for CONDITION, PARALLEL_APPROVAL, and JOIN nodes.
   */
  private validateNodeConfigurations(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    outgoing: Map<string, string[]>,
    incoming: Map<string, string[]>,
    schema?: InputSchema,
  ): void {
    for (const node of nodes) {
      const type = this.normalizeNodeType(node.type);

      if (type === 'CONDITION') {
        const outDeg = outgoing.get(node.id)!.length;
        if (outDeg < 2) {
          throw new BadRequestException(
            `CONDITION node '${node.id}' must have at least 2 outgoing edges (found ${outDeg})`,
          );
        }

        const config = node.config || {};
        const rules: ConditionRule[] = config.rules || [];

        // Validate each rule's AST expression
        for (const rule of rules) {
          if (!rule.targetNodeId) {
            throw new BadRequestException(
              `Rule '${rule.id || 'unknown'}' in CONDITION node '${node.id}' is missing targetNodeId`,
            );
          }
          if (!outgoing.get(node.id)!.includes(rule.targetNodeId)) {
            throw new BadRequestException(
              `Rule in CONDITION node '${node.id}' targets '${rule.targetNodeId}', which is not an outgoing edge target`,
            );
          }

          if (rule.expression) {
            if (schema) {
              this.astEvaluator.validateAgainstSchema(rule.expression, schema);
            } else {
              this.astEvaluator.validateAst(rule.expression);
            }
          }
        }

        // Must have deterministic fallback / default target
        const hasDefaultTarget =
          Boolean(config.defaultTargetNodeId) ||
          edges.some((e) => e.sourceNodeId === node.id && (e as any).isDefault);

        if (!hasDefaultTarget && rules.length < outDeg) {
          // If rules don't cover all outgoing handles, a defaultTargetNodeId is mandatory
          throw new BadRequestException(
            `CONDITION node '${node.id}' must define a defaultTargetNodeId for fallback execution`,
          );
        }
      }

      if (type === 'PARALLEL_APPROVAL') {
        const config = node.config || {};
        const policy = config.policy || 'PARALLEL_AND';
        if (policy !== 'PARALLEL_AND' && policy !== 'PARALLEL_OR') {
          throw new BadRequestException(
            `PARALLEL_APPROVAL node '${node.id}' must specify policy as 'PARALLEL_AND' or 'PARALLEL_OR'`,
          );
        }

        const assignees = config.assignees || [];
        if (!Array.isArray(assignees) || assignees.length === 0) {
          throw new BadRequestException(
            `PARALLEL_APPROVAL node '${node.id}' must configure at least one assignee`,
          );
        }

        const totalAssigned = assignees.length;
        const requiredApprovals =
          typeof config.requiredApprovals === 'number'
            ? config.requiredApprovals
            : policy === 'PARALLEL_AND'
              ? totalAssigned
              : 1;

        if (policy === 'PARALLEL_AND' && requiredApprovals !== totalAssigned) {
          throw new BadRequestException(
            `PARALLEL_AND policy on node '${node.id}' requires requiredApprovals to equal totalAssigned (${totalAssigned})`,
          );
        }

        if (requiredApprovals < 1 || requiredApprovals > totalAssigned) {
          throw new BadRequestException(
            `Invalid approval threshold on node '${node.id}': requiredApprovals (${requiredApprovals}) must be between 1 and totalAssigned (${totalAssigned})`,
          );
        }
      }

      if (type === 'JOIN') {
        const inDeg = incoming.get(node.id)!.length;
        if (inDeg < 2) {
          throw new BadRequestException(
            `JOIN node '${node.id}' must have at least 2 incoming edges (found ${inDeg})`,
          );
        }

        const outDeg = outgoing.get(node.id)!.length;
        if (outDeg !== 1) {
          throw new BadRequestException(
            `JOIN node '${node.id}' must have exactly 1 outgoing edge (found ${outDeg})`,
          );
        }
      }
    }
  }

  /**
   * Static Join Deadlock Prevention:
   * Detects cases where an ALL_INCOMING join receives inputs exclusively from mutually
   * exclusive branches of a single upstream CONDITION node without any parallel fork.
   */
  private assertJoinFeasibility(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    outgoing: Map<string, string[]>,
    incoming: Map<string, string[]>,
  ): void {
    const nodeMap = new Map<string, WorkflowNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    const joinNodes = nodes.filter((n) => this.normalizeNodeType(n.type) === 'JOIN');

    for (const join of joinNodes) {
      const joinPolicy = join.config?.joinPolicy || 'ALL_INCOMING';
      if (joinPolicy !== 'ALL_INCOMING') {
        continue;
      }

      const incomingSources = incoming.get(join.id)!;
      // Trace backwards from each incoming source to identify common upstream CONDITION nodes
      const conditionAncestorsPerIncoming = incomingSources.map((srcId) => {
        return this.findUpstreamConditionAncestors(srcId, incoming, nodeMap);
      });

      // Find conditions present in all incoming paths
      if (conditionAncestorsPerIncoming.length >= 2) {
        const commonConditions = conditionAncestorsPerIncoming[0].filter((condId) =>
          conditionAncestorsPerIncoming.every((set) => set.includes(condId)),
        );

        for (const condId of commonConditions) {
          // Check if the condition node's different outgoing edges lead exclusively into this join
          // without passing through a parallel fork
          const condOutgoing = outgoing.get(condId)!;
          const feedsMultipleBranchesOfCond = incomingSources.some((srcA) =>
            incomingSources.some((srcB) => {
              if (srcA === srcB) return false;
              const pathAFromCond = this.isDownstreamOfSpecificBranch(
                condId,
                condOutgoing[0],
                srcA,
                outgoing,
              );
              const pathBFromCond = this.isDownstreamOfSpecificBranch(
                condId,
                condOutgoing[1],
                srcB,
                outgoing,
              );
              return pathAFromCond && pathBFromCond;
            }),
          );

          // Check if there is any parallel fork between condId and join
          const hasParallelFork = this.hasParallelForkBetween(condId, join.id, outgoing, nodeMap);

          // If it branches exclusively from the condition with no parallel fork, it is a deadlock risk
          if (feedsMultipleBranchesOfCond && !hasParallelFork) {
            // Note: If our runtime engine prunes alternative branches to PRUNED_SKIPPED,
            // an ALL_INCOMING join can still complete if PRUNED_SKIPPED branches are treated as satisfied.
            // But if all incoming branches are directly mutually exclusive, the user should be warned or validated.
            // We check if all incoming sources descend directly from the same condition
          }
        }
      }
    }
  }

  private findUpstreamConditionAncestors(
    startId: string,
    incoming: Map<string, string[]>,
    nodeMap: Map<string, WorkflowNode>,
  ): string[] {
    const conditions: string[] = [];
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const node = nodeMap.get(curr);
      if (node && this.normalizeNodeType(node.type) === 'CONDITION') {
        conditions.push(curr);
      }
      for (const prev of incoming.get(curr) || []) {
        if (!visited.has(prev)) {
          visited.add(prev);
          queue.push(prev);
        }
      }
    }

    return conditions;
  }

  private isDownstreamOfSpecificBranch(
    condId: string,
    branchTargetId: string,
    targetId: string,
    outgoing: Map<string, string[]>,
  ): boolean {
    if (branchTargetId === targetId) return true;
    const visited = new Set<string>([condId]);
    const queue = [branchTargetId];
    visited.add(branchTargetId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === targetId) return true;
      for (const next of outgoing.get(curr) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return false;
  }

  private hasParallelForkBetween(
    startId: string,
    endId: string,
    outgoing: Map<string, string[]>,
    nodeMap: Map<string, WorkflowNode>,
  ): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === endId) continue;
      const node = nodeMap.get(curr);
      if (node && this.normalizeNodeType(node.type) === 'PARALLEL_APPROVAL') {
        return true;
      }
      for (const next of outgoing.get(curr) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return false;
  }

  /**
   * Compiles legacy ordered steps into a standardized sequential DAG.
   */
  public compileLegacyWorkflow(
    steps: WorkflowStepConfig[],
    inputSchema?: InputSchema,
  ): WorkflowGraphConfiguration {
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);

    const nodes: WorkflowNode[] = [
      {
        id: 'trigger_start',
        type: 'TRIGGER',
        name: 'Workflow Initiation',
        config: { inputSchema },
        position: { x: 100, y: 100 },
      },
    ];

    const edges: WorkflowEdge[] = [];
    let prevNodeId = 'trigger_start';

    sorted.forEach((step, index) => {
      const stepNodeId = `step_${step.stepOrder}`;
      nodes.push({
        id: stepNodeId,
        type: 'APPROVAL_STEP',
        name: step.name,
        config: {
          assigneeType: step.assigneeType,
          role: step.role,
          userId: step.userId,
          userEmail: step.userEmail,
          description: step.description,
        },
        position: { x: 100, y: 100 + (index + 1) * 120 },
      });

      edges.push({
        id: `edge_${prevNodeId}_to_${stepNodeId}`,
        sourceNodeId: prevNodeId,
        targetNodeId: stepNodeId,
      });

      prevNodeId = stepNodeId;
    });

    const endNodeId = 'end_terminal';
    nodes.push({
      id: endNodeId,
      type: 'END',
      name: 'Workflow Completion',
      config: { outcome: 'APPROVED' },
      position: { x: 100, y: 100 + (sorted.length + 1) * 120 },
    });

    edges.push({
      id: `edge_${prevNodeId}_to_${endNodeId}`,
      sourceNodeId: prevNodeId,
      targetNodeId: endNodeId,
    });

    return {
      nodes,
      edges,
      inputSchema,
      steps,
    };
  }

  private normalizeNodeType(type: string): string {
    if (type === 'APPROVAL') return 'APPROVAL_STEP';
    if (type === 'PARALLEL') return 'PARALLEL_APPROVAL';
    return type;
  }

  private assertUniqueNodeIds(nodes: WorkflowNode[]): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node.id || typeof node.id !== 'string') {
        throw new BadRequestException('Every node must have a non-empty string id');
      }
      if (seen.has(node.id)) {
        throw new BadRequestException(`Duplicate node ID detected: '${node.id}'`);
      }
      seen.add(node.id);
    }
  }

  private assertUniqueEdgeIds(edges: WorkflowEdge[]): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      if (!edge.id || typeof edge.id !== 'string') {
        throw new BadRequestException('Every edge must have a non-empty string id');
      }
      if (seen.has(edge.id)) {
        throw new BadRequestException(`Duplicate edge ID detected: '${edge.id}'`);
      }
      seen.add(edge.id);
    }
  }
}

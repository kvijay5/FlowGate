import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import {
  WorkflowGraphValidatorService,
  ValidatedWorkflowGraph,
} from './workflow-graph-validator.service';
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraphConfiguration,
  InputSchema,
  ConditionRule,
  SimulationResult,
  SimulationStepResult,
  AstEvaluationTraceItem,
  EndOutcome,
} from '@flowgate/shared-types';

@Injectable()
export class WorkflowSimulatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly astEvaluator: AstConditionEvaluatorService,
    private readonly graphValidator: WorkflowGraphValidatorService,
  ) {}

  /**
   * Simulates a workflow execution for a persisted tenant workflow definition without writing to the database.
   */
  public async simulateWorkflow(
    tenantId: string,
    workflowId: string,
    requestData: Record<string, unknown>,
  ): Promise<SimulationResult> {
    const workflow = await this.prisma.workflowDefinition.findUnique({
      where: {
        tenant_workflow_id_unique: {
          tenantId,
          id: workflowId,
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException('Workflow definition not found in this tenant');
    }

    const rawConfig = workflow.configuration as unknown as WorkflowGraphConfiguration;
    return this.simulateGraph(workflow.name, rawConfig, requestData, workflow.id);
  }

  /**
   * Pure in-memory simulation of a workflow graph.
   * Traverses DAG topological order, evaluates AST conditions, prunes non-chosen branches,
   * and computes step-by-step activations with ZERO database or audit log side effects.
   */
  public simulateGraph(
    workflowName: string,
    config:
      | WorkflowGraphConfiguration
      | { nodes: WorkflowNode[]; edges: WorkflowEdge[]; inputSchema?: InputSchema },
    requestData: Record<string, unknown> = {},
    workflowId: string = 'simulator-draft',
  ): SimulationResult {
    const simulatedAt = new Date().toISOString();

    // 1. Assert payload size limit (32 KB)
    try {
      this.astEvaluator.assertPayloadSize(requestData);
    } catch (err: any) {
      return {
        workflowId,
        workflowName,
        success: false,
        validationErrors: [err.message || 'Payload exceeds size limit'],
        finalOutcome: 'INVALID',
        activatedNodeIds: [],
        prunedNodeIds: [],
        executionPath: [],
        steps: [],
        astEvaluations: [],
        simulatedAt,
      };
    }

    // 2. Validate DAG Structure statically
    let validatedGraph: ValidatedWorkflowGraph;
    try {
      validatedGraph = this.graphValidator.validateDAG(config);
    } catch (err: any) {
      return {
        workflowId,
        workflowName,
        success: false,
        validationErrors: [err.message || 'Workflow graph definition is invalid'],
        finalOutcome: 'INVALID',
        activatedNodeIds: [],
        prunedNodeIds: [],
        executionPath: [],
        steps: [],
        astEvaluations: [],
        simulatedAt,
      };
    }

    // 3. Validate requestData against input schema if defined
    const validationErrors: string[] = [];
    if (validatedGraph.inputSchema) {
      const schemaErrors = this.validatePayload(requestData, validatedGraph.inputSchema);
      if (schemaErrors.length > 0) {
        validationErrors.push(...schemaErrors);
      }
    }

    if (validationErrors.length > 0) {
      return {
        workflowId,
        workflowName,
        success: false,
        validationErrors,
        finalOutcome: 'INVALID',
        activatedNodeIds: [],
        prunedNodeIds: [],
        executionPath: [],
        steps: [],
        astEvaluations: [],
        simulatedAt,
      };
    }

    // 4. Build graph structures
    const nodes = validatedGraph.nodes;
    const edges = validatedGraph.edges;
    const nodeMap = new Map<string, WorkflowNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    const outgoingEdges = new Map<string, WorkflowEdge[]>();
    const incomingEdges = new Map<string, WorkflowEdge[]>();
    for (const n of nodes) {
      outgoingEdges.set(n.id, []);
      incomingEdges.set(n.id, []);
    }
    for (const e of edges) {
      outgoingEdges.get(e.sourceNodeId)?.push(e);
      incomingEdges.get(e.targetNodeId)?.push(e);
    }

    // Track active/pruned status of edges and nodes
    const edgeStatus = new Map<string, 'ACTIVE' | 'PRUNED'>();
    const nodeStatus = new Map<string, 'ACTIVE' | 'EVALUATED' | 'PRUNED' | 'COMPLETED'>();

    const steps: SimulationStepResult[] = [];
    const executionPath: string[] = [];
    const astEvaluations: AstEvaluationTraceItem[] = [];
    let finalOutcome: EndOutcome | undefined = undefined;

    // Start traversal: TRIGGER node
    const triggerNode = validatedGraph.triggerNode;
    nodeStatus.set(triggerNode.id, 'COMPLETED');
    executionPath.push(triggerNode.id);
    steps.push({
      nodeId: triggerNode.id,
      nodeName: triggerNode.name,
      nodeType: triggerNode.type,
      status: 'COMPLETED',
      reason: 'Trigger event simulated with input payload',
    });

    for (const edge of outgoingEdges.get(triggerNode.id) || []) {
      edgeStatus.set(edge.id, 'ACTIVE');
    }

    // Traverse remaining nodes in topological order
    for (const nodeId of validatedGraph.topologicalOrder) {
      if (nodeId === triggerNode.id) {
        continue;
      }

      const node = nodeMap.get(nodeId)!;
      const inc = incomingEdges.get(nodeId) || [];

      // Check incoming edge statuses
      const activeIncoming = inc.filter((e) => edgeStatus.get(e.id) === 'ACTIVE');
      const prunedIncoming = inc.filter((e) => edgeStatus.get(e.id) === 'PRUNED');

      // If no incoming edges are active
      if (activeIncoming.length === 0) {
        nodeStatus.set(nodeId, 'PRUNED');
        for (const outEdge of outgoingEdges.get(nodeId) || []) {
          edgeStatus.set(outEdge.id, 'PRUNED');
        }
        steps.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: 'PRUNED',
          reason: 'All incoming upstream branches were bypassed or pruned',
        });
        continue;
      }

      // Handle JOIN node logic
      if (node.type === 'JOIN') {
        const joinPolicy = node.config?.joinPolicy || 'ALL_INCOMING';
        if (joinPolicy === 'ALL_INCOMING' && prunedIncoming.length > 0) {
          // If ANY incoming branch is pruned for an ALL_INCOMING join, join is pruned
          nodeStatus.set(nodeId, 'PRUNED');
          for (const outEdge of outgoingEdges.get(nodeId) || []) {
            edgeStatus.set(outEdge.id, 'PRUNED');
          }
          steps.push({
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            status: 'PRUNED',
            reason:
              'ALL_INCOMING join could not be satisfied because one or more incoming paths were pruned',
          });
          continue;
        }

        // Join is satisfied
        nodeStatus.set(nodeId, 'COMPLETED');
        executionPath.push(nodeId);
        steps.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: 'COMPLETED',
          reason: `Convergence reached via ${joinPolicy} policy (${activeIncoming.length} incoming branch(es) active)`,
        });

        for (const outEdge of outgoingEdges.get(nodeId) || []) {
          edgeStatus.set(outEdge.id, 'ACTIVE');
        }
        continue;
      }

      // Handle CONDITION node logic
      if (node.type === 'CONDITION') {
        const rules: ConditionRule[] = node.config?.rules || [];
        let matchedRule: ConditionRule | null = null;

        for (const rule of rules) {
          if (!rule.expression) continue;
          try {
            const evalResult = this.astEvaluator.evaluate(
              rule.expression,
              requestData,
              validatedGraph.inputSchema,
            );
            astEvaluations.push({
              nodeId: node.id,
              expression: rule.expression,
              result: evalResult.result,
              branchKey: rule.branchKey,
              targetNodeId: rule.targetNodeId,
              trace: evalResult.trace,
            });

            if (evalResult.result) {
              matchedRule = rule;
              break;
            }
          } catch (err: any) {
            astEvaluations.push({
              nodeId: node.id,
              expression: rule.expression,
              result: false,
              branchKey: rule.branchKey,
              targetNodeId: rule.targetNodeId,
              trace: { error: err.message },
            });
          }
        }

        const outEdges = outgoingEdges.get(nodeId) || [];
        let chosenTargetId: string;
        let chosenBranchKey: string;
        let chosenRuleId: string | undefined;

        if (matchedRule) {
          chosenTargetId = matchedRule.targetNodeId;
          chosenBranchKey = matchedRule.branchKey;
          chosenRuleId = matchedRule.id;
        } else {
          // Fallback to defaultTargetNodeId or first edge marked default or first remaining outgoing edge
          chosenTargetId =
            node.config?.defaultTargetNodeId ||
            outEdges.find((e) => (e as any).isDefault)?.targetNodeId ||
            outEdges[outEdges.length - 1]?.targetNodeId;
          chosenBranchKey = 'default';
        }

        // Activate matched edge and prune others
        for (const outEdge of outEdges) {
          if (outEdge.targetNodeId === chosenTargetId) {
            edgeStatus.set(outEdge.id, 'ACTIVE');
          } else {
            edgeStatus.set(outEdge.id, 'PRUNED');
          }
        }

        nodeStatus.set(nodeId, 'EVALUATED');
        executionPath.push(nodeId);
        steps.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: 'EVALUATED',
          evaluatedBranchKey: chosenBranchKey,
          targetNodeId: chosenTargetId,
          ruleId: chosenRuleId,
          reason: matchedRule
            ? `Rule '${matchedRule.id}' evaluated to TRUE, routing to branch '${chosenBranchKey}'`
            : `No condition rules evaluated to TRUE; routing to fallback target '${chosenTargetId}'`,
        });
        continue;
      }

      // Handle APPROVAL_STEP and PARALLEL_APPROVAL
      if (node.type === 'APPROVAL_STEP' || node.type === 'PARALLEL_APPROVAL') {
        const assignees =
          node.config?.assignees ||
          (node.config?.role || node.config?.userId
            ? [
                {
                  assigneeType: node.config?.assigneeType || 'ROLE',
                  role: node.config?.role,
                  userId: node.config?.userId,
                },
              ]
            : []);

        nodeStatus.set(nodeId, 'ACTIVE');
        executionPath.push(nodeId);
        steps.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: 'ACTIVE',
          assignees,
          reason:
            node.type === 'PARALLEL_APPROVAL'
              ? `Parallel quorum required: ${node.config?.requiredApprovals || 1} of ${assignees.length} approvals (${node.config?.policy || 'PARALLEL_AND'})`
              : `Approval required from ${node.config?.role || node.config?.userId || 'assigned approver'}`,
        });

        // In dry run, we simulate step completion so downstream paths are fully traversed to END
        for (const outEdge of outgoingEdges.get(nodeId) || []) {
          edgeStatus.set(outEdge.id, 'ACTIVE');
        }
        continue;
      }

      // Handle END node
      if (node.type === 'END') {
        const outcome = node.config?.outcome || 'APPROVED';
        finalOutcome = outcome;
        nodeStatus.set(nodeId, 'COMPLETED');
        executionPath.push(nodeId);
        steps.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: 'COMPLETED',
          outcome,
          reason: `Terminal state reached with outcome: ${outcome}`,
        });
        continue;
      }

      // Fallback generic node handler
      nodeStatus.set(nodeId, 'COMPLETED');
      executionPath.push(nodeId);
      steps.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: 'COMPLETED',
      });
      for (const outEdge of outgoingEdges.get(nodeId) || []) {
        edgeStatus.set(outEdge.id, 'ACTIVE');
      }
    }

    const activatedNodeIds = steps.filter((s) => s.status !== 'PRUNED').map((s) => s.nodeId);
    const prunedNodeIds = steps.filter((s) => s.status === 'PRUNED').map((s) => s.nodeId);

    return {
      workflowId,
      workflowName,
      success: true,
      finalOutcome: finalOutcome || 'IN_REVIEW',
      activatedNodeIds,
      prunedNodeIds,
      executionPath,
      steps,
      astEvaluations,
      simulatedAt,
    };
  }

  private validatePayload(data: Record<string, unknown>, schema: InputSchema): string[] {
    const errors: string[] = [];

    for (const field of schema.fields || []) {
      const val = data[field.name];
      if (field.required && (val === undefined || val === null || val === '')) {
        errors.push(`Missing required input field '${field.name}' (${field.label || field.name})`);
        continue;
      }

      if (val !== undefined && val !== null) {
        if (field.type === 'NUMBER') {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            errors.push(`Field '${field.name}' must be a finite number`);
          } else {
            if (typeof field.minimum === 'number' && val < field.minimum) {
              errors.push(`Field '${field.name}' must be >= ${field.minimum}`);
            }
            if (typeof field.maximum === 'number' && val > field.maximum) {
              errors.push(`Field '${field.name}' must be <= ${field.maximum}`);
            }
          }
        } else if (field.type === 'STRING') {
          if (typeof val !== 'string') {
            errors.push(`Field '${field.name}' must be a string`);
          } else if (field.allowedValues && field.allowedValues.length > 0) {
            if (!field.allowedValues.includes(val)) {
              errors.push(
                `Field '${field.name}' must be one of: [${field.allowedValues.join(', ')}]`,
              );
            }
          }
        } else if (field.type === 'BOOLEAN') {
          if (typeof val !== 'boolean') {
            errors.push(`Field '${field.name}' must be a boolean`);
          }
        }
      }
    }

    return errors;
  }
}

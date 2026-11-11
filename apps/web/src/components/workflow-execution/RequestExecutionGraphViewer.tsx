'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  RequestExecutionGraph,
  WorkflowNode,
  WorkflowEdge,
  NodeExecutionStatus,
  StepStatus,
} from '@flowgate/shared-types';
import { ExecutionNode, ExecutionNodeData } from './ExecutionNode';
import { ExecutionNodeDetailsModal } from './ExecutionNodeDetailsModal';
import { RefreshCw, Maximize2, ShieldCheck, Activity } from 'lucide-react';

const nodeTypes = {
  executionNode: ExecutionNode,
};

interface RequestExecutionGraphViewerProps {
  executionGraph: RequestExecutionGraph;
  selectedRound?: number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const RequestExecutionGraphViewer: React.FC<RequestExecutionGraphViewerProps> = ({
  executionGraph,
  selectedRound,
  onRefresh,
  isRefreshing = false,
}) => {
  const [selectedNodeData, setSelectedNodeData] = useState<ExecutionNodeData | null>(null);

  const activeRound = selectedRound ?? executionGraph.currentReviewRound ?? 1;

  // 1. Build Nodes & Edges from workflow snapshot or fallback steps
  const { initialNodes, initialEdges } = useMemo(() => {
    const snapshot = executionGraph.workflowSnapshot as
      { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] } | undefined;

    let rawNodes: WorkflowNode[] = snapshot?.nodes || [];
    let rawEdges: WorkflowEdge[] = snapshot?.edges || [];

    // Fallback: If legacy sequential workflow without graph snapshot, construct synthetic graph
    if (rawNodes.length === 0) {
      rawNodes = [
        {
          id: 'trigger-node',
          type: 'TRIGGER',
          name: 'Request Submitted',
          position: { x: 250, y: 50 },
          config: {},
        },
      ];

      const sortedSteps = [...(executionGraph.steps || [])].sort(
        (a, b) => a.stepOrder - b.stepOrder,
      );

      sortedSteps.forEach((step, idx) => {
        rawNodes.push({
          id: step.nodeId && step.nodeId !== 'legacy_step' ? step.nodeId : `step-${step.id}`,
          type:
            (step.nodeType as any) ||
            (step.policy === 'PARALLEL_AND' ? 'PARALLEL_APPROVAL' : 'APPROVAL_STEP'),
          name: step.stepName,
          position: { x: 250, y: 180 + idx * 140 },
          config: {
            policy: step.policy,
            rejectionPolicy: step.rejectionPolicy,
            requiredApprovals: step.requiredApprovals,
          },
        });
      });

      rawNodes.push({
        id: 'end-node',
        type: 'END',
        name: executionGraph.status === 'REJECTED' ? 'Request Rejected' : 'Final Approval',
        position: { x: 250, y: 180 + sortedSteps.length * 140 },
        config: {
          outcome: executionGraph.status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        },
      });

      // Construct sequential edges
      for (let i = 0; i < rawNodes.length - 1; i++) {
        rawEdges.push({
          id: `e-${rawNodes[i].id}-${rawNodes[i + 1].id}`,
          sourceNodeId: rawNodes[i].id,
          targetNodeId: rawNodes[i + 1].id,
        });
      }
    }

    // Filter node and branch executions for the selected review round
    const roundNodeExecs = (executionGraph.nodeExecutions || []).filter(
      (ne) => ne.reviewRound === activeRound,
    );
    const roundBranchExecs = (executionGraph.branchExecutions || []).filter(
      (be) => be.reviewRound === activeRound,
    );
    const roundSteps = (executionGraph.steps || []).filter(
      (s) => (s.reviewRound || 1) === activeRound,
    );

    // Map raw nodes into ReactFlow nodes with live execution state
    const nodes: Node[] = rawNodes.map((n, idx) => {
      // Find matching node execution record
      const exec = roundNodeExecs.find((e) => e.nodeId === n.id);

      // Derive status
      let nodeStatus: NodeExecutionStatus | 'ACTIVE' | 'PRUNED_SKIPPED' | 'REJECTED' = 'PENDING';
      if (exec) {
        nodeStatus = exec.status;
      } else if (executionGraph.currentNodeId === n.id && executionGraph.status === 'IN_PROGRESS') {
        nodeStatus = 'IN_REVIEW';
      } else if (n.type === 'TRIGGER') {
        nodeStatus = 'COMPLETED';
      } else if (executionGraph.status === 'APPROVED' && n.type === 'END') {
        nodeStatus = 'COMPLETED';
      } else if (executionGraph.status === 'REJECTED' && executionGraph.currentNodeId === n.id) {
        nodeStatus = 'REJECTED';
      }

      // Find matching step details and assignees
      const matchingStep = roundSteps.find((s) => s.nodeId === n.id || s.id === n.id);

      const assignees =
        matchingStep?.assignees?.map((a) => ({
          id: a.id,
          name: a.assignedTo?.name || a.actionedBy?.name,
          role: a.assignedRole || a.assignedTo?.role,
          status: a.status as StepStatus,
          isDelegated: Boolean(a.delegatedFromUserId),
          delegatedFrom: a.delegatedFromUser?.name,
          comments: a.comments,
        })) ||
        (matchingStep?.assignedTo
          ? [
              {
                id: matchingStep.assignedTo.id,
                name: matchingStep.assignedTo.name,
                role: matchingStep.assignedTo.role,
                status: matchingStep.status,
                comments: matchingStep.comments,
              },
            ]
          : []);

      const quorumDetails = matchingStep
        ? {
            policy: matchingStep.policy,
            requiredApprovals: matchingStep.requiredApprovals || 1,
            totalAssigned: matchingStep.totalAssigned || assignees.length || 1,
            approvedCount: matchingStep.approvedCount || 0,
            rejectedCount: matchingStep.rejectedCount || 0,
          }
        : undefined;

      const nodeData: ExecutionNodeData = {
        id: n.id,
        name: n.name,
        nodeType: n.type,
        status: nodeStatus,
        activatedAt: exec?.activatedAt || (n.type === 'TRIGGER' ? executionGraph.createdAt : null),
        completedAt: exec?.completedAt || (n.type === 'TRIGGER' ? executionGraph.createdAt : null),
        assignees,
        quorumDetails,
        evaluationTrace: exec?.executionData as Record<string, unknown> | null,
        comments: matchingStep?.comments,
      };

      return {
        id: n.id,
        type: 'executionNode',
        position: n.position || { x: 250, y: idx * 150 + 50 },
        data: nodeData as any,
      };
    });

    // Map edges with real-time branch status styling
    const edges: Edge[] = rawEdges.map((e) => {
      const sourceId = e.sourceNodeId || (e as any).source || '';
      const targetId = e.targetNodeId || (e as any).target || '';

      // Check if branch was executed or pruned in this round
      const branchExec = roundBranchExecs.find(
        (b) =>
          (b.sourceNodeId === sourceId && b.targetNodeId === targetId) ||
          ((e as any).branchKey && b.branchKey === (e as any).branchKey),
      );

      const isPruned = branchExec?.status === 'PRUNED_SKIPPED';
      const isCompleted = branchExec?.status === 'COMPLETED';
      const isActive = branchExec?.status === 'ACTIVE';

      let strokeColor = '#1e293b'; // default subtle slate
      let strokeDasharray = undefined;
      let strokeWidth = 2;
      let animated = false;

      if (isCompleted) {
        strokeColor = '#10b981'; // emerald-500
        strokeWidth = 2.5;
      } else if (isActive) {
        strokeColor = '#06b6d4'; // electric cyan
        strokeWidth = 3;
        animated = true;
      } else if (isPruned) {
        strokeColor = '#334155'; // muted slate
        strokeDasharray = '5 5';
        strokeWidth = 1.5;
      }

      return {
        id: e.id,
        source: sourceId,
        target: targetId,
        sourceHandle: e.sourceHandle,
        label: e.label || (branchExec?.branchKey ? `Branch: ${branchExec.branchKey}` : undefined),
        animated,
        style: {
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [executionGraph, activeRound]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Synchronize nodes & edges when props update
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeData(node.data as unknown as ExecutionNodeData);
  }, []);

  return (
    <div className="relative w-full h-[620px] rounded-2xl border border-white/10 bg-[#05050A] overflow-hidden shadow-2xl flex flex-col">
      {/* HUD Header */}
      <div className="p-3 bg-[#0B0D19]/80 border-b border-white/[0.06] flex items-center justify-between text-xs backdrop-blur-md z-10">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-bold text-white">
            <Activity className="h-4 w-4 text-cyan-400" />
            <span>Live DAG Execution Visualizer</span>
          </div>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400 text-[11px]">
            Review Round <span className="font-bold text-cyan-300">#{activeRound}</span>
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400 text-[11px]">
            {nodes.length} Nodes, {edges.length} Transitions
          </span>
        </div>

        {/* Legend & Refresh Action */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-3 text-[10px] font-semibold uppercase tracking-wider">
            <span className="flex items-center space-x-1 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span>Completed</span>
            </span>
            <span className="flex items-center space-x-1 text-cyan-400">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              <span>Active</span>
            </span>
            <span className="flex items-center space-x-1 text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              <span>Pruned</span>
            </span>
            <span className="flex items-center space-x-1 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-slate-700" />
              <span>Pending</span>
            </span>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/10 text-xs font-medium flex items-center space-x-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* ReactFlow Canvas */}
      <div className="flex-1 w-full h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#334155" gap={20} size={1} variant={BackgroundVariant.Dots} />
          <Controls
            showInteractive={false}
            className="!bg-slate-900 !border-slate-800 !text-slate-200"
          />
          <MiniMap
            nodeColor={(node) => {
              const status = (node.data as any)?.status;
              if (status === 'COMPLETED') return '#10b981';
              if (status === 'IN_REVIEW' || status === 'ACTIVE') return '#6366f1';
              if (status === 'REJECTED') return '#ef4444';
              if (status === 'PRUNED_SKIPPED' || status === 'SKIPPED') return '#475569';
              return '#1e293b';
            }}
            maskColor="rgba(15, 23, 42, 0.7)"
            className="!bg-slate-950 !border !border-slate-800 !rounded-xl"
          />
        </ReactFlow>
      </div>

      {/* Node Details Popover / Modal */}
      <ExecutionNodeDetailsModal
        nodeData={selectedNodeData}
        onClose={() => setSelectedNodeData(null)}
      />
    </div>
  );
};

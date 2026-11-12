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
  StepStatus,
} from '@flowgate/shared-types';
import { ExecutionNode, ExecutionNodeData } from './ExecutionNode';
import { ExecutionNodeDetailsModal } from './ExecutionNodeDetailsModal';
import { RefreshCw, Activity } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import { useThemeColors } from '../../lib/useThemeColors';

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
  const { resolvedTheme } = useTheme();
  const themeColors = useThemeColors();
  const isDark = resolvedTheme === 'dark';
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
          id: `edge-${rawNodes[i].id}-${rawNodes[i + 1].id}`,
          sourceNodeId: rawNodes[i].id,
          targetNodeId: rawNodes[i + 1].id,
        });
      }
    }

    // 2. Filter node executions and branch executions for active review round
    const roundExecs = (executionGraph.nodeExecutions || []).filter(
      (ne) => (ne.reviewRound ?? 1) === activeRound,
    );

    const roundBranchExecs = (executionGraph.branchExecutions || []).filter(
      (be) => (be.reviewRound ?? 1) === activeRound,
    );

    // Map nodes with real-time execution status
    const nodes: Node[] = rawNodes.map((n, idx) => {
      const exec = roundExecs.find((e) => e.nodeId === n.id);
      const matchingStep = (executionGraph.steps || []).find(
        (s) => s.nodeId === n.id || `step-${s.id}` === n.id,
      );

      let nodeStatus = exec?.status || (matchingStep ? matchingStep.status : 'PENDING');
      if (n.type === 'TRIGGER' && !exec) {
        nodeStatus = 'COMPLETED';
      }

      const assignees =
        matchingStep?.assignees?.map((a) => ({
          id: a.id,
          name: a.assignedTo?.name,
          role: a.assignedRole || a.assignedTo?.role,
          status: a.status as StepStatus,
          isDelegated: Boolean(a.delegatedFromUserId),
          delegatedFrom: a.delegatedFromUser?.name,
          comments: (a as any).comments,
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

    // Map edges with sharp orthogonal routing and HUD Crimson accents
    const edges: Edge[] = rawEdges.map((e) => {
      const sourceId = e.sourceNodeId || (e as any).source || '';
      const targetId = e.targetNodeId || (e as any).target || '';

      const branchExec = roundBranchExecs.find(
        (b) =>
          (b.sourceNodeId === sourceId && b.targetNodeId === targetId) ||
          ((e as any).branchKey && b.branchKey === (e as any).branchKey),
      );

      const isPruned = branchExec?.status === 'PRUNED_SKIPPED';
      const isCompleted = branchExec?.status === 'COMPLETED';
      const isActive = branchExec?.status === 'ACTIVE';

      let strokeColor = isDark ? '#4B5563' : '#9CA3AF'; // Default subtle hairline
      let strokeDasharray = undefined;
      let strokeWidth = 1.5;
      let animated = false;

      if (isCompleted) {
        strokeColor = isDark ? '#22C55E' : '#16A34A';
        strokeWidth = 2;
      } else if (isActive) {
        strokeColor = isDark ? '#DC2626' : '#B91C1C'; // Deep Crimson
        strokeWidth = 2.5;
        animated = true;
      } else if (isPruned) {
        strokeColor = isDark ? '#374151' : '#D1D5DB';
        strokeDasharray = '4 4';
        strokeWidth = 1;
      }

      return {
        id: e.id,
        source: sourceId,
        target: targetId,
        type: 'step', // Strict orthogonal step routing
        sourceHandle: e.sourceHandle,
        label:
          e.label || (branchExec?.branchKey ? `[ BRANCH: ${branchExec.branchKey} ]` : undefined),
        animated,
        style: {
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray,
        },
        labelStyle: {
          fill: isDark ? '#D1D5DB' : '#374151',
          fontFamily: 'var(--font-mono), monospace',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.05em',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: 14,
          height: 14,
        },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [executionGraph, activeRound, isDark]);

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
    <div className="relative w-full h-[620px] rounded-none border border-line bg-canvas overflow-hidden shadow-none flex flex-col">
      {/* HUD Header */}
      <div className="p-3 bg-surface border-b border-line flex items-center justify-between text-xs z-10">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-bold text-fg-primary">
            <Activity className="h-4 w-4 text-accent" />
            <span className="font-serif font-bold text-sm tracking-tight">
              Live DAG Execution Visualizer
            </span>
          </div>
          <span className="text-fg-tertiary">•</span>
          <span className="font-mono text-[11px] text-fg-secondary uppercase tracking-wider">
            ROUND <span className="font-bold text-accent">#{activeRound}</span>
          </span>
          <span className="text-fg-tertiary">•</span>
          <span className="font-mono text-[11px] text-fg-secondary uppercase tracking-wider">
            {nodes.length} NODES / {edges.length} EDGES
          </span>
        </div>

        {/* Legend & Refresh Action */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-3 font-mono text-[10px] uppercase tracking-wider">
            <span className="flex items-center space-x-1 text-emerald-500">
              <span className="h-2 w-2 rounded-none bg-emerald-500" />
              <span>COMPLETED</span>
            </span>
            <span className="flex items-center space-x-1 text-accent">
              <span className="h-2 w-2 rounded-none bg-accent animate-pulse" />
              <span>ACTIVE</span>
            </span>
            <span className="flex items-center space-x-1 text-fg-tertiary">
              <span className="h-2 w-2 rounded-none bg-fg-tertiary" />
              <span>PRUNED</span>
            </span>
            <span className="flex items-center space-x-1 text-fg-secondary">
              <span className="h-2 w-2 rounded-none bg-line" />
              <span>STANDBY</span>
            </span>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="px-2.5 py-1.5 rounded-none bg-surface hover:bg-raised text-fg-primary border border-line font-mono text-xs uppercase tracking-wider flex items-center space-x-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>REFRESH</span>
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
          colorMode={resolvedTheme}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            color={themeColors.gridDot}
            gap={24}
            size={1}
            variant={BackgroundVariant.Lines}
          />
          <Controls
            showInteractive={false}
            className="!bg-surface !border-line !text-fg-primary !rounded-none"
          />
          <MiniMap
            nodeColor={(node) => {
              const status = (node.data as any)?.status;
              if (status === 'COMPLETED') return '#22C55E';
              if (status === 'IN_REVIEW' || status === 'ACTIVE') return '#DC2626';
              if (status === 'REJECTED') return '#DC2626';
              if (status === 'PRUNED_SKIPPED' || status === 'SKIPPED') return '#4B5563';
              return '#1F2937';
            }}
            maskColor={isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)'}
            className="!bg-surface !border !border-line !rounded-none"
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

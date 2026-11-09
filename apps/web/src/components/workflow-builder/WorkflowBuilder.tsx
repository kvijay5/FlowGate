'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  MarkerType,
} from '@xyflow/react';
import {
  Zap,
  UserCheck,
  Users,
  GitBranch,
  GitMerge,
  Flag,
  Save,
  Send,
  Copy,
  ArrowLeft,
  LayoutGrid,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowDefinitionSummary,
  InputSchemaField,
} from '@flowgate/shared-types';
import { nodeTypes } from './nodes';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { ValidationBanner } from './ValidationBanner';
import { validateWorkflowGraph } from './graph-validator';
import { DEFAULT_NODE_TEMPLATES, WorkflowBuilderNodeData } from './types';
import { api, ApiError } from '../../lib/api';

interface WorkflowBuilderProps {
  initialWorkflow?: WorkflowDefinitionSummary | null;
  onBack?: () => void;
  onSaved?: (workflow: WorkflowDefinitionSummary) => void;
}

export function WorkflowBuilder({ initialWorkflow, onBack, onSaved }: WorkflowBuilderProps) {
  const [workflowId, setWorkflowId] = useState<string | null>(initialWorkflow?.id || null);
  const [workflowName, setWorkflowName] = useState(
    initialWorkflow?.name || 'Untitled Approval Workflow',
  );
  const [workflowDesc, setWorkflowDesc] = useState(initialWorkflow?.description || '');
  const [workflowStatus, setWorkflowStatus] = useState(initialWorkflow?.status || 'DRAFT');
  const [workflowVersion, setWorkflowVersion] = useState(initialWorkflow?.version || 1);

  // Convert initialWorkflow configuration to ReactFlow nodes and edges
  const initialNodesAndEdges = useMemo(() => {
    const rawConfig = initialWorkflow?.configuration || {};
    const existingNodes: WorkflowNode[] = rawConfig.nodes || [];
    const existingEdges: WorkflowEdge[] = rawConfig.edges || [];

    if (existingNodes.length > 0) {
      const rfNodes: Node[] = existingNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position || { x: 250, y: 100 },
        data: {
          label: n.name,
          type: n.type,
          config: n.config || {},
        },
      }));

      const rfEdges: Edge[] = existingEdges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId || e.source || '',
        target: e.targetNodeId || e.target || '',
        sourceHandle: e.sourceHandle || undefined,
        label: e.label || undefined,
        animated: true,
        style: { strokeWidth: 2, stroke: '#94a3b8' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      }));

      return { nodes: rfNodes, edges: rfEdges };
    }

    // Default starter template: Trigger -> Approval -> End
    const triggerId = 'node_trigger';
    const approvalId = 'node_approval';
    const endId = 'node_end';

    const defaultNodes: Node[] = [
      {
        id: triggerId,
        type: 'TRIGGER',
        position: { x: 300, y: 50 },
        data: {
          label: 'Request Submitted',
          type: 'TRIGGER',
          config: DEFAULT_NODE_TEMPLATES.TRIGGER.config,
        },
      },
      {
        id: approvalId,
        type: 'APPROVAL_STEP',
        position: { x: 300, y: 220 },
        data: {
          label: 'Manager Review',
          type: 'APPROVAL_STEP',
          config: DEFAULT_NODE_TEMPLATES.APPROVAL_STEP.config,
        },
      },
      {
        id: endId,
        type: 'END',
        position: { x: 300, y: 400 },
        data: {
          label: 'Approved & Finalized',
          type: 'END',
          config: DEFAULT_NODE_TEMPLATES.END.config,
        },
      },
    ];

    const defaultEdges: Edge[] = [
      {
        id: 'edge_trig_appr',
        source: triggerId,
        target: approvalId,
        animated: true,
        style: { strokeWidth: 2, stroke: '#94a3b8' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      },
      {
        id: 'edge_appr_end',
        source: approvalId,
        target: endId,
        animated: true,
        style: { strokeWidth: 2, stroke: '#94a3b8' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      },
    ];

    return { nodes: defaultNodes, edges: defaultEdges };
  }, [initialWorkflow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodesAndEdges.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialNodesAndEdges.edges);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Connection handler
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { strokeWidth: 2, stroke: '#6366f1' },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // Node selection handler
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Compute canonical WorkflowNode[] and WorkflowEdge[]
  const canonicalNodes: WorkflowNode[] = useMemo(() => {
    return nodes.map((n) => ({
      id: n.id,
      type: n.type as WorkflowNodeType,
      name: (n.data as any)?.label || n.id,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: (n.data as any)?.config || {},
    }));
  }, [nodes]);

  const canonicalEdges: WorkflowEdge[] = useMemo(() => {
    return edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      targetNodeId: e.target,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
      label: typeof e.label === 'string' ? e.label : undefined,
    }));
  }, [edges]);

  // Real-time Graph Validation
  const validation = useMemo(() => {
    return validateWorkflowGraph(canonicalNodes, canonicalEdges);
  }, [canonicalNodes, canonicalEdges]);

  // Selected node object
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return canonicalNodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, canonicalNodes]);

  // Extract input schema fields from TRIGGER node for condition auto-complete
  const triggerFields: InputSchemaField[] = useMemo(() => {
    const trigger = canonicalNodes.find((n) => n.type === 'TRIGGER');
    return trigger?.config?.inputSchema?.fields || [];
  }, [canonicalNodes]);

  // Update node handler
  const handleUpdateNode = useCallback(
    (nodeId: string, updates: Partial<WorkflowNode>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const currentData = n.data as any;
          return {
            ...n,
            data: {
              ...currentData,
              label: updates.name !== undefined ? updates.name : currentData.label,
              config: updates.config !== undefined ? updates.config : currentData.config,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  // Delete node handler
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // Add node from palette
  const handleAddNode = useCallback(
    (type: WorkflowNodeType) => {
      const template = DEFAULT_NODE_TEMPLATES[type] || {
        name: type,
        config: {},
      };

      // Find reasonable position offset from existing nodes
      const count = nodes.length;
      const newId = `node_${Date.now().toString().slice(-6)}`;
      const position = {
        x: 250 + (count % 3) * 60,
        y: 100 + count * 60,
      };

      const newNode: Node = {
        id: newId,
        type,
        position,
        data: {
          label: template.name,
          type,
          config: JSON.parse(JSON.stringify(template.config)),
        },
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newId);
    },
    [nodes.length, setNodes],
  );

  // Auto-Layout
  const handleAutoLayout = useCallback(() => {
    // Layout nodes along topological order
    const topo = validation.topologicalOrder;
    if (topo.length === 0) return;

    setNodes((nds) => {
      const nodeMap = new Map(nds.map((n) => [n.id, n]));
      return nds.map((n) => {
        const orderIdx = topo.indexOf(n.id);
        const yPos = orderIdx !== -1 ? 80 + orderIdx * 140 : n.position.y;
        return {
          ...n,
          position: {
            x: 320,
            y: yPos,
          },
        };
      });
    });
  }, [validation.topologicalOrder, setNodes]);

  // Save Draft
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    const triggerNode = canonicalNodes.find((n) => n.type === 'TRIGGER');
    const inputSchema = triggerNode?.config?.inputSchema;

    const payload = {
      name: workflowName.trim(),
      description: workflowDesc.trim(),
      nodes: canonicalNodes,
      edges: canonicalEdges,
      inputSchema,
      status: workflowStatus,
    };

    try {
      let saved: WorkflowDefinitionSummary;
      if (workflowId) {
        saved = await api.updateWorkflow(workflowId, payload);
      } else {
        saved = await api.createWorkflow(payload);
        setWorkflowId(saved.id);
      }

      setWorkflowStatus(saved.status);
      setWorkflowVersion(saved.version);
      setSaveSuccessMessage(`Workflow saved as Draft (v${saved.version})`);
      if (onSaved) onSaved(saved);
    } catch (err: any) {
      setSaveErrorMessage(err.message || 'Failed to save workflow definition');
    } finally {
      setIsSaving(false);
    }
  };

  // Publish Workflow
  const handlePublish = async () => {
    if (!validation.isValid) {
      setSaveErrorMessage('Cannot publish invalid graph. Fix errors shown in the banner.');
      return;
    }

    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    try {
      let activeId = workflowId;
      const triggerNode = canonicalNodes.find((n) => n.type === 'TRIGGER');

      // If not yet persisted, save draft first
      if (!activeId) {
        const created = await api.createWorkflow({
          name: workflowName.trim(),
          description: workflowDesc.trim(),
          nodes: canonicalNodes,
          edges: canonicalEdges,
          inputSchema: triggerNode?.config?.inputSchema,
          status: 'DRAFT',
        });
        activeId = created.id;
        setWorkflowId(activeId);
      } else {
        await api.updateWorkflow(activeId, {
          name: workflowName.trim(),
          description: workflowDesc.trim(),
          nodes: canonicalNodes,
          edges: canonicalEdges,
          inputSchema: triggerNode?.config?.inputSchema,
        });
      }

      // Publish workflow
      const published = await api.publishWorkflow(activeId);
      setWorkflowStatus(published.status);
      setWorkflowVersion(published.version);
      setSaveSuccessMessage(
        `Workflow published and activated successfully (v${published.version})!`,
      );
      if (onSaved) onSaved(published);
    } catch (err: any) {
      setSaveErrorMessage(err.message || 'Failed to publish workflow');
    } finally {
      setIsSaving(false);
    }
  };

  // Clone Version (vN -> vN+1)
  const handleCloneVersion = async () => {
    if (!workflowId) return;
    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    try {
      const cloned = await api.cloneDraftWorkflow(workflowId);
      setWorkflowId(cloned.id);
      setWorkflowVersion(cloned.version);
      setWorkflowStatus(cloned.status);
      setSaveSuccessMessage(`Cloned into new Draft version ${cloned.version}!`);
      if (onSaved) onSaved(cloned);
    } catch (err: any) {
      setSaveErrorMessage(err.message || 'Failed to clone draft version');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50">
      {/* Top Header & Actions Bar */}
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-xs">
        <div className="flex items-center space-x-4">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Back to Workflows"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}

          <div>
            <div className="flex items-center space-x-2.5">
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                className="rounded border-transparent px-1 py-0.5 text-base font-bold text-slate-900 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
                placeholder="Workflow Name"
              />
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  workflowStatus === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {workflowStatus} (v{workflowVersion})
              </span>
            </div>
            <input
              type="text"
              value={workflowDesc}
              onChange={(e) => setWorkflowDesc(e.target.value)}
              className="text-xs text-slate-500 hover:border-slate-200 focus:outline-none"
              placeholder="Add optional description..."
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleAutoLayout}
            className="flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300"
            title="Auto-arrange nodes hierarchically"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Auto Layout</span>
          </button>

          {workflowId && workflowStatus === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleCloneVersion}
              disabled={isSaving}
              className="flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300"
              title="Create a new draft version from this active workflow"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Clone v{workflowVersion + 1}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSaving}
            className="flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={isSaving || !validation.isValid}
            className="flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Send className="h-4 w-4" />
            <span>Publish Workflow</span>
          </button>
        </div>
      </header>

      {/* Validation Status Banner */}
      <ValidationBanner validation={validation} nodeCount={nodes.length} edgeCount={edges.length} />

      {/* Alerts */}
      {saveSuccessMessage && (
        <div className="flex items-center justify-between bg-emerald-600 px-6 py-2 text-xs font-medium text-white">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{saveSuccessMessage}</span>
          </div>
          <button onClick={() => setSaveSuccessMessage(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {saveErrorMessage && (
        <div className="flex items-center justify-between bg-rose-600 px-6 py-2 text-xs font-medium text-white">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{saveErrorMessage}</span>
          </div>
          <button onClick={() => setSaveErrorMessage(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Canvas Area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left Toolbar / Node Palette */}
        <div className="absolute left-4 top-4 z-10 flex flex-col space-y-1.5 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur-xs">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Add Nodes
          </div>

          <button
            onClick={() => handleAddNode('TRIGGER')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
          >
            <Zap className="h-4 w-4 text-emerald-600" />
            <span>Trigger</span>
          </button>

          <button
            onClick={() => handleAddNode('APPROVAL_STEP')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
          >
            <UserCheck className="h-4 w-4 text-indigo-600" />
            <span>Approval</span>
          </button>

          <button
            onClick={() => handleAddNode('PARALLEL_APPROVAL')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-purple-50 hover:text-purple-700"
          >
            <Users className="h-4 w-4 text-purple-600" />
            <span>Parallel Quorum</span>
          </button>

          <button
            onClick={() => handleAddNode('CONDITION')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-amber-50 hover:text-amber-700"
          >
            <GitBranch className="h-4 w-4 text-amber-600" />
            <span>Condition</span>
          </button>

          <button
            onClick={() => handleAddNode('JOIN')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-cyan-50 hover:text-cyan-700"
          >
            <GitMerge className="h-4 w-4 text-cyan-600" />
            <span>Join Gate</span>
          </button>

          <button
            onClick={() => handleAddNode('END')}
            className="flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-rose-50 hover:text-rose-700"
          >
            <Flag className="h-4 w-4 text-rose-600" />
            <span>End Terminal</span>
          </button>
        </div>

        {/* ReactFlow Canvas */}
        <div className="flex-1 h-full w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
          >
            <Controls className="!border-slate-200 !bg-white !shadow-md" />
            <MiniMap
              className="!border-slate-200 !bg-white/90 !shadow-md"
              nodeColor={(n) => {
                switch (n.type) {
                  case 'TRIGGER':
                    return '#10b981';
                  case 'APPROVAL_STEP':
                  case 'APPROVAL':
                    return '#6366f1';
                  case 'PARALLEL_APPROVAL':
                  case 'PARALLEL':
                    return '#a855f7';
                  case 'CONDITION':
                    return '#f59e0b';
                  case 'JOIN':
                    return '#06b6d4';
                  case 'END':
                    return '#ef4444';
                  default:
                    return '#94a3b8';
                }
              }}
            />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
          </ReactFlow>
        </div>

        {/* Node Properties Drawer / Sidebar */}
        {selectedNode && (
          <NodePropertiesPanel
            selectedNode={selectedNode}
            triggerFields={triggerFields}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

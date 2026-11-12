'use client';

import React, { useState, useEffect } from 'react';
import { WorkflowNode, WorkflowEdge, InputSchema, SimulationResult } from '@flowgate/shared-types';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GitBranch,
  ArrowRight,
  Code2,
  Layers,
  Sparkles,
} from 'lucide-react';

interface SimulatorPanelProps {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema?: InputSchema;
  onSimulationResult?: (result: SimulationResult | null) => void;
}

export function SimulatorPanel({
  open,
  onClose,
  workflowId,
  workflowName,
  nodes,
  edges,
  inputSchema,
  onSimulationResult,
}: SimulatorPanelProps) {
  const { showToast } = useToast();
  const [jsonPayload, setJsonPayload] = useState<string>('{}');
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);

  // Auto-generate sample payload from inputSchema
  useEffect(() => {
    if (inputSchema && inputSchema.fields && inputSchema.fields.length > 0) {
      const sample: Record<string, unknown> = {};
      for (const field of inputSchema.fields) {
        if (field.defaultValue !== undefined) {
          sample[field.name] = field.defaultValue;
        } else if (field.allowedValues && field.allowedValues.length > 0) {
          sample[field.name] = field.allowedValues[0];
        } else if (field.type === 'NUMBER') {
          sample[field.name] = field.minimum !== undefined ? field.minimum * 2 || 1000 : 25000;
        } else if (field.type === 'BOOLEAN') {
          sample[field.name] = true;
        } else {
          sample[field.name] = `Sample ${field.label || field.name}`;
        }
      }
      setJsonPayload(JSON.stringify(sample, null, 2));
    } else {
      setJsonPayload(JSON.stringify({ amount: 15000, department: 'ENGINEERING' }, null, 2));
    }
  }, [inputSchema]);

  const handleRunSimulation = async () => {
    setPayloadError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonPayload);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Payload must be a JSON object');
      }
    } catch (e: any) {
      setPayloadError(e.message || 'Invalid JSON syntax');
      return;
    }

    setSimulating(true);
    try {
      const res = await api.simulateWorkflow(workflowId, parsed);
      setSimulationResult(res);
      if (onSimulationResult) {
        onSimulationResult(res);
      }

      if (res.success) {
        showToast({
          title: 'Simulation Complete',
          description: `Outcome: ${res.finalOutcome || 'IN_REVIEW'} (${res.activatedNodeIds.length} nodes traversed, ${res.prunedNodeIds.length} pruned)`,
          type: 'success',
        });
      } else {
        showToast({
          title: 'Simulation Validation Failed',
          description: res.validationErrors?.join('; ') || 'Graph condition failure',
          type: 'error',
        });
      }
    } catch (err: any) {
      showToast({
        title: 'Simulation Error',
        description: err.message || 'Failed to simulate workflow',
        type: 'error',
      });
    } finally {
      setSimulating(false);
    }
  };

  const handleReset = () => {
    setSimulationResult(null);
    if (onSimulationResult) {
      onSimulationResult(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Workflow Dry-Run Simulator"
      description={`Simulate input payloads against "${workflowName}" with zero database side-effects.`}
      width="w-full sm:max-w-xl"
    >
      <div className="space-y-6">
        {/* Input Payload Editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-mono uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-accent" />
              Request Payload (JSON)
            </label>
            <span className="text-[11px] font-mono text-fg-subtle">
              {inputSchema?.fields?.length || 0} fields defined
            </span>
          </div>

          <textarea
            value={jsonPayload}
            onChange={(e) => {
              setJsonPayload(e.target.value);
              setPayloadError(null);
            }}
            rows={7}
            className="w-full p-3 font-mono text-xs rounded-none border border-line bg-canvas text-fg-primary outline-none focus:border-accent transition-colors resize-y"
            placeholder="Enter JSON request data..."
          />

          {payloadError && <p className="text-xs text-danger font-mono">{payloadError}</p>}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              loading={simulating}
              onClick={handleRunSimulation}
              className="gap-2 shadow-none"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Simulate DAG Path</span>
            </Button>
            {simulationResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 text-fg-secondary"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset View</span>
              </Button>
            )}
          </div>
        </div>

        {/* Results Container */}
        {simulationResult && (
          <div className="space-y-4 pt-4 border-t border-line">
            {/* Outcome Banner */}
            <div
              className={`p-3.5 rounded-none border flex items-start gap-3 ${
                simulationResult.success
                  ? simulationResult.finalOutcome === 'APPROVED'
                    ? 'bg-emerald-950/20 border-emerald-600/40 text-emerald-500'
                    : 'bg-surface border-line text-fg-primary'
                  : 'bg-danger/10 border-danger/40 text-danger'
              }`}
            >
              {simulationResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
              )}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-serif font-bold text-sm">
                    {simulationResult.success
                      ? `Execution Outcome: ${simulationResult.finalOutcome || 'IN_REVIEW'}`
                      : 'Validation Failed'}
                  </span>
                  <Chip variant={simulationResult.success ? 'success' : 'danger'} size="sm">
                    {simulationResult.success ? 'VALID' : 'INVALID'}
                  </Chip>
                </div>
                {simulationResult.validationErrors && (
                  <ul className="text-xs font-mono list-disc list-inside space-y-0.5">
                    {simulationResult.validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Stepped Traversal Pipeline */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-fg-secondary">
                Traversal Trace ({simulationResult.steps.length} Steps)
              </span>

              <div className="space-y-2">
                {simulationResult.steps.map((step, idx) => (
                  <div
                    key={`${step.nodeId}-${idx}`}
                    className={`p-3 rounded-none border text-xs font-sans transition-all ${
                      step.status === 'PRUNED'
                        ? 'bg-canvas border-line text-fg-secondary line-through opacity-50'
                        : 'bg-surface border-line text-fg-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-fg">{step.nodeName}</span>
                      </div>
                      <Chip
                        variant={
                          step.status === 'COMPLETED'
                            ? 'success'
                            : step.status === 'ACTIVE'
                              ? 'info'
                              : step.status === 'EVALUATED'
                                ? 'default'
                                : 'default'
                        }
                        size="sm"
                      >
                        {step.status}
                      </Chip>
                    </div>

                    {step.reason && (
                      <p className="mt-1.5 ml-7 text-[11px] text-fg-muted">{step.reason}</p>
                    )}

                    {step.evaluatedBranchKey && (
                      <div className="mt-1 ml-7 flex items-center gap-1.5 text-[11px] font-mono text-accent">
                        <GitBranch className="w-3 h-3" />
                        <span>Branch Selected: {step.evaluatedBranchKey}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* AST Trace Accordion */}
            {simulationResult.astEvaluations && simulationResult.astEvaluations.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
                  AST Condition Rule Evaluations ({simulationResult.astEvaluations.length})
                </span>
                <div className="p-3 bg-canvas rounded-xl border border-line space-y-2 text-xs font-mono">
                  {simulationResult.astEvaluations.map((evalItem, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-surface border border-line"
                    >
                      <div className="truncate">
                        <span className="text-fg font-semibold">
                          {(evalItem.expression as any)?.field || 'Expression'}
                        </span>
                        <span className="text-fg-subtle mx-1">
                          {(evalItem.expression as any)?.operator}
                        </span>
                        <span className="text-accent">
                          {JSON.stringify((evalItem.expression as any)?.value)}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          evalItem.result
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-red-500/15 text-red-600 dark:text-red-400'
                        }`}
                      >
                        {evalItem.result ? 'TRUE' : 'FALSE'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

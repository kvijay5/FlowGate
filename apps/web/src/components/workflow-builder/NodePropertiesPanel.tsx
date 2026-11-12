'use client';

import React, { useState } from 'react';
import {
  X,
  Trash2,
  Plus,
  Tag,
  Shield,
  Clock,
  CheckCircle,
  GitBranch,
  Layers,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  WorkflowNode,
  WorkflowNodeConfig,
  InputSchemaField,
  FieldDataType,
  UserRole,
  StepPolicy,
  RejectionPolicy,
  JoinPolicy,
  EndOutcome,
  ConditionRule,
  AstComparisonNode,
} from '@flowgate/shared-types';

interface NodePropertiesPanelProps {
  selectedNode: WorkflowNode | null;
  triggerFields: InputSchemaField[];
  onUpdateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

const AVAILABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: 'APPROVER', label: 'Approver' },
  { value: 'MANAGER', label: 'Department Manager' },
  { value: 'TENANT_ADMIN', label: 'Tenant Administrator' },
  { value: 'SUPER_ADMIN', label: 'Super Administrator' },
  { value: 'REQUESTER', label: 'Requester' },
];

export function NodePropertiesPanel({
  selectedNode,
  triggerFields,
  onUpdateNode,
  onDeleteNode,
  onClose,
}: NodePropertiesPanelProps) {
  // State for adding a new schema field
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldDataType>('STRING');
  const [newFieldRequired, setNewFieldRequired] = useState(true);

  // State for adding an approver in parallel node
  const [newApproverRole, setNewApproverRole] = useState<UserRole>('MANAGER');

  // State for adding a condition rule
  const [newRuleField, setNewRuleField] = useState(triggerFields[0]?.name || 'amount');
  const [newRuleOp, setNewRuleOp] = useState<any>('>');
  const [newRuleVal, setNewRuleVal] = useState('5000');

  if (!selectedNode) return null;

  const { id, type, name, config } = selectedNode;

  const updateConfig = (newConfig: Partial<WorkflowNodeConfig>) => {
    onUpdateNode(id, {
      config: {
        ...config,
        ...newConfig,
      },
    });
  };

  const handleAddSchemaField = () => {
    if (!newFieldName.trim()) return;
    const currentFields = config.inputSchema?.fields || [];
    const formattedName = newFieldName.trim().toLowerCase().replace(/\s+/g, '_');

    // Avoid duplicate field names
    if (currentFields.some((f) => f.name === formattedName)) return;

    const updatedFields: InputSchemaField[] = [
      ...currentFields,
      {
        name: formattedName,
        label: newFieldLabel.trim() || newFieldName.trim(),
        type: newFieldType,
        required: newFieldRequired,
      },
    ];

    updateConfig({
      inputSchema: { fields: updatedFields },
    });

    setNewFieldName('');
    setNewFieldLabel('');
  };

  const handleRemoveSchemaField = (fieldName: string) => {
    const currentFields = config.inputSchema?.fields || [];
    updateConfig({
      inputSchema: { fields: currentFields.filter((f) => f.name !== fieldName) },
    });
  };

  const handleAddAssignee = () => {
    const current = config.assignees || [];
    updateConfig({
      assignees: [...current, { assigneeType: 'ROLE', role: newApproverRole }],
    });
  };

  const handleRemoveAssignee = (index: number) => {
    const current = config.assignees || [];
    const updated = current.filter((_, idx) => idx !== index);
    updateConfig({
      assignees: updated,
      requiredApprovals: Math.min(config.requiredApprovals || 1, Math.max(1, updated.length)),
    });
  };

  const handleAddConditionRule = () => {
    const currentRules = (config.rules || []) as ConditionRule[];
    const nextIdx = currentRules.length + 1;
    const parsedVal =
      newRuleOp === '>' || newRuleOp === '>=' || newRuleOp === '<' || newRuleOp === '<='
        ? Number(newRuleVal) || 0
        : newRuleVal;

    const newRule: ConditionRule = {
      id: `rule_${Date.now()}`,
      branchKey: `branch_${nextIdx}`,
      targetNodeId: '',
      description: `${newRuleField} ${newRuleOp} ${newRuleVal}`,
      expression: {
        field: newRuleField,
        operator: newRuleOp,
        value: parsedVal,
      },
    };

    updateConfig({
      rules: [...currentRules, newRule],
    });
  };

  const handleRemoveConditionRule = (ruleId: string) => {
    const currentRules = (config.rules || []) as ConditionRule[];
    updateConfig({
      rules: currentRules.filter((r) => r.id !== ruleId),
    });
  };

  return (
    <div className="flex h-full w-96 flex-col border-l border-slate-200 bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
              {type}
            </span>
            <span className="text-xs text-slate-400 font-mono">#{id.slice(0, 8)}</span>
          </div>
          <input
            type="text"
            value={name || ''}
            onChange={(e) => onUpdateNode(id, { name: e.target.value })}
            className="mt-1 block w-full rounded-none border border-border-subtle bg-surface px-2 py-1 text-base font-serif font-bold text-ink hover:border-accent/40 focus:border-accent focus:outline-none"
            placeholder="Node Name"
          />
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* --- TRIGGER CONFIGURATION --- */}
        {type === 'TRIGGER' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Payload Input Schema
              </label>
              <span className="text-[11px] text-slate-400">Validated upon submission</span>
            </div>

            {/* List of Fields */}
            <div className="space-y-2">
              {(config.inputSchema?.fields || []).map((f) => (
                <div
                  key={f.name}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-800">{f.name}</span>
                    <span className="ml-1 text-[11px] text-slate-500">({f.type})</span>
                    {f.required && (
                      <span className="ml-1.5 rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">
                        REQUIRED
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveSchemaField(f.name)}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Field Form */}
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-3 space-y-2.5">
              <span className="text-xs font-medium text-slate-700">Add Schema Field</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="field_name"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as FieldDataType)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                >
                  <option value="STRING">STRING</option>
                  <option value="NUMBER">NUMBER</option>
                  <option value="BOOLEAN">BOOLEAN</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={newFieldRequired}
                    onChange={(e) => setNewFieldRequired(e.target.checked)}
                    className="rounded-none border-border-subtle text-accent focus:ring-0"
                  />
                  <span>Required field</span>
                </label>

                <button
                  type="button"
                  onClick={handleAddSchemaField}
                  disabled={!newFieldName.trim()}
                  className="flex items-center space-x-1 rounded-none bg-accent hover:bg-accent/90 px-2.5 py-1 text-xs font-mono font-semibold uppercase text-white disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Field</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- APPROVAL STEP CONFIGURATION --- */}
        {(type === 'APPROVAL_STEP' || type === 'APPROVAL') && (
          <div className="space-y-4 font-mono">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Assigned Approver Role
              </label>
              <select
                value={config.role || 'APPROVER'}
                onChange={(e) => updateConfig({ role: e.target.value as UserRole })}
                className="mt-1.5 block w-full rounded-none border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-ink focus:border-accent focus:outline-none"
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} ({r.value})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                SLA Timeout (Hours)
              </label>
              <input
                type="number"
                min="1"
                max="720"
                value={
                  config.escalationTimeoutMinutes
                    ? Math.round(config.escalationTimeoutMinutes / 60)
                    : 24
                }
                onChange={(e) =>
                  updateConfig({
                    escalationTimeoutMinutes: Math.max(1, Number(e.target.value)) * 60,
                  })
                }
                className="mt-1.5 block w-full rounded-none border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-fg-subtle">
                Escalation triggers if no decision is logged within this window.
              </p>
            </div>

            <div className="pt-2">
              <label className="flex items-center space-x-2 text-xs font-medium text-fg-muted">
                <input
                  type="checkbox"
                  checked={config.fastForwardOnResubmit || false}
                  onChange={(e) => updateConfig({ fastForwardOnResubmit: e.target.checked })}
                  className="rounded-none border-border-subtle text-accent focus:ring-0"
                />
                <span>Fast-forward on resubmission if approved previously</span>
              </label>
            </div>
          </div>
        )}

        {/* --- PARALLEL APPROVAL CONFIGURATION --- */}
        {(type === 'PARALLEL_APPROVAL' || type === 'PARALLEL') && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Approval Policy
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateConfig({ policy: 'PARALLEL_OR' })}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    config.policy === 'PARALLEL_OR'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 ring-1 ring-purple-600'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold">PARALLEL_OR</div>
                  <div className="text-[10px] text-slate-500">Quorum threshold ($K$-of-$N$)</div>
                </button>

                <button
                  type="button"
                  onClick={() => updateConfig({ policy: 'PARALLEL_AND' })}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    config.policy === 'PARALLEL_AND'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 ring-1 ring-purple-600'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold">PARALLEL_AND</div>
                  <div className="text-[10px] text-slate-500">All must approve</div>
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Rejection Policy
              </label>
              <select
                value={config.rejectionPolicy || 'SOFT_REJECTION'}
                onChange={(e) =>
                  updateConfig({ rejectionPolicy: e.target.value as RejectionPolicy })
                }
                className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs focus:border-purple-500 focus:outline-none"
              >
                <option value="SOFT_REJECTION">
                  SOFT_REJECTION (Continues while threshold reachable)
                </option>
                <option value="STRICT_VETO">
                  STRICT_VETO (Immediate stage failure on 1 rejection)
                </option>
              </select>
            </div>

            {config.policy === 'PARALLEL_OR' && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Required Approval Threshold ($K$)
                </label>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, (config.assignees || []).length)}
                  value={config.requiredApprovals || 1}
                  onChange={(e) =>
                    updateConfig({ requiredApprovals: Math.max(1, Number(e.target.value)) })
                  }
                  className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs focus:border-purple-500 focus:outline-none"
                />
              </div>
            )}

            {/* Approver List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Assigned Approvers ({(config.assignees || []).length})
                </span>
              </div>

              <div className="space-y-1.5 mb-3">
                {(config.assignees || []).map((a, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"
                  >
                    <span className="font-semibold text-slate-800">
                      {a.role || a.userId || 'Approver'}
                    </span>
                    <button
                      onClick={() => handleRemoveAssignee(idx)}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Approver */}
              <div className="flex items-center space-x-2">
                <select
                  value={newApproverRole}
                  onChange={(e) => setNewApproverRole(e.target.value as UserRole)}
                  className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
                >
                  {AVAILABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddAssignee}
                  className="flex items-center space-x-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- CONDITION CONFIGURATION --- */}
        {type === 'CONDITION' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Conditional Outgoing Branches
              </label>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Rules are evaluated in order. The first matching rule activates its branch.
              </p>
            </div>

            {/* Existing Rules */}
            <div className="space-y-2">
              {((config.rules || []) as ConditionRule[]).map((rule, idx) => {
                const expr = rule.expression as AstComparisonNode;
                return (
                  <div
                    key={rule.id || idx}
                    className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900">Branch #{idx + 1}</span>
                      <button
                        onClick={() => handleRemoveConditionRule(rule.id)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="font-mono text-xs text-amber-800">
                      {expr
                        ? `${expr.field} ${expr.operator} ${JSON.stringify(expr.value)}`
                        : rule.description}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Rule Builder */}
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/30 p-3 space-y-2">
              <span className="text-xs font-bold text-amber-900">Add Branch Rule</span>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400">Trigger Field</span>
                    <select
                      value={newRuleField}
                      onChange={(e) => setNewRuleField(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      {triggerFields.length > 0 ? (
                        triggerFields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name} ({f.type})
                          </option>
                        ))
                      ) : (
                        <option value="amount">amount (NUMBER)</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400">Operator</span>
                    <select
                      value={newRuleOp}
                      onChange={(e) => setNewRuleOp(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      <option value=">">&gt; (Greater)</option>
                      <option value=">=">&gt;= (Greater/Equal)</option>
                      <option value="<">&lt; (Less)</option>
                      <option value="<=">&lt;= (Less/Equal)</option>
                      <option value="==">== (Equals)</option>
                      <option value="!=">!= (Not Equals)</option>
                      <option value="IN">IN (List)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400">Comparison Value</span>
                  <input
                    type="text"
                    value={newRuleVal}
                    onChange={(e) => setNewRuleVal(e.target.value)}
                    placeholder="e.g. 5000 or USD"
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddConditionRule}
                  className="w-full rounded-md bg-amber-600 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Add Condition Branch
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- JOIN GATE CONFIGURATION --- */}
        {type === 'JOIN' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Join Synchronization Policy
              </label>
              <select
                value={config.joinPolicy || 'ALL_INCOMING'}
                onChange={(e) => updateConfig({ joinPolicy: e.target.value as JoinPolicy })}
                className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs focus:border-cyan-500 focus:outline-none"
              >
                <option value="ALL_INCOMING">ALL_INCOMING (Waits for all incoming paths)</option>
                <option value="ANY_INCOMING">ANY_INCOMING (First arrival proceeds)</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              When set to ALL_INCOMING, this join gate only executes after every incoming parallel
              or conditional branch has reached completion or pruned status.
            </p>
          </div>
        )}

        {/* --- END NODE CONFIGURATION --- */}
        {type === 'END' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Terminal Outcome
              </label>
              <select
                value={config.outcome || 'APPROVED'}
                onChange={(e) => updateConfig({ outcome: e.target.value as EndOutcome })}
                className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="APPROVED">APPROVED (Request completes with Approval)</option>
                <option value="REJECTED">REJECTED (Request completes with Rejection)</option>
                <option value="AUTO_APPROVED">AUTO_APPROVED (Automatic system signoff)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-slate-200 p-4">
        <button
          type="button"
          onClick={() => onDeleteNode(id)}
          className="flex w-full items-center justify-center space-x-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          <Trash2 className="h-4 w-4" />
          <span>Delete Node from Canvas</span>
        </button>
      </div>
    </div>
  );
}

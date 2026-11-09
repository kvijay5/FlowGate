'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { GitBranch, CornerDownRight } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';
import { ConditionRule, AstComparisonNode } from '@flowgate/shared-types';

export function ConditionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const config = nodeData.config || {};
  const rules = (config.rules || []) as ConditionRule[];

  return (
    <div
      className={`relative min-w-[260px] max-w-[300px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? 'border-amber-500 shadow-md ring-2 ring-amber-200'
          : 'border-amber-200 hover:border-amber-300 hover:shadow'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-amber-500 hover:!scale-125"
      />

      <div className="flex items-center space-x-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <GitBranch className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
            Condition Router
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'Condition'}
          </h4>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-2.5">
        <div className="text-xs font-medium text-slate-600">Branching Rules:</div>

        {rules.length > 0 ? (
          <div className="space-y-1.5">
            {rules.map((rule, idx) => {
              const expr = rule.expression as AstComparisonNode;
              const ruleText = expr
                ? `${expr.field} ${expr.operator} ${JSON.stringify(expr.value)}`
                : rule.description || `Rule #${idx + 1}`;

              return (
                <div
                  key={rule.id || idx}
                  className="flex items-center justify-between rounded bg-amber-50/70 px-2 py-1 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/10"
                >
                  <span className="truncate font-mono font-medium">{ruleText}</span>
                  <span className="ml-1 text-[10px] text-amber-600 font-semibold">IF</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] italic text-slate-400">No condition rules added yet</p>
        )}

        <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
          <span className="flex items-center">
            <CornerDownRight className="mr-1 h-3 w-3 text-slate-400" />
            Default Fallback
          </span>
          <span className="text-[10px] font-semibold text-slate-500">ELSE</span>
        </div>
      </div>

      {/* Multiple Outgoing Connection Handles along the bottom */}
      <div className="mt-4 flex justify-between px-2 pt-2 border-t border-dashed border-slate-200 text-[10px] text-slate-400">
        {rules.map((rule, idx) => {
          const totalHandles = rules.length + 1;
          const leftPercent = ((idx + 1) / (totalHandles + 1)) * 100;
          const handleId = rule.branchKey || rule.id || `rule_${idx}`;

          return (
            <div key={handleId} className="flex flex-col items-center">
              <span className="text-[9px] font-bold text-amber-700">R{idx + 1}</span>
              <Handle
                type="source"
                id={handleId}
                position={Position.Bottom}
                style={{ left: `${leftPercent}%` }}
                className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-amber-500 hover:!scale-125"
              />
            </div>
          );
        })}

        {/* Default fallback handle */}
        <div className="flex flex-col items-center">
          <span className="text-[9px] font-bold text-slate-600">Default</span>
          <Handle
            type="source"
            id="default"
            position={Position.Bottom}
            style={{ left: `${((rules.length + 1) / (rules.length + 2)) * 100}%` }}
            className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-slate-600 hover:!scale-125"
          />
        </div>
      </div>
    </div>
  );
}

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
      className={`relative min-w-[260px] max-w-[300px] rounded-none border bg-surface p-3.5 transition-colors shadow-none text-fg-primary ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-fg-secondary'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !rounded-none !border !border-surface !bg-accent -top-1.5"
      />

      <div className="flex items-center space-x-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-none border border-line bg-raised text-accent">
          <GitBranch className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary block">
            [ CONDITION ROUTER ]
          </span>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'Condition'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 border-t border-line pt-2 font-mono text-[10px]">
        <div className="text-fg-secondary uppercase">EVALUATION RULES:</div>

        {rules.length > 0 ? (
          <div className="space-y-1">
            {rules.map((rule, idx) => {
              const expr = rule.expression as AstComparisonNode;
              const ruleText = expr
                ? `${expr.field} ${expr.operator} ${JSON.stringify(expr.value)}`
                : rule.description || `RULE #${idx + 1}`;

              return (
                <div
                  key={rule.id || idx}
                  className="flex items-center justify-between border border-line bg-raised px-1.5 py-0.5 text-[9px] text-fg-primary"
                >
                  <span className="truncate font-mono">{ruleText}</span>
                  <span className="ml-1 text-accent font-bold">IF</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="font-mono text-[9px] text-fg-tertiary uppercase">NO RULES CONFIGURED</p>
        )}

        <div className="flex items-center justify-between border border-line bg-raised px-1.5 py-0.5 text-[9px] text-fg-secondary">
          <span className="flex items-center">
            <CornerDownRight className="mr-1 h-2.5 w-2.5 text-accent" />
            DEFAULT FALLBACK
          </span>
          <span className="font-bold text-fg-primary">ELSE</span>
        </div>
      </div>

      {/* Multiple source handles for branching */}
      {rules.map((rule, idx) => {
        const leftPercent = ((idx + 1) / (rules.length + 2)) * 100;
        return (
          <Handle
            key={rule.id || idx}
            type="source"
            position={Position.Bottom}
            id={rule.targetNodeId || `rule-${idx}`}
            style={{ left: `${leftPercent}%` }}
            className="!h-2.5 !w-2.5 !rounded-none !border !border-surface !bg-accent -bottom-1.5"
            title={`Branch: ${rule.branchKey || `Rule ${idx + 1}`}`}
          />
        );
      })}

      {/* Default fallback branch handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        style={{ left: `${((rules.length + 1) / (rules.length + 2)) * 100}%` }}
        className="!h-2.5 !w-2.5 !rounded-none !border !border-surface !bg-fg-secondary -bottom-1.5"
        title="Default Fallback Branch"
      />
    </div>
  );
}

'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { CheckCircle2, XCircle, Flag } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function EndNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const config = nodeData.config || {};
  const outcome = config.outcome || 'APPROVED';

  const isApproved = outcome === 'APPROVED' || outcome === 'AUTO_APPROVED';

  return (
    <div
      className={`relative min-w-[240px] max-w-[280px] rounded-none border bg-surface p-3.5 transition-colors shadow-none text-fg-primary ${
        selected
          ? 'border-accent ring-1 ring-accent'
          : isApproved
            ? 'border-emerald-600/40 hover:border-emerald-600'
            : 'border-danger/40 hover:border-danger'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className={`!h-2.5 !w-2.5 !rounded-none !border !border-surface -top-1.5 ${
          isApproved ? '!bg-emerald-500' : '!bg-danger'
        }`}
      />

      <div className="flex items-center space-x-2.5">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-none border ${
            isApproved
              ? 'border-emerald-600/40 bg-emerald-950/20 text-emerald-500'
              : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          {isApproved ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`font-mono text-[9px] uppercase tracking-widest block ${
              isApproved ? 'text-emerald-500' : 'text-danger'
            }`}
          >
            [ TERMINAL NODE ]
          </span>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'End of Workflow'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 border-t border-line pt-2 font-mono text-[10px]">
        <div className="flex items-center justify-between text-fg-secondary">
          <span className="flex items-center uppercase">
            <Flag className="mr-1 h-3 w-3 text-fg-tertiary" />
            FINAL OUTCOME
          </span>
          <span
            className={`font-bold uppercase ${isApproved ? 'text-emerald-500' : 'text-danger'}`}
          >
            {outcome}
          </span>
        </div>
      </div>
    </div>
  );
}

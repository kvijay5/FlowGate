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
      className={`relative min-w-[220px] max-w-[260px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? isApproved
            ? 'border-emerald-500 shadow-md ring-2 ring-emerald-200'
            : 'border-rose-500 shadow-md ring-2 ring-rose-200'
          : isApproved
            ? 'border-emerald-200 hover:border-emerald-300 hover:shadow'
            : 'border-rose-200 hover:border-rose-300 hover:shadow'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className={`!h-3 !w-3 !rounded-full !border-2 !border-white hover:!scale-125 ${
          isApproved ? '!bg-emerald-500' : '!bg-rose-500'
        }`}
      />

      <div className="flex items-center space-x-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}
        >
          {isApproved ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider ${
              isApproved ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            Terminal Node
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'End of Workflow'}
          </h4>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center text-slate-500">
            <Flag className="mr-1 h-3 w-3 text-slate-400" />
            Outcome:
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
              isApproved
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20'
            }`}
          >
            {outcome}
          </span>
        </div>
      </div>
    </div>
  );
}

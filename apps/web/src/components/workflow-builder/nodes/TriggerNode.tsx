'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Zap, Tag, Sparkles } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const fields = nodeData.config?.inputSchema?.fields || [];

  return (
    <div
      className={`relative min-w-[240px] max-w-[280px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? 'border-emerald-500 shadow-md ring-2 ring-emerald-200'
          : 'border-emerald-200 hover:border-emerald-300 hover:shadow'
      }`}
    >
      <div className="flex items-center space-x-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Zap className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
            Trigger
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'Workflow Trigger'}
          </h4>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-medium text-slate-600">Payload Schema:</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
        </div>

        {fields.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {fields.slice(0, 3).map((f) => (
              <span
                key={f.name}
                className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20"
              >
                <Tag className="mr-1 h-2.5 w-2.5 text-emerald-600" />
                {f.name}: <span className="ml-1 opacity-75">{f.type}</span>
                {f.required && <span className="ml-0.5 text-red-500">*</span>}
              </span>
            ))}
            {fields.length > 3 && (
              <span className="inline-flex items-center rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-400/20">
                +{fields.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] italic text-slate-400">No schema fields configured</p>
        )}
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-emerald-500 hover:!scale-125"
      />
    </div>
  );
}

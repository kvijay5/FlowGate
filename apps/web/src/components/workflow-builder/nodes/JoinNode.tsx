'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { GitMerge, Layers } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function JoinNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const config = nodeData.config || {};
  const policy = config.joinPolicy || 'ALL_INCOMING';

  return (
    <div
      className={`relative min-w-[220px] max-w-[260px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? 'border-cyan-500 shadow-md ring-2 ring-cyan-200'
          : 'border-cyan-200 hover:border-cyan-300 hover:shadow'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-cyan-500 hover:!scale-125"
      />

      <div className="flex items-center space-x-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
          <GitMerge className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-600">
            Join Gate
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'Join Synchronizer'}
          </h4>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center">
            <Layers className="mr-1 h-3 w-3 text-cyan-600" />
            Sync Policy:
          </span>
          <span className="font-semibold text-cyan-800">{policy}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Synchronizes all incoming parallel & conditional branches before advancing.
        </p>
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-cyan-500 hover:!scale-125"
      />
    </div>
  );
}

'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { UserCheck, Clock, FastForward, Shield } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function ApprovalNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const config = nodeData.config || {};
  const role = config.role || 'APPROVER';
  const timeoutHours = config.escalationTimeoutMinutes
    ? Math.round(config.escalationTimeoutMinutes / 60)
    : null;

  return (
    <div
      className={`relative min-w-[240px] max-w-[280px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? 'border-indigo-500 shadow-md ring-2 ring-indigo-200'
          : 'border-indigo-200 hover:border-indigo-300 hover:shadow'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-indigo-500 hover:!scale-125"
      />

      <div className="flex items-center space-x-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <UserCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
            Approval Step
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'Approval Step'}
          </h4>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Assigned:</span>
          <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
            <Shield className="mr-1 h-3 w-3 text-indigo-500" />
            {role}
          </span>
        </div>

        {timeoutHours !== null && (
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center text-slate-400">
              <Clock className="mr-1 h-3 w-3" />
              SLA Timeout:
            </span>
            <span className="font-medium text-slate-700">{timeoutHours}h</span>
          </div>
        )}

        {config.fastForwardOnResubmit && (
          <div className="flex items-center text-[10px] font-medium text-emerald-600">
            <FastForward className="mr-1 h-3 w-3" />
            Fast-forwards on resubmit
          </div>
        )}
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-indigo-500 hover:!scale-125"
      />
    </div>
  );
}

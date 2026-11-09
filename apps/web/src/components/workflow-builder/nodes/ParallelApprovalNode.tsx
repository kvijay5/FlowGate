'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Users, CheckCheck, AlertTriangle } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function ParallelApprovalNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const config = nodeData.config || {};
  const policy = config.policy || 'PARALLEL_OR';
  const rejectionPolicy = config.rejectionPolicy || 'SOFT_REJECTION';
  const assignees = config.assignees || [];
  const required = config.requiredApprovals || 1;

  const isOr = policy === 'PARALLEL_OR';

  return (
    <div
      className={`relative min-w-[250px] max-w-[290px] rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
        selected
          ? 'border-purple-500 shadow-md ring-2 ring-purple-200'
          : 'border-purple-200 hover:border-purple-300 hover:shadow'
      }`}
    >
      {/* Incoming connection handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-purple-500 hover:!scale-125"
      />

      <div className="flex items-center space-x-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-600">
              Parallel Stage
            </span>
            <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[9px] font-bold text-purple-800">
              {isOr ? 'QUORUM' : 'UNANIMOUS'}
            </span>
          </div>
          <h4 className="truncate text-sm font-semibold text-slate-800">
            {nodeData.label || 'Parallel Approvals'}
          </h4>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-2.5">
        {/* Quorum Badge */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Threshold:</span>
          <span className="inline-flex items-center font-semibold text-purple-700">
            <CheckCheck className="mr-1 h-3.5 w-3.5 text-purple-600" />
            {isOr ? `${required} of ${assignees.length} required` : 'All must approve'}
          </span>
        </div>

        {/* Rejection Policy Flag */}
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="text-slate-400">Rejection:</span>
          <span
            className={`font-medium ${
              rejectionPolicy === 'STRICT_VETO' ? 'text-amber-600' : 'text-slate-600'
            }`}
          >
            {rejectionPolicy === 'STRICT_VETO' ? 'Strict Veto (1 veto fails)' : 'Soft Rejection'}
          </span>
        </div>

        {/* Approver Badges */}
        <div className="flex flex-wrap gap-1 pt-1">
          {assignees.map((a, idx) => (
            <span
              key={idx}
              className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
            >
              {a.role || a.userId || 'Approver'}
            </span>
          ))}
          {assignees.length === 0 && (
            <span className="flex items-center text-[10px] text-amber-600">
              <AlertTriangle className="mr-1 h-3 w-3" />
              No approvers configured
            </span>
          )}
        </div>
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-purple-500 hover:!scale-125"
      />
    </div>
  );
}

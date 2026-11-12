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
      className={`relative min-w-[250px] max-w-[290px] rounded-none border bg-surface p-3.5 transition-colors shadow-none text-fg-primary ${
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
          <Users className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center space-x-1.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary">
              [ PARALLEL STAGE ]
            </span>
            <span className="border border-line bg-raised px-1 py-0.2 font-mono text-[9px] font-bold text-accent uppercase">
              {isOr ? 'QUORUM' : 'UNANIMOUS'}
            </span>
          </div>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'Parallel Approvals'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 border-t border-line pt-2 font-mono text-[10px]">
        {/* Quorum Badge */}
        <div className="flex items-center justify-between text-fg-secondary">
          <span className="uppercase">QUORUM</span>
          <span className="inline-flex items-center font-bold text-fg-primary uppercase">
            <CheckCheck className="mr-1 h-3 w-3 text-accent" />
            {isOr ? `${required} OF ${assignees.length} REQ` : 'UNANIMOUS REQ'}
          </span>
        </div>

        {/* Rejection Policy */}
        <div className="flex items-center justify-between text-fg-secondary">
          <span className="uppercase">VETO POLICY</span>
          <span
            className={`font-bold uppercase ${
              rejectionPolicy === 'STRICT_VETO' ? 'text-danger' : 'text-fg-primary'
            }`}
          >
            {rejectionPolicy === 'STRICT_VETO' ? 'STRICT VETO' : 'SOFT REJECT'}
          </span>
        </div>

        {/* Approver Badges */}
        <div className="flex flex-wrap gap-1 pt-1 font-mono text-[9px]">
          {assignees.map((a, idx) => (
            <span
              key={idx}
              className="border border-line bg-raised px-1.5 py-0.5 text-fg-secondary uppercase font-medium"
            >
              {a.role || a.userId || 'APPROVER'}
            </span>
          ))}
          {assignees.length === 0 && (
            <span className="flex items-center text-danger">
              <AlertTriangle className="mr-1 h-3 w-3" />
              NO VOTERS CONFIGURED
            </span>
          )}
        </div>
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-none !border !border-surface !bg-accent -bottom-1.5"
      />
    </div>
  );
}

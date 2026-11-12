'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { UserCheck, Clock, Shield } from 'lucide-react';
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
          <UserCheck className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary block">
            [ APPROVAL STEP ]
          </span>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'Approval Step'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 border-t border-line pt-2 font-mono text-[10px]">
        <div className="flex items-center justify-between text-fg-secondary">
          <span className="uppercase">ROLE</span>
          <span className="inline-flex items-center border border-line bg-raised px-1.5 py-0.5 text-fg-primary uppercase font-bold">
            <Shield className="mr-1 h-2.5 w-2.5 text-accent" />
            {role}
          </span>
        </div>

        {timeoutHours !== null && (
          <div className="flex items-center justify-between text-fg-secondary">
            <span className="flex items-center uppercase">
              <Clock className="mr-1 h-2.5 w-2.5 text-fg-tertiary" />
              SLA
            </span>
            <span className="font-bold text-fg-primary">{timeoutHours}H TIMEOUT</span>
          </div>
        )}
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

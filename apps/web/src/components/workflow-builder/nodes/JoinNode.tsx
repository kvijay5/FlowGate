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
      className={`relative min-w-[240px] max-w-[280px] rounded-none border bg-surface p-3.5 transition-colors shadow-none text-fg-primary ${
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
          <GitMerge className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary block">
            [ JOIN SYNCHRONIZER ]
          </span>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'Join Synchronizer'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 border-t border-line pt-2 font-mono text-[10px]">
        <div className="flex items-center justify-between text-fg-secondary">
          <span className="flex items-center uppercase">
            <Layers className="mr-1 h-3 w-3 text-accent" />
            SYNC POLICY
          </span>
          <span className="font-bold text-fg-primary uppercase">{policy}</span>
        </div>
        <p className="mt-1 font-mono text-[9px] text-fg-tertiary uppercase leading-tight">
          SYNCHRONIZES ALL INCOMING BRANCHES BEFORE ADVANCING
        </p>
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

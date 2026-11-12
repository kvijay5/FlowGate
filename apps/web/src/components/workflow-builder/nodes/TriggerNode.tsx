'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Zap, Tag } from 'lucide-react';
import { WorkflowBuilderNodeData } from '../types';

export function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowBuilderNodeData;
  const fields = nodeData.config?.inputSchema?.fields || [];

  return (
    <div
      className={`relative min-w-[250px] max-w-[290px] rounded-none border bg-surface p-3.5 transition-colors shadow-none text-fg-primary ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-fg-secondary'
      }`}
    >
      <div className="flex items-center space-x-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-none border border-line bg-raised text-accent">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary block">
            [ TRIGGER NODE ]
          </span>
          <h4 className="font-serif font-bold text-xs text-fg-primary truncate tracking-tight">
            {nodeData.label || 'Workflow Trigger'}
          </h4>
        </div>
      </div>

      <div className="mt-2.5 border-t border-line pt-2">
        <div className="flex items-center justify-between font-mono text-[10px] text-fg-secondary uppercase">
          <span>SCHEMA PAYLOAD</span>
          <span className="border border-line bg-raised px-1 py-0.2 text-[9px] text-fg-primary">
            {fields.length} {fields.length === 1 ? 'FIELD' : 'FIELDS'}
          </span>
        </div>

        {fields.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[9px]">
            {fields.slice(0, 3).map((f) => (
              <span
                key={f.name}
                className="inline-flex items-center border border-line bg-raised px-1 py-0.5 text-fg-secondary uppercase"
              >
                <Tag className="mr-1 h-2.5 w-2.5 text-accent" />
                {f.name}: {f.type}
                {f.required && <span className="ml-0.5 text-accent">*</span>}
              </span>
            ))}
            {fields.length > 3 && (
              <span className="border border-line bg-raised px-1 py-0.5 text-fg-tertiary">
                +{fields.length - 3} MORE
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 font-mono text-[9px] text-fg-tertiary uppercase">NO PAYLOAD FIELDS</p>
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

'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Play,
  CheckCircle2,
  Users,
  GitBranch,
  Split,
  Flag,
  Clock,
  AlertTriangle,
  XCircle,
  HelpCircle,
  UserCheck,
} from 'lucide-react';
import { NodeExecutionStatus, StepStatus } from '@flowgate/shared-types';

export interface ExecutionNodeData {
  id: string;
  name: string;
  nodeType: string;
  status: NodeExecutionStatus | 'ACTIVE' | 'PRUNED_SKIPPED' | 'REJECTED';
  activatedAt?: string | null;
  completedAt?: string | null;
  assignees?: Array<{
    id?: string;
    name?: string;
    role?: string;
    status: StepStatus;
    isDelegated?: boolean;
    delegatedFrom?: string;
    comments?: string | null;
  }>;
  quorumDetails?: {
    policy?: string;
    requiredApprovals?: number;
    totalAssigned?: number;
    approvedCount?: number;
    rejectedCount?: number;
  };
  evaluationTrace?: Record<string, unknown> | null;
  comments?: string | null;
  isSelected?: boolean;
}

export const ExecutionNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as ExecutionNodeData;
  const {
    name,
    nodeType,
    status = 'PENDING',
    activatedAt,
    completedAt,
    assignees = [],
    quorumDetails,
  } = nodeData;

  const isCompleted = status === 'COMPLETED';
  const isActive = status === 'IN_REVIEW' || status === 'ACTIVE';
  const isPruned = status === 'PRUNED_SKIPPED' || status === 'SKIPPED';
  const isRejected = status === 'REJECTED' || status === 'FAILED';
  const isPending = status === 'PENDING';

  // Determine container styling based on execution status
  let containerStyle = 'bg-slate-900 border-slate-700 text-slate-300';
  let badgeStyle = 'bg-slate-800 text-slate-400 border-slate-700';
  let statusText = 'Pending';
  let StatusIcon = Clock;

  if (isCompleted) {
    containerStyle =
      'bg-emerald-950/40 border-emerald-500 shadow-md shadow-emerald-900/20 text-emerald-100';
    badgeStyle = 'bg-emerald-900/80 text-emerald-200 border-emerald-600';
    statusText = 'Completed';
    StatusIcon = CheckCircle2;
  } else if (isActive) {
    containerStyle =
      'bg-indigo-950/60 border-indigo-500 shadow-lg shadow-indigo-900/30 text-indigo-100 ring-2 ring-indigo-500/30 animate-pulse';
    badgeStyle = 'bg-indigo-600 text-white border-indigo-400';
    statusText = 'Active / In Review';
    StatusIcon = Clock;
  } else if (isRejected) {
    containerStyle = 'bg-red-950/50 border-red-500 shadow-md shadow-red-900/20 text-red-100';
    badgeStyle = 'bg-red-900/80 text-red-200 border-red-600';
    statusText = 'Rejected';
    StatusIcon = XCircle;
  } else if (isPruned) {
    containerStyle = 'bg-slate-900/30 border-slate-700/60 border-dashed opacity-50 text-slate-500';
    badgeStyle = 'bg-slate-800/60 text-slate-500 border-slate-700';
    statusText = 'Pruned / Skipped';
    StatusIcon = AlertTriangle;
  }

  // Node type icon
  let TypeIcon = HelpCircle;
  switch (nodeType) {
    case 'TRIGGER':
      TypeIcon = Play;
      break;
    case 'APPROVAL_STEP':
    case 'APPROVAL':
      TypeIcon = UserCheck;
      break;
    case 'PARALLEL_APPROVAL':
    case 'PARALLEL':
      TypeIcon = Users;
      break;
    case 'CONDITION':
      TypeIcon = GitBranch;
      break;
    case 'JOIN':
      TypeIcon = Split;
      break;
    case 'END':
      TypeIcon = Flag;
      break;
  }

  // Check for quorum loss in parallel nodes
  const isParallel = nodeType === 'PARALLEL_APPROVAL' || nodeType === 'PARALLEL';
  const required = quorumDetails?.requiredApprovals || 1;
  const approved = quorumDetails?.approvedCount || 0;
  const rejected = quorumDetails?.rejectedCount || 0;
  const total = quorumDetails?.totalAssigned || assignees.length || 1;
  const remainingPotential = total - rejected;
  const isQuorumLost = isParallel && remainingPotential < required && !isCompleted;

  return (
    <div
      className={`relative min-w-[220px] max-w-[280px] rounded-xl border-2 p-3.5 transition-all cursor-pointer ${containerStyle} ${
        selected ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-indigo-400' : ''
      }`}
    >
      {/* Handles */}
      {nodeType !== 'TRIGGER' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-slate-500 !border-2 !border-slate-900 -top-1.5"
        />
      )}
      {nodeType !== 'END' && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-slate-500 !border-2 !border-slate-900 -bottom-1.5"
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700">
            <TypeIcon className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
              {nodeType.replace('_', ' ')}
            </span>
            <h4 className="font-semibold text-xs text-white leading-tight">{name}</h4>
          </div>
        </div>

        {/* Status Badge */}
        <span
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border flex items-center space-x-1 shrink-0 ${badgeStyle}`}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          <span>{statusText}</span>
        </span>
      </div>

      {/* Parallel Approver Voter Chips */}
      {isParallel && (
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-400 font-medium">Quorum Progress</span>
            <span
              className={`font-bold ${isQuorumLost ? 'text-red-400' : isCompleted ? 'text-emerald-400' : 'text-indigo-400'}`}
            >
              {approved} / {required} Approvals
            </span>
          </div>

          {/* Mini Voter Chips */}
          <div className="flex flex-wrap gap-1">
            {assignees.map((a, idx) => {
              const isVoterApproved = a.status === 'APPROVED';
              const isVoterRejected = a.status === 'REJECTED';
              let voterChip = 'bg-slate-800 text-slate-400 border-slate-700';

              if (isVoterApproved) {
                voterChip = 'bg-emerald-950 text-emerald-300 border-emerald-800';
              } else if (isVoterRejected) {
                voterChip = 'bg-red-950 text-red-300 border-red-800';
              }

              return (
                <span
                  key={a.id || idx}
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-medium flex items-center space-x-1 ${voterChip}`}
                  title={a.comments ? `Comment: ${a.comments}` : undefined}
                >
                  <span>{a.name || a.role || `Voter ${idx + 1}`}</span>
                  {isVoterApproved && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />}
                  {isVoterRejected && <XCircle className="h-2.5 w-2.5 text-red-400" />}
                </span>
              );
            })}
          </div>

          {isQuorumLost && (
            <div className="p-1 rounded bg-red-950/80 border border-red-800 text-[9px] text-red-300 flex items-center space-x-1 font-medium">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              <span>Quorum threshold mathematically unachievable</span>
            </div>
          )}
        </div>
      )}

      {/* Execution Timestamps */}
      <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
        {completedAt ? (
          <span>Done {new Date(completedAt).toLocaleTimeString()}</span>
        ) : activatedAt ? (
          <span>Active since {new Date(activatedAt).toLocaleTimeString()}</span>
        ) : (
          <span>Awaiting activation</span>
        )}
        <span className="text-[9px] text-slate-500 font-mono">Click for details</span>
      </div>
    </div>
  );
};

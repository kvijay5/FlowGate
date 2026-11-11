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
  let containerStyle =
    'bg-[#0B0D19]/90 border-white/10 text-slate-300 shadow-lg backdrop-blur-md hover:border-white/20';
  let badgeStyle = 'bg-white/[0.04] text-slate-400 border-white/10';
  let statusText = 'Pending';
  let StatusIcon = Clock;

  if (isCompleted) {
    containerStyle =
      'bg-gradient-to-b from-emerald-950/40 to-[#0B0D19]/90 border-emerald-500/80 shadow-lg shadow-emerald-500/10 text-emerald-100 ring-1 ring-emerald-500/30';
    badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]';
    statusText = 'Completed';
    StatusIcon = CheckCircle2;
  } else if (isActive) {
    containerStyle =
      'bg-gradient-to-b from-cyan-950/50 to-[#0B0D19]/90 border-cyan-400 shadow-xl shadow-cyan-500/25 text-cyan-100 ring-2 ring-cyan-500/40 animate-pulse';
    badgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)]';
    statusText = 'Active / In Review';
    StatusIcon = Clock;
  } else if (isRejected) {
    containerStyle =
      'bg-gradient-to-b from-rose-950/50 to-[#0B0D19]/90 border-rose-500/80 shadow-lg shadow-rose-500/20 text-rose-100 ring-1 ring-rose-500/30';
    badgeStyle = 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)]';
    statusText = 'Rejected';
    StatusIcon = XCircle;
  } else if (isPruned) {
    containerStyle =
      'bg-[#07080F]/60 border-slate-800/80 border-dashed opacity-40 text-slate-500';
    badgeStyle = 'bg-white/[0.02] text-slate-500 border-white/5';
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
      className={`relative min-w-[220px] max-w-[280px] rounded-2xl border-2 p-3.5 transition-all cursor-pointer backdrop-blur-md ${containerStyle} ${
        selected ? 'ring-2 ring-offset-2 ring-offset-[#05050A] ring-cyan-400' : ''
      }`}
    >
      {/* Handles */}
      {nodeType !== 'TRIGGER' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-[#05050A] !shadow-[0_0_8px_rgba(6,182,212,0.8)] -top-1.5"
        />
      )}
      {nodeType !== 'END' && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-[#05050A] !shadow-[0_0_8px_rgba(6,182,212,0.8)] -bottom-1.5"
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-cyan-300">
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

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
  status: NodeExecutionStatus | StepStatus | 'ACTIVE' | 'PRUNED_SKIPPED' | 'REJECTED';
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
    id,
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

  // HUD styling based on execution status
  let containerStyle = 'bg-surface border-line text-fg-primary hover:border-fg-secondary';
  let badgeStyle = 'bg-surface text-fg-secondary border-line';
  let statusText = 'PENDING';
  let StatusIcon = Clock;

  if (isCompleted) {
    containerStyle = 'bg-surface border-emerald-600/60 text-fg-primary';
    badgeStyle = 'bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-600/40';
    statusText = 'COMPLETED';
    StatusIcon = CheckCircle2;
  } else if (isActive) {
    containerStyle = 'bg-surface border-accent ring-1 ring-accent text-fg-primary animate-pulse';
    badgeStyle = 'bg-accent/15 text-accent border-accent';
    statusText = 'ACTIVE';
    StatusIcon = Clock;
  } else if (isRejected) {
    containerStyle = 'bg-surface border-danger text-fg-primary';
    badgeStyle = 'bg-danger/15 text-danger border-danger';
    statusText = 'REJECTED';
    StatusIcon = XCircle;
  } else if (isPruned) {
    containerStyle = 'bg-surface/60 border-line border-dashed opacity-40 text-fg-secondary';
    badgeStyle = 'bg-surface text-fg-tertiary border-line';
    statusText = 'PRUNED';
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
      className={`relative min-w-[240px] max-w-[290px] rounded-none border p-3.5 transition-colors cursor-pointer shadow-none ${containerStyle} ${
        selected ? 'ring-2 ring-accent' : ''
      }`}
    >
      {/* Schematic Square Handles */}
      {nodeType !== 'TRIGGER' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !rounded-none !bg-accent !border !border-surface -top-1.5"
        />
      )}
      {nodeType !== 'END' && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2.5 !h-2.5 !rounded-none !bg-accent !border !border-surface -bottom-1.5"
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1 rounded-none border border-line bg-raised text-accent shrink-0">
            <TypeIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <span className="font-mono text-[9px] uppercase tracking-widest text-fg-secondary block truncate">
              {nodeType.replace('_', ' ')} • {id.slice(-6)}
            </span>
            <h4 className="font-serif font-bold text-xs text-fg-primary leading-tight truncate">
              {name}
            </h4>
          </div>
        </div>

        {/* Status Badge */}
        <span
          className={`font-mono px-1.5 py-0.5 rounded-none text-[9px] font-medium uppercase tracking-wider border flex items-center space-x-1 shrink-0 ${badgeStyle}`}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          <span>[ {statusText} ]</span>
        </span>
      </div>

      {/* Parallel Approver Voter Chips */}
      {isParallel && (
        <div className="mt-2 pt-2 border-t border-line space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-fg-secondary uppercase">QUORUM</span>
            <span
              className={`font-bold ${isQuorumLost ? 'text-danger' : isCompleted ? 'text-emerald-500' : 'text-accent'}`}
            >
              {approved} / {required} REQ
            </span>
          </div>

          {/* Mini Voter Chips */}
          <div className="flex flex-wrap gap-1">
            {assignees.map((a, idx) => {
              const isVoterApproved = a.status === 'APPROVED';
              const isVoterRejected = a.status === 'REJECTED';
              let voterChip = 'bg-raised text-fg-secondary border-line';

              if (isVoterApproved) {
                voterChip =
                  'bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-600/40';
              } else if (isVoterRejected) {
                voterChip = 'bg-danger/10 text-danger border-danger/40';
              }

              return (
                <span
                  key={a.id || idx}
                  className={`font-mono text-[9px] px-1 py-0.5 rounded-none border uppercase tracking-wider flex items-center space-x-1 ${voterChip}`}
                  title={a.comments ? `Comment: ${a.comments}` : undefined}
                >
                  <span>{a.name || a.role || `VOTER ${idx + 1}`}</span>
                  {isVoterApproved && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
                  {isVoterRejected && <XCircle className="h-2.5 w-2.5 text-danger" />}
                </span>
              );
            })}
          </div>

          {isQuorumLost && (
            <div className="p-1 rounded-none bg-danger/10 border border-danger font-mono text-[9px] text-danger flex items-center space-x-1">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              <span>[ ALERT: QUORUM UNREACHABLE ]</span>
            </div>
          )}
        </div>
      )}

      {/* Execution Timestamps */}
      <div className="mt-2 pt-1.5 border-t border-line flex items-center justify-between font-mono text-[9px] text-fg-secondary uppercase tracking-wider">
        {completedAt ? (
          <span>DONE {new Date(completedAt).toLocaleTimeString()}</span>
        ) : activatedAt ? (
          <span className="text-accent">ACTIVE {new Date(activatedAt).toLocaleTimeString()}</span>
        ) : (
          <span>STANDBY</span>
        )}
        <span className="text-fg-tertiary">CLICK FOR TRACE</span>
      </div>
    </div>
  );
};

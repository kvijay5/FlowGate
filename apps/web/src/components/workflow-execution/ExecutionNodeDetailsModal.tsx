'use client';

import React from 'react';
import {
  X,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GitBranch,
  UserCheck,
  Shield,
  FileCode,
  MessageSquare,
} from 'lucide-react';
import { ExecutionNodeData } from './ExecutionNode';

interface ExecutionNodeDetailsModalProps {
  nodeData: ExecutionNodeData | null;
  onClose: () => void;
}

export const ExecutionNodeDetailsModal: React.FC<ExecutionNodeDetailsModalProps> = ({
  nodeData,
  onClose,
}) => {
  if (!nodeData) return null;

  const {
    name,
    nodeType,
    status,
    activatedAt,
    completedAt,
    assignees = [],
    quorumDetails,
    evaluationTrace,
    comments,
  } = nodeData;

  const isCompleted = status === 'COMPLETED';
  const isActive = status === 'IN_REVIEW' || status === 'ACTIVE';
  const isRejected = status === 'REJECTED' || status === 'FAILED';
  const isPruned = status === 'PRUNED_SKIPPED' || status === 'SKIPPED';

  // Calculate duration if start and end exist
  let durationText: string | null = null;
  if (activatedAt && completedAt) {
    const start = new Date(activatedAt).getTime();
    const end = new Date(completedAt).getTime();
    const diffSec = Math.max(0, Math.round((end - start) / 1000));
    if (diffSec < 60) {
      durationText = `${diffSec}s`;
    } else {
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      durationText = `${mins}m ${secs}s`;
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-border-subtle rounded-none w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl p-5 space-y-5 font-mono">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border-subtle pb-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider bg-canvas text-fg-muted border border-border-subtle">
                {nodeType}
              </span>
              <span
                className={`px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider border ${
                  isCompleted
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                    : isActive
                      ? 'bg-accent/20 text-accent-foreground border-accent/40 animate-pulse'
                      : isRejected
                        ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                        : isPruned
                          ? 'bg-canvas text-fg-subtle border-border-subtle'
                          : 'bg-canvas text-fg-muted border-border-subtle'
                }`}
              >
                [ {status} ]
              </span>
            </div>
            <h3 className="text-base font-serif font-bold text-ink">{name}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none text-fg-muted hover:text-ink hover:bg-canvas transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Timestamps & Duration */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-none bg-canvas border border-border-subtle text-xs">
          <div>
            <span className="text-fg-subtle text-[10px] uppercase font-bold block">
              Activated At
            </span>
            <span className="text-ink">
              {activatedAt ? new Date(activatedAt).toLocaleString() : 'Not activated'}
            </span>
          </div>
          <div>
            <span className="text-fg-subtle text-[10px] uppercase font-bold block">
              Resolved At
            </span>
            <span className="text-ink">
              {completedAt ? new Date(completedAt).toLocaleString() : 'Pending completion'}
            </span>
          </div>
          {durationText && (
            <div className="col-span-2 pt-2 border-t border-border-subtle flex items-center justify-between text-accent">
              <span className="flex items-center space-x-1.5 font-medium">
                <Clock className="h-3.5 w-3.5" />
                <span>Execution Duration</span>
              </span>
              <span className="font-mono font-bold">{durationText}</span>
            </div>
          )}
        </div>

        {/* Parallel Quorum Breakdown */}
        {quorumDetails && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
              [ PARALLEL QUORUM STATUS ]
            </h4>
            <div className="p-3 rounded-none bg-canvas border border-border-subtle space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Policy:</span>
                <span className="font-semibold text-ink">
                  {quorumDetails.policy || 'PARALLEL_AND'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Required Approvals:</span>
                <span className="font-bold text-accent">
                  {quorumDetails.requiredApprovals || 1}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Current Approvals:</span>
                <span className="font-bold text-emerald-400">
                  {quorumDetails.approvedCount || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Current Rejections:</span>
                <span className="font-bold text-rose-400">{quorumDetails.rejectedCount || 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Assignees & Voter Decisions */}
        {assignees.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
              [ ASSIGNEE DECISIONS ({assignees.length}) ]
            </h4>
            <div className="space-y-2">
              {assignees.map((a, idx) => {
                const isVoteApproved = a.status === 'APPROVED';
                const isVoteRejected = a.status === 'REJECTED';
                return (
                  <div
                    key={a.id || idx}
                    className="p-3 rounded-none bg-canvas border border-border-subtle space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-ink">
                          {a.name || a.role || `Assignee ${idx + 1}`}
                        </span>
                        {a.role && (
                          <span className="text-[10px] text-fg-muted px-1.5 py-0.5 rounded-none bg-surface border border-border-subtle">
                            {a.role}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-none border ${
                          isVoteApproved
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : isVoteRejected
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : 'bg-surface text-fg-muted border-border-subtle'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>

                    {/* Delegation Badge */}
                    {a.isDelegated && (
                      <div className="text-[10px] text-amber-300 flex items-center space-x-1 font-medium bg-amber-950/40 p-1.5 rounded-none border border-amber-800/60">
                        <Shield className="h-3 w-3 shrink-0" />
                        <span>Delegated by {a.delegatedFrom || 'Designated Approver'}</span>
                      </div>
                    )}

                    {/* Voter Comments */}
                    {a.comments && (
                      <div className="text-[11px] text-ink bg-surface p-2 rounded-none border border-border-subtle flex items-start space-x-2">
                        <MessageSquare className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                        <span>{a.comments}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Condition Evaluation Trace */}
        {evaluationTrace && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-fg-muted">
              <FileCode className="h-3.5 w-3.5 text-accent" />
              <span>[ AST Evaluation Trace ]</span>
            </div>
            <pre className="p-3 rounded-none bg-canvas border border-border-subtle text-[11px] font-mono text-accent overflow-x-auto max-h-48">
              {JSON.stringify(evaluationTrace, null, 2)}
            </pre>
          </div>
        )}

        {/* Node Level Comments */}
        {comments && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-fg-subtle block">
              Node Comments / Reason
            </span>
            <div className="p-3 bg-canvas rounded-none text-xs text-ink border border-border-subtle">
              {comments}
            </div>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-canvas hover:bg-surface text-ink border border-border-subtle text-xs font-semibold uppercase tracking-wider rounded-none transition-colors"
          >
            [ Close Details ]
          </button>
        </div>
      </div>
    </div>
  );
};

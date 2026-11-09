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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {nodeType}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  isCompleted
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : isActive
                      ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                      : isRejected
                        ? 'bg-red-950 text-red-300 border-red-800'
                        : isPruned
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {status}
              </span>
            </div>
            <h3 className="text-base font-bold text-white">{name}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Timestamps & Duration */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <div>
            <span className="text-slate-500 text-[10px] uppercase font-bold block">
              Activated At
            </span>
            <span className="text-slate-200">
              {activatedAt ? new Date(activatedAt).toLocaleString() : 'Not activated'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] uppercase font-bold block">
              Resolved At
            </span>
            <span className="text-slate-200">
              {completedAt ? new Date(completedAt).toLocaleString() : 'Pending completion'}
            </span>
          </div>
          {durationText && (
            <div className="col-span-2 pt-2 border-t border-slate-850 flex items-center justify-between text-indigo-300">
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
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Parallel Quorum Status
            </h4>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Policy:</span>
                <span className="font-semibold text-slate-200">
                  {quorumDetails.policy || 'PARALLEL_AND'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Required Approvals:</span>
                <span className="font-bold text-indigo-300">
                  {quorumDetails.requiredApprovals || 1}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Current Approvals:</span>
                <span className="font-bold text-emerald-400">
                  {quorumDetails.approvedCount || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Current Rejections:</span>
                <span className="font-bold text-red-400">{quorumDetails.rejectedCount || 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Assignees & Voter Decisions */}
        {assignees.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Assignee Decisions ({assignees.length})
            </h4>
            <div className="space-y-2">
              {assignees.map((a, idx) => {
                const isVoteApproved = a.status === 'APPROVED';
                const isVoteRejected = a.status === 'REJECTED';
                return (
                  <div
                    key={a.id || idx}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-200">
                          {a.name || a.role || `Assignee ${idx + 1}`}
                        </span>
                        {a.role && (
                          <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                            {a.role}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          isVoteApproved
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : isVoteRejected
                              ? 'bg-red-950 text-red-300 border-red-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>

                    {/* Delegation Badge */}
                    {a.isDelegated && (
                      <div className="text-[10px] text-amber-300 flex items-center space-x-1 font-medium bg-amber-950/40 p-1.5 rounded border border-amber-800/60">
                        <Shield className="h-3 w-3 shrink-0" />
                        <span>Delegated by {a.delegatedFrom || 'Designated Approver'}</span>
                      </div>
                    )}

                    {/* Voter Comments */}
                    {a.comments && (
                      <div className="text-[11px] text-slate-300 bg-slate-900 p-2 rounded border border-slate-800 flex items-start space-x-2">
                        <MessageSquare className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
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
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <FileCode className="h-3.5 w-3.5 text-indigo-400" />
              <span>AST Evaluation Trace</span>
            </div>
            <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-indigo-300 overflow-x-auto max-h-48">
              {JSON.stringify(evaluationTrace, null, 2)}
            </pre>
          </div>
        )}

        {/* Node Level Comments */}
        {comments && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-slate-500 block">
              Node Comments / Reason
            </span>
            <div className="p-3 bg-slate-950 rounded-xl text-xs text-slate-300 border border-slate-800">
              {comments}
            </div>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};

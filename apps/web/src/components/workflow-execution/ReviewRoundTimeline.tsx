'use client';

import React from 'react';
import {
  RotateCcw,
  FastForward,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { ApprovalStepDetail, AuditLogSummary, ResubmissionPolicy } from '@flowgate/shared-types';

interface ReviewRoundTimelineProps {
  currentRound: number;
  selectedRound: number;
  onSelectRound: (round: number) => void;
  steps: ApprovalStepDetail[];
  auditLogs?: AuditLogSummary[];
  status: string;
}

export const ReviewRoundTimeline: React.FC<ReviewRoundTimelineProps> = ({
  currentRound,
  selectedRound,
  onSelectRound,
  steps,
  auditLogs = [],
  status,
}) => {
  // Extract all unique round numbers from steps, node executions, and currentReviewRound
  const allRounds = Array.from(
    new Set([
      ...steps.map((s) => s.reviewRound || 1),
      ...Array.from({ length: currentRound }, (_, i) => i + 1),
    ]),
  ).sort((a, b) => a - b);

  // Find resubmission audit logs for metadata (e.g. policy, comments, timestamp)
  const resubmissionLogs = auditLogs.filter((l) => l.action === 'REQUEST_RESUBMITTED');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-200">
            Review Round Timeline & Snapshot Navigation
          </h4>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">
          Total Rounds: <span className="font-bold text-indigo-300">{allRounds.length}</span>{' '}
          (Active: Round #{currentRound})
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        {allRounds.map((round) => {
          const isSelected = selectedRound === round;
          const isCurrent = round === currentRound;
          const roundSteps = steps.filter((s) => (s.reviewRound || 1) === round);
          const allApproved =
            roundSteps.length > 0 && roundSteps.every((s) => s.status === 'APPROVED');
          const hasRejected = roundSteps.some((s) => s.status === 'REJECTED');
          const hasChangesRequested = status === 'CHANGES_REQUESTED' && isCurrent;

          // Find log entry for this round if resubmitted
          const resubmitLog = resubmissionLogs.find(
            (log) => (log.metadata as any)?.reviewRound === round,
          );
          const policy: ResubmissionPolicy | undefined = (resubmitLog?.metadata as any)
            ?.resubmissionPolicy;

          return (
            <button
              key={round}
              onClick={() => onSelectRound(round)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 border transition-all shrink-0 ${
                isSelected
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <span>Round {round}</span>
              {isCurrent && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9px] uppercase font-bold ${
                    isSelected
                      ? 'bg-indigo-800 text-indigo-200'
                      : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                  }`}
                >
                  Current
                </span>
              )}
              {allApproved && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              {hasRejected && <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
              {hasChangesRequested && <RotateCcw className="h-3.5 w-3.5 text-amber-400" />}
            </button>
          );
        })}
      </div>

      {/* Selected Round Snapshot Details Banner */}
      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-200">
              Viewing Snapshot: Round #{selectedRound}
            </span>
            {selectedRound < currentRound && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-800">
                Immutable Past Snapshot
              </span>
            )}
            {selectedRound === currentRound && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-800">
                Live State
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            {selectedRound === currentRound
              ? 'Reflecting live execution status and pending approver decisions.'
              : `Viewing the frozen state of Round ${selectedRound}. All steps and decisions below represent this round's record.`}
          </p>
        </div>

        {/* Resubmission Policy Indicator */}
        {selectedRound > 1 && (
          <div className="flex items-center space-x-2 p-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0">
            <div className="flex items-center space-x-1.5 text-indigo-300 font-semibold text-[11px]">
              <FastForward className="h-3.5 w-3.5" />
              <span>Policy:</span>
            </div>
            <span className="text-[11px] font-mono text-slate-200 uppercase bg-slate-800 px-2 py-0.5 rounded">
              SELECTIVE FAST FORWARD
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

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
    <div className="bg-surface border border-border-subtle rounded-none p-4 space-y-3 font-mono">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex items-center space-x-2">
          <Layers className="h-4 w-4 text-accent" />
          <h4 className="font-bold text-xs uppercase tracking-wider text-ink">
            [ REVIEW ROUND TIMELINE & SNAPSHOT NAVIGATION ]
          </h4>
        </div>
        <span className="text-[11px] text-fg-muted font-medium">
          TOTAL ROUNDS: <span className="font-bold text-accent">{allRounds.length}</span> (ACTIVE:
          ROUND #{currentRound})
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

          return (
            <button
              key={round}
              onClick={() => onSelectRound(round)}
              className={`px-3 py-1.5 rounded-none text-xs font-mono font-semibold uppercase tracking-wider flex items-center space-x-2 border transition-all shrink-0 ${
                isSelected
                  ? 'bg-accent text-white border-accent'
                  : 'bg-canvas text-fg-muted border-border-subtle hover:border-accent/40 hover:text-ink'
              }`}
            >
              <span>Round {round}</span>
              {isCurrent && (
                <span
                  className={`px-1.5 py-0.2 rounded-none text-[9px] uppercase font-bold border ${
                    isSelected
                      ? 'bg-black/30 text-white border-white/20'
                      : 'bg-accent/20 text-accent border-accent/40'
                  }`}
                >
                  LIVE
                </span>
              )}
              {allApproved && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              {hasRejected && <AlertCircle className="h-3.5 w-3.5 text-rose-400" />}
              {hasChangesRequested && <RotateCcw className="h-3.5 w-3.5 text-amber-400" />}
            </button>
          );
        })}
      </div>

      {/* Selected Round Snapshot Details Banner */}
      <div className="p-3 bg-canvas rounded-none border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-ink">[ SNAPSHOT: ROUND #{selectedRound} ]</span>
            {selectedRound < currentRound && (
              <span className="px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider bg-amber-950/80 text-amber-300 border border-amber-800">
                Immutable Past Snapshot
              </span>
            )}
            {selectedRound === currentRound && (
              <span className="px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                Live State
              </span>
            )}
          </div>
          <p className="text-[11px] text-fg-muted">
            {selectedRound === currentRound
              ? 'Reflecting live execution status and pending approver decisions.'
              : `Viewing the frozen state of Round ${selectedRound}. All steps and decisions below represent this round's record.`}
          </p>
        </div>

        {/* Resubmission Policy Indicator */}
        {selectedRound > 1 && (
          <div className="flex items-center space-x-2 p-2 rounded-none bg-surface border border-border-subtle shrink-0">
            <div className="flex items-center space-x-1.5 text-accent font-semibold text-[11px]">
              <FastForward className="h-3.5 w-3.5" />
              <span>Policy:</span>
            </div>
            <span className="text-[11px] font-mono text-ink uppercase bg-canvas px-2 py-0.5 rounded-none border border-border-subtle">
              SELECTIVE FAST FORWARD
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

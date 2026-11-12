'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Activity,
  Layers,
  ShieldCheck,
  RefreshCw,
  User,
  Calendar,
  MessageSquare,
  GitBranch,
  Send,
  HelpCircle,
  Check,
  X,
} from 'lucide-react';
import {
  ApprovalRequestDetail,
  RequestExecutionGraph,
  ApprovalActionType,
} from '@flowgate/shared-types';
import { api } from '@/lib/api';
import { RequestExecutionGraphViewer } from '@/components/workflow-execution/RequestExecutionGraphViewer';
import { ReviewRoundTimeline } from '@/components/workflow-execution/ReviewRoundTimeline';
import { AuditChainInspector } from '@/components/workflow-execution/AuditChainInspector';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useToast } from '@/components/ui/Toast';

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;
  const { showToast } = useToast();

  const [requestDetail, setRequestDetail] = useState<ApprovalRequestDetail | null>(null);
  const [executionGraph, setExecutionGraph] = useState<RequestExecutionGraph | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs: 'graph' | 'steps' | 'audit'
  const [activeTab, setActiveTab] = useState<'graph' | 'steps' | 'audit'>('graph');

  // Review round navigation
  const [selectedRound, setSelectedRound] = useState<number>(1);

  // Action submission state
  const [actionComments, setActionComments] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Resubmit modal state
  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [resubmitComments, setResubmitComments] = useState('');
  const [isResubmitting, setIsResubmitting] = useState(false);

  const fetchData = useCallback(
    async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) setIsLoading(true);
      else setIsRefreshing(true);
      setError(null);

      try {
        const [detail, graph] = await Promise.all([
          api.getRequest(requestId),
          api.getExecutionGraph(requestId).catch(() => null),
        ]);

        setRequestDetail(detail);

        if (graph) {
          setExecutionGraph(graph);
        } else {
          // Construct fallback execution graph from detail
          setExecutionGraph({
            requestId: detail.id,
            tenantId: detail.tenantId,
            workflowDefinitionId: detail.workflowDefinitionId,
            workflowVersion: detail.workflowVersion,
            status: detail.status,
            currentReviewRound: (detail as any).currentReviewRound || 1,
            currentNodeId: (detail as any).currentNodeId,
            workflowSnapshot: detail.workflowSnapshot,
            requestData: detail.requestData,
            nodeExecutions: detail.nodeExecutions || [],
            branchExecutions: detail.branchExecutions || [],
            steps: detail.steps,
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
          });
        }

        // Set selected round to current round initially
        const currentRoundNum = (detail as any).currentReviewRound || 1;
        setSelectedRound((prev) => (prev > currentRoundNum ? currentRoundNum : prev));
      } catch (err: any) {
        setError(err?.message || 'Failed to fetch request execution details');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [requestId],
  );

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const handleAction = async (action: ApprovalActionType) => {
    setIsSubmittingAction(true);
    setActionSuccessMessage(null);

    try {
      await api.submitAction(requestId, action, actionComments || undefined);

      setActionSuccessMessage(
        `Action "${action.replace('_', ' ')}" recorded successfully. Workflow updated.`,
      );
      setActionComments('');
      await fetchData(false);
    } catch (err: any) {
      showToast({
        title: 'Action Failed',
        description: err?.message || 'Unknown error',
        type: 'error',
      });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleResubmit = async () => {
    setIsResubmitting(true);
    try {
      await api.resubmitRequest(requestId, {
        comments: resubmitComments || undefined,
      });

      showToast({
        title: 'Request Resubmitted',
        description: 'Initialized new review round for authorized approvers.',
        type: 'success',
      });

      setShowResubmitModal(false);
      setResubmitComments('');
      await fetchData(false);
    } catch (err: any) {
      showToast({
        title: 'Resubmission Failed',
        description: err?.message || 'Unknown error',
        type: 'error',
      });
    } finally {
      setIsResubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-fg-muted space-y-3 font-mono">
        <RefreshCw className="h-8 w-8 animate-spin text-accent" />
        <p className="text-xs uppercase tracking-wider">
          [ LOADING TELEMETRY & EXECUTION GRAPH... ]
        </p>
      </div>
    );
  }

  if (error || !requestDetail) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-rose-500" />
        <h2 className="text-lg font-serif font-bold text-ink">Error Loading Request</h2>
        <p className="text-xs font-mono text-fg-muted max-w-md">{error || 'Request not found'}</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-surface hover:bg-canvas text-ink border border-border-subtle rounded-none text-xs font-mono font-semibold uppercase tracking-wider"
        >
          [ Return to Dashboard ]
        </button>
      </div>
    );
  }

  const currentRound = (requestDetail as any).currentReviewRound || 1;
  const roundSteps = requestDetail.steps.filter((s) => (s.reviewRound || 1) === selectedRound);

  const statusColors: Record<string, string> = {
    APPROVED: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
    REJECTED: 'bg-rose-950/80 text-rose-300 border-rose-800',
    IN_PROGRESS: 'bg-accent/20 text-accent-foreground border-accent/40 animate-pulse',
    CHANGES_REQUESTED: 'bg-amber-950/80 text-amber-300 border-amber-800',
    CANCELLED: 'bg-surface text-fg-muted border-border-subtle',
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans transition-colors duration-200">
      {/* Top Navigation Bar */}
      <header className="border-b border-border-subtle bg-surface/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => router.push('/')}
              className="p-2 rounded-none bg-canvas hover:bg-surface text-fg-muted hover:text-ink border border-border-subtle transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-0.5 rounded-none text-[10px] font-mono font-bold uppercase tracking-wider border ${
                    statusColors[requestDetail.status] || 'bg-surface text-ink border-border-subtle'
                  }`}
                >
                  [ {requestDetail.status.replace('_', ' ')} ]
                </span>
                <span className="text-xs text-accent font-mono font-medium">
                  {requestDetail.workflowName} (v{requestDetail.workflowVersion})
                </span>
                <span className="text-fg-subtle">•</span>
                <span className="text-xs text-fg-muted font-mono">Round #{currentRound}</span>
              </div>
              <h1 className="text-xl font-serif font-bold text-ink leading-tight mt-0.5">
                {requestDetail.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-none bg-surface border border-border-subtle text-accent text-xs font-mono font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SHA-256 Ledger Verified</span>
            </div>

            <ThemeToggle />

            {requestDetail.status === 'CHANGES_REQUESTED' && (
              <button
                onClick={() => setShowResubmitModal(true)}
                className="px-3.5 py-1.5 rounded-none bg-amber-600 hover:bg-amber-500 text-white text-xs font-mono font-semibold uppercase tracking-wider flex items-center space-x-1.5 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Resubmit Request</span>
              </button>
            )}

            <button
              onClick={() => fetchData(false)}
              disabled={isRefreshing}
              className="p-2 rounded-none border border-border-subtle bg-canvas text-ink hover:bg-surface transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-4 py-6 space-y-6 flex-1">
        {/* Success Alert Banner */}
        {actionSuccessMessage && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-none text-xs text-emerald-200 flex items-center justify-between font-mono">
            <span className="flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>{actionSuccessMessage}</span>
            </span>
            <button onClick={() => setActionSuccessMessage(null)}>
              <X className="h-4 w-4 text-emerald-400" />
            </button>
          </div>
        )}

        {/* Request Overview Header Card */}
        <div className="p-5 rounded-none bg-surface border border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-mono font-bold text-fg-muted tracking-wider block">
              [ CONTEXT & SUBMITTER ]
            </span>
            <p className="text-xs text-fg-muted">
              {requestDetail.description || 'No description provided.'}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted pt-1 font-mono">
              <span className="flex items-center space-x-1">
                <User className="h-3.5 w-3.5 text-fg-subtle" />
                <span>
                  Submitted by: <strong className="text-ink">{requestDetail.requesterName}</strong>{' '}
                  ({requestDetail.requesterEmail})
                </span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <Calendar className="h-3.5 w-3.5 text-fg-subtle" />
                <span>Created {new Date(requestDetail.createdAt).toLocaleString()}</span>
              </span>
              <span>•</span>
              <span className="text-fg-subtle">ID: {requestDetail.id}</span>
            </div>

            {/* Structured DAG Routing Parameters */}
            {requestDetail.requestData && Object.keys(requestDetail.requestData).length > 0 && (
              <div className="pt-2 border-t border-border-subtle mt-2 space-y-1.5 font-mono">
                <span className="text-[10px] uppercase font-bold text-accent tracking-wider block">
                  Workflow Execution Parameters (Condition Routing Payload)
                </span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(requestDetail.requestData).map(([key, value]) => (
                    <div
                      key={key}
                      className="px-2.5 py-1 rounded-none bg-canvas border border-border-subtle flex items-center space-x-1.5 text-xs font-mono"
                    >
                      <span className="text-fg-muted">{key}:</span>
                      <span className="text-accent font-semibold">
                        {typeof value === 'boolean'
                          ? value
                            ? 'true'
                            : 'false'
                          : typeof value === 'number'
                            ? key.toLowerCase().includes('amount') ||
                              key.toLowerCase().includes('cost') ||
                              key.toLowerCase().includes('budget')
                              ? `$${value.toLocaleString()}`
                              : value.toString()
                            : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center space-x-2 border-b border-border-subtle font-mono text-xs">
          <button
            onClick={() => setActiveTab('graph')}
            className={`pb-3 px-4 font-semibold uppercase tracking-wider flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'graph'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-ink'
            }`}
          >
            <Activity className="h-4 w-4" />
            <span>[ Live Execution Graph ]</span>
          </button>
          <button
            onClick={() => setActiveTab('steps')}
            className={`pb-3 px-4 font-semibold uppercase tracking-wider flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'steps'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-ink'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>[ Approval Steps & Voting ]</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-4 font-semibold uppercase tracking-wider flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'audit'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-ink'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>[ Cryptographic Audit Chain ]</span>
          </button>
        </div>

        {/* TAB 1: LIVE EXECUTION GRAPH */}
        {activeTab === 'graph' && (
          <div className="space-y-4">
            {/* Review Round Timeline */}
            <ReviewRoundTimeline
              currentRound={currentRound}
              selectedRound={selectedRound}
              onSelectRound={(r) => setSelectedRound(r)}
              steps={requestDetail.steps}
              auditLogs={requestDetail.auditLogs}
              status={requestDetail.status}
            />

            {/* Live Graph Visualizer */}
            {executionGraph && (
              <RequestExecutionGraphViewer
                executionGraph={executionGraph}
                selectedRound={selectedRound}
                onRefresh={() => fetchData(false)}
                isRefreshing={isRefreshing}
              />
            )}
          </div>
        )}

        {/* TAB 2: APPROVAL STEPS & VOTING */}
        {activeTab === 'steps' && (
          <div className="space-y-6">
            {/* Review Round Timeline */}
            <ReviewRoundTimeline
              currentRound={currentRound}
              selectedRound={selectedRound}
              onSelectRound={(r) => setSelectedRound(r)}
              steps={requestDetail.steps}
              auditLogs={requestDetail.auditLogs}
              status={requestDetail.status}
            />

            {/* Approver Action Box (if live in-progress) */}
            {requestDetail.status === 'IN_PROGRESS' && selectedRound === currentRound && (
              <div className="p-5 rounded-none bg-surface border border-border-subtle space-y-3 font-mono">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-accent" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
                    [ Submit Approval Action & Sign-off ]
                  </h3>
                </div>
                <textarea
                  value={actionComments}
                  onChange={(e) => setActionComments(e.target.value)}
                  placeholder="Enter comments or sign-off feedback (required for rejections or changes)..."
                  className="w-full bg-canvas border border-border-subtle rounded-none p-3 text-xs text-ink focus:outline-none focus:border-accent h-24 placeholder:text-fg-subtle"
                />

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={() => handleAction('REQUEST_CHANGES')}
                    disabled={isSubmittingAction}
                    className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 rounded-none text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    Request Changes
                  </button>
                  <button
                    onClick={() => handleAction('REJECT')}
                    disabled={isSubmittingAction}
                    className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-700/60 rounded-none text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction('APPROVE')}
                    disabled={isSubmittingAction}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-none text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    <Check className="h-4 w-4" />
                    <span>Approve Step</span>
                  </button>
                </div>
              </div>
            )}

            {/* Steps List for Selected Round */}
            <div className="space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-fg-muted px-1">
                Steps in Round #{selectedRound} ({roundSteps.length})
              </h3>
              {roundSteps.map((step) => {
                const isCurrent = step.status === 'IN_REVIEW';
                const isApproved = step.status === 'APPROVED';
                const isRejected = step.status === 'REJECTED';
                const isSkipped = step.status === 'SKIPPED';

                return (
                  <div
                    key={step.id}
                    className={`p-4 rounded-none border transition-all ${
                      isCurrent
                        ? 'bg-amber-950/20 border-amber-800/80'
                        : isApproved
                          ? 'bg-emerald-950/20 border-emerald-900/60'
                          : isRejected
                            ? 'bg-rose-950/20 border-rose-900/60'
                            : 'bg-surface border-border-subtle'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`h-7 w-7 rounded-none flex items-center justify-center text-xs font-mono font-bold ${
                            isApproved
                              ? 'bg-emerald-600 text-white'
                              : isRejected
                                ? 'bg-rose-600 text-white'
                                : isCurrent
                                  ? 'bg-amber-500 text-slate-950 animate-pulse'
                                  : 'bg-canvas text-fg-muted border border-border-subtle'
                          }`}
                        >
                          {isApproved ? (
                            <Check className="h-4 w-4" />
                          ) : isRejected ? (
                            <X className="h-4 w-4" />
                          ) : (
                            step.stepOrder
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-sm text-ink font-mono">
                              {step.stepName}
                            </span>
                            <span className="text-[10px] font-mono text-fg-muted uppercase">
                              {step.nodeType || 'APPROVAL_STEP'}
                            </span>
                          </div>
                          <span className="text-xs text-fg-muted">
                            Assigned:{' '}
                            {step.assignedRole ||
                              step.assignedTo?.name ||
                              (step.assignees && step.assignees.length > 0
                                ? `${step.assignees.length} parallel approvers`
                                : 'Organization')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 font-mono">
                        {step.policy === 'PARALLEL_AND' && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-none bg-canvas text-accent border border-accent/40">
                            {step.approvedCount || 0} / {step.requiredApprovals || 1} Quorum
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-none border ${
                            isCurrent
                              ? 'bg-amber-900/50 text-amber-300 border-amber-700'
                              : isApproved
                                ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700'
                                : isRejected
                                  ? 'bg-rose-900/50 text-rose-300 border-rose-700'
                                  : 'bg-canvas text-fg-muted border-border-subtle'
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                    </div>

                    {/* Comments */}
                    {step.comments && (
                      <div className="mt-3 text-xs text-ink bg-canvas p-2.5 rounded-none border border-border-subtle flex items-start space-x-2 font-mono">
                        <MessageSquare className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                        <div>
                          <span className="font-semibold text-[11px] text-fg-muted block">
                            {step.actionedBy
                              ? `${step.actionedBy.name} commented:`
                              : 'Reviewer comment:'}
                          </span>
                          <span>{step.comments}</span>
                        </div>
                      </div>
                    )}

                    {/* Parallel Assignee Voters */}
                    {step.assignees && step.assignees.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border-subtle space-y-1.5 font-mono">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted block">
                          Individual Assignee Decisions:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {step.assignees.map((a, idx) => (
                            <div
                              key={a.id || idx}
                              className="p-2 rounded-none bg-canvas border border-border-subtle text-xs flex items-center justify-between"
                            >
                              <div className="space-y-0.5">
                                <span className="font-medium text-ink block">
                                  {a.assignedTo?.name || a.assignedRole || `Approver ${idx + 1}`}
                                </span>
                                {a.delegatedFromUser && (
                                  <span className="text-[10px] text-amber-400 block">
                                    Delegated from {a.delegatedFromUser.name}
                                  </span>
                                )}
                              </div>
                              <span
                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-none border ${
                                  a.status === 'APPROVED'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : a.status === 'REJECTED'
                                      ? 'bg-rose-950 text-rose-300 border-rose-800'
                                      : 'bg-surface text-fg-muted border-border-subtle'
                                }`}
                              >
                                {a.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: CRYPTOGRAPHIC AUDIT CHAIN */}
        {activeTab === 'audit' && (
          <AuditChainInspector
            auditLogs={requestDetail.auditLogs || []}
            entityId={requestDetail.id}
          />
        )}
      </main>

      {/* Resubmit Request Modal */}
      {showResubmitModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border-subtle rounded-none w-full max-w-md shadow-2xl p-6 space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h3 className="font-serif font-bold text-base text-ink">Resubmit Approval Request</h3>
              <button
                onClick={() => setShowResubmitModal(false)}
                className="p-1 rounded-none text-fg-muted hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-fg-muted">
              Provide clarification or updated values addressing requested changes. A new Review
              Round #{currentRound + 1} will be initialized.
            </p>

            <textarea
              value={resubmitComments}
              onChange={(e) => setResubmitComments(e.target.value)}
              placeholder="Explain changes made for reviewers..."
              className="w-full bg-canvas border border-border-subtle rounded-none p-3 text-xs text-ink focus:outline-none focus:border-accent h-28 placeholder:text-fg-subtle"
            />

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowResubmitModal(false)}
                className="px-4 py-2 bg-canvas hover:bg-surface text-fg-muted hover:text-ink border border-border-subtle text-xs font-semibold uppercase tracking-wider rounded-none"
              >
                Cancel
              </button>
              <button
                onClick={handleResubmit}
                disabled={isResubmitting}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-xs font-semibold uppercase tracking-wider rounded-none disabled:opacity-50 flex items-center space-x-1.5"
              >
                {isResubmitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>Resubmit Round</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

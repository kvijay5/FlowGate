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

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

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

        const currentRound = (detail as any).currentReviewRound || 1;
        setSelectedRound(currentRound);
      } catch (err: any) {
        setError(err?.message || 'Failed to load approval request details.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [requestId],
  );

  useEffect(() => {
    if (requestId) {
      fetchData(true);
    }
  }, [requestId, fetchData]);

  const handleAction = async (action: ApprovalActionType, stepId?: string) => {
    setIsSubmittingAction(true);
    setActionSuccessMessage(null);
    try {
      await api.submitAction(requestId, action, actionComments, stepId);
      setActionComments('');
      setActionSuccessMessage(`Successfully submitted action: ${action}`);
      await fetchData(false);
    } catch (err: any) {
      alert(`Action failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleResubmit = async () => {
    setIsResubmitting(true);
    try {
      await api.resubmitRequest(requestId, {
        comments: resubmitComments,
        resubmissionPolicy: 'SELECTIVE_FAST_FORWARD',
      });
      setShowResubmitModal(false);
      setResubmitComments('');
      await fetchData(false);
    } catch (err: any) {
      alert(`Resubmission failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsResubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-400 space-y-3">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-500" />
        <p className="text-sm font-medium">Loading approval request & DAG execution graph...</p>
      </div>
    );
  }

  if (error || !requestDetail) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-red-400" />
        <h2 className="text-lg font-bold text-white">Error Loading Request</h2>
        <p className="text-xs text-slate-400 max-w-md">{error || 'Request not found'}</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const currentRound = (requestDetail as any).currentReviewRound || 1;
  const roundSteps = requestDetail.steps.filter((s) => (s.reviewRound || 1) === selectedRound);

  const statusColors: Record<string, string> = {
    APPROVED: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    REJECTED: 'bg-red-950 text-red-300 border-red-800',
    IN_PROGRESS: 'bg-indigo-950 text-indigo-300 border-indigo-800 animate-pulse',
    CHANGES_REQUESTED: 'bg-amber-950 text-amber-300 border-amber-800',
    CANCELLED: 'bg-slate-800 text-slate-400 border-slate-700',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => router.push('/')}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    statusColors[requestDetail.status] || 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {requestDetail.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-indigo-400 font-medium">
                  {requestDetail.workflowName} (v{requestDetail.workflowVersion})
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-xs text-slate-400 font-mono">Round #{currentRound}</span>
              </div>
              <h1 className="text-lg font-bold text-white leading-tight mt-0.5">
                {requestDetail.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {requestDetail.status === 'CHANGES_REQUESTED' && (
              <button
                onClick={() => setShowResubmitModal(true)}
                className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-amber-600/20 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Resubmit Request</span>
              </button>
            )}

            <button
              onClick={() => fetchData(false)}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
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
          <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-xl text-xs text-emerald-200 flex items-center justify-between">
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
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Request Context & Submitter
            </span>
            <p className="text-xs text-slate-300">
              {requestDetail.description || 'No description provided.'}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
              <span className="flex items-center space-x-1">
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span>
                  Submitted by: {requestDetail.requesterName} ({requestDetail.requesterEmail})
                </span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span>Created {new Date(requestDetail.createdAt).toLocaleString()}</span>
              </span>
              <span>•</span>
              <span className="font-mono text-slate-400">ID: {requestDetail.id}</span>
            </div>

            {/* Structured DAG Routing Parameters */}
            {requestDetail.requestData && Object.keys(requestDetail.requestData).length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 mt-2 space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block">
                  Workflow Execution Parameters (Condition Routing Payload)
                </span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(requestDetail.requestData).map(([key, value]) => (
                    <div
                      key={key}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-1.5 text-xs font-mono"
                    >
                      <span className="text-slate-400">{key}:</span>
                      <span className="text-emerald-400 font-semibold">
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
        <div className="flex items-center space-x-2 border-b border-slate-800">
          <button
            onClick={() => setActiveTab('graph')}
            className={`pb-3 px-4 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'graph'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="h-4 w-4" />
            <span>Live Execution Graph</span>
          </button>
          <button
            onClick={() => setActiveTab('steps')}
            className={`pb-3 px-4 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'steps'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Approval Steps & Voting</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-4 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-all ${
              activeTab === 'audit'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Cryptographic Audit Chain</span>
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
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-indigo-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Submit Approval Action & Sign-off
                  </h3>
                </div>
                <textarea
                  value={actionComments}
                  onChange={(e) => setActionComments(e.target.value)}
                  placeholder="Enter comments or sign-off feedback (required for rejections or changes)..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 h-24"
                />

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={() => handleAction('REQUEST_CHANGES')}
                    disabled={isSubmittingAction}
                    className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Request Changes
                  </button>
                  <button
                    onClick={() => handleAction('REJECT')}
                    disabled={isSubmittingAction}
                    className="px-3.5 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-700/60 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction('APPROVE')}
                    disabled={isSubmittingAction}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    <Check className="h-4 w-4" />
                    <span>Approve Step</span>
                  </button>
                </div>
              </div>
            )}

            {/* Steps List for Selected Round */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
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
                    className={`p-4 rounded-2xl border transition-all ${
                      isCurrent
                        ? 'bg-amber-950/20 border-amber-800/80'
                        : isApproved
                          ? 'bg-emerald-950/20 border-emerald-900/60'
                          : isRejected
                            ? 'bg-red-950/20 border-red-900/60'
                            : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            isApproved
                              ? 'bg-emerald-600 text-white'
                              : isRejected
                                ? 'bg-red-600 text-white'
                                : isCurrent
                                  ? 'bg-amber-500 text-slate-950 animate-pulse'
                                  : 'bg-slate-800 text-slate-400'
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
                            <span className="font-semibold text-sm text-white">
                              {step.stepName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 uppercase">
                              {step.nodeType || 'APPROVAL_STEP'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400">
                            Assigned:{' '}
                            {step.assignedRole ||
                              step.assignedTo?.name ||
                              (step.assignees && step.assignees.length > 0
                                ? `${step.assignees.length} parallel approvers`
                                : 'Organization')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {step.policy === 'PARALLEL_AND' && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                            {step.approvedCount || 0} / {step.requiredApprovals || 1} Quorum
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                            isCurrent
                              ? 'bg-amber-900/50 text-amber-300 border-amber-700'
                              : isApproved
                                ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700'
                                : isRejected
                                  ? 'bg-red-900/50 text-red-300 border-red-700'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                    </div>

                    {/* Comments */}
                    {step.comments && (
                      <div className="mt-3 text-xs text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex items-start space-x-2">
                        <MessageSquare className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-semibold text-[11px] text-slate-400 block">
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
                      <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Individual Assignee Decisions:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {step.assignees.map((a, idx) => (
                            <div
                              key={a.id || idx}
                              className="p-2 rounded-lg bg-slate-950 border border-slate-850 text-xs flex items-center justify-between"
                            >
                              <div className="space-y-0.5">
                                <span className="font-medium text-slate-200 block">
                                  {a.assignedTo?.name || a.assignedRole || `Approver ${idx + 1}`}
                                </span>
                                {a.delegatedFromUser && (
                                  <span className="text-[10px] text-amber-400 block">
                                    Delegated from {a.delegatedFromUser.name}
                                  </span>
                                )}
                              </div>
                              <span
                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                  a.status === 'APPROVED'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : a.status === 'REJECTED'
                                      ? 'bg-red-950 text-red-300 border-red-800'
                                      : 'bg-slate-800 text-slate-400 border-slate-700'
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">Resubmit Approval Request</h3>
              <button
                onClick={() => setShowResubmitModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Provide clarification or updated values addressing requested changes. A new Review
              Round #{currentRound + 1} will be initialized.
            </p>

            <textarea
              value={resubmitComments}
              onChange={(e) => setResubmitComments(e.target.value)}
              placeholder="Explain changes made for reviewers..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 h-28"
            />

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowResubmitModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleResubmit}
                disabled={isResubmitting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center space-x-1.5"
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

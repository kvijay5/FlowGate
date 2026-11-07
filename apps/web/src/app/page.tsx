'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  GitBranch,
  Layers,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Plus,
  RefreshCw,
  LogOut,
  User as UserIcon,
  Building,
  FileText,
  MessageSquare,
  Check,
  X,
  History,
  Lock,
  ExternalLink,
  Activity,
  Radio,
  Zap,
  Copy,
  RotateCcw,
  Bell,
  Send,
  Terminal,
} from 'lucide-react';
import { api, ApiError, getStoredAuth, setStoredAuth } from '../lib/api';
import {
  AuthResponse,
  WorkflowDefinitionSummary,
  ApprovalRequestSummary,
  ApprovalRequestDetail,
  UserRole,
  WebhookSubscriptionSummary,
  WebhookDeliverySummary,
  QueueHealthStatus,
  NotificationLogSummary,
} from '@flowgate/shared-types';

export default function FlowGateApp() {
  // Demo accounts are strictly restricted to local development mode (NODE_ENV === 'development').
  // A public environment variable cannot independently expose credentials or activate demo accounts in production.
  const isDevMode = process.env.NODE_ENV === 'development';

  // Auth state
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginSlug, setLoginSlug] = useState('acme-corp');
  const [loginEmail, setLoginEmail] = useState('admin@acme.com');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

  // App navigation
  const [activeTab, setActiveTab] = useState<'requests' | 'workflows' | 'webhooks'>('requests');
  const [requestFilter, setRequestFilter] = useState<'pending_approval' | 'mine' | 'all'>(
    'pending_approval',
  );

  // Data state
  const [requests, setRequests] = useState<ApprovalRequestSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Selected request detail modal
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedRequestDetail, setSelectedRequestDetail] = useState<ApprovalRequestDetail | null>(
    null,
  );
  const [actionComments, setActionComments] = useState('');
  const [isExecutingAction, setIsExecutingAction] = useState(false);

  // Create Request Modal
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false);
  const [newRequestWorkflowId, setNewRequestWorkflowId] = useState('');
  const [newRequestTitle, setNewRequestTitle] = useState('');
  const [newRequestDesc, setNewRequestDesc] = useState('');

  // Create Workflow Modal
  const [showCreateWorkflowModal, setShowCreateWorkflowModal] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
  const [newWorkflowSteps, setNewWorkflowSteps] = useState<
    Array<{ stepOrder: number; name: string; assigneeType: 'ROLE'; role: UserRole }>
  >([
    { stepOrder: 1, name: 'Department Review', assigneeType: 'ROLE', role: 'APPROVER' },
    { stepOrder: 2, name: 'Executive Signoff', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
  ]);

  // Queue Health state
  const [queueHealth, setQueueHealth] = useState<QueueHealthStatus | null>(null);
  const [showQueueModal, setShowQueueModal] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookSubscriptionSummary[]>([]);
  const [selectedSubForDeliveries, setSelectedSubForDeliveries] =
    useState<WebhookSubscriptionSummary | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliverySummary[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [showCreateWebhookModal, setShowCreateWebhookModal] = useState(false);
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([
    'request.created',
    'step.approved',
    'request.approved',
  ]);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [isSubmittingWebhook, setIsSubmittingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [selectedDeliveryPayload, setSelectedDeliveryPayload] =
    useState<WebhookDeliverySummary | null>(null);

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationLogSummary[]>([]);
  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifStats, setNotifStats] = useState<{
    sent: number;
    pending: number;
    failed: number;
    total: number;
  } | null>(null);

  // Load auth on mount
  useEffect(() => {
    const saved = getStoredAuth();
    if (saved) {
      setAuth(saved);
    }
    setAuthLoading(false);
  }, []);

  // Fetch data when tab or filter changes
  const fetchData = useCallback(async () => {
    if (!auth) return;
    setDataLoading(true);
    setActionError(null);
    try {
      const isAdmin = auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'SUPER_ADMIN';
      const promises: Promise<any>[] = [
        api.getRequests({ filter: requestFilter, limit: 50 }),
        api.getWorkflows(),
      ];
      if (isAdmin) {
        promises.push(api.getQueueHealth().catch(() => null));
        promises.push(api.getWebhooks().catch(() => []));
        promises.push(api.getNotificationStats().catch(() => null));
      }
      const [reqRes, wfRes, qHealth, whList, nStats] = await Promise.all(promises);
      setRequests(reqRes.data);
      setWorkflows(wfRes);
      if (isAdmin) {
        if (qHealth) setQueueHealth(qHealth);
        if (whList) setWebhooks(whList);
        if (nStats) setNotifStats(nStats);
      }
      if (wfRes.length > 0 && !newRequestWorkflowId) {
        setNewRequestWorkflowId(wfRes[0].id);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to load data from server');
    } finally {
      setDataLoading(false);
    }
  }, [auth, requestFilter, newRequestWorkflowId]);

  useEffect(() => {
    if (auth) {
      fetchData();
    }
  }, [auth, fetchData]);

  // Load request details when selected
  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedRequestDetail(null);
      return;
    }
    let isMounted = true;
    api
      .getRequest(selectedRequestId)
      .then((detail) => {
        if (isMounted) setSelectedRequestDetail(detail);
      })
      .catch((err) => {
        if (isMounted) setActionError(err.message);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedRequestId]);

  // Handlers
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmittingLogin(true);
    setLoginError(null);
    try {
      const res = await api.login(loginSlug, loginEmail, loginPassword);
      setAuth(res);
      setActionSuccess(`Authenticated successfully as ${res.user.name}`);
    } catch (err: any) {
      setLoginError(err.message || 'Invalid credentials');
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleQuickLogin = async (slug: string, email: string) => {
    setLoginSlug(slug);
    setLoginEmail(email);

    const devPassword = process.env.NEXT_PUBLIC_DEV_PASSWORD;
    if (isDevMode && devPassword) {
      setLoginPassword(devPassword);
      setIsSubmittingLogin(true);
      setLoginError(null);
      try {
        const res = await api.login(slug, email, devPassword);
        setAuth(res);
        setActionSuccess(`Switched context to ${res.user.name} (${res.tenant.name})`);
      } catch (err: any) {
        setLoginError(err.message || 'Quick login failed');
      } finally {
        setIsSubmittingLogin(false);
      }
    } else {
      setLoginPassword('');
    }
  };

  const handleLogout = () => {
    api.logout();
    setAuth(null);
    setSelectedRequestId(null);
    setSelectedRequestDetail(null);
  };

  const handleAction = async (action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    if (!selectedRequestId) return;
    setIsExecutingAction(true);
    setActionError(null);
    try {
      const updated = await api.submitAction(selectedRequestId, action, actionComments);
      setSelectedRequestDetail(updated);
      setActionComments('');
      setActionSuccess(`Request ${action.toLowerCase()}d successfully`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to execute action');
    } finally {
      setIsExecutingAction(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRequestWorkflowId || !newRequestTitle.trim()) return;
    setActionError(null);
    try {
      await api.createRequest({
        workflowDefinitionId: newRequestWorkflowId,
        title: newRequestTitle.trim(),
        description: newRequestDesc.trim() || undefined,
      });
      setShowCreateRequestModal(false);
      setNewRequestTitle('');
      setNewRequestDesc('');
      setActionSuccess('Approval request created and submitted successfully');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create request');
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkflowName.trim()) return;
    setActionError(null);
    try {
      await api.createWorkflow({
        name: newWorkflowName.trim(),
        description: newWorkflowDesc.trim() || undefined,
        steps: newWorkflowSteps,
      });
      setShowCreateWorkflowModal(false);
      setNewWorkflowName('');
      setNewWorkflowDesc('');
      setActionSuccess('Workflow definition created successfully');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create workflow');
    }
  };

  const handleToggleWorkflow = async (id: string, currentStatus: string) => {
    try {
      if (currentStatus === 'ACTIVE') {
        await api.deactivateWorkflow(id);
        setActionSuccess('Workflow archived');
      } else {
        await api.activateWorkflow(id);
        setActionSuccess('Workflow activated');
      }
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update workflow state');
    }
  };

  const fetchDeliveries = async (subId?: string) => {
    setDeliveriesLoading(true);
    try {
      const res = await api.getWebhookDeliveries(subId, 1, 50);
      setDeliveries(res.data);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load delivery logs');
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookName.trim() || !newWebhookUrl.trim()) return;
    setIsSubmittingWebhook(true);
    setActionError(null);
    try {
      const created = await api.createWebhook({
        name: newWebhookName.trim(),
        url: newWebhookUrl.trim(),
        eventTypes: newWebhookEvents.length > 0 ? newWebhookEvents : ['*'],
      });
      setShowCreateWebhookModal(false);
      setNewWebhookName('');
      setNewWebhookUrl('');
      setNewWebhookEvents(['request.created', 'step.approved', 'request.approved']);
      if (created.secret) {
        setCreatedWebhookSecret({ name: created.name, secret: created.secret });
        setCopiedSecret(false);
      }
      setActionSuccess(`Webhook "${created.name}" created successfully`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create webhook');
    } finally {
      setIsSubmittingWebhook(false);
    }
  };

  const handleTestPing = async (id: string, name: string) => {
    setTestingWebhookId(id);
    setActionError(null);
    try {
      await api.testPingWebhook(id);
      setActionSuccess(`Test ping sent to "${name}". Background job queued.`);
      if (selectedSubForDeliveries?.id === id) {
        setTimeout(() => fetchDeliveries(id), 1200);
      }
    } catch (err: any) {
      setActionError(err.message || 'Test ping failed');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const handleDeleteWebhook = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete webhook "${name}"?`)) return;
    try {
      await api.deleteWebhook(id);
      setActionSuccess(`Webhook "${name}" deleted`);
      if (selectedSubForDeliveries?.id === id) {
        setSelectedSubForDeliveries(null);
      }
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete webhook');
    }
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    setRetryingDeliveryId(deliveryId);
    try {
      await api.retryWebhookDelivery(deliveryId);
      setActionSuccess('Delivery re-queued for transmission');
      setTimeout(() => fetchDeliveries(selectedSubForDeliveries?.id), 1000);
    } catch (err: any) {
      setActionError(err.message || 'Retry failed');
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  const handleOpenNotifications = async () => {
    setShowNotificationsDrawer(true);
    setNotificationsLoading(true);
    try {
      const res = await api.getNotifications(1, 50);
      setNotifications(res.data);
    } catch (err: any) {
      setActionError(err.message || 'Failed to fetch notifications');
    } finally {
      setNotificationsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  // ===========================================================================
  // UNAUTHENTICATED: LANDING & LOGIN CONSOLE
  // ===========================================================================
  if (!auth) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-indigo-600 selection:text-white">
        {/* Navigation */}
        <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <GitBranch className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-indigo-300">
                FlowGate
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-indigo-400 bg-indigo-950/80 border border-indigo-800/60 rounded-full">
                SaaS Engine
              </span>
            </div>
            <a
              href="http://localhost:4000/health"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-full flex items-center space-x-1.5"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Backend API :4000</span>
            </a>
          </div>
        </header>

        {/* Hero & Login */}
        <section className="relative overflow-hidden pt-12 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column: SaaS Value Proposition */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 text-xs font-medium">
                <ShieldCheck className="h-4 w-4 text-indigo-400" />
                <span>Milestone 4: Core Workflow Engine Active</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                Multi-Tenant Approval Workflows,{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-300 to-indigo-200">
                  Enforced at the Database
                </span>
              </h1>
              <p className="text-slate-300 text-lg leading-relaxed">
                FlowGate provides enterprise organizations with automated multi-step approval
                routing, role-based authorization gates, and append-only tamper-evident audit
                trails.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-indigo-400 font-semibold text-sm">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Composite FK Isolation</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    PostgreSQL physical constraints guarantee Tenant A cannot reference Tenant B
                    data.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-indigo-400 font-semibold text-sm">
                    <Layers className="h-4 w-4" />
                    <span>Sequential State Machine</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Step progression, change requests, rejection skip cascades, and atomic audit
                    logging.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Login Box */}
            <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Sign In to Your Workspace</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Authenticate against your tenant realm or use a demo account below.
                </p>
              </div>

              {loginError && (
                <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-xs text-red-300 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tenant Slug
                  </label>
                  <input
                    type="text"
                    value={loginSlug}
                    onChange={(e) => setLoginSlug(e.target.value)}
                    required
                    placeholder="acme-corp"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    placeholder="admin@acme.com"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingLogin}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {isSubmittingLogin ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <span>Enter Workspace</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Quick Login Switcher (Development Only) */}
              {isDevMode && (
                <div className="pt-4 border-t border-slate-800 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    1-Click Seed Account Login (Development Mode)
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      onClick={() => handleQuickLogin('acme-corp', 'admin@acme.com')}
                      className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors"
                    >
                      <div className="font-semibold text-indigo-400">Acme Admin</div>
                      <div className="text-[10px] text-slate-400">TENANT_ADMIN</div>
                    </button>
                    <button
                      onClick={() => handleQuickLogin('acme-corp', 'finance@acme.com')}
                      className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors"
                    >
                      <div className="font-semibold text-emerald-400">Acme CFO</div>
                      <div className="text-[10px] text-slate-400">APPROVER</div>
                    </button>
                    <button
                      onClick={() => handleQuickLogin('acme-corp', 'engineer@acme.com')}
                      className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors"
                    >
                      <div className="font-semibold text-purple-400">Acme Engineer</div>
                      <div className="text-[10px] text-slate-400">REQUESTER</div>
                    </button>
                    <button
                      onClick={() => handleQuickLogin('globex-ind', 'admin@globex.com')}
                      className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition-colors"
                    >
                      <div className="font-semibold text-amber-400">Globex Admin</div>
                      <div className="text-[10px] text-slate-400">Tenant 2 Realm</div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ===========================================================================
  // AUTHENTICATED: FLOWGATE APP CONSOLE
  // ===========================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Application Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2.5">
              <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/30">
                <GitBranch className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-lg text-white">FlowGate</span>
            </div>
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 text-xs text-slate-300 border border-slate-700">
              <Building className="h-3.5 w-3.5 text-indigo-400" />
              <span className="font-semibold">{auth.tenant.name}</span>
              <span className="text-[10px] text-slate-400">({auth.tenant.slug})</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Live Queue Health Badge */}
            {queueHealth && (
              <button
                onClick={() => setShowQueueModal(true)}
                title="View Queue & Background Processing Health"
                className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 hover:border-slate-600 text-xs transition-colors"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    queueHealth.redisConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span className="text-[11px] font-medium text-slate-300">
                  {queueHealth.redisConnected ? 'Engine Healthy' : 'Redis Offline'}
                </span>
              </button>
            )}

            {/* Notifications Activity Button */}
            <button
              onClick={handleOpenNotifications}
              title="Recent Notifications & Delivery History"
              className="relative p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              <Bell className="h-4 w-4" />
              {notifStats && notifStats.total > 0 && (
                <span className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-indigo-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                  {notifStats.sent > 9 ? '9+' : notifStats.sent}
                </span>
              )}
            </button>

            {/* User Profile Pill */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="hidden md:inline font-medium text-slate-300">{auth.user.name}</span>
              <span className="px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800">
                {auth.user.role}
              </span>
            </div>

            {/* Quick Account Switcher (Development Only) */}
            {isDevMode && (
              <div className="hidden lg:flex items-center space-x-1 text-xs">
                <button
                  onClick={() => handleQuickLogin('acme-corp', 'admin@acme.com')}
                  title="Switch to Acme Admin"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  Admin
                </button>
                <button
                  onClick={() => handleQuickLogin('acme-corp', 'finance@acme.com')}
                  title="Switch to Acme Approver"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700"
                >
                  Approver
                </button>
                <button
                  onClick={() => handleQuickLogin('acme-corp', 'engineer@acme.com')}
                  title="Switch to Acme Requester"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-purple-400 border border-slate-700"
                >
                  Requester
                </button>
                <button
                  onClick={() => handleQuickLogin('globex-ind', 'admin@globex.com')}
                  title="Switch to Globex Tenant"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700"
                >
                  Globex
                </button>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 hover:text-red-400 text-slate-400 border border-slate-700 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 space-y-6">
        {/* Global Notifications */}
        {actionError && (
          <div className="p-3 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs rounded-xl flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-emerald-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tab Controls & Primary Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'requests'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              Approval Requests
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'workflows'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              Workflows ({workflows.length})
            </button>
            {(auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'SUPER_ADMIN') && (
              <button
                onClick={() => {
                  setActiveTab('webhooks');
                  fetchDeliveries();
                }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center space-x-1.5 ${
                  activeTab === 'webhooks'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Zap className="h-4 w-4" />
                <span>Webhooks & Integrations ({webhooks.length})</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                fetchData();
                if (activeTab === 'webhooks') fetchDeliveries(selectedSubForDeliveries?.id);
              }}
              disabled={dataLoading || deliveriesLoading}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs flex items-center space-x-1.5 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${dataLoading || deliveriesLoading ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {activeTab === 'requests' && (
              <button
                onClick={() => setShowCreateRequestModal(true)}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-indigo-600/20 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>New Request</span>
              </button>
            )}

            {activeTab === 'workflows' &&
              (auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'MANAGER') && (
                <button
                  onClick={() => setShowCreateWorkflowModal(true)}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-indigo-600/20 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Workflow</span>
                </button>
              )}

            {activeTab === 'webhooks' &&
              (auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'SUPER_ADMIN') && (
                <button
                  onClick={() => setShowCreateWebhookModal(true)}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-indigo-600/20 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Webhook</span>
                </button>
              )}
          </div>
        </div>

        {/* =================================================================== */}
        {/* TAB 1: APPROVAL REQUESTS */}
        {/* =================================================================== */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            {/* Filter sub-tabs */}
            <div className="flex items-center space-x-2 text-xs">
              <button
                onClick={() => setRequestFilter('pending_approval')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  requestFilter === 'pending_approval'
                    ? 'bg-amber-950/70 text-amber-300 border border-amber-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Awaiting My Review
              </button>
              <button
                onClick={() => setRequestFilter('mine')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  requestFilter === 'mine'
                    ? 'bg-indigo-950/70 text-indigo-300 border border-indigo-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                My Submissions
              </button>
              <button
                onClick={() => setRequestFilter('all')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  requestFilter === 'all'
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Organization Requests
              </button>
            </div>

            {/* Requests List */}
            {dataLoading ? (
              <div className="py-16 text-center text-slate-400 space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-indigo-400" />
                <p className="text-xs">Loading approval requests...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl space-y-3">
                <FileText className="h-10 w-10 mx-auto text-slate-600" />
                <h3 className="font-semibold text-slate-200">No approval requests found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {requestFilter === 'pending_approval'
                    ? 'You have zero pending approval actions awaiting your review.'
                    : 'No requests match the selected view. Submit your first approval request.'}
                </p>
                <button
                  onClick={() => setShowCreateRequestModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-500 transition-colors"
                >
                  Create Request
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {requests.map((req) => {
                  const statusColors: Record<string, string> = {
                    APPROVED: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
                    REJECTED: 'bg-red-950/80 text-red-300 border-red-800',
                    IN_PROGRESS: 'bg-amber-950/80 text-amber-300 border-amber-800',
                    CHANGES_REQUESTED: 'bg-blue-950/80 text-blue-300 border-blue-800',
                    CANCELLED: 'bg-slate-800 text-slate-400 border-slate-700',
                    PENDING: 'bg-slate-800 text-slate-300 border-slate-700',
                  };

                  return (
                    <div
                      key={req.id}
                      onClick={() => setSelectedRequestId(req.id)}
                      className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              statusColors[req.status] || 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {req.status.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-indigo-400 font-medium">
                            {req.workflowName}
                          </span>
                        </div>
                        <h4 className="font-semibold text-white text-base">{req.title}</h4>
                        {req.description && (
                          <p className="text-xs text-slate-400 line-clamp-1">{req.description}</p>
                        )}
                        <div className="flex items-center space-x-4 text-[11px] text-slate-500 pt-1">
                          <span>Requester: {req.requesterName}</span>
                          <span>•</span>
                          <span>
                            {req.currentStep
                              ? `Awaiting Step ${req.currentStep} of ${req.totalSteps}`
                              : `Completed (${req.totalSteps} steps)`}
                          </span>
                          <span>•</span>
                          <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 self-end sm:self-center">
                        <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-200 border border-slate-700 flex items-center space-x-1">
                          <span>View Detail</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: WORKFLOWS */}
        {/* =================================================================== */}
        {activeTab === 'workflows' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workflows.map((wf) => {
              const steps = (wf.configuration as any)?.steps || [];
              const isActive = wf.status === 'ACTIVE';

              return (
                <div
                  key={wf.id}
                  className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            isActive
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {wf.status}
                        </span>
                        <span className="text-[11px] text-slate-400">v{wf.version}</span>
                      </div>
                      <h4 className="font-bold text-white text-base">{wf.name}</h4>
                    </div>

                    {(auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'MANAGER') && (
                      <button
                        onClick={() => handleToggleWorkflow(wf.id, wf.status)}
                        className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                          isActive
                            ? 'border-red-900 bg-red-950/50 text-red-300 hover:bg-red-900/60'
                            : 'border-emerald-900 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60'
                        }`}
                      >
                        {isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>

                  {wf.description && <p className="text-xs text-slate-400">{wf.description}</p>}

                  {/* Steps Chain */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Approval Chain ({steps.length} Steps)
                    </span>
                    <div className="space-y-1.5">
                      {steps.map((st: any) => (
                        <div
                          key={st.stepOrder}
                          className="flex items-center justify-between p-2 rounded bg-slate-950 text-xs border border-slate-800"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="h-5 w-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-[10px] text-slate-300">
                              {st.stepOrder}
                            </span>
                            <span className="font-medium text-slate-200">{st.name}</span>
                          </div>
                          <span className="text-[10px] text-indigo-400 font-semibold px-2 py-0.5 rounded bg-indigo-950 border border-indigo-900">
                            {st.role || st.userEmail || 'Assigned'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: WEBHOOKS & INTEGRATIONS */}
        {/* =================================================================== */}
        {activeTab === 'webhooks' && (
          <div className="space-y-6">
            {/* Architecture Banner */}
            <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-900/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-900/80 text-indigo-300 border border-indigo-700">
                    HMAC-SHA256 Signed
                  </span>
                  <span className="text-xs text-indigo-300 font-semibold">
                    BullMQ Asynchronous Outbound Webhooks
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                  FlowGate signs all outbound webhook deliveries using HMAC-SHA256 and includes{' '}
                  <code className="text-indigo-300 font-mono">
                    X-FlowGate-Signature: t=&#123;timestamp&#125;,v1=&#123;signature&#125;
                  </code>{' '}
                  for replay-attack protection. Deliveries are processed in the background with
                  exponential backoff retries.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => fetchDeliveries(selectedSubForDeliveries?.id)}
                  disabled={deliveriesLoading}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex items-center space-x-1.5 transition-colors"
                >
                  <History className="h-3.5 w-3.5 text-indigo-400" />
                  <span>{selectedSubForDeliveries ? 'Endpoint Deliveries' : 'All Deliveries'}</span>
                </button>
              </div>
            </div>

            {/* Webhooks Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Configured Endpoints ({webhooks.length})
                </h4>
              </div>

              {webhooks.length === 0 ? (
                <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
                  <Zap className="h-8 w-8 text-slate-500 mx-auto" />
                  <p className="text-sm font-semibold text-white">
                    No Webhook Endpoints Configured
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Configure webhooks to receive real-time HTTP POST notifications in your external
                    systems (e.g., Slack, Zapier, SIEM) whenever requests are created, approved,
                    rejected, or escalated.
                  </p>
                  <button
                    onClick={() => setShowCreateWebhookModal(true)}
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center space-x-1.5 shadow-md shadow-indigo-600/20"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Your First Webhook</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {webhooks.map((sub) => {
                    const isTesting = testingWebhookId === sub.id;
                    const isSelected = selectedSubForDeliveries?.id === sub.id;

                    return (
                      <div
                        key={sub.id}
                        className={`p-5 rounded-2xl bg-slate-900/70 border transition-all space-y-4 shadow-sm ${
                          isSelected ? 'border-indigo-600 bg-indigo-950/20' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                  sub.status === 'ACTIVE'
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                              >
                                {sub.status}
                              </span>
                              {sub.failureCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
                                  {sub.failureCount} Failures
                                </span>
                              )}
                            </div>
                            <h4 className="font-bold text-white text-base">{sub.name}</h4>
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleTestPing(sub.id, sub.name)}
                              disabled={isTesting}
                              title="Send Test Ping to URL"
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 border border-slate-700 flex items-center space-x-1 transition-colors"
                            >
                              <Radio className={`h-3 w-3 ${isTesting ? 'animate-spin' : ''}`} />
                              <span>{isTesting ? 'Pinging...' : 'Ping'}</span>
                            </button>
                            <button
                              onClick={() => handleDeleteWebhook(sub.id, sub.name)}
                              title="Delete Webhook"
                              className="p-1.5 rounded hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-transparent hover:border-rose-900/60 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* URL snippet */}
                        <div
                          className="p-2 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 truncate"
                          title={sub.url}
                        >
                          {sub.url}
                        </div>

                        {/* Subscribed Events */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Subscribed Events
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {sub.eventTypes.map((ev) => (
                              <span
                                key={ev}
                                className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-950 border border-slate-800 text-indigo-300"
                              >
                                {ev}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Footer details & Deliveries Button */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                          <span className="text-[11px] text-slate-400">
                            Created {new Date(sub.createdAt).toLocaleDateString()}
                          </span>
                          <button
                            onClick={() => {
                              if (isSelected) {
                                setSelectedSubForDeliveries(null);
                                fetchDeliveries();
                              } else {
                                setSelectedSubForDeliveries(sub);
                                fetchDeliveries(sub.id);
                              }
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1"
                          >
                            <History className="h-3.5 w-3.5" />
                            <span>{isSelected ? 'Viewing Deliveries' : 'View Deliveries'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Deliveries History Section */}
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {selectedSubForDeliveries
                      ? `Deliveries: ${selectedSubForDeliveries.name}`
                      : 'Recent Outbound Deliveries'}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Live delivery status, HTTP response status codes, and execution latency.
                  </p>
                </div>
                {selectedSubForDeliveries && (
                  <button
                    onClick={() => {
                      setSelectedSubForDeliveries(null);
                      fetchDeliveries();
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {deliveriesLoading ? (
                <div className="p-8 text-center text-slate-400 space-y-2">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-indigo-400" />
                  <p className="text-xs">Loading delivery logs...</p>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
                  No delivery logs recorded yet for this selection.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">HTTP Code</th>
                        <th className="py-2.5 px-3">Event Type</th>
                        <th className="py-2.5 px-3">Attempts</th>
                        <th className="py-2.5 px-3">Latency</th>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {deliveries.map((del) => {
                        const isRetrying = retryingDeliveryId === del.id;
                        return (
                          <tr key={del.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                  del.status === 'SENT'
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                    : del.status === 'FAILED'
                                      ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                                      : 'bg-amber-950/80 text-amber-300 border-amber-800'
                                }`}
                              >
                                {del.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold">
                              {del.httpStatusCode ? (
                                <span
                                  className={
                                    del.httpStatusCode >= 200 && del.httpStatusCode < 300
                                      ? 'text-emerald-400'
                                      : 'text-rose-400'
                                  }
                                >
                                  {del.httpStatusCode}
                                </span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-indigo-300">
                              {del.eventType}
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">
                              {del.attemptCount} / {del.maxAttempts}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 font-mono">
                              {del.durationMs !== undefined && del.durationMs !== null
                                ? `${del.durationMs}ms`
                                : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400">
                              {new Date(del.createdAt).toLocaleTimeString()}
                            </td>
                            <td className="py-2.5 px-3 text-right space-x-2">
                              <button
                                onClick={() => setSelectedDeliveryPayload(del)}
                                className="text-slate-400 hover:text-indigo-300 font-medium text-[11px]"
                              >
                                Payload
                              </button>
                              {del.status !== 'SENT' && (
                                <button
                                  onClick={() => handleRetryDelivery(del.id)}
                                  disabled={isRetrying}
                                  className="text-indigo-400 hover:text-indigo-300 font-medium text-[11px]"
                                >
                                  {isRetrying ? 'Retrying...' : 'Retry'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL: REQUEST DETAIL & APPROVAL ACTION */}
      {/* =================================================================== */}
      {selectedRequestId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            {!selectedRequestDetail ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-indigo-400" />
                <p className="text-xs">Loading request details & audit history...</p>
              </div>
            ) : (
              <>
                {/* Modal Header */}
                <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-800">
                        {selectedRequestDetail.workflowName}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(selectedRequestDetail.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{selectedRequestDetail.title}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedRequestId(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Request Description */}
                {selectedRequestDetail.description && (
                  <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-300 border border-slate-800">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                      Description / Context
                    </span>
                    {selectedRequestDetail.description}
                  </div>
                )}

                {/* Stepper Timeline */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Approval Sequence
                  </h4>
                  <div className="space-y-2">
                    {selectedRequestDetail.steps.map((step) => {
                      const isCurrent = step.status === 'IN_REVIEW';
                      const isApproved = step.status === 'APPROVED';
                      const isRejected = step.status === 'REJECTED';
                      const isSkipped = step.status === 'SKIPPED';

                      return (
                        <div
                          key={step.id}
                          className={`p-3 rounded-xl border transition-all ${
                            isCurrent
                              ? 'bg-amber-950/30 border-amber-800/80'
                              : isApproved
                                ? 'bg-emerald-950/20 border-emerald-900/60'
                                : isRejected
                                  ? 'bg-red-950/20 border-red-900/60'
                                  : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div
                                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
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
                                  <Check className="h-3.5 w-3.5" />
                                ) : isRejected ? (
                                  <X className="h-3.5 w-3.5" />
                                ) : (
                                  step.stepOrder
                                )}
                              </div>
                              <div>
                                <span className="font-semibold text-sm text-slate-100">
                                  {step.stepName}
                                </span>
                                <div className="text-[11px] text-slate-400">
                                  Assigned:{' '}
                                  {step.assignedRole ||
                                    step.assignedTo?.name ||
                                    'Anyone in organization'}
                                </div>
                              </div>
                            </div>

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

                          {/* Comments & Action Details */}
                          {step.comments && (
                            <div className="mt-2 text-xs text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 flex items-start space-x-2">
                              <MessageSquare className="h-3.5 w-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
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
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Approver Action Panel */}
                {selectedRequestDetail.status === 'IN_PROGRESS' && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <label className="block text-xs font-semibold text-slate-300">
                      Sign-off Decision & Comments
                    </label>
                    <textarea
                      value={actionComments}
                      onChange={(e) => setActionComments(e.target.value)}
                      placeholder="Add mandatory or optional comments explaining your decision..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 h-20"
                    />

                    <div className="flex items-center justify-end space-x-2 pt-1">
                      <button
                        onClick={() => handleAction('REQUEST_CHANGES')}
                        disabled={isExecutingAction}
                        className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Request Changes
                      </button>
                      <button
                        onClick={() => handleAction('REJECT')}
                        disabled={isExecutingAction}
                        className="px-3.5 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-700/60 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleAction('APPROVE')}
                        disabled={isExecutingAction}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                      >
                        <Check className="h-4 w-4" />
                        <span>Approve Step</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Audit Trail */}
                {selectedRequestDetail.auditLogs && selectedRequestDetail.auditLogs.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <History className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Tamper-Evident Audit Trail</span>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {selectedRequestDetail.auditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-2 rounded bg-slate-950 text-[11px] border border-slate-850 flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-indigo-300">{log.action}</span>
                            <span className="text-slate-500">by</span>
                            <span className="text-slate-300">{log.actor?.name || 'System'}</span>
                          </div>
                          <span className="text-slate-500 text-[10px]">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE APPROVAL REQUEST */}
      {/* =================================================================== */}
      {showCreateRequestModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">Create Approval Request</h3>
              <button
                onClick={() => setShowCreateRequestModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Workflow Definition
                </label>
                <select
                  value={newRequestWorkflowId}
                  onChange={(e) => setNewRequestWorkflowId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {workflows
                    .filter((w) => w.status === 'ACTIVE')
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} (v{w.version})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Request Title
                </label>
                <input
                  type="text"
                  value={newRequestTitle}
                  onChange={(e) => setNewRequestTitle(e.target.value)}
                  required
                  placeholder="e.g. Purchase 4x GPUs for AI cluster"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Description / Justification
                </label>
                <textarea
                  value={newRequestDesc}
                  onChange={(e) => setNewRequestDesc(e.target.value)}
                  placeholder="Detailed business justification and context..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 h-24"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateRequestModal(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE WORKFLOW DEFINITION */}
      {/* =================================================================== */}
      {showCreateWorkflowModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">Create New Workflow</h3>
              <button
                onClick={() => setShowCreateWorkflowModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Workflow Name
                </label>
                <input
                  type="text"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  required
                  placeholder="e.g. Legal Contract Review"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={newWorkflowDesc}
                  onChange={(e) => setNewWorkflowDesc(e.target.value)}
                  placeholder="Brief description of when this workflow applies"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Ordered Approval Steps
                </label>
                {newWorkflowSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-center space-x-2 p-2 rounded bg-slate-950 border border-slate-800 text-xs"
                  >
                    <span className="font-bold text-slate-400 w-4">{step.stepOrder}.</span>
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => {
                        const updated = [...newWorkflowSteps];
                        updated[idx].name = e.target.value;
                        setNewWorkflowSteps(updated);
                      }}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    />
                    <select
                      value={step.role}
                      onChange={(e) => {
                        const updated = [...newWorkflowSteps];
                        updated[idx].role = e.target.value as UserRole;
                        setNewWorkflowSteps(updated);
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="APPROVER">APPROVER</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="TENANT_ADMIN">TENANT_ADMIN</option>
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWorkflowModal(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20"
                >
                  Create & Activate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE WEBHOOK SUBSCRIPTION */}
      {/* =================================================================== */}
      {showCreateWebhookModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Zap className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Create Webhook Endpoint</h3>
              </div>
              <button
                onClick={() => setShowCreateWebhookModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Endpoint Name
                </label>
                <input
                  type="text"
                  value={newWebhookName}
                  onChange={(e) => setNewWebhookName(e.target.value)}
                  required
                  placeholder="e.g. Slack Incident Channel / Zapier"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Destination HTTP/HTTPS URL
                </label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  required
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Subscribed Event Types
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    'request.created',
                    'step.approved',
                    'request.approved',
                    'request.rejected',
                    'request.changes_requested',
                    'request.resubmitted',
                    'request.cancelled',
                    '*',
                  ].map((evt) => {
                    const isChecked = newWebhookEvents.includes(evt);
                    return (
                      <label
                        key={evt}
                        className={`flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-indigo-950/60 border-indigo-700 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewWebhookEvents([...newWebhookEvents, evt]);
                            } else {
                              setNewWebhookEvents(newWebhookEvents.filter((x) => x !== evt));
                            }
                          }}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <span className="font-mono text-[11px]">{evt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWebhookModal(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWebhook}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20 flex items-center space-x-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isSubmittingWebhook ? 'Creating...' : 'Register Endpoint'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: WEBHOOK SECRET CREATED NOTICE */}
      {/* =================================================================== */}
      {createdWebhookSecret && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-indigo-600/60 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center space-x-2 text-indigo-400">
              <ShieldCheck className="h-6 w-6" />
              <h3 className="text-base font-bold text-white">Webhook Signing Secret Generated</h3>
            </div>

            <p className="text-xs text-slate-300">
              FlowGate has created endpoint{' '}
              <strong className="text-white">&ldquo;{createdWebhookSecret.name}&rdquo;</strong> with
              an HMAC-SHA256 signature key.
            </p>

            <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl text-xs text-rose-300 space-y-1">
              <div className="font-bold flex items-center space-x-1.5">
                <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                <span>Save this secret now!</span>
              </div>
              <p className="text-[11px] text-rose-300/90">
                For security reasons, FlowGate never stores secrets in plaintext and will never
                display this key again.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                HMAC-SHA256 Signing Secret
              </label>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 break-all select-all flex items-center justify-between">
                <span>{createdWebhookSecret.secret}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdWebhookSecret.secret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="ml-2 p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
                >
                  {copiedSecret ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span className="text-[10px]">{copiedSecret ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCreatedWebhookSecret(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
              >
                I Have Stored the Secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: DELIVERY PAYLOAD VIEWER */}
      {/* =================================================================== */}
      {selectedDeliveryPayload && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs text-indigo-400 font-semibold">
                    {selectedDeliveryPayload.eventType}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      selectedDeliveryPayload.status === 'SENT'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                        : 'bg-rose-950/80 text-rose-300 border-rose-800'
                    }`}
                  >
                    {selectedDeliveryPayload.status}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white">Webhook Delivery Inspector</h3>
              </div>
              <button
                onClick={() => setSelectedDeliveryPayload(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Request Payload (JSON)
                </span>
                <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 overflow-x-auto">
                  {JSON.stringify(selectedDeliveryPayload.payload, null, 2)}
                </pre>
              </div>

              {selectedDeliveryPayload.errorMessage && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block mb-1">
                    Transmission Error
                  </span>
                  <div className="p-3 bg-rose-950/40 rounded-lg border border-rose-800 font-mono text-xs text-rose-300">
                    {selectedDeliveryPayload.errorMessage}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedDeliveryPayload(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: QUEUE & BACKGROUND ENGINE HEALTH */}
      {/* =================================================================== */}
      {showQueueModal && queueHealth && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">BullMQ Background Engine Status</h3>
              </div>
              <button
                onClick={() => setShowQueueModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Redis Connection Pill */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center space-x-2.5">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    queueHealth.redisConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <div>
                  <div className="text-xs font-bold text-white">Redis Infrastructure</div>
                  <div className="text-[10px] text-slate-400">
                    Distributed Locks, Delayed Timers & BullMQ Streams
                  </div>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  queueHealth.redisConnected
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-rose-950 text-rose-300 border-rose-800'
                }`}
              >
                {queueHealth.redisConnected ? 'Connected' : 'Offline'}
              </span>
            </div>

            {/* Queue Metrics */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Active Worker Queues
              </span>
              {(['notifications', 'escalations', 'webhooks'] as const).map((qName) => {
                const q = queueHealth.queues[qName];
                return (
                  <div
                    key={qName}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">
                        {qName}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {q.completed} completed
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Waiting</div>
                        <div className="font-bold text-slate-200">{q.waiting}</div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-indigo-400">Active</div>
                        <div className="font-bold text-indigo-300">{q.active}</div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-amber-400">Delayed</div>
                        <div className="font-bold text-amber-300">{q.delayed || 0}</div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-rose-400">Failed</div>
                        <div className="font-bold text-rose-300">{q.failed}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowQueueModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* DRAWER: NOTIFICATION LOGS ACTIVITY */}
      {/* =================================================================== */}
      {showNotificationsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full flex flex-col p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Bell className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Notifications Activity</h3>
              </div>
              <button
                onClick={() => setShowNotificationsDrawer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-3 pr-1">
              {notificationsLoading ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-indigo-400" />
                  <p className="text-xs">Loading notification logs...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No notifications recorded yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-indigo-400 font-bold">
                        {n.eventType}
                      </span>
                      <span
                        className={`px-2 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                          n.status === 'SENT'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-amber-950 text-amber-300 border-amber-800'
                        }`}
                      >
                        {n.status}
                      </span>
                    </div>
                    <div className="font-semibold text-white">{n.subject}</div>
                    <div className="text-slate-400 text-[11px] leading-relaxed">{n.content}</div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[10px] text-slate-500">
                      <span>To: {n.recipientEmail}</span>
                      <span>{new Date(n.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowNotificationsDrawer(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

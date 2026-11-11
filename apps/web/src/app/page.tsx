'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  UserCheck,
  Plane,
  Calendar,
  Search,
  Sparkles,
  ChevronRight,
  Filter,
  TrendingUp,
  Eye,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import confetti from 'canvas-confetti';
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
  TenantQueueHealthStatus,
  NotificationLogSummary,
  UserDelegationSummary,
  CreateDelegationDto,
  InputSchema,
} from '@flowgate/shared-types';

// =============================================================================
// DEMO PERSONAS CONFIGURATION (Instant 1-Click Launchpad)
// =============================================================================
interface DemoPersona {
  id: string;
  name: string;
  email: string;
  tenantSlug: string;
  tenantName: string;
  role: UserRole;
  title: string;
  badge: string;
  badgeColor: string;
  avatar: string;
  gradient: string;
  borderHover: string;
  description: string;
  powers: string[];
}

const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: 'acme-admin',
    name: 'Alice Vance',
    email: 'admin@acme.com',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    role: 'TENANT_ADMIN',
    title: 'Acme Administrator',
    badge: 'TENANT_ADMIN',
    badgeColor: 'bg-violet-950/80 text-violet-300 border-violet-700/80',
    avatar: '⚡',
    gradient: 'from-violet-600 via-indigo-600 to-purple-700',
    borderHover: 'hover:border-violet-500/70 hover:shadow-violet-500/25',
    description: 'Full workspace authority, visual workflow designer, webhook manager, queue monitor',
    powers: ['Design & Publish DAGs', 'Executive Final Approval', 'Verify SHA-256 Ledger', 'SSRF Webhooks'],
  },
  {
    id: 'acme-cfo',
    name: 'Bob Finance',
    email: 'finance@acme.com',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    role: 'APPROVER',
    title: 'Chief Financial Officer',
    badge: 'APPROVER (DELEGATOR)',
    badgeColor: 'bg-cyan-950/80 text-cyan-300 border-cyan-700/80',
    avatar: '💼',
    gradient: 'from-cyan-600 via-blue-600 to-indigo-700',
    borderHover: 'hover:border-cyan-500/70 hover:shadow-cyan-500/25',
    description: 'Executive capex reviewer with active Out-of-Office delegation delegated to Linda Legal',
    powers: ['Parallel Quorum 2-of-3 Vote', 'Out-of-Office Delegation', 'Budget Sign-off'],
  },
  {
    id: 'acme-legal',
    name: 'Linda Legal',
    email: 'legal@acme.com',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    role: 'APPROVER',
    title: 'General Counsel & Delegatee',
    badge: 'DELEGATEE / APPROVER',
    badgeColor: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80',
    avatar: '⚖️',
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
    borderHover: 'hover:border-emerald-500/70 hover:shadow-emerald-500/25',
    description: 'Acme legal counsel & active stand-in delegatee casting decisive votes on Bob’s behalf',
    powers: ['Cast Delegated Quorum Vote', 'Export Compliance Sign-off', 'Deciding Tie-breaker Vote'],
  },
  {
    id: 'acme-engineer',
    name: 'Charlie Dev',
    email: 'engineer@acme.com',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    role: 'REQUESTER',
    title: 'Principal AI Engineer',
    badge: 'REQUESTER',
    badgeColor: 'bg-amber-950/80 text-amber-300 border-amber-700/80',
    avatar: '🚀',
    gradient: 'from-amber-600 via-orange-600 to-rose-700',
    borderHover: 'hover:border-amber-500/70 hover:shadow-amber-500/25',
    description: 'Submits capex purchase requests with structured runtime condition parameters ($145k AI Cluster)',
    powers: ['Submit Structured DAG Requests', 'Selective Fast-Forward Resubmit', 'Cancel Submissions'],
  },
  {
    id: 'globex-admin',
    name: 'David Mercer',
    email: 'admin@globex.com',
    tenantSlug: 'globex-ind',
    tenantName: 'Globex Industries',
    role: 'TENANT_ADMIN',
    title: 'Globex Administrator',
    badge: 'ISOLATED REALM',
    badgeColor: 'bg-rose-950/80 text-rose-300 border-rose-700/80',
    avatar: '🌐',
    gradient: 'from-rose-600 via-pink-600 to-purple-700',
    borderHover: 'hover:border-rose-500/70 hover:shadow-rose-500/25',
    description: 'Demonstrates physical multi-tenant isolation — zero visibility into Acme workflows or data',
    powers: ['Tenant Boundary Isolation', 'Separate Workflow Catalog', 'Isolated Audit Ledger'],
  },
];

const DEFAULT_DEV_PASSWORD =
  process.env.NEXT_PUBLIC_DEV_PASSWORD || 'FlowGatePass123!';

export default function FlowGateApp() {
  // Auth state
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginSlug, setLoginSlug] = useState('acme-corp');
  const [loginEmail, setLoginEmail] = useState('admin@acme.com');
  const [loginPassword, setLoginPassword] = useState(DEFAULT_DEV_PASSWORD);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [launchingPersonaId, setLaunchingPersonaId] = useState<string | null>(null);

  // App navigation
  const [activeTab, setActiveTab] = useState<'requests' | 'workflows' | 'delegations' | 'webhooks'>('requests');
  const [requestFilter, setRequestFilter] = useState<'pending_approval' | 'mine' | 'all'>('pending_approval');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [requests, setRequests] = useState<ApprovalRequestSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [delegations, setDelegations] = useState<UserDelegationSummary[]>([]);
  const [colleagues, setColleagues] = useState<Array<{ id: string; name: string; email: string; role: UserRole }>>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Selected request detail modal (Quick View)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedRequestDetail, setSelectedRequestDetail] = useState<ApprovalRequestDetail | null>(null);
  const [actionComments, setActionComments] = useState('');
  const [isExecutingAction, setIsExecutingAction] = useState(false);

  // Create Request Modal & Dynamic DAG Parameters
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false);
  const [newRequestWorkflowId, setNewRequestWorkflowId] = useState('');
  const [newRequestTitle, setNewRequestTitle] = useState('');
  const [newRequestDesc, setNewRequestDesc] = useState('');
  const [newRequestData, setNewRequestData] = useState<Record<string, any>>({});

  // Delegations Modal & State
  const [showCreateDelegationModal, setShowCreateDelegationModal] = useState(false);
  const [newDelegateeId, setNewDelegateeId] = useState('');
  const [newDelegationWorkflowId, setNewDelegationWorkflowId] = useState('');
  const [newDelegationStartDate, setNewDelegationStartDate] = useState('');
  const [newDelegationEndDate, setNewDelegationEndDate] = useState('');
  const [newDelegationReason, setNewDelegationReason] = useState('');
  const [isSubmittingDelegation, setIsSubmittingDelegation] = useState(false);
  const [revokingDelegationId, setRevokingDelegationId] = useState<string | null>(null);

  // Audit chain verification status
  const [verifyingChain, setVerifyingChain] = useState(false);
  const [auditChainVerified, setAuditChainVerified] = useState<boolean | null>(null);

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
  const [tenantQueueHealth, setTenantQueueHealth] = useState<TenantQueueHealthStatus | null>(null);
  const [showQueueModal, setShowQueueModal] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookSubscriptionSummary[]>([]);
  const [selectedSubForDeliveries, setSelectedSubForDeliveries] = useState<WebhookSubscriptionSummary | null>(null);
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
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [isSubmittingWebhook, setIsSubmittingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const [selectedDeliveryPayload, setSelectedDeliveryPayload] = useState<WebhookDeliverySummary | null>(null);

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
        api.getDelegations().catch(() => []),
      ];
      if (isAdmin) {
        if (auth.user.role === 'SUPER_ADMIN') {
          promises.push(api.getQueueHealth().catch(() => null));
        } else {
          promises.push(api.getTenantQueueHealth().catch(() => null));
        }
        promises.push(api.getWebhooks().catch(() => []));
        promises.push(api.getNotificationStats().catch(() => null));
      }
      const [reqRes, wfRes, delegRes, qHealth, whList, nStats] = await Promise.all(promises);
      setRequests(reqRes.data);
      setWorkflows(wfRes);
      if (delegRes) setDelegations(delegRes);
      if (isAdmin) {
        if (qHealth) {
          if (auth.user.role === 'SUPER_ADMIN') {
            setQueueHealth(qHealth);
          } else {
            setTenantQueueHealth(qHealth);
          }
        }
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

  // Load eligible colleagues
  const fetchColleagues = useCallback(async () => {
    try {
      const list = await api.getEligibleColleagues();
      setColleagues(list);
      if (list.length > 0 && !newDelegateeId) {
        setNewDelegateeId(list[0].id);
      }
    } catch {
      // ignore
    }
  }, [newDelegateeId]);

  useEffect(() => {
    if (auth && (activeTab === 'delegations' || showCreateDelegationModal)) {
      fetchColleagues();
    }
  }, [auth, activeTab, showCreateDelegationModal, fetchColleagues]);

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

  // Selected workflow & dynamic input schema
  const selectedWorkflow = workflows.find((w) => w.id === newRequestWorkflowId);
  const inputSchema: InputSchema | undefined =
    selectedWorkflow?.configuration?.inputSchema ||
    (selectedWorkflow?.configuration?.nodes?.find((n) => n.type === 'TRIGGER')?.config as any)?.inputSchema;

  // Initialize or reset dynamic input fields when workflow changes
  useEffect(() => {
    if (inputSchema?.fields && inputSchema.fields.length > 0) {
      const defaults: Record<string, any> = {};
      for (const field of inputSchema.fields) {
        if (field.defaultValue !== undefined) {
          defaults[field.name] = field.defaultValue;
        } else if (field.type === 'NUMBER') {
          defaults[field.name] = field.minimum ?? 0;
        } else if (field.type === 'BOOLEAN') {
          defaults[field.name] = false;
        } else if (field.type === 'STRING') {
          defaults[field.name] =
            field.allowedValues && field.allowedValues.length > 0 ? field.allowedValues[0] : '';
        }
      }
      setNewRequestData(defaults);
    } else {
      setNewRequestData({});
    }
  }, [newRequestWorkflowId, workflows, inputSchema]);

  // ---------------------------------------------------------------------------
  // AUTH HANDLERS
  // ---------------------------------------------------------------------------
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmittingLogin(true);
    setLoginError(null);
    try {
      const res = await api.login(loginSlug.trim(), loginEmail.trim(), loginPassword);
      setAuth(res);
      setActionSuccess(`Authenticated as ${res.user.name} (${res.tenant.name})`);
    } catch (err: any) {
      setLoginError(err.message || 'Invalid credentials or tenant not found.');
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleLaunchPersona = async (persona: DemoPersona) => {
    setLaunchingPersonaId(persona.id);
    setLoginError(null);
    try {
      const res = await api.login(persona.tenantSlug, persona.email, DEFAULT_DEV_PASSWORD);
      setAuth(res);
      setActionSuccess(`Instant launch successful: ${res.user.name} (${persona.title})`);
    } catch (err: any) {
      setLoginError(`Failed to authenticate as ${persona.name}: ${err.message || 'Server error'}`);
    } finally {
      setLaunchingPersonaId(null);
    }
  };

  const handleLogout = () => {
    api.logout();
    setAuth(null);
    setSelectedRequestId(null);
    setSelectedRequestDetail(null);
  };

  // ---------------------------------------------------------------------------
  // WORKFLOW & APPROVAL ACTIONS
  // ---------------------------------------------------------------------------
  const handleAction = async (action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', requestId?: string) => {
    const targetId = requestId || selectedRequestId;
    if (!targetId) return;
    setIsExecutingAction(true);
    setActionError(null);
    try {
      const updated = await api.submitAction(targetId, action, actionComments);
      if (selectedRequestId === targetId) {
        setSelectedRequestDetail(updated);
      }
      setActionComments('');
      setActionSuccess(`Successfully submitted ${action.toLowerCase()} decision`);

      if (action === 'APPROVE') {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B'],
        });
      }

      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to execute approval action');
    } finally {
      setIsExecutingAction(false);
    }
  };

  const handleVerifyAuditChain = async () => {
    setVerifyingChain(true);
    try {
      const result = await api.verifyAuditChain();
      setAuditChainVerified(result.valid);
      setActionSuccess(
        result.valid
          ? `Cryptographic Audit Chain verified: ${result.totalEntries} entries valid from genesis block.`
          : `Tampering detected at log ${result.brokenAtId ? `ID #${result.brokenAtId}` : (result.details || 'block')}`
      );
    } catch (err: any) {
      setActionError(err.message || 'Audit chain verification failed');
    } finally {
      setVerifyingChain(false);
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
        requestData: Object.keys(newRequestData).length > 0 ? newRequestData : undefined,
      });
      setShowCreateRequestModal(false);
      setNewRequestTitle('');
      setNewRequestDesc('');
      setNewRequestData({});
      setActionSuccess('Approval request submitted successfully');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create request');
    }
  };

  const openCreateDelegation = () => {
    const now = new Date();
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const formatDt = (d: Date) => d.toISOString().slice(0, 16);
    setNewDelegationStartDate(formatDt(now));
    setNewDelegationEndDate(formatDt(nextWeek));
    setNewDelegationReason('');
    setNewDelegationWorkflowId('');
    setShowCreateDelegationModal(true);
    fetchColleagues();
  };

  const handleCreateDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDelegateeId || !newDelegationStartDate || !newDelegationEndDate) {
      setActionError('Please select a colleague and specify start/end dates.');
      return;
    }
    setIsSubmittingDelegation(true);
    setActionError(null);
    try {
      await api.createDelegation({
        delegateeId: newDelegateeId,
        workflowDefinitionId: newDelegationWorkflowId || undefined,
        delegateRoles: true,
        startDate: new Date(newDelegationStartDate).toISOString(),
        endDate: new Date(newDelegationEndDate).toISOString(),
        reason: newDelegationReason.trim() || undefined,
      });
      setShowCreateDelegationModal(false);
      setActionSuccess('Out-of-office delegation authorized successfully');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create delegation');
    } finally {
      setIsSubmittingDelegation(false);
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    setRevokingDelegationId(id);
    setActionError(null);
    try {
      await api.revokeDelegation(id);
      setActionSuccess('Delegation revoked successfully');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to revoke delegation');
    } finally {
      setRevokingDelegationId(null);
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
      setActionError(err.message || 'Failed to toggle workflow status');
    }
  };

  const handleDeactivateWorkflow = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to deactivate workflow "${name}"?`)) return;
    try {
      await api.deactivateWorkflow(id);
      setActionSuccess(`Workflow "${name}" deactivated successfully`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to deactivate workflow');
    }
  };

  const handleCloneDraft = async (id: string) => {
    try {
      const cloned = await api.cloneDraftWorkflow(id);
      setActionSuccess(`Created draft workflow "${cloned.name}" (v${cloned.version})`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to clone draft workflow');
    }
  };

  // Webhooks
  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookName.trim() || !newWebhookUrl.trim()) return;
    setIsSubmittingWebhook(true);
    setActionError(null);
    try {
      const res = await api.createWebhook({
        name: newWebhookName.trim(),
        url: newWebhookUrl.trim(),
        eventTypes: newWebhookEvents,
      });
      setShowCreateWebhookModal(false);
      setCreatedWebhookSecret({ name: res.name, secret: res.secret || '' });
      setNewWebhookName('');
      setNewWebhookUrl('');
      setActionSuccess(`Webhook subscription "${res.name}" registered`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create webhook');
    } finally {
      setIsSubmittingWebhook(false);
    }
  };

  const handleDeleteWebhook = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete webhook "${name}"?`)) return;
    try {
      await api.deleteWebhook(id);
      setActionSuccess(`Webhook "${name}" deleted`);
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete webhook');
    }
  };

  const handleTestPing = async (id: string, name: string) => {
    setTestingWebhookId(id);
    setActionError(null);
    try {
      const res = await api.testPingWebhook(id);
      setActionSuccess(`Ping sent to "${name}": ${res.message || res.event}`);
      if (activeTab === 'webhooks') fetchDeliveries(id);
    } catch (err: any) {
      setActionError(err.message || 'Ping failed');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const fetchDeliveries = async (subscriptionId?: string) => {
    setDeliveriesLoading(true);
    try {
      const res = await api.getWebhookDeliveries(subscriptionId, 1, 20);
      setDeliveries(res.data);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load deliveries');
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    setRetryingDeliveryId(deliveryId);
    try {
      await api.retryWebhookDelivery(deliveryId);
      setActionSuccess('Delivery retry scheduled');
      fetchDeliveries(selectedSubForDeliveries?.id);
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
      const res = await api.getNotifications(1, 20);
      setNotifications(res.data);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load notifications');
    } finally {
      setNotificationsLoading(false);
    }
  };

  // Filtered requests computation
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        req.title.toLowerCase().includes(q) ||
        req.workflowName.toLowerCase().includes(q) ||
        req.requesterName.toLowerCase().includes(q)
      );
    });
  }, [requests, searchQuery]);

  // Active delegations detection
  const nowMs = Date.now();
  const activeOutgoingDelegation = auth
    ? delegations.find(
        (d) =>
          d.delegatorId === auth.user.id &&
          d.status === 'ACTIVE' &&
          new Date(d.startDate).getTime() <= nowMs &&
          new Date(d.endDate).getTime() >= nowMs
      )
    : null;

  const activeIncomingDelegation = auth
    ? delegations.find(
        (d) =>
          d.delegateeId === auth.user.id &&
          d.status === 'ACTIVE' &&
          new Date(d.startDate).getTime() <= nowMs &&
          new Date(d.endDate).getTime() >= nowMs
      )
    : null;

  // Loading spinner during initial auth read
  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-4">
        <div className="relative">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-aurora-violet to-aurora-cyan p-0.5 animate-spin">
            <div className="h-full w-full bg-obsidian-950 rounded-2xl" />
          </div>
          <Sparkles className="h-6 w-6 text-aurora-cyan absolute inset-0 m-auto" />
        </div>
        <p className="text-xs uppercase tracking-widest text-slate-400 font-mono">Initializing FlowGate...</p>
      </div>
    );
  }

  // ===========================================================================
  // UNAUTHENTICATED: OBSIDIAN & ELECTRIC AURORA LAUNCHPAD
  // ===========================================================================
  if (!auth) {
    return (
      <main className="min-h-screen w-full flex flex-col justify-between p-4 sm:p-8 lg:p-12 relative">
        {/* Top Navbar */}
        <header className="max-w-7xl mx-auto w-full flex items-center justify-between pb-6 border-b border-white/[0.08]">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-aurora-violet via-indigo-600 to-aurora-cyan p-0.5 shadow-lg shadow-violet-500/20">
              <div className="h-full w-full bg-obsidian-950 rounded-[10px] flex items-center justify-center">
                <GitBranch className="h-5 w-5 text-aurora-cyan" />
              </div>
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-white flex items-center space-x-1.5">
                <span>FlowGate</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-mono font-bold bg-violet-950/80 text-violet-300 border border-violet-700/60">
                  Enterprise v7.0
                </span>
              </span>
              <p className="text-[11px] text-slate-400">High-Assurance Approval DAG Engine</p>
            </div>
          </div>

          <a
            href="http://localhost:4000/health"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3.5 py-1.5 rounded-full flex items-center space-x-2 hover:bg-emerald-950/80 transition-colors shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>API Engine :4000 Online</span>
          </a>
        </header>

        {/* Hero & Interactive Launchpad Grid */}
        <section className="max-w-7xl mx-auto w-full py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left Column: Vision, Architecture Live Preview */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-slate-300 backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-aurora-cyan" />
              <span>Obsidian & Electric Aurora Design System</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
              Autonomous DAG Approvals,{' '}
              <span className="bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
                Enforced at the Database.
              </span>
            </h1>

            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-xl">
              FlowGate provides enterprise organizations with automated multi-step DAG approval routing,
              AST condition evaluations, parallel quorum consensus, and append-only SHA-256 cryptographic audit trails.
            </p>

            {/* Live Interactive DAG Preview Card */}
            <div className="glass-card p-5 rounded-2xl border border-white/[0.1] space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div className="flex items-center space-x-2">
                  <Activity className="h-4 w-4 text-aurora-cyan animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    Live Flagship DAG Execution Flow
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  ALL_INCOMING JOIN
                </span>
              </div>

              {/* Node Sequence Mini Flow */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-xl bg-obsidian-900 border border-cyan-800/80 text-cyan-200 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-500">TRIGGER</span>
                  <span className="font-semibold text-white truncate">Capex Intake</span>
                  <span className="text-[10px] text-emerald-400">✓ Validated</span>
                </div>
                <div className="p-2.5 rounded-xl bg-obsidian-900 border border-amber-800/80 text-amber-200 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-500">AST CONDITION</span>
                  <span className="font-semibold text-white truncate">&gt; $10k Capex</span>
                  <span className="text-[10px] text-cyan-400">✓ True ($145k)</span>
                </div>
                <div className="p-2.5 rounded-xl bg-obsidian-900 border border-violet-800/80 text-violet-200 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-500">PARALLEL QUORUM</span>
                  <span className="font-semibold text-white truncate">2 of 3 Required</span>
                  <span className="text-[10px] text-amber-400 animate-pulse">● 1 / 2 Votes</span>
                </div>
                <div className="p-2.5 rounded-xl bg-obsidian-900 border border-emerald-800/80 text-emerald-200 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-500">SYNCHRONIZED JOIN</span>
                  <span className="font-semibold text-white truncate">Final Approval</span>
                  <span className="text-[10px] text-slate-400">Awaiting Quorum</span>
                </div>
              </div>

              {/* Cryptographic Hash Ticker */}
              <div className="p-2.5 rounded-xl bg-obsidian-950 border border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
                <div className="flex items-center space-x-2 truncate">
                  <Lock className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
                  <span className="text-slate-400">Ledger Hash:</span>
                  <span className="text-violet-300 truncate">7e51c890...4f2a (Block #4)</span>
                </div>
                <span className="text-emerald-400 font-semibold flex items-center space-x-1 flex-shrink-0">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Tamper-Free</span>
                </span>
              </div>
            </div>

            {/* Architecture Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                <span className="text-lg font-extrabold text-white">367</span>
                <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Automated Tests</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                <span className="text-lg font-extrabold text-aurora-cyan">Zero</span>
                <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Eval AST Safety</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                <span className="text-lg font-extrabold text-aurora-violet">SHA-256</span>
                <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Audit Ledger</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                <span className="text-lg font-extrabold text-aurora-emerald">Strict</span>
                <span className="block text-[10px] text-slate-400 uppercase tracking-wider">Tenant Isolation</span>
              </div>
            </div>
          </div>

          {/* Right Column: Instant Persona Launchpad */}
          <div className="lg:col-span-6 space-y-5">
            <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-white/[0.1] shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-aurora-violet/20 blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Sparkles className="h-5 w-5 text-aurora-cyan" />
                    <span>Instant Persona Launchpad</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Click any enterprise role card below to authenticate and enter workspace immediately.
                  </p>
                </div>
              </div>

              {loginError && (
                <div className="my-4 p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-xs text-rose-200 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* Persona Cards Grid */}
              <div className="grid grid-cols-1 gap-2.5 pt-4">
                {DEMO_PERSONAS.map((persona) => {
                  const isLaunching = launchingPersonaId === persona.id;

                  return (
                    <button
                      key={persona.id}
                      onClick={() => handleLaunchPersona(persona)}
                      disabled={isLaunching || isSubmittingLogin}
                      className={`w-full text-left p-3.5 rounded-2xl glass-card-interactive border flex items-center justify-between group transition-all ${persona.borderHover} disabled:opacity-50`}
                    >
                      <div className="flex items-center space-x-3.5 min-w-0">
                        <div
                          className={`h-11 w-11 rounded-xl bg-gradient-to-tr ${persona.gradient} flex items-center justify-center text-xl flex-shrink-0 shadow-md group-hover:scale-105 transition-transform`}
                        >
                          {persona.avatar}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-bold text-white text-sm truncate group-hover:text-aurora-cyan transition-colors">
                              {persona.name}
                            </h4>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider border ${persona.badgeColor}`}>
                              {persona.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 font-medium truncate mt-0.5">
                            {persona.title} • <span className="font-mono text-slate-400">{persona.email}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {persona.description}
                          </p>
                        </div>
                      </div>

                      <div className="pl-3 flex-shrink-0 flex items-center space-x-1.5 text-slate-400 group-hover:text-white transition-colors">
                        {isLaunching ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-aurora-cyan" />
                        ) : (
                          <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform text-aurora-cyan" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Manual Login Drawer / Form */}
              <div className="mt-6 pt-5 border-t border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold uppercase tracking-wider text-[10px]">
                    Or Sign In with Custom Credentials
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Default: FlowGatePass123!</span>
                </div>

                <form onSubmit={handleLogin} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">Tenant Slug</label>
                      <input
                        type="text"
                        value={loginSlug}
                        onChange={(e) => setLoginSlug(e.target.value)}
                        required
                        className="w-full bg-obsidian-900 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-aurora-violet font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">Email</label>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        className="w-full bg-obsidian-900 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-aurora-violet font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Password</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      placeholder="FlowGatePass123!"
                      className="w-full bg-obsidian-900 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-aurora-violet font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingLogin}
                    className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-violet-600/30 flex items-center justify-center space-x-1.5 disabled:opacity-50"
                  >
                    {isSubmittingLogin ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <span>Enter Workspace</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="max-w-7xl mx-auto w-full pt-6 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <span>FlowGate Enterprise SaaS Monorepo • MIT License</span>
          <div className="flex items-center space-x-4">
            <span className="font-mono">NestJS 10 • Next.js 14 • PostgreSQL 16 • Redis 7</span>
          </div>
        </footer>
      </main>
    );
  }

  // ===========================================================================
  // AUTHENTICATED: BENTO COMMAND CENTER DASHBOARD
  // ===========================================================================
  return (
    <div className="min-h-screen text-slate-100 flex flex-col selection:bg-violet-600 selection:text-white">
      {/* Top Floating Command Dock Header */}
      <header className="border-b border-white/[0.08] glass-panel sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          {/* Logo & Tenant Context */}
          <div className="flex items-center space-x-3 flex-shrink-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-aurora-violet via-indigo-600 to-aurora-cyan p-0.5 shadow-md shadow-violet-500/20">
              <div className="h-full w-full bg-obsidian-950 rounded-[10px] flex items-center justify-center">
                <GitBranch className="h-4 w-4 text-aurora-cyan" />
              </div>
            </div>
            <div>
              <span className="font-bold text-sm text-white flex items-center space-x-2">
                <span>FlowGate</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-white/[0.06] border border-white/[0.1] text-aurora-cyan">
                  {auth.tenant.slug}
                </span>
              </span>
              <span className="text-[11px] text-slate-400 block truncate">{auth.tenant.name}</span>
            </div>
          </div>

          {/* Instant One-Click Persona Switcher Bar */}
          <div className="hidden xl:flex items-center space-x-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2">Switch Persona:</span>
            {DEMO_PERSONAS.map((persona) => {
              const isActive = auth.user.email === persona.email;
              const isSwitching = launchingPersonaId === persona.id;

              return (
                <button
                  key={persona.id}
                  onClick={() => handleLaunchPersona(persona)}
                  disabled={isActive || isSwitching}
                  className={`px-2.5 py-1 rounded-lg font-medium text-xs flex items-center space-x-1.5 transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                  title={`Switch context to ${persona.name} (${persona.title})`}
                >
                  <span>{persona.avatar}</span>
                  <span>{persona.title.split(' ')[0]}</span>
                  {isSwitching && <RefreshCw className="h-3 w-3 animate-spin" />}
                </button>
              );
            })}
          </div>

          {/* Right Action Icons & Profile */}
          <div className="flex items-center space-x-2.5 flex-shrink-0">
            {/* Notification Bell */}
            <button
              onClick={handleOpenNotifications}
              title="Recent Outbound Notifications"
              className="relative p-2 rounded-xl glass-card hover:bg-white/[0.08] text-slate-300 hover:text-white transition-colors"
            >
              <Bell className="h-4 w-4" />
              {notifStats && notifStats.total > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-violet-600 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                  {notifStats.sent > 9 ? '9+' : notifStats.sent}
                </span>
              )}
            </button>

            {/* User Profile Pill */}
            <div className="flex items-center space-x-2 pl-1 text-xs">
              <div className="text-right hidden sm:block">
                <span className="font-semibold text-white block leading-tight">{auth.user.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">{auth.user.email}</span>
              </div>
              <span className="px-2.5 py-1 rounded-lg font-mono font-bold text-[10px] uppercase bg-violet-950/80 text-violet-300 border border-violet-800">
                {auth.user.role}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl glass-card hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 transition-colors"
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
          <div className="p-3.5 rounded-2xl bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-center justify-between shadow-xl">
            <div className="flex items-center space-x-2.5">
              <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center justify-between shadow-xl">
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Active Out-of-Office Delegation Notice Banners */}
        {activeOutgoingDelegation && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/60 via-obsidian-900 to-obsidian-900 border border-amber-800 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-amber-900/60 border border-amber-700/80 flex items-center justify-center flex-shrink-0">
                <Plane className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <strong className="text-white block">Out-of-Office Delegation Active</strong>
                <span>
                  Your review and sign-off authority is currently delegated to{' '}
                  <strong className="text-amber-300">{activeOutgoingDelegation.delegatee?.name || activeOutgoingDelegation.delegateeId}</strong> until{' '}
                  {new Date(activeOutgoingDelegation.endDate).toLocaleDateString()}.
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('delegations')}
              className="px-3 py-1.5 rounded-lg bg-amber-900/80 hover:bg-amber-800 text-amber-200 border border-amber-700 text-xs font-semibold self-start sm:self-center transition-colors"
            >
              Manage Delegations
            </button>
          </div>
        )}

        {activeIncomingDelegation && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/60 via-obsidian-900 to-obsidian-900 border border-cyan-800 text-cyan-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-cyan-900/60 border border-cyan-700/80 flex items-center justify-center flex-shrink-0">
                <UserCheck className="h-4 w-4 text-cyan-400" />
              </div>
              <div>
                <strong className="text-white block">Acting as Authorized Delegatee</strong>
                <span>
                  You hold delegated approval authority for{' '}
                  <strong className="text-cyan-300">{activeIncomingDelegation.delegator?.name || activeIncomingDelegation.delegatorId}</strong> until{' '}
                  {new Date(activeIncomingDelegation.endDate).toLocaleDateString()}. Your decisions carry full quorum weight.
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('delegations')}
              className="px-3 py-1.5 rounded-lg bg-cyan-900/80 hover:bg-cyan-800 text-cyan-200 border border-cyan-700 text-xs font-semibold self-start sm:self-center transition-colors"
            >
              View Delegated Authority
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* INTERACTIVE BENTO KPI CARDS */}
        {/* =================================================================== */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Pending Approvals */}
          <div
            onClick={() => {
              setActiveTab('requests');
              setRequestFilter('pending_approval');
            }}
            className="p-5 rounded-2xl glass-card-interactive border border-white/[0.08] cursor-pointer space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Awaiting My Review
              </span>
              <div className="h-8 w-8 rounded-xl bg-amber-950/60 border border-amber-800/80 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold text-white">
                {requests.filter((r) => r.status === 'IN_PROGRESS' || r.status === 'PENDING').length}
              </span>
              <span className="text-xs text-amber-400 font-medium">Action Required</span>
            </div>
            <p className="text-[11px] text-slate-400 line-clamp-1">
              Active DAG requests sitting at an approval node
            </p>
          </div>

          {/* Card 2: Workflows */}
          <div
            onClick={() => setActiveTab('workflows')}
            className="p-5 rounded-2xl glass-card-interactive border border-white/[0.08] cursor-pointer space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Active Workflows
              </span>
              <div className="h-8 w-8 rounded-xl bg-violet-950/60 border border-violet-800/80 flex items-center justify-center text-aurora-violet group-hover:scale-110 transition-transform">
                <GitBranch className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold text-white">{workflows.length}</span>
              <span className="text-xs text-violet-400 font-medium">Catalogs Ready</span>
            </div>
            <p className="text-[11px] text-slate-400 line-clamp-1">
              DAG definitions with AST condition routing
            </p>
          </div>

          {/* Card 3: Out-of-Office Delegations */}
          <div
            onClick={() => setActiveTab('delegations')}
            className="p-5 rounded-2xl glass-card-interactive border border-white/[0.08] cursor-pointer space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Delegation Status
              </span>
              <div className="h-8 w-8 rounded-xl bg-cyan-950/60 border border-cyan-800/80 flex items-center justify-center text-aurora-cyan group-hover:scale-110 transition-transform">
                <UserCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold text-white">
                {delegations.filter((d) => d.status === 'ACTIVE').length}
              </span>
              <span className="text-xs text-cyan-400 font-medium">Active Windows</span>
            </div>
            <p className="text-[11px] text-slate-400 line-clamp-1">
              {activeOutgoingDelegation ? 'You have an active outgoing stand-in' : 'Manage travel & leave coverage'}
            </p>
          </div>

          {/* Card 4: SHA-256 Audit Ledger */}
          <div
            onClick={handleVerifyAuditChain}
            className="p-5 rounded-2xl glass-card-interactive border border-white/[0.08] cursor-pointer space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Cryptographic Ledger
              </span>
              <div className="h-8 w-8 rounded-xl bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl font-extrabold text-emerald-400 flex items-center space-x-1">
                {verifyingChain ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                ) : (
                  <span>Verified ✓</span>
                )}
              </span>
              <span className="text-xs text-slate-400 font-mono">SHA-256</span>
            </div>
            <p className="text-[11px] text-slate-400 line-clamp-1">
              Click to recalculate hash chain integrity
            </p>
          </div>
        </section>

        {/* Tab Controls & Primary Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/[0.08]">
          <div className="flex items-center space-x-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
                activeTab === 'requests'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              Approval Requests ({requests.length})
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
                activeTab === 'workflows'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              Workflows ({workflows.length})
            </button>
            <button
              onClick={() => setActiveTab('delegations')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                activeTab === 'delegations'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Delegations ({delegations.length})</span>
            </button>
            {(auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'SUPER_ADMIN') && (
              <button
                onClick={() => {
                  setActiveTab('webhooks');
                  fetchDeliveries();
                }}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center space-x-1.5 ${
                  activeTab === 'webhooks'
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Webhooks ({webhooks.length})</span>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => {
                fetchData();
                if (activeTab === 'webhooks') fetchDeliveries(selectedSubForDeliveries?.id);
              }}
              disabled={dataLoading || deliveriesLoading}
              className="p-2 rounded-xl glass-card hover:bg-white/[0.08] text-slate-300 text-xs flex items-center space-x-1.5 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${dataLoading || deliveriesLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {activeTab === 'requests' && (
              <button
                onClick={() => setShowCreateRequestModal(true)}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-violet-600/30 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span>New Request</span>
              </button>
            )}

            {activeTab === 'workflows' && (auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'MANAGER') && (
              <div className="flex items-center space-x-2">
                <a
                  href="/workflows/new/builder"
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-emerald-600/30 transition-all"
                >
                  <GitBranch className="h-4 w-4" />
                  <span>Visual Workflow Builder</span>
                </a>
                <button
                  onClick={() => setShowCreateWorkflowModal(true)}
                  className="px-3 py-2 rounded-xl glass-card hover:bg-white/[0.08] text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Quick Workflow</span>
                </button>
              </div>
            )}

            {activeTab === 'delegations' && (
              <button
                onClick={openCreateDelegation}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-cyan-600/30 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span>New Delegation</span>
              </button>
            )}

            {activeTab === 'webhooks' && (auth.user.role === 'TENANT_ADMIN' || auth.user.role === 'SUPER_ADMIN') && (
              <button
                onClick={() => setShowCreateWebhookModal(true)}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-violet-600/30 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span>New Webhook</span>
              </button>
            )}
          </div>
        </div>

        {/* =================================================================== */}
        {/* TAB 1: APPROVAL REQUESTS (BENTO VIEW) */}
        {/* =================================================================== */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            {/* Filter Sub-Tabs & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs">
                <button
                  onClick={() => setRequestFilter('pending_approval')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    requestFilter === 'pending_approval'
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/80'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Awaiting My Review
                </button>
                <button
                  onClick={() => setRequestFilter('mine')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    requestFilter === 'mine'
                      ? 'bg-violet-950/80 text-violet-300 border border-violet-700/80'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  My Submissions
                </button>
                <button
                  onClick={() => setRequestFilter('all')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    requestFilter === 'all'
                      ? 'bg-white/[0.08] text-white border border-white/[0.15]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All Organization
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-72">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter requests by title, user..."
                  className="w-full bg-obsidian-900 border border-white/[0.08] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500 font-mono placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Requests List */}
            {dataLoading ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto text-aurora-cyan" />
                <p className="text-xs font-mono uppercase tracking-wider">Loading approval requests...</p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-16 text-center glass-panel rounded-3xl border border-white/[0.08] space-y-4">
                <FileText className="h-12 w-12 mx-auto text-slate-600" />
                <h3 className="font-bold text-lg text-white">No approval requests found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {requestFilter === 'pending_approval'
                    ? 'Zero pending approval actions awaiting your review.'
                    : 'No requests match the selected view. Submit your first approval request.'}
                </p>
                <button
                  onClick={() => setShowCreateRequestModal(true)}
                  className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold rounded-xl hover:from-violet-500 hover:to-indigo-500 transition-all shadow-md shadow-violet-600/30"
                >
                  Create Request
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {filteredRequests.map((req) => {
                  const statusColors: Record<string, string> = {
                    APPROVED: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
                    REJECTED: 'bg-rose-950/80 text-rose-300 border-rose-800',
                    IN_PROGRESS: 'bg-amber-950/80 text-amber-300 border-amber-800',
                    CHANGES_REQUESTED: 'bg-blue-950/80 text-blue-300 border-blue-800',
                    CANCELLED: 'bg-slate-800 text-slate-400 border-slate-700',
                    PENDING: 'bg-slate-800 text-slate-300 border-slate-700',
                  };

                  const isPendingReview = req.status === 'IN_PROGRESS' || req.status === 'PENDING';

                  return (
                    <div
                      key={req.id}
                      onClick={() => setSelectedRequestId(req.id)}
                      className="p-5 rounded-2xl glass-card-interactive border flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer group"
                    >
                      {/* Left: Metadata, Title, Requester */}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              statusColors[req.status] || 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {req.status.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-aurora-cyan font-semibold flex items-center space-x-1">
                            <GitBranch className="h-3 w-3" />
                            <span>{req.workflowName}</span>
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {req.currentStep
                              ? `Stage ${req.currentStep} of ${req.totalSteps}`
                              : `Completed (${req.totalSteps} steps)`}
                          </span>
                        </div>

                        <h4 className="font-bold text-white text-base group-hover:text-aurora-cyan transition-colors">
                          {req.title}
                        </h4>

                        {req.description && (
                          <p className="text-xs text-slate-300 line-clamp-1">{req.description}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pt-0.5">
                          <span>Requester: <strong className="text-slate-200">{req.requesterName}</strong></span>
                          <span>•</span>
                          <span>Submitted: {new Date(req.createdAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span className="font-mono text-slate-500">ID: {req.id.slice(0, 8)}...</span>
                        </div>
                      </div>

                      {/* Right: Actions Dock */}
                      <div className="flex items-center space-x-2 self-end md:self-center flex-shrink-0">
                        {/* 1-Click Approve / Reject (If In Review) */}
                        {isPendingReview && (
                          <div className="flex items-center space-x-1.5 mr-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleAction('APPROVE', req.id)}
                              disabled={isExecutingAction}
                              title="1-Click Approve"
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-800 text-xs font-semibold flex items-center space-x-1 transition-all"
                            >
                              <ThumbsUp className="h-3 w-3" />
                              <span className="hidden sm:inline">Approve</span>
                            </button>
                            <button
                              onClick={() => handleAction('REJECT', req.id)}
                              disabled={isExecutingAction}
                              title="1-Click Reject"
                              className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 border border-rose-800 text-xs font-semibold flex items-center space-x-1 transition-all"
                            >
                              <ThumbsDown className="h-3 w-3" />
                              <span className="hidden sm:inline">Reject</span>
                            </button>
                          </div>
                        )}

                        <a
                          href={`/requests/${req.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-3.5 py-1.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-700/60 text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
                        >
                          <Activity className="h-3.5 w-3.5 text-aurora-cyan" />
                          <span>Live DAG</span>
                        </a>

                        <button
                          onClick={() => setSelectedRequestId(req.id)}
                          className="px-3 py-1.5 rounded-xl glass-card hover:bg-white/[0.08] text-slate-200 text-xs font-medium flex items-center space-x-1 transition-colors"
                        >
                          <span>Review</span>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
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
              const isActive = wf.status === 'ACTIVE';

              return (
                <div
                  key={wf.id}
                  className="p-5 rounded-2xl glass-card border border-white/[0.08] space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            isActive
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {wf.status}
                        </span>
                        <span className="text-xs text-aurora-cyan font-mono">v{wf.version}</span>
                      </div>

                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleCloneDraft(wf.id)}
                          title="Clone as new draft version"
                          className="p-1.5 rounded-lg glass-card hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeactivateWorkflow(wf.id, wf.name)}
                          title="Deactivate workflow"
                          className="p-1.5 rounded-lg glass-card hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <h4 className="font-bold text-white text-base">{wf.name}</h4>
                    {wf.description && (
                      <p className="text-xs text-slate-300 line-clamp-2">{wf.description}</p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-400 font-mono">
                      Requests: {wf._count?.approvalRequests || 0}
                    </span>

                    <div className="flex items-center space-x-2">
                      <a
                        href={`/workflows/${wf.id}/builder`}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-700/60 font-semibold flex items-center space-x-1 transition-colors"
                      >
                        <GitBranch className="h-3 w-3" />
                        <span>Visual Builder</span>
                      </a>

                      <button
                        onClick={() => handleToggleWorkflow(wf.id, wf.status)}
                        className={`px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                          isActive
                            ? 'bg-rose-950/60 text-rose-300 border-rose-800 hover:bg-rose-900/60'
                            : 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'
                        }`}
                      >
                        {isActive ? 'Archive' : 'Publish'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: OUT-OF-OFFICE DELEGATIONS */}
        {/* =================================================================== */}
        {activeTab === 'delegations' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl glass-panel border border-white/[0.08]">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <UserCheck className="h-5 w-5 text-aurora-cyan" />
                  <h3 className="font-bold text-white text-base">Out-of-Office Approver Delegations</h3>
                </div>
                <p className="text-xs text-slate-400 max-w-2xl">
                  Temporarily assign your review and sign-off authority to an eligible colleague when traveling or on leave. All delegated votes are cryptographically attested and chained in the immutable audit log.
                </p>
              </div>
              <button
                onClick={openCreateDelegation}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-cyan-600/30 transition-all self-start sm:self-center"
              >
                <Plus className="h-4 w-4" />
                <span>New Delegation</span>
              </button>
            </div>

            {delegations.length === 0 ? (
              <div className="p-16 text-center glass-panel rounded-3xl border border-white/[0.08] space-y-3">
                <UserCheck className="h-10 w-10 mx-auto text-slate-600" />
                <h3 className="font-bold text-slate-200">No delegations configured</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  There are no active or historical out-of-office delegations configured in your tenant.
                </p>
                <button
                  onClick={openCreateDelegation}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xs font-semibold rounded-xl hover:from-cyan-500 hover:to-blue-500 transition-all shadow-md shadow-cyan-600/30"
                >
                  Create Out-of-Office Delegation
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {delegations.map((del) => {
                  const now = new Date();
                  const start = new Date(del.startDate);
                  const end = new Date(del.endDate);
                  const isCurrentActive = del.status === 'ACTIVE' && now >= start && now <= end;
                  const isPendingStart = del.status === 'ACTIVE' && now < start;
                  const isRevoked = del.status === 'REVOKED';

                  const statusBadgeClass = isCurrentActive
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                    : isPendingStart
                    ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                    : isRevoked
                    ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                    : 'bg-slate-800 text-slate-400 border-slate-700';

                  const statusLabel = isCurrentActive
                    ? 'ACTIVE NOW'
                    : isPendingStart
                    ? 'SCHEDULED'
                    : isRevoked
                    ? 'REVOKED'
                    : 'EXPIRED';

                  const isRevoking = revokingDelegationId === del.id;

                  return (
                    <div
                      key={del.id}
                      className="p-5 rounded-2xl glass-card border border-white/[0.08] space-y-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusBadgeClass}`}
                        >
                          {statusLabel}
                        </span>

                        {del.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleRevokeDelegation(del.id)}
                            disabled={isRevoking}
                            className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 text-xs font-medium transition-colors flex items-center space-x-1"
                          >
                            <X className={`h-3 w-3 ${isRevoking ? 'animate-spin' : ''}`} />
                            <span>{isRevoking ? 'Revoking...' : 'Revoke Early'}</span>
                          </button>
                        )}
                      </div>

                      {/* Delegator -> Delegatee */}
                      <div className="p-3.5 bg-obsidian-950 rounded-xl border border-white/[0.06] flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            Principal (Delegator)
                          </span>
                          <span className="font-bold text-white text-xs">
                            {del.delegator?.name || del.delegatorId}
                          </span>
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {del.delegator?.email}
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-aurora-cyan mx-2 flex-shrink-0" />
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            Stand-in (Delegatee)
                          </span>
                          <span className="font-bold text-white text-xs">
                            {del.delegatee?.name || del.delegateeId}
                          </span>
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {del.delegatee?.email}
                          </span>
                        </div>
                      </div>

                      {/* Details: Scope, Window, Reason */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-[11px]">Workflow Scope:</span>
                          <span className="text-slate-200 font-medium">
                            {del.workflowDefinitionName || (del.workflowDefinitionId ? 'Specific Workflow' : 'All Organization Workflows')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-[11px]">Effective Window:</span>
                          <span className="text-slate-200 font-mono text-[11px]">
                            {start.toLocaleDateString()} – {end.toLocaleDateString()}
                          </span>
                        </div>
                        {del.reason && (
                          <div className="pt-1 text-[11px] text-slate-400 italic">
                            &ldquo;{del.reason}&rdquo;
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: WEBHOOKS & INTEGRATIONS */}
        {/* =================================================================== */}
        {activeTab === 'webhooks' && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl glass-panel border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Zap className="h-5 w-5 text-aurora-cyan" />
                  <h3 className="font-bold text-white text-base">SSRF-Guarded Outbound Webhooks</h3>
                </div>
                <p className="text-xs text-slate-400 max-w-2xl">
                  Dispatches HMAC-SHA256 signed event payloads on workflow lifecycle state transitions. Outbound HTTP requests undergo pre-flight DNS socket verification to block private networks (RFC 1918) and cloud metadata targets.
                </p>
              </div>
              <button
                onClick={() => setShowCreateWebhookModal(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-violet-600/30 transition-all self-start md:self-center"
              >
                <Plus className="h-4 w-4" />
                <span>New Webhook</span>
              </button>
            </div>

            {webhooks.length === 0 ? (
              <div className="p-16 text-center glass-panel rounded-3xl border border-white/[0.08] space-y-3">
                <Zap className="h-10 w-10 mx-auto text-slate-600" />
                <h3 className="font-bold text-slate-200">No Webhook Subscriptions</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Subscribe third-party services, Slack bots, or internal APIs to approval events.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {webhooks.map((sub) => (
                  <div key={sub.id} className="p-5 rounded-2xl glass-card border border-white/[0.08] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm">{sub.name}</span>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleTestPing(sub.id, sub.name)}
                          disabled={testingWebhookId === sub.id}
                          className="px-2.5 py-1 rounded-lg glass-card hover:bg-white/[0.08] text-xs text-aurora-cyan font-mono transition-colors"
                        >
                          Ping
                        </button>
                        <button
                          onClick={() => handleDeleteWebhook(sub.id, sub.name)}
                          className="p-1.5 rounded-lg glass-card hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-obsidian-950 border border-white/[0.06] font-mono text-xs text-slate-300 truncate">
                      {sub.url}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {sub.eventTypes.map((ev) => (
                        <span key={ev} className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet-950/60 text-violet-300 border border-violet-800">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL: REQUEST DETAIL & APPROVAL ACTION */}
      {/* =================================================================== */}
      {selectedRequestId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            {!selectedRequestDetail ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-aurora-cyan" />
                <p className="text-xs font-mono">Loading request details...</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between border-b border-white/[0.08] pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-950 text-violet-300 border border-violet-800">
                        {selectedRequestDetail.workflowName}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(selectedRequestDetail.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{selectedRequestDetail.title}</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <a
                      href={`/requests/${selectedRequestDetail.id}`}
                      className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-md shadow-violet-600/30"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      <span>Full Live DAG</span>
                    </a>
                    <button
                      onClick={() => setSelectedRequestId(null)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08]"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {selectedRequestDetail.description && (
                  <div className="p-3.5 bg-obsidian-950 rounded-xl text-xs text-slate-300 border border-white/[0.08]">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                      Description / Business Justification
                    </span>
                    {selectedRequestDetail.description}
                  </div>
                )}

                {/* Structured DAG Routing Parameters */}
                {selectedRequestDetail.requestData && Object.keys(selectedRequestDetail.requestData).length > 0 && (
                  <div className="p-3.5 bg-obsidian-950 rounded-xl text-xs text-slate-300 border border-white/[0.08] space-y-1.5">
                    <span className="text-[10px] uppercase font-bold text-aurora-cyan tracking-wider block">
                      DAG Execution Parameters (Condition Routing Payload)
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(selectedRequestDetail.requestData).map(([k, v]) => (
                        <div
                          key={k}
                          className="px-2.5 py-1 rounded-lg bg-obsidian-900 border border-white/[0.08] font-mono text-[11px] text-slate-300"
                        >
                          <span className="text-slate-400">{k}:</span>{' '}
                          <span className="text-emerald-400 font-semibold">
                            {typeof v === 'boolean'
                              ? v ? 'true' : 'false'
                              : typeof v === 'number'
                              ? k.toLowerCase().includes('amount') || k.toLowerCase().includes('cost') || k.toLowerCase().includes('budget')
                                ? `$${v.toLocaleString()}`
                                : v.toString()
                              : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stepper Timeline */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Approval Steps</h4>
                  <div className="space-y-2">
                    {selectedRequestDetail.steps.map((step) => (
                      <div key={step.id} className="p-3 rounded-xl bg-obsidian-950 border border-white/[0.08] flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-3">
                          <span className="h-6 w-6 rounded-full bg-violet-950 text-violet-300 border border-violet-800 flex items-center justify-center font-bold text-[11px]">
                            {step.stepOrder}
                          </span>
                          <div>
                            <span className="font-semibold text-white block">{step.stepName}</span>
                            <span className="text-[11px] text-slate-400">
                              Assigned: {step.assignedRole || step.assignedTo?.name || 'Authorized Approver'}
                            </span>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/[0.06] border border-white/[0.1] text-slate-300">
                          {step.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Approver Action Panel */}
                {(selectedRequestDetail.status === 'IN_PROGRESS' || selectedRequestDetail.status === 'PENDING') && (
                  <div className="p-4 rounded-2xl bg-obsidian-950 border border-white/[0.08] space-y-3">
                    <label className="block text-xs font-semibold text-slate-300">Sign-off Decision & Review Comments</label>
                    <textarea
                      value={actionComments}
                      onChange={(e) => setActionComments(e.target.value)}
                      placeholder="Add review feedback, compliance attestations, or rationale..."
                      className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500 h-20"
                    />
                    <div className="flex items-center justify-end space-x-2 pt-1">
                      <button
                        onClick={() => handleAction('REQUEST_CHANGES')}
                        disabled={isExecutingAction}
                        className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Request Changes
                      </button>
                      <button
                        onClick={() => handleAction('REJECT')}
                        disabled={isExecutingAction}
                        className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-700/60 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleAction('APPROVE')}
                        disabled={isExecutingAction}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all flex items-center space-x-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Authorize Approval</span>
                      </button>
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Create Approval Request</h3>
              <button onClick={() => setShowCreateRequestModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Workflow Definition</label>
                <select
                  value={newRequestWorkflowId}
                  onChange={(e) => setNewRequestWorkflowId(e.target.value)}
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
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
                <label className="block text-xs font-semibold text-slate-300 mb-1">Request Title</label>
                <input
                  type="text"
                  value={newRequestTitle}
                  onChange={(e) => setNewRequestTitle(e.target.value)}
                  required
                  placeholder="e.g. Purchase 4x H100 GPUs for AI cluster"
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description / Justification</label>
                <textarea
                  value={newRequestDesc}
                  onChange={(e) => setNewRequestDesc(e.target.value)}
                  placeholder="Detailed business context and ROI..."
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500 h-20"
                />
              </div>

              {/* Dynamic DAG Input Schema Parameters */}
              {inputSchema?.fields && inputSchema.fields.length > 0 && (
                <div className="p-4 rounded-2xl bg-obsidian-950 border border-white/[0.08] space-y-3">
                  <div className="flex items-center space-x-2">
                    <GitBranch className="h-4 w-4 text-aurora-cyan" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Workflow Input Parameters
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    This workflow evaluates runtime condition expressions. Values provided below drive DAG branch selection.
                  </p>
                  <div className="space-y-3 pt-1">
                    {inputSchema.fields.map((field) => (
                      <div key={field.name}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-slate-300">
                            {field.label} {field.required && <span className="text-rose-400">*</span>}
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {field.name} ({field.type})
                          </span>
                        </div>

                        {field.type === 'NUMBER' ? (
                          <input
                            type="number"
                            min={field.minimum}
                            max={field.maximum}
                            value={newRequestData[field.name] ?? ''}
                            onChange={(e) =>
                              setNewRequestData((prev) => ({
                                ...prev,
                                [field.name]: e.target.value === '' ? '' : Number(e.target.value),
                              }))
                            }
                            required={field.required}
                            className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500 font-mono"
                          />
                        ) : field.type === 'STRING' && field.allowedValues && field.allowedValues.length > 0 ? (
                          <select
                            value={newRequestData[field.name] ?? field.allowedValues[0]}
                            onChange={(e) =>
                              setNewRequestData((prev) => ({
                                ...prev,
                                [field.name]: e.target.value,
                              }))
                            }
                            className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                          >
                            {field.allowedValues.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : field.type === 'BOOLEAN' ? (
                          <label className="flex items-center space-x-2 cursor-pointer mt-1 bg-obsidian-900 border border-white/[0.08] p-2.5 rounded-xl">
                            <input
                              type="checkbox"
                              checked={!!newRequestData[field.name]}
                              onChange={(e) =>
                                setNewRequestData((prev) => ({
                                  ...prev,
                                  [field.name]: e.target.checked,
                                }))
                              }
                              className="rounded bg-obsidian-950 border-white/[0.2] text-violet-600 focus:ring-0"
                            />
                            <span className="text-xs text-slate-300">
                              {newRequestData[field.name] ? 'Enabled / Yes' : 'Disabled / No'}
                            </span>
                          </label>
                        ) : (
                          <input
                            type="text"
                            value={newRequestData[field.name] ?? ''}
                            onChange={(e) =>
                              setNewRequestData((prev) => ({
                                ...prev,
                                [field.name]: e.target.value,
                              }))
                            }
                            required={field.required}
                            className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateRequestModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-xs font-semibold shadow-md shadow-violet-600/30 hover:from-violet-500 hover:to-indigo-500 transition-all"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE OUT-OF-OFFICE DELEGATION */}
      {/* =================================================================== */}
      {showCreateDelegationModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center space-x-2">
                <UserCheck className="h-5 w-5 text-aurora-cyan" />
                <h3 className="font-bold text-base text-white">New Out-of-Office Delegation</h3>
              </div>
              <button onClick={() => setShowCreateDelegationModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDelegation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Designated Colleague (Delegatee) *</label>
                <select
                  value={newDelegateeId}
                  onChange={(e) => setNewDelegateeId(e.target.value)}
                  required
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email}) — {c.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Workflow Scope</label>
                <select
                  value={newDelegationWorkflowId}
                  onChange={(e) => setNewDelegationWorkflowId(e.target.value)}
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">All Organization Workflows (Universal)</option>
                  {workflows
                    .filter((w) => w.status === 'ACTIVE')
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} (v{w.version})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Start Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={newDelegationStartDate}
                    onChange={(e) => setNewDelegationStartDate(e.target.value)}
                    required
                    className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">End Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={newDelegationEndDate}
                    onChange={(e) => setNewDelegationEndDate(e.target.value)}
                    required
                    className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Reason / Context</label>
                <textarea
                  value={newDelegationReason}
                  onChange={(e) => setNewDelegationReason(e.target.value)}
                  placeholder="e.g. Attending AWS re:Invent conference, PTO..."
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 h-20"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateDelegationModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDelegation}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-cyan-600/30 transition-all disabled:opacity-50"
                >
                  {isSubmittingDelegation ? 'Saving...' : 'Authorize Delegation'}
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Create Quick Workflow</h3>
              <button onClick={() => setShowCreateWorkflowModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Workflow Name</label>
                <input
                  type="text"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  required
                  placeholder="e.g. Cloud Infrastructure Provisioning"
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  value={newWorkflowDesc}
                  onChange={(e) => setNewWorkflowDesc(e.target.value)}
                  placeholder="Purpose and SLA expectations..."
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500 h-20"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWorkflowModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-violet-600/30 transition-all"
                >
                  Create Workflow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE WEBHOOK */}
      {/* =================================================================== */}
      {showCreateWebhookModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Register Webhook</h3>
              <button onClick={() => setShowCreateWebhookModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  value={newWebhookName}
                  onChange={(e) => setNewWebhookName(e.target.value)}
                  required
                  placeholder="e.g. Slack Approval Bot"
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target Endpoint URL</label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  required
                  placeholder="https://api.example.com/webhooks"
                  className="w-full bg-obsidian-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWebhookModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWebhook}
                  className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-violet-600/30 transition-all disabled:opacity-50"
                >
                  {isSubmittingWebhook ? 'Saving...' : 'Register Webhook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secret Display Modal */}
      {createdWebhookSecret && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-base text-white">Webhook HMAC Secret</h3>
            <p className="text-xs text-slate-400">Save this secret key. It will not be shown again.</p>
            <div className="p-3 bg-obsidian-950 border border-white/[0.1] rounded-xl font-mono text-xs text-aurora-cyan break-all">
              {createdWebhookSecret.secret}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setCreatedWebhookSecret(null)}
                className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Drawer */}
      {showNotificationsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md h-full glass-panel border-l border-white/[0.1] p-6 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Outbound Notifications</h3>
              <button onClick={() => setShowNotificationsDrawer(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {notificationsLoading ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-aurora-cyan" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">No recent notifications.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className="p-3 rounded-xl bg-obsidian-950 border border-white/[0.06] text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-aurora-cyan">{n.eventType}</span>
                      <span className="text-[10px] text-slate-500">{new Date(n.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-300 font-medium">{n.recipientEmail}</p>
                    <p className="text-slate-400 text-[11px] truncate">{n.subject}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

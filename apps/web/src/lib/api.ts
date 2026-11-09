import {
  AuthResponse,
  WorkflowDefinitionSummary,
  ApprovalRequestSummary,
  ApprovalRequestDetail,
  PaginatedResult,
  ApprovalActionType,
  UserRole,
  WebhookSubscriptionSummary,
  WebhookDeliverySummary,
  CreateWebhookDto,
  UpdateWebhookDto,
  QueueHealthStatus,
  TenantQueueHealthStatus,
  NotificationLogSummary,
  WorkflowNode,
  WorkflowEdge,
  InputSchema,
  RequestExecutionGraph,
  AuditChainVerificationResult,
} from '@flowgate/shared-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errors?: any[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('flowgate_token');
}

export function setStoredToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('flowgate_token', token);
  } else {
    localStorage.removeItem('flowgate_token');
    localStorage.removeItem('flowgate_auth');
  }
}

export function getStoredAuth(): AuthResponse | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('flowgate_auth');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthResponse;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: AuthResponse | null) {
  if (typeof window === 'undefined') return;
  if (auth) {
    localStorage.setItem('flowgate_auth', JSON.stringify(auth));
    setStoredToken(auth.accessToken);
  } else {
    setStoredToken(null);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    let errErrors: any[] | undefined;

    try {
      const data = await response.json();
      if (data.message) {
        errMessage = Array.isArray(data.message) ? data.message.join(', ') : data.message;
      }
      errErrors = data.errors;
    } catch {
      // Non-json response
    }

    if (response.status === 401 && typeof window !== 'undefined') {
      // Token expired or invalid
      setStoredAuth(null);
    }

    throw new ApiError(response.status, errMessage, errErrors);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// API Methods
// =============================================================================

export const api = {
  // Authentication
  async login(tenantSlug: string, email: string, password: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password }),
    });
    setStoredAuth(data);
    return data;
  },

  async getProfile() {
    return request<any>('/api/v1/auth/me');
  },

  logout() {
    setStoredAuth(null);
  },

  // Workflows
  async getWorkflows(): Promise<WorkflowDefinitionSummary[]> {
    return request<WorkflowDefinitionSummary[]>('/api/v1/workflows');
  },

  async getWorkflow(id: string): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}`);
  },

  async createWorkflow(payload: {
    name: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    inputSchema?: InputSchema;
    steps?: Array<{
      stepOrder: number;
      name: string;
      assigneeType: 'ROLE' | 'USER';
      role?: UserRole;
      description?: string;
    }>;
    approvalThresholdUsd?: number;
    status?: string;
  }): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateWorkflow(
    id: string,
    payload: {
      name?: string;
      description?: string;
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
      inputSchema?: InputSchema;
      steps?: Array<{
        stepOrder: number;
        name: string;
        assigneeType: 'ROLE' | 'USER';
        role?: UserRole;
        description?: string;
      }>;
      approvalThresholdUsd?: number;
      status?: string;
    },
  ): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async publishWorkflow(id: string): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}/publish`, {
      method: 'POST',
    });
  },

  async cloneDraftWorkflow(id: string): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}/clone-draft`, {
      method: 'POST',
    });
  },

  async getExecutionGraph(requestId: string): Promise<RequestExecutionGraph> {
    return request<RequestExecutionGraph>(`/api/v1/requests/${requestId}/execution-tree`);
  },

  async activateWorkflow(id: string): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}/activate`, {
      method: 'POST',
    });
  },

  async deactivateWorkflow(id: string): Promise<WorkflowDefinitionSummary> {
    return request<WorkflowDefinitionSummary>(`/api/v1/workflows/${id}/deactivate`, {
      method: 'POST',
    });
  },

  // Approval Requests
  async getRequests(params?: {
    filter?: 'mine' | 'pending_approval' | 'all';
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<ApprovalRequestSummary>> {
    const query = new URLSearchParams();
    if (params?.filter) query.set('filter', params.filter);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<PaginatedResult<ApprovalRequestSummary>>(`/api/v1/requests${qs}`);
  },

  async getRequest(id: string): Promise<ApprovalRequestDetail> {
    return request<ApprovalRequestDetail>(`/api/v1/requests/${id}`);
  },

  async createRequest(payload: {
    workflowDefinitionId: string;
    title: string;
    description?: string;
  }): Promise<ApprovalRequestDetail> {
    return request<ApprovalRequestDetail>('/api/v1/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async submitAction(
    id: string,
    action: ApprovalActionType,
    comments?: string,
    stepId?: string,
    delegationId?: string,
  ): Promise<ApprovalRequestDetail> {
    return request<ApprovalRequestDetail>(`/api/v1/requests/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, comments, stepId, delegationId }),
    });
  },

  async resubmitRequest(
    id: string,
    payload: {
      title?: string;
      description?: string;
      comments?: string;
      updatedData?: Record<string, unknown>;
      resubmissionPolicy?: 'REOPEN_ALL' | 'SELECTIVE_FAST_FORWARD';
    },
  ): Promise<ApprovalRequestDetail> {
    return request<ApprovalRequestDetail>(`/api/v1/requests/${id}/resubmit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyAuditChain(): Promise<AuditChainVerificationResult> {
    return request<AuditChainVerificationResult>('/api/v1/audit/verify');
  },

  async cancelRequest(id: string): Promise<ApprovalRequestDetail> {
    return request<ApprovalRequestDetail>(`/api/v1/requests/${id}/cancel`, {
      method: 'POST',
    });
  },

  // Queue Health (Admin)
  async getQueueHealth(): Promise<QueueHealthStatus> {
    return request<QueueHealthStatus>('/api/v1/admin/queues/status');
  },

  async getTenantQueueHealth(): Promise<TenantQueueHealthStatus> {
    return request<TenantQueueHealthStatus>('/api/v1/admin/queues/tenant-status');
  },

  // Webhooks (Admin)
  async getWebhooks(): Promise<WebhookSubscriptionSummary[]> {
    return request<WebhookSubscriptionSummary[]>('/api/v1/webhooks');
  },

  async createWebhook(payload: CreateWebhookDto): Promise<WebhookSubscriptionSummary> {
    return request<WebhookSubscriptionSummary>('/api/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateWebhook(id: string, payload: UpdateWebhookDto): Promise<WebhookSubscriptionSummary> {
    return request<WebhookSubscriptionSummary>(`/api/v1/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteWebhook(id: string): Promise<void> {
    return request<void>(`/api/v1/webhooks/${id}`, {
      method: 'DELETE',
    });
  },

  async testPingWebhook(id: string): Promise<{ event: string; message: string }> {
    return request<{ event: string; message: string }>(`/api/v1/webhooks/${id}/test`, {
      method: 'POST',
    });
  },

  async getWebhookDeliveries(
    subscriptionId?: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<WebhookDeliverySummary>> {
    const qs = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    const path = subscriptionId
      ? `/api/v1/webhooks/${subscriptionId}/deliveries?${qs.toString()}`
      : `/api/v1/webhooks/deliveries?${qs.toString()}`;
    return request<PaginatedResult<WebhookDeliverySummary>>(path);
  },

  async retryWebhookDelivery(deliveryId: string): Promise<WebhookDeliverySummary> {
    return request<WebhookDeliverySummary>(`/api/v1/webhooks/deliveries/${deliveryId}/retry`, {
      method: 'POST',
    });
  },

  // Notifications
  async getNotifications(page = 1, limit = 20): Promise<PaginatedResult<NotificationLogSummary>> {
    const qs = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    return request<PaginatedResult<NotificationLogSummary>>(
      `/api/v1/notifications?${qs.toString()}`,
    );
  },

  async getNotificationStats(): Promise<{
    sent: number;
    pending: number;
    failed: number;
    total: number;
  }> {
    return request<{ sent: number; pending: number; failed: number; total: number }>(
      '/api/v1/notifications/stats',
    );
  },
};

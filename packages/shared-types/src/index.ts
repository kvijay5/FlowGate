/**
 * FlowGate Shared Types & Domain Interfaces
 */

export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface DatabaseHealth {
  status: 'connected' | 'disconnected';
  responseTimeMs?: number;
}

export interface HealthCheckResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  service: string;
  database?: DatabaseHealth;
}

// User & Role Domain
export type UserRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MANAGER' | 'REQUESTER' | 'APPROVER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';

// Workflow Domain
export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export type AssigneeType = 'ROLE' | 'USER';

export interface WorkflowStepConfig {
  stepOrder: number;
  name: string;
  assigneeType: AssigneeType;
  role?: UserRole;
  userId?: string;
  userEmail?: string;
  description?: string;
}

export interface WorkflowConfiguration {
  steps: WorkflowStepConfig[];
  approvalThresholdUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowDefinitionSummary {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  version: number;
  configuration: WorkflowConfiguration;
  createdAt: string;
  updatedAt: string;
  _count?: {
    approvalRequests: number;
  };
}

// Approval Request Domain
export type ApprovalRequestStatus =
  'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CHANGES_REQUESTED';

export type StepStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

export type ApprovalActionType = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'CANCEL';

export interface ApprovalStepDetail {
  id: string;
  tenantId: string;
  approvalRequestId: string;
  stepName: string;
  stepOrder: number;
  status: StepStatus;
  assignedRole?: UserRole | null;
  assignedToId?: string | null;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  } | null;
  actionedById?: string | null;
  actionedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  actionedAt?: string | null;
  comments?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestSummary {
  id: string;
  tenantId: string;
  workflowDefinitionId: string;
  workflowName: string;
  workflowVersion: number;
  requestedById: string;
  requesterName: string;
  requesterEmail: string;
  title: string;
  description?: string | null;
  status: ApprovalRequestStatus;
  currentStep?: number | null;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestDetail extends ApprovalRequestSummary {
  workflowDefinition: WorkflowDefinitionSummary;
  workflowSnapshot?: Record<string, unknown> | null;
  steps: ApprovalStepDetail[];
  auditLogs?: AuditLogSummary[];
}

// Audit Domain
export interface AuditLogSummary {
  id: string;
  tenantId: string;
  actorId?: string | null;
  actor?: {
    id: string;
    name: string;
    email: string;
  } | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
  previousHash?: string | null;
  hash?: string | null;
  sequenceNumber?: number | null;
  createdAt: string;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenAtId?: string;
  details?: string;
}

// Multi-tenant & Auth Domain
export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  accessToken: string;
  user: UserSummary;
  tenant: TenantSummary;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

// Pagination & Filtering
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// =============================================================================
// Background Processing, Notifications, Webhooks & Escalations (Milestone 5)
// =============================================================================

export type NotificationChannel = 'EMAIL' | 'SLACK_MOCK';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';
export type WebhookStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface NotificationLogSummary {
  id: string;
  tenantId: string;
  recipientEmail: string;
  recipientUserId?: string | null;
  channel: NotificationChannel;
  eventType: string;
  subject: string;
  content: string;
  metadata?: Record<string, unknown>;
  status: DeliveryStatus;
  attemptCount: number;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface WebhookSubscriptionSummary {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  eventTypes: string[];
  status: WebhookStatus;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  secret?: string; // Only returned once on creation
}

export interface WebhookDeliverySummary {
  id: string;
  tenantId: string;
  subscriptionId: string;
  subscriptionName?: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  httpStatusCode?: number | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEventSummary {
  id: string;
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  idempotencyKey: string;
  scheduledFor: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantQueueHealthStatus {
  tenantId: string;
  redisConnected: boolean;
  timestamp: string;
  outbox: {
    pending: number;
    processing: number;
    published: number;
    failed: number;
  };
  notifications: {
    pending: number;
    sent: number;
    failed: number;
  };
  webhooks: {
    activeEndpoints: number;
    totalDeliveries: number;
    failedDeliveries: number;
  };
}

export interface CreateWebhookDto {
  name: string;
  url: string;
  eventTypes: string[];
}

export interface UpdateWebhookDto {
  name?: string;
  url?: string;
  eventTypes?: string[];
  status?: WebhookStatus;
}

export interface QueueJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed?: number;
}

export interface QueueHealthStatus {
  redisConnected: boolean;
  timestamp: string;
  queues: {
    notifications: QueueJobCounts;
    escalations: QueueJobCounts;
    webhooks: QueueJobCounts;
  };
}

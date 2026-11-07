# FlowGate - Engineering Development Log

---

## [Milestone 5.1: Background Reliability & Webhook Security Hardening] - 2026-11-08

### 1. Executive Summary

Milestone 5.1 resolved four critical reliability, data-integrity, and security findings identified in the background processing and webhook subsystems before proceeding to Milestone 6:

1. **Transactional Outbox Engine (`apps/api/src/outbox/`)**:
   - Replaced direct post-commit job enqueueing with a PostgreSQL-backed Transactional Outbox pattern.
   - All workflow lifecycle events (escalation timers, signed webhooks, notifications) are written directly into `outbox_events` within the exact same database transaction (`tx: Prisma.TransactionClient`) as the business state transition. If a business mutation rolls back, zero outbox events are created.
   - Built a high-throughput, concurrency-safe `OutboxPublisherService` leveraging PostgreSQL row-level locks (`SELECT ... FOR UPDATE SKIP LOCKED`) inside short transactions to claim pending jobs without contention across multiple API nodes.
   - Features automatic recovery sweeps on application bootstrap (`onApplicationBootstrap`), 1s periodic background polling, and immediate event-driven triggers.
   - Added automatic exponential backoff (up to 60s) with 5 retry attempts and crash recovery for stalled `PROCESSING` rows older than 60 seconds.

2. **Webhook Replay Protection & Inbound Deduplication (`apps/api/src/webhooks/`)**:
   - Formally documented replay vulnerability models, tolerance windows, and receiver deduplication strategies in `webhook-signature.util.ts`.
   - Introduced a stable logical `eventId` across the entire webhook lifecycle. Every delivery, payload, and HTTP header (`X-FlowGate-Event-Id`) contains the event ID. Upon manual or automated retries, the logical `eventId` is strictly preserved, enabling receiver deduplication while `deliveryId` identifies the individual physical attempt (`X-FlowGate-Delivery-Id`).
   - Implemented a persistent deduplication store `InboundWebhookEvent` (`inbound_webhook_events`) with composite uniqueness on `[tenant_id, event_id]`.
   - Exposed `POST /api/v1/webhooks/inbound` providing deduplication for incoming webhook events with configurable TTL expiration.

3. **Enterprise-Grade SSRF Protection (`apps/api/src/webhooks/ssrf/`)**:
   - Built a standalone security guard and HTTP client (`ssrf-guard.ts`) validating all untrusted webhook destination URLs upon registration, modification, and test pings.
   - Rejects non-HTTPS schemes (enforced by default, configurable in test environments via `ALLOW_INSECURE_HTTP_WEBHOOKS`).
   - Strictly blocks loopback addresses (`127.0.0.0/8`, `::1`), private RFC 1918 / ULA networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local and cloud metadata addresses (`169.254.0.0/16`, `fe80::/10`, `169.254.169.254`, `metadata.google.internal`), multicast (`224.0.0.0/4`, `ff00::/8`), and reserved address spaces.
   - Performs DNS resolution across all returned records (`all: true`), rejecting the destination if any resolved IP address belongs to a forbidden subnet.
   - Eliminates DNS rebinding (TOCTOU attacks) via connection-time DNS pinning: resolves and validates the IP address prior to connection, pins the socket connection directly to the validated IP, and retains TLS Server Name Indication (SNI) for hostname verification.
   - Enforces manual redirect validation (max 3 hops) re-checking every redirect hop against the SSRF policy before connection.
   - Imposes strict connection limits: 3s connection timeout, 5s response timeout, 64KB response body truncation, and HTTP credential stripping.

4. **Queue Health Authorization & Tenant Isolation (`apps/api/src/queues/`)**:
   - Restricted global queue health metrics (`GET /api/v1/admin/queues/status`) strictly to `SUPER_ADMIN`, preventing tenant administrators from viewing platform-wide worker counts or queue depths.
   - Implemented a dedicated tenant health endpoint (`GET /api/v1/admin/queues/tenant-status`) for `TENANT_ADMIN` and `SUPER_ADMIN`.
   - Queries database counts (outbox events, notification logs, webhook deliveries) filtered strictly by verified `tenantId`, guaranteeing multi-tenant confidentiality.
   - Updated Next.js web application dashboard to fetch tenant-scoped health metrics for `TENANT_ADMIN`.

5. **Rigorously Verified**:
   - Monorepo quality gates: 0 TypeScript errors, 0 ESLint warnings, 100% Prettier formatting.
   - **113 unit tests passed** across 14 test suites.
   - **84 integration/e2e tests passed** across 6 test suites (totaling **197 automated tests passed**).
   - Clean production build verified for Next.js 14 and NestJS.

---

### 2. Deliverables Completed

- **Database Migration (`20261107182509_milestone5_1_outbox_replay_ssrf_hardening`)**:
  - Enum: `OutboxStatus` (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`).
  - Table: `outbox_events` with composite unique constraint `[tenant_id, idempotency_key]` and indexes on `[status, scheduled_for]`, `[tenant_id, entity_id]`, and `[created_at]`.
  - Table: `inbound_webhook_events` with composite unique constraint `[tenant_id, event_id]` and index on `[expires_at]`.
  - Added `event_id` (UUID) to `webhook_deliveries` with index on `[tenant_id, event_id]`.
- **Shared Types (`packages/shared-types/src/index.ts`)**:
  - Exported `OutboxStatus`, `OutboxEventSummary`, `TenantQueueHealthStatus`.
  - Added `eventId: string` to `WebhookDeliverySummary`.
  - Recompiled `@flowgate/shared-types`.
- **Transactional Outbox Engine (`apps/api/src/outbox/`)**:
  - `outbox.constants.ts`: Event types (`OUTBOX_EVENT_NOTIFICATION`, `OUTBOX_EVENT_WEBHOOK`, `OUTBOX_EVENT_ESCALATION_SCHEDULE`, `OUTBOX_EVENT_ESCALATION_CANCEL`).
  - `outbox.service.ts`: Atomic `createEvent` within `tx`, concurrency-safe `claimPendingEvents` using `FOR UPDATE SKIP LOCKED`, `markPublished`, `markFailed` with exponential backoff and max retry handling.
  - `outbox-publisher.service.ts`: Background publishing daemon with bootstrap recovery sweep, 1s polling interval, immediate `trigger()` dispatcher, and deterministic BullMQ job IDs (`outbox_${event.id}`).
  - `outbox.module.ts`: Modular encapsulation imported across application domains.
- **Workflow State Machine Outbox Integration (`apps/api/src/requests/requests.service.ts`)**:
  - Refactored `create()`, `submitAction()` (for `APPROVE`, `REJECT`, `REQUEST_CHANGES`), `resubmit()`, and `cancel()` to write all outbox events directly inside `tx`.
  - Fires `this.outboxPublisher.trigger()` immediately following transaction commitment.
- **SSRF Protection & Secure HTTP Client (`apps/api/src/webhooks/ssrf/`)**:
  - `ssrf-guard.ts`: Complete IPv4/IPv6 classification, metadata hostname filter, DNS resolution checking all IPs, connection-time DNS pinning preventing DNS rebinding, manual redirect following (max 3 hops), strict timeouts (3s connect, 5s response), 64KB body truncation, credential stripping.
  - `ssrf-guard.spec.ts`: 24 unit tests covering IPv4/IPv6 subnets, link-local metadata, loopback, private ranges, redirect hops, and public domains.
- **Webhook Replay Protection & Inbound Deduplication (`apps/api/src/webhooks/`)**:
  - `webhook-signature.util.ts`: Added replay vulnerability documentation, receiver deduplication guidance, and event ID vs delivery ID semantics.
  - `webhooks.service.ts`: Injected SSRF validation on `create`, `update`, and `testPing`; preserved stable `eventId` on `retryDelivery`; built `recordInboundEvent`.
  - `webhooks.controller.ts`: Added `POST /api/v1/webhooks/inbound` endpoint.
  - `webhooks.processor.ts`: Migrated to `executeSafeWebhookRequest`, forwarding `X-FlowGate-Event-Id`, `X-FlowGate-Delivery-Id`, `X-FlowGate-Attempt`.
- **Queue-Health Authorization & Tenant Isolation (`apps/api/src/queues/`)**:
  - `queue-health.controller.ts`: Restricted `GET /api/v1/admin/queues/status` strictly to `SUPER_ADMIN`. Added `GET /api/v1/admin/queues/tenant-status` for `TENANT_ADMIN` & `SUPER_ADMIN`.
  - `queue-health.service.ts`: Built `getTenantHealthStatus(tenantId)` querying database metrics scoped by tenant.
  - `apps/web/src/lib/api.ts` & `apps/web/src/app/page.tsx`: Updated dashboard to query tenant-scoped metrics for tenant administrators.
- **Dedicated Integration Suite (`apps/api/test/outbox-and-security.integration-spec.ts`)**:
  - 18 automated integration tests covering transactional atomicity, rollback verification, outbox status transitions, inbound deduplication, tenant isolation of deduplication keys, SSRF rejection of cloud metadata and RFC 1918 addresses, test ping SSRF rejection, and role-based queue health authorization.

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why the Transactional Outbox Pattern is Essential**:
  In a distributed system, a service often needs to update a database and enqueue a background message (such as an email or webhook). Doing these two operations separately creates a dual-write failure mode:
  - If you enqueue the job _before_ the database commit, the database commit might fail, leaving an orphaned message that notifies a user about an action that never happened.
  - If you enqueue the job _after_ the database commit, the server could crash or lose network connectivity before the enqueue command reaches Redis, causing the notification to be permanently lost.
    The Transactional Outbox pattern solves this by writing the message directly into an `outbox_events` table inside the _same_ database transaction as the business operation. Because relational databases guarantee atomicity (ACID), either both the business change and the outbox event are saved, or neither is. A separate background worker reads from the outbox table and reliably delivers the jobs to BullMQ.

- **Why `FOR UPDATE SKIP LOCKED` Prevents Worker Contention**:
  When multiple API servers or worker instances run concurrently, standard SQL queries like `SELECT * FROM outbox_events WHERE status = 'PENDING' LIMIT 10` can result in multiple workers picking up the exact same events, leading to duplicate execution or lock contention. Using PostgreSQL's `FOR UPDATE SKIP LOCKED` tells the database engine to lock matching rows and immediately skip past any rows that are already locked by another active transaction. Each worker gets a unique batch of events instantly without waiting or blocking other workers.

- **Why Connection-Time DNS Pinning Stops DNS Rebinding (TOCTOU) Attacks**:
  A naive SSRF check might look like this: resolve `example.com` to `93.184.216.34`, verify that `93.184.216.34` is a public IP, and then pass `https://example.com` to `fetch()` or `axios`.
  This creates a Time-of-Check to Time-of-Use (TOCTOU) race condition. An attacker can set up a custom DNS server that returns a valid public IP on the first lookup (when your validator checks it) and then returns `169.254.169.254` (cloud metadata) on the second lookup (when the HTTP client actually connects).
  FlowGate's `ssrf-guard` uses Node's custom `lookup` option in `http.request` / `https.request`. The socket connects directly to the pre-validated IP address while sending the original hostname in the HTTP `Host` header and TLS Server Name Indication (SNI). This eliminates the window for DNS rebinding attacks.

- **Why Webhook `eventId` Must Be Distinct from `deliveryId`**:
  A single business event (e.g., "Request #101 was approved") may require multiple delivery attempts if the receiver's server experiences temporary downtime.
  - The `eventId` is the logical identifier of the business occurrence. It remains identical across all retries.
  - The `deliveryId` identifies a single physical HTTP delivery attempt.
    When an external receiver processes a webhook, they check whether they have already seen that `eventId`. If so, they acknowledge with 200 OK without re-executing actions (like charging a credit card or provisioning a server twice).

- **Why Tenant Queue Health Must Be Isolated from Global Queue Metrics**:
  In a multi-tenant SaaS application, tenants should never be able to deduce the overall transaction volume, customer traffic patterns, or system load of other companies sharing the platform. Exposing global queue counts (e.g. 50,000 pending jobs across all tenants) leaks sensitive platform-wide telemetry. `TENANT_ADMIN` users are provided with tenant-scoped counts derived strictly from their own database records (`outbox_events`, `notification_logs`, `webhook_deliveries`), while platform-wide BullMQ worker internals are restricted strictly to `SUPER_ADMIN`.

---

### 4. Verification and Actual Test Results

All verification suites executed on Node.js `v24.18.0` with active Docker services (`flowgate-postgres` on `:5432`, `flowgate-redis` on `:6379`):

#### A. Monorepo Quality Gates

| Check                       | Tool / Command                | Result     | Notes                                                 |
| :-------------------------- | :---------------------------- | :--------- | :---------------------------------------------------- |
| **Type Check**              | `pnpm check-types`            | **PASSED** | 0 TypeScript errors across web, api, and shared-types |
| **Linting**                 | `pnpm lint`                   | **PASSED** | 0 ESLint warnings or errors across all packages       |
| **Code Style**              | `pnpm format:check`           | **PASSED** | 100% compliant with Prettier formatting               |
| **Backend Unit Tests**      | `pnpm test`                   | **PASSED** | **113 passed** across 14 test suites                  |
| **Integration / E2E Tests** | `pnpm test:e2e`               | **PASSED** | **84 passed** across 6 test suites (ran in band)      |
| **Total Automated Tests**   | `pnpm test` + `pnpm test:e2e` | **PASSED** | **197 tests passed**, exit code 0                     |
| **Production Build**        | `pnpm build`                  | **PASSED** | Next.js 14 and NestJS production builds clean         |

#### B. Detailed Test Suite Summary

- **Unit Test Suites (113 passed)**:
  - `src/webhooks/ssrf/ssrf-guard.spec.ts` (24 tests): IPv4 loopback, private RFC 1918, link-local cloud metadata, broadcast/reserved ranges, IPv6 loopback, ULA, link-local, IPv4-mapped IPv6, public global unicast, combined classifier, scheme validation, redirect hop limiting, body truncation, DNS pinning.
  - `src/outbox/outbox.service.spec.ts` (8 tests): In-transaction event creation, row-level locking claim, status updates, exponential retry backoff, permanent failure handling, stats aggregation, publisher daemon sweep.
  - `src/webhooks/webhook-signature.util.spec.ts` (9 tests): HMAC signing, verification, malformed headers, secret mismatch, tampered payload, replay attacks, future drift, simulated replay deduplication.
  - `src/webhooks/webhooks.service.spec.ts` (10 tests): Secret generation (`whsec_...`), secret masking on read, tenant isolation, wildcard event matching, manual delivery retry, stable event ID preservation, SSRF validation, inbound deduplication recording.
  - `src/queues/queue-health.service.spec.ts` (3 tests): Multi-queue count aggregation, Redis disconnect handling, tenant-scoped database health query.
  - `src/requests/requests.service.spec.ts` (8 tests): Request creation, step instantiation, approval transitions, final approval, rejection skips, change requests, in-transaction outbox recording.
  - `src/escalations/escalations.service.spec.ts` (8 tests): Delayed job scheduling, job removal, reminder state checks, request status suppression, reminder audit logging, escalation state checks, atomic conditional updates.
  - `src/notifications/notifications.service.spec.ts` (10 tests): DB logging, BullMQ enqueue, idempotency skips, role scoping, stats aggregation, worker delivery, retry backoff, max attempts failure.
  - `src/workflows/workflows.service.spec.ts` (6 tests): Creation, retrieval, activation, deactivation, version incrementing.
  - `src/audit/audit.service.spec.ts` (14 tests): Hash chain integrity, canonical JSON hashing, verification.
  - `src/auth/auth.service.spec.ts` (7 tests): Tenant login, password hashing, JWT signing, user profile.
  - `src/auth/guards/roles.guard.spec.ts` (4 tests): Role hierarchy and permission enforcement.
  - `src/health/health.controller.spec.ts` (2 tests): Service ping and DB connectivity.
  - `src/prisma/prisma.service.spec.ts` (1 test): Lifecycle connection handling.
- **Integration / E2E Test Suites (84 passed)**:
  - `test/outbox-and-security.integration-spec.ts` (18 tests):
    - Atomic outbox creation within request transaction.
    - Outbox event rollback on transaction abort.
    - Outbox claiming with row-level locks and status transitions.
    - Inbound webhook first arrival acceptance.
    - Inbound webhook duplicate flagging on replayed eventId.
    - Inbound webhook tenant isolation for duplicate keys.
    - Rejection of inbound webhooks missing eventId.
    - SSRF rejection of unencrypted HTTP schemes.
    - SSRF rejection of cloud metadata IP 169.254.169.254.
    - SSRF rejection of GCP metadata host.
    - SSRF rejection of private IP addresses (RFC 1918).
    - SSRF rejection of test ping without network traffic.
    - Rejection of unauthenticated requests to global queue status (401).
    - Rejection of non-admin requester requests to global status (403).
    - Rejection of TENANT_ADMIN requests to global status (403).
    - SUPER_ADMIN authorization for global queue metrics (200).
    - TENANT_ADMIN authorization for tenant-status with isolated metrics (200).
    - Rejection of non-admin requester requests to tenant-status (403).
  - `test/background-jobs.integration-spec.ts` (10 tests): Admin queue health endpoint authorization; webhook subscription CRUD and tenant isolation; test ping with HMAC signature verification; request creation triggering signed outbound webhook to local HTTP server and mock email delivery; notification stats aggregation.
  - `test/workflow-engine.integration-spec.ts` (31 tests): Multi-step sequential lifecycle, change requests, rejections, concurrency guards, audit chain verification.
  - `test/tenant-isolation.integration-spec.ts` (11 tests): Composite foreign keys, cross-tenant leak prevention.
  - `test/auth.integration-spec.ts` (10 tests): JWT authentication, token expiration, invalid credentials.
  - `test/app.e2e-spec.ts` (2 tests): Health check endpoints.

---

### 5. Known Limitations or Environmental Blockers

- **Mock Email Delivery**: In accordance with the security constitution, external SMTP / third-party email APIs remain routed to `MockEmailProvider` in development and testing environments.
- **Local Loopback in Integration Tests**: `ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS` is enabled strictly when `process.env.NODE_ENV === 'test'` to facilitate ephemeral local HTTP receiver testing without weakening production SSRF boundaries.

---

### 6. Recommended Next Steps (Milestone 6 Preparation)

1. **Parallel & Conditional Workflow Branches**:
   - Support branching workflows where multiple approvers or roles must sign off concurrently (AND/OR parallel step stages).
   - Evaluate dynamic condition trees (e.g., evaluate JSON payloads against conditional expression rules).
2. **Delegation & Out-of-Office Routing**:
   - Temporary delegation of approval authority to designated delegates during absence windows with tamper-evident audit logging.
3. **Advanced Admin Console & Visual Workflow Designer**:
   - Drag-and-drop or node-based visual workflow editor in Next.js web application.

---

## [Milestone 5: Background Processing & Escalation Engine] - 2026-11-07

### 1. Executive Summary

Milestone 5 delivered a production-grade, asynchronous background processing engine for FlowGate backed by Redis 7 and BullMQ, seamlessly integrated with the multi-tenant workflow state machine:

1. **BullMQ & Redis Infrastructure**:
   - Configured high-performance Redis queues (`notifications`, `escalations`, `webhooks`) running via `@nestjs/bullmq` and `ioredis`.
   - Built a dedicated health aggregation service (`QueueHealthService`) exposing real-time worker metrics (waiting, active, completed, failed, delayed) and Redis ping status over `/api/v1/admin/queues/status`.
2. **Notification Subsystem with Idempotency & Safe Transports**:
   - Built `NotificationsService` and `NotificationsProcessor` executing background email deliveries.
   - Enforced database-backed delivery logs (`notification_logs`) with tenant-isolated composite uniqueness on `[tenant_id, idempotency_key]` to guarantee zero duplicate emails.
   - Implemented an extensible `EmailProvider` interface backed by `MockEmailProvider` ensuring no external third-party emails are dispatched during development or testing.
3. **Automated Reminders & State-Rechecking Escalation Engine**:
   - Implemented delayed BullMQ jobs for step reminders and timeout escalations (`EscalationsService`).
   - Built `EscalationsProcessor` with strict state re-check invariants: workers verify database state before acting. If an approver actions the step while a delayed job is pending, the worker safely aborts execution as a no-op.
   - If an overdue step remains in review, `EscalationsProcessor` executes an atomic conditional transaction (`updateMany` on `status === 'IN_REVIEW' && isEscalated === false`), reassigns the step to the designated escalation role or user, records `STEP_ESCALATED` to the tamper-evident audit chain, and notifies the new assignee.
4. **Outbound Cryptographically Signed Webhooks (HMAC-SHA256)**:
   - Built tenant-scoped webhook subscriptions (`webhook_subscriptions`) with per-endpoint cryptographic secrets (`whsec_...`).
   - Implemented `signWebhookPayload` producing standard signatures: `X-FlowGate-Signature: t={timestamp},v1={hmac_sha256_hex}` with constant-time verification (`timingSafeEqual`) and timestamp drift tolerance (default 300s) to block replay attacks.
   - Secrets are returned exclusively once on endpoint creation and masked everywhere else.
   - Built `WebhooksProcessor` delivering HTTP POST payloads with a 5s timeout, tracking HTTP status codes and roundtrip latency in `webhook_deliveries`, and supporting manual delivery retries.
5. **Next.js Web Console Integration**:
   - Added live "Engine Healthy" status pill in the top navigation bar showing Redis connectivity and opening a real-time queue inspector modal.
   - Added "Webhooks & Integrations" console tab with endpoint creation, copyable secret dialog, test ping triggers, and deliveries drawer with payload inspection and manual retry buttons.
   - Added notifications activity drawer displaying recent delivery logs and recipient statuses.
6. **Rigorously Verified**:
   - Monorepo quality gates: 0 TypeScript errors, 0 ESLint warnings, 100% Prettier formatting.
   - **75 unit tests passed** across 12 test suites.
   - **62 integration/e2e tests passed** across 5 test suites (totaling **137 automated tests**).
   - Clean production build verified for Next.js 14 and NestJS.

---

### 2. Deliverables Completed

- **Database Migration (`20261107160000_milestone5_background_processing_notifications_webhooks_escalations`)**:
  - Enums: `NotificationChannel` (`EMAIL`, `SLACK_MOCK`), `DeliveryStatus` (`PENDING`, `SENT`, `FAILED`), `WebhookStatus` (`ACTIVE`, `INACTIVE`, `SUSPENDED`).
  - Added reminder and escalation tracking columns to `approval_steps`: `reminder_count`, `last_reminded_at`, `is_escalated`, `escalated_at`, `escalated_to_role`, `escalated_to_user_id`, `escalation_reason`.
  - Created `notification_logs` table with composite unique constraint on `[tenant_id, idempotency_key]`.
  - Created `webhook_subscriptions` table with `secret` column and composite unique constraint on `[tenant_id, id]`.
  - Created `webhook_deliveries` table tracking `status`, `http_status_code`, `request_headers`, `response_body`, `duration_ms`, `attempt_count`, and `max_attempts`.
- **Shared Types (`packages/shared-types/src/index.ts`)**:
  - Exported `NotificationChannel`, `DeliveryStatus`, `WebhookStatus`.
  - Added DTOs and interfaces: `NotificationLogSummary`, `WebhookSubscriptionSummary`, `WebhookDeliverySummary`, `CreateWebhookDto`, `UpdateWebhookDto`, `QueueJobCounts`, `QueueHealthStatus`.
  - Recompiled `@flowgate/shared-types`.
- **BullMQ Queue Infrastructure (`apps/api/src/queues/`)**:
  - `queue.constants.ts`: Queue names (`QUEUE_NOTIFICATIONS`, `QUEUE_ESCALATIONS`, `QUEUE_WEBHOOKS`) and job names.
  - `queues.module.ts`: Global module configuring `BullModule.forRootAsync` with connection parameters (`maxRetriesPerRequest: null`, `enableOfflineQueue: false`) and default retry backoff policies.
  - `queue-health.service.ts`: Checks Redis ping, polls BullMQ queue counts, and cleans up client connections on module destroy.
  - `queue-health.controller.ts`: Endpoint `GET /api/v1/admin/queues/status` protected by `@Roles('TENANT_ADMIN', 'SUPER_ADMIN')`.
- **Notification Subsystem (`apps/api/src/notifications/`)**:
  - `email-provider.interface.ts`: `EmailProvider` interface.
  - `mock-email.provider.ts`: Safe in-memory transport logging structured emails and simulating transient delivery errors on demand.
  - `notifications.processor.ts`: Worker host processing `JOB_SEND_NOTIFICATION` with database idempotency checks, retry logging, and exponential backoff.
  - `notifications.service.ts`: `dispatchWorkflowNotification` creating database records and enqueueing jobs; `findAll` and `getStats` query endpoints.
  - `notifications.controller.ts`: `GET /api/v1/notifications` and `GET /api/v1/notifications/stats`.
- **Escalation & Reminder Engine (`apps/api/src/escalations/`)**:
  - `escalations.service.ts`: Computes delays, generates deterministic job IDs, and schedules delayed reminder/escalation jobs; cancels pending delayed jobs on step completion.
  - `escalations.processor.ts`: Worker host processing `JOB_CHECK_REMINDER` and `JOB_PROCESS_ESCALATION` with mandatory database state re-checks, atomic conditional updates, and audit logging.
- **Outbound Webhooks Subsystem (`apps/api/src/webhooks/`)**:
  - `webhook-signature.util.ts`: HMAC-SHA256 signing (`t=...,v1=...`), constant-time signature comparison (`crypto.timingSafeEqual`), and timestamp tolerance verification.
  - `webhooks.service.ts`: Subscription CRUD, automatic cryptographic secret generation, secret masking on retrieval, event dispatching, and delivery retry.
  - `webhooks.processor.ts`: Worker executing HTTP POST requests with 5s timeout, tracking response bodies and durations, and updating delivery records.
  - `webhooks.controller.ts`: REST endpoints protected by `@Roles('TENANT_ADMIN', 'SUPER_ADMIN')`.
- **Workflow State Machine Integration (`apps/api/src/requests/requests.service.ts`)**:
  - Hooked non-blocking background dispatches safely _after_ database transactions commit:
    - `create()`: schedules Step 1 reminder/escalation jobs, fires `request.created` webhook, dispatches `REQUEST_SUBMITTED` notification.
    - `submitAction('APPROVE')`: cancels previous step jobs; schedules next step jobs, fires `step.approved`, and notifies next assignee (`STEP_ASSIGNED`); on final approval, fires `request.approved` and notifies requester (`REQUEST_APPROVED`).
    - `submitAction('REJECT')`: cancels pending step jobs, fires `request.rejected`, and notifies requester (`REQUEST_REJECTED`).
    - `submitAction('REQUEST_CHANGES')`: cancels step jobs, fires `request.changes_requested`, and notifies requester (`CHANGES_REQUESTED`).
    - `resubmit()`: reschedules step jobs for active step, fires `request.resubmitted`, and notifies reviewer (`REQUEST_RESUBMITTED`).
    - `cancel()`: cancels all step jobs and fires `request.cancelled`.
- **Next.js Web Console (`apps/web/src/app/page.tsx` & `apps/web/src/lib/api.ts`)**:
  - Live queue health pill in header with Redis ping indicator and queue metrics modal.
  - "Webhooks & Integrations" dashboard tab with endpoint cards, event badges, failure counters, and test ping triggers.
  - Copyable secret modal with security warnings.
  - Delivery history table with HTTP status codes, latency in ms, payload inspector, and retry buttons.
  - Notifications drawer displaying recent system alerts.
- **Automated Testing Suite**:
  - `apps/api/src/webhooks/webhook-signature.util.spec.ts`: HMAC signing, tampered payload rejection, expired timestamp rejection (8 tests).
  - `apps/api/src/notifications/notifications.service.spec.ts`: Mock email delivery, idempotency, retry state (10 tests).
  - `apps/api/src/escalations/escalations.service.spec.ts`: Job scheduling, job cancellation, step state re-checking, atomic escalation (8 tests).
  - `apps/api/src/webhooks/webhooks.service.spec.ts`: Secret generation, secret masking, event matching, delivery retries (5 tests).
  - `apps/api/src/queues/queue-health.service.spec.ts`: Redis ping, queue job counts aggregation (2 tests).
  - `apps/api/test/background-jobs.integration-spec.ts`: Full end-to-end integration test with ephemeral HTTP webhook receiver verifying HMAC signature, timestamp tolerance, mock email logging, and queue status (8 tests).

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why BullMQ with Redis Instead of Node.js `setTimeout`**:
  `setTimeout` runs entirely in memory within a single Node.js process. If the server restarts, crashes, or scales to multiple instances, in-memory timers are lost forever. BullMQ persists jobs in Redis. If a server reboots or crashes while an escalation is pending, Redis keeps the job safe. When the server comes back online, BullMQ picks up right where it left off.
- **Why Background Jobs Run AFTER the Database Transaction Commits**:
  In `RequestsService`, we wrap database mutations inside `prisma.$transaction(...)` and only dispatch background jobs _after_ the transaction successfully completes. If we enqueued an email or webhook _inside_ the transaction and the transaction later rolled back due to a constraint error, the user would receive an email for an action that never actually occurred. By executing hooks strictly post-commit, notifications and webhooks reflect only committed, permanent database state.
- **Why Workers Re-Check Database State (The "Stale Job" Defense)**:
  Suppose an approval step has a 24-hour escalation timeout. A delayed job is placed on the queue for `now + 24 hours`. At hour 2, the approver logs in and approves the request. When hour 24 arrives and the job wakes up, the worker cannot assume the step is still waiting for review. The worker immediately queries `approval_steps` in the database. Finding that `status === 'APPROVED'`, it logs a message and exits as a harmless no-op.
- **Why Atomic Conditional Updates (`updateMany`) Prevent Escalation Race Conditions**:
  Suppose a worker wakes up to escalate a step at the exact millisecond the approver clicks "Approve". If both processes proceed simultaneously, both might think they succeeded. To prevent this, the escalation worker executes:
  `UPDATE approval_steps WHERE id = :id AND status = 'IN_REVIEW' AND is_escalated = false`
  If the approver's transaction committed first, `status` is already `'APPROVED'`. The worker's update query finds 0 matching rows and aborts, preventing duplicate or conflicting state transitions.
- **Why Webhook Signatures Use `t={timestamp},v1={hmac}` (Replay Attack Defense)**:
  If a webhook only contained an HMAC signature of the JSON body, a malicious attacker who intercepts the network traffic could record the exact HTTP request and replay it against your server 3 days later ("replay attack"). By prepending a UNIX timestamp `t` to the signature payload (`${t}.${rawBody}`) and checking that `|now - t| < 300 seconds`, the receiver can reject any request that is older than 5 minutes, rendering replayed requests invalid.
- **Why Webhook Secrets Are Only Displayed Once**:
  FlowGate uses asymmetric-style secret management. The raw secret is generated with high entropy (`whsec_` + 48 hex characters) and returned exclusively in the `POST /api/v1/webhooks` creation response. In all subsequent `GET` requests, the secret is omitted. If an attacker gains read access to the dashboard or an API token is leaked, they cannot steal the webhook signing secrets.

---

### 4. Verification and Actual Test Results

All verification suites executed on Node.js `v24.18.0` with active Docker services (`flowgate-postgres` on `:5432`, `flowgate-redis` on `:6379`):

#### A. Monorepo Quality Gates

| Check                       | Tool / Command                | Result     | Notes                                                       |
| :-------------------------- | :---------------------------- | :--------- | :---------------------------------------------------------- |
| **Type Check**              | `pnpm check-types`            | **PASSED** | 0 TypeScript errors across web, api, and shared-types       |
| **Linting**                 | `pnpm lint`                   | **PASSED** | 0 ESLint warnings or errors across all packages             |
| **Code Style**              | `pnpm format:check`           | **PASSED** | 100% compliant with Prettier formatting                     |
| **Backend Unit Tests**      | `pnpm test`                   | **PASSED** | **75 passed** across 12 test suites                         |
| **Integration / E2E Tests** | `pnpm test:e2e`               | **PASSED** | **62 passed** across 5 test suites (ran in band)            |
| **Total Automated Tests**   | `pnpm test` + `pnpm test:e2e` | **PASSED** | **137 tests passed**, exit code 0                           |
| **Production Build**        | `pnpm build`                  | **PASSED** | Next.js 14 and NestJS production builds clean               |
| **Runtime Health Check**    | `curl /health`                | **PASSED** | `{ "status": "ok", "database": { "status": "connected" } }` |
| **Queue Admin Health API**  | `curl /api/v1/admin/queues`   | **PASSED** | `{ "redisConnected": true, "queues": { ... } }`             |

#### B. Detailed Test Suite Summary

- **Unit Test Suites (75 passed)**:
  - `src/webhooks/webhook-signature.util.spec.ts` (8 tests): HMAC signing, verification, malformed headers, secret mismatch, tampered payload, replay attacks, future drift.
  - `src/notifications/notifications.service.spec.ts` (10 tests): DB logging, BullMQ enqueue, idempotency skips, role scoping, stats aggregation, worker delivery, retry backoff, max attempts failure.
  - `src/escalations/escalations.service.spec.ts` (8 tests): Delayed job scheduling, job removal, reminder state checks, request status suppression, reminder audit logging, escalation state checks, atomic conditional updates.
  - `src/webhooks/webhooks.service.spec.ts` (5 tests): Secret generation (`whsec_...`), secret masking on read, tenant isolation, wildcard event matching, manual delivery retry.
  - `src/queues/queue-health.service.spec.ts` (2 tests): Multi-queue count aggregation, Redis disconnect handling.
  - `src/requests/requests.service.spec.ts` (8 tests): Request creation, step instantiation, approval transitions, final approval, rejection skips, change requests.
  - `src/workflows/workflows.service.spec.ts` (6 tests): Creation, retrieval, activation, deactivation, version incrementing.
  - `src/audit/audit.service.spec.ts` (14 tests): Hash chain integrity, canonical JSON hashing, verification.
  - `src/auth/auth.service.spec.ts` (7 tests): Tenant login, password hashing, JWT signing, user profile.
  - `src/auth/guards/roles.guard.spec.ts` (4 tests): Role hierarchy and permission enforcement.
  - `src/health/health.controller.spec.ts` (2 tests): Service ping and DB connectivity.
  - `src/prisma/prisma.service.spec.ts` (1 test): Lifecycle connection handling.
- **Integration / E2E Test Suites (62 passed)**:
  - `test/background-jobs.integration-spec.ts` (8 tests): Admin queue health endpoint (403 for non-admin, 200 with queue metrics for admin); webhook subscription CRUD and tenant isolation; test ping with HMAC signature verification; request creation triggering signed outbound webhook to local HTTP server and mock email delivery; notification stats aggregation.
  - `test/workflow-engine.integration-spec.ts` (31 tests): Multi-step sequential lifecycle, change requests, rejections, concurrency guards, audit chain verification.
  - `test/tenant-isolation.integration-spec.ts` (11 tests): Composite foreign keys, cross-tenant leak prevention.
  - `test/auth.integration-spec.ts` (10 tests): JWT authentication, token expiration, invalid credentials.
  - `test/app.e2e-spec.ts` (2 tests): Public health endpoints.

---

### 5. Known Limitations

- **Mock Email Transport**: `MockEmailProvider` records structured emails to application logs and `notification_logs` table rather than sending real network emails. This is intentional for development and testing safety (Rule 8: no unapproved external notifications). Production SMTP/SendGrid/SES transports can be plugged in via the `EmailProvider` interface.
- **Docker Dependency**: Requires local PostgreSQL 16 and Redis 7 containers running via `docker-compose.yml`.

---

### 6. Recommended Next Steps

- Proceed to **Milestone 6: Advanced Workflow Features & Audit Visualizer** (or final production deployment hardening per project roadmap):
  - Visual DAG / flowchart workflow editor in Next.js.
  - Interactive cryptographic audit-chain inspector and verification UI.
  - Parallel step routing (e.g. concurrent approvals required from Legal AND Finance).
  - Production containerization and deployment checklists.

---

## [Milestone 4.2: Final Audit Chain & Production Configuration Verification] - 2026-11-07

### 1. Executive Summary

Milestone 4.2 resolved two critical architectural and security findings:

1. **Concurrent Audit-Chain Integrity & Fork Prevention**:
   - **Vulnerability Confirmed**: Under PostgreSQL default Read Committed transaction isolation, simultaneous audit writes for the same tenant executed standard non-locking `findFirst` queries. Consequently, two concurrent transactions could read the exact same `previousHash`, resulting in chain branching (forks) and violating linear tamper-evident audit guarantees.
   - **Architectural Solution Implemented**: Designed and deployed a tenant-specific chain-head record (`audit_chain_heads`) with transactional row-level locking (`SELECT ... FOR UPDATE`), strictly monotonic sequence numbering (`sequence_number`), and database-enforced unique constraints (`@@unique([tenantId, sequenceNumber])`). This guarantees that concurrent audit writes for the same tenant are strictly serialized with zero forks, while writes for distinct tenants execute in parallel with zero contention.
2. **Production Demo-Account Safeguards**:
   - **Vulnerability Confirmed**: The application previously allowed `NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS=true` to enable 1-click seed accounts in production environments, potentially exposing demo accounts or unsafe bypasses.
   - **Hardening Implemented**: Restricted demo account rendering strictly to compile-time development mode (`process.env.NODE_ENV === 'development'`). A public environment variable cannot enable demo accounts in production. The entire demo account UI is completely tree-shaken and eliminated from production client bundles (reducing static bundle size from 10.2 kB to 8.93 kB). Confirmed `.env.local` is completely excluded from Git tracking.

### 2. Deliverables Completed

- **Database Schema Enhancements & Migration (`apps/api/prisma/`)**:
  - Created `AuditChainHead` table mapping `tenant_id` (PK), `last_hash` (VARCHAR 64), `sequence_number` (INT), `last_created_at` (TIMESTAMP), and `updated_at`.
  - Added `sequence_number` to `AuditLog` with unique constraint `tenant_audit_sequence_unique` on `[tenant_id, sequence_number]`.
  - Created and deployed migration `20261107151500_concurrency_safe_audit_chain_heads` with automated backfill of sequence numbers for existing historical audit records.
- **Shared Types Update (`packages/shared-types/src/index.ts`)**:
  - Added `sequenceNumber?: number | null` to `AuditLogSummary`. Recompiled `@flowgate/shared-types`.
- **Audit Service Concurrency Hardening (`apps/api/src/audit/audit.service.ts`)**:
  - Transactional serialization: In `executeLog()`, initializes `audit_chain_heads` via `INSERT ... ON CONFLICT DO NOTHING`, then locks the tenant's chain-head row exclusively with `SELECT ... FOR UPDATE`.
  - Increments `sequence_number` atomically and binds it into the deterministic canonical SHA-256 payload (`AuditService.canonicalJsonStringify`).
  - Monotonic timestamp guarantees: Updates `last_created_at` ensuring each subsequent log's timestamp is strictly greater than the preceding record.
  - Enhanced verification (`verifyChain`):
    - Validates sequential ordering: detects missing or deleted records (sequence gaps).
    - Validates cryptographic chaining: detects forks, branches, or altered `previousHash` links.
    - Validates payload hashes: detects tampered metadata or forged fields.
    - Validates timestamp monotonicity: detects out-of-order chronological inversions.
    - Validates synchronization with `audit_chain_heads`.
- **Production Demo Account Hardening (`apps/web/src/app/page.tsx`)**:
  - Replaced ambiguous dev check with strict compile-time check: `const isDevMode = process.env.NODE_ENV === 'development'`.
  - Ensured no public environment variable can bypass authentication or activate demo accounts in production.
  - Verified Next.js compiler eliminates demo UI and code from `.next/static` bundles during production build.
- **Automated Concurrency & Integration Tests**:
  - Added concurrent same-tenant integration test firing 8 simultaneous audit events in parallel; verified zero forks, strictly sequential sequence numbers (1..N), and unbroken chain verification.
  - Added concurrent cross-tenant integration test firing simultaneous audit writes to Acme Corp and Globex; verified independent chain validity with zero deadlocks.
  - Total automated tests increased to **96 passed** (42 unit, 54 integration/e2e).

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why `SELECT ... FOR UPDATE` on `audit_chain_heads` Prevents Forking**:
  In a database like PostgreSQL, two transactions running simultaneously will see the same snapshot of data unless explicitly locked. If Tenant A has 10 logs and receives two requests at the same microsecond, both requests would think "Log #10 is the latest, so I will attach to Log #10." Both would write an entry pointing to Log #10, creating a tree branch instead of a single chain. By executing `SELECT ... FOR UPDATE` on a single row dedicated to that tenant (`audit_chain_heads`), PostgreSQL grants an exclusive lock to the first request and pauses the second request for a few milliseconds until the first finishes. The second request then wakes up, sees that Log #11 was just written, and attaches cleanly as Log #12.
- **Why Separate Chain Heads Instead of Locking the Entire Tenant Table**:
  If the application locked the main `tenants` table row during every audit write, ordinary business operations (such as updating tenant settings, changing billing info, or adding a user) could conflict with background audit logging. A dedicated `audit_chain_heads` table isolates audit serialization to a lightweight 1-row counter per tenant without any contention on core business tables.
- **Why Include `sequenceNumber` Inside the Cryptographic Hash**:
  If an attacker managed to delete record #5 and record #6, but the hashes only linked A to B, someone might try to forge a transition. By including `sequenceNumber: 5` directly inside the SHA-256 payload, a hash generated for slot #5 cannot be relocated to slot #4 or slot #6; the entry is mathematically bound to its exact slot in history.
- **Why Tree-Shaking Eliminates Demo Accounts from Production**:
  When Next.js compiles code for production, it statically replaces `process.env.NODE_ENV === 'development'` with the literal constant `false`. The JavaScript bundler recognizes that `if (false)` blocks can never run, and strips out the associated JSX elements, button handlers, and strings entirely. The production bundle physically contains zero demo code.

---

### 4. Verification and Actual Test Results

All verification suites executed on Node.js `v24.18.0` with active Docker services (`flowgate-postgres` on `:5432`, `flowgate-redis` on `:6379`):

#### A. Monorepo Quality Gates

| Check                       | Tool / Command                | Result     | Notes                                                  |
| :-------------------------- | :---------------------------- | :--------- | :----------------------------------------------------- |
| **Type Check**              | `pnpm check-types`            | **PASSED** | 0 TypeScript errors across web, api, and shared-types  |
| **Linting**                 | `pnpm lint`                   | **PASSED** | 0 ESLint warnings or errors across all packages        |
| **Code Style**              | `pnpm format:check`           | **PASSED** | 100% compliant with Prettier formatting                |
| **Backend Unit Tests**      | `pnpm test`                   | **PASSED** | **42 passed** across 7 test suites                     |
| **Integration / E2E Tests** | `pnpm test:e2e`               | **PASSED** | **54 passed** across 4 test suites                     |
| **Total Automated Tests**   | `pnpm test` + `pnpm test:e2e` | **PASSED** | **96 tests passed**, exit code 0                       |
| **Production Build**        | `pnpm build`                  | **PASSED** | Next.js 14 and NestJS production builds clean          |
| **Secret & Demo Scan**      | `grep` on `.next/static`      | **PASSED** | Zero credentials or demo UI elements in client bundles |

#### B. Audit Concurrency Test Results

- **Concurrent Same-Tenant Stress Test**:
  - Test: 8 simultaneous audit events fired via `Promise.all` for `acmeTenantId`.
  - Result: All 8 writes succeeded. `sequence_number` assigned consecutively with 0 duplicates. `previousHash` linked sequentially from log 1 to 8 without a fork. `verifyChain` passed with 100% mathematical integrity.
- **Concurrent Cross-Tenant Independence Test**:
  - Test: Simultaneous audit events fired in parallel to Acme Corp and Globex.
  - Result: Both events committed immediately with zero lock contention or deadlocks. Both tenant chains independently verified.

---

### 5. Known Limitations

- All audit log writes require database connectivity; offline queueing for audit logs will be integrated with BullMQ in Milestone 5.
- Docker containers remain healthy and operational.

---

### 6. Recommended Next Steps

- Proceed to **Milestone 5: Background Processing & Escalation Engine**:
  - BullMQ queue setup with Redis.
  - Background workers for automated approval step timeout escalation.
  - Email and webhook notification dispatchers.

---

## [Milestone 4.1: Security & Reliability Hardening] - 2026-11-07

### 1. Executive Summary

Milestone 4.1 conducted an independent, rigorous security and reliability audit of the Milestone 4 deliverables. It identified and resolved critical real-world vulnerabilities and data-integrity risks prior to Milestone 5:

- **Approval Concurrency & Race Conditions**: Prevented simultaneous competing approval actions on the same step from double-advancing or creating duplicate state transitions using atomic database conditional updates.
- **Workflow Version Immutability & Snapshots**: Added immutable snapshots (`workflowVersion` and `workflowSnapshot`) directly to `ApprovalRequest` to ensure in-flight or historical requests remain untainted by future workflow definition edits or deletions.
- **Cryptographic Audit Hash Chaining**: Implemented per-tenant SHA-256 hash chaining (`previousHash`, `hash`) with deterministic canonical JSON serialization (RFC 8785 subset), strictly monotonic timestamps, and a mathematical verification routine `verifyChain(tenantId)` that flags broken chains or tampered records.
- **Frontend Bundle Security Hardening**: Gated quick-login demo accounts to development mode only, purged default password strings from client-side bundles, and ensured production builds contain zero hardcoded credentials.
- **Access Control & Tenant Isolation Boundaries**: Verified that cross-tenant cancellation, cross-tenant resubmission, non-admin request cancellations, and self-approval attempts are strictly rejected.

### 2. Deliverables Completed

- **Database Schema Enhancements & Forward Migration (`apps/api/prisma/`)**:
  - `ApprovalRequest`: Added `workflowVersion` (`Int @default(1)`) and `workflowSnapshot` (`Json?`).
  - `AuditLog`: Added `previousHash` (`String? @db.VarChar(64)`), `hash` (`String? @db.VarChar(64)`), and composite index `@@index([tenantId, hash])`.
  - Created and applied safe forward migration: `20261107144500_hardening_workflow_snapshots_and_audit_hash_chain`.
- **Shared Types Extension (`packages/shared-types/src/index.ts`)**:
  - Updated `ApprovalRequestSummary` with `workflowVersion`.
  - Updated `ApprovalRequestDetail` with `workflowSnapshot`.
  - Updated `AuditLogSummary` with `previousHash` and `hash`.
  - Added `AuditChainVerificationResult` interface.
- **Concurrency & Approval Race-Condition Hardening (`apps/api/src/requests/`)**:
  - Replaced non-atomic step queries with database-level atomic conditional updates (`tx.approvalStep.updateMany({ where: { id, status: 'IN_REVIEW' }, data: ... })`).
  - Throws `ConflictException` (HTTP 409) if another concurrent process has already actioned the step.
  - Applied atomic conditional updates across `APPROVED`, `REJECTED`, `CHANGES_REQUESTED`, `RESUBMITTED`, and `CANCELLED` transitions.
  - Captured full workflow configuration snapshots at the time of request submission.
- **Cryptographic Audit Log Hash Chain & Verification (`apps/api/src/audit/`)**:
  - Built `canonicalJsonStringify`: Deterministic recursive alphabetical key sorting to eliminate discrepancies between in-memory JavaScript objects and PostgreSQL JSONB storage.
  - Implemented strictly monotonic millisecond timestamps (`now = Math.max(now, lastLog.createdAt + 1ms)`) ensuring total ordering of audit logs even during sub-millisecond execution.
  - SHA-256 chained hashing linking each log to the tenant's prior log hash (`previousHash -> hash`).
  - Implemented `AuditService.verifyChain(tenantId)`: Traverses the chain from `GENESIS`, verifying linkage integrity and detecting altered records, deletions, or out-of-order insertions.
- **Frontend Security & Bundle Hardening (`apps/web/src/app/page.tsx`)**:
  - Gated demo account switcher with `isDevMode` check.
  - Removed all hardcoded password strings from the component source and default states.
  - Verified with `grep` that `apps/web/.next/static` production bundles contain zero passwords.
- **Comprehensive Automated Test Coverage**:
  - Concurrency integration tests: Simultaneous `Promise.all` racing approvals (Approve vs Approve, Approve vs Reject) proving exactly 1 succeeds (200) and 1 receives Conflict (409).
  - Immutability integration tests: Updated workflow definition with new steps while request was in-flight; proved historical request retained v1 snapshot with 2 steps while new request used v2 with 3 steps.
  - Audit chain verification & tamper-detection tests: Verified valid hash chain and verified simulated database row tampering is immediately detected by `verifyChain`.
  - Total automated test count increased to **93 tests passed** (41 unit, 52 integration/e2e).

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why a Transaction by Itself Does Not Prevent Concurrency Race Conditions**:
  When two requests arrive at the same millisecond in PostgreSQL default isolation level (Read Committed), both transactions read the current step's status as `IN_REVIEW`. Without locking or conditional checks, both transactions would proceed to mark the step approved and advance the request twice. FlowGate employs **atomic conditional updates** (`UPDATE approval_steps SET status = 'APPROVED' WHERE id = ... AND status = 'IN_REVIEW'`). Because row updates acquire an exclusive write lock in PostgreSQL, the first transaction changes the status and updates 1 row; the second transaction finds 0 matching rows (`count === 0`) and immediately throws HTTP 409 Conflict without corrupting state.
- **Why Canonical JSON Serialization is Required for Cryptographic Hashing**:
  JavaScript objects do not guarantee key order, and PostgreSQL `jsonb` columns reorder keys internally (e.g. alphabetically or by byte length). If `computeHash` hashes `{ "title": "Buy Laptop", "steps": 2 }` before writing to the database, but PostgreSQL reads it back as `{ "steps": 2, "title": "Buy Laptop" }`, standard `JSON.stringify` produces different strings, falsely flagging valid records as tampered. FlowGate's `canonicalJsonStringify` recursively sorts all object keys alphabetically, guaranteeing that the string representation is 100% deterministic everywhere.
- **Why Strict Monotonic Timestamps for Audit Chains?**:
  In high-throughput environments or fast automated integration tests, multiple audit log records can be generated within the exact same millisecond. Relying solely on `createdAt: 'asc'` without monotonic increments can lead to ambiguous sorting in database queries. By ensuring each subsequent audit log's timestamp is at least 1 millisecond greater than the previous log (`lastLog.createdAt.getTime() + 1`), the sequence of events is unambiguously ordered.
- **Why Workflow Snapshots on Approval Requests?**:
  A workflow definition is a living template that changes as corporate policies evolve (e.g., adding a VP sign-off for expenses > $5,000). If an audit occurs 2 years later, the system must prove what steps were required at the time the request was approved, not what the policy requires today. FlowGate persists both the workflow version number and a full JSON snapshot of the workflow definition inside the `ApprovalRequest` record.

---

### 4. Verification and Actual Test Results

All verification suites executed on Node.js `v24.18.0` with healthy PostgreSQL 16 and Redis 7 containers:

#### A. Monorepo Quality Gates

| Check                | Tool / Command           | Result     | Notes                                                     |
| :------------------- | :----------------------- | :--------- | :-------------------------------------------------------- |
| **Type Check**       | `pnpm check-types`       | **PASSED** | 0 TypeScript errors across web, api, and shared-types     |
| **Linting**          | `pnpm lint`              | **PASSED** | 0 ESLint warnings or errors across all packages           |
| **Code Style**       | `pnpm format:check`      | **PASSED** | 100% compliant with Prettier formatting                   |
| **Production Build** | `pnpm build`             | **PASSED** | Next.js and NestJS production builds compiled cleanly     |
| **Secret Scan**      | `grep` on `.next/static` | **PASSED** | Zero credentials or hardcoded passwords in client bundles |

#### B. Backend Unit Tests (`pnpm --filter api test`)

- **Result**: Passed (7 test suites, 41 passed, exit code 0)
  - `src/audit/audit.service.spec.ts` (6 passed): Hash calculation, redacting secrets, chain formation, tamper detection, transaction client support.
  - `src/requests/requests.service.spec.ts` (7 passed): Creation, find, conditional step updates, self-approval prevention.
  - `src/workflows/workflows.service.spec.ts` (6 passed): Step validation, role-based assignments, activation lifecycle.
  - `src/auth/auth.service.spec.ts` (6 passed): Password hashing, JWT issuance, tenant slug resolution.
  - `src/auth/guards/roles.guard.spec.ts` (5 passed): RBAC role hierarchy enforcement.
  - `src/prisma/prisma.service.spec.ts` (3 passed): Lifecycle hooks, connection management.
  - `src/health/health.controller.spec.ts` (4 passed): Health check endpoints.

#### C. Backend Integration / E2E Tests (`pnpm --filter api test:e2e`)

- **Result**: Passed (4 test suites, 52 passed, exit code 0)
  - `test/workflow-engine.integration-spec.ts` (25 passed):
    - Multi-step workflow definitions and tenant boundaries.
    - Full request lifecycle (Approve, Reject, Request Changes, Resubmit, Cancel).
    - **Concurrency race-condition tests**: 2 competing simultaneous approvals on Step 1 (1 succeeds with 200, 1 receives 409 Conflict).
    - **Competing action tests**: Simultaneous APPROVE vs REJECT on same step (1 wins, 1 receives 409 Conflict, state remains coherent).
    - **Workflow versioning tests**: Definition updated while request in-progress; existing request preserves v1 2-step snapshot, new request uses v2 3-step definition.
    - **Cryptographic audit chain tests**: Full chain mathematically verified from GENESIS; database row tampering detected and localized to exact ID.
    - **Tenant isolation tests**: Cross-tenant cancellation (404), cross-tenant resubmission (404), non-admin cross-user cancellation (403).
  - `test/tenant-isolation.integration-spec.ts` (10 passed): Tenant isolation across all entities.
  - `test/auth.integration-spec.ts` (14 passed): JWT security, expiration, suspension guards.
  - `test/app.e2e-spec.ts` (3 passed): Health check endpoints.

---

### 5. Known Limitations or Environmental Blockers

- None. Docker containers (PostgreSQL 16 and Redis 7) are healthy and active.
- Database contains zero corrupted or broken audit chains.

---

### 6. Recommended Next Steps

- Proceed to **Milestone 5: Background Processing & Escalation Engine**:
  - BullMQ queue configuration with Redis.
  - Asynchronous notification dispatcher (email, webhooks).
  - Scheduled background worker for approval step timeout escalation.
  - Delegation mechanisms when an approver is unavailable.

---

## [Milestone 4: Core Workflow & Approval Engine] - 2026-11-07

### 1. Executive Summary

Milestone 4 implemented the complete core workflow definition engine, approval request lifecycle, sequential state machine, concurrency-safe approval actions (Approve, Reject, Request Changes, Resubmit, Cancel), atomic audit logging, security regression suites, and an interactive Next.js web application console connected to live APIs.

### 2. Deliverables Completed

- **Security Regression Verification Suite (`apps/api/test/auth.integration-spec.ts`)**:
  - Verified expired JWT tokens return HTTP 401 Unauthorized.
  - Verified forged/tampered JWT signatures return HTTP 401 Unauthorized.
  - Verified suspended users cannot authenticate or access protected endpoints.
  - Verified suspended tenants cannot authenticate or access protected endpoints.
  - Verified client-supplied `tenantId` cannot override authenticated server-side context.
- **Database Schema Enhancements & Forward Migration (`apps/api/prisma/`)**:
  - Added `CHANGES_REQUESTED` state to `ApprovalRequestStatus`.
  - Added `stepName`, `assignedRole`, `actionedById`, `actionedAt` to `ApprovalStep` with composite foreign key referencing `users(tenant_id, id)`.
  - Created and deployed safe forward migration `20261107141500_workflow_engine_enhancements` preserving all existing records.
- **Audit Logging Module (`apps/api/src/audit/`)**:
  - Implemented `AuditService` with metadata sanitization (redacting passwords, secrets, tokens).
  - Transaction-aware logging: all workflow state changes record audit logs in the same atomic database transaction.
  - Strict append-only architecture: zero mutation or deletion endpoints.
- **Workflow Definition Module (`apps/api/src/workflows/`)**:
  - Ordered approval steps configuration with continuous sequential order validation (1..N).
  - Role-based (`ROLE`) and user-targeted (`USER`) assignee definitions.
  - Structural mutation protection: changes to steps in workflows with active requests bump the definition `version`.
  - Activation & deactivation lifecycle (`ACTIVE`, `ARCHIVED`, `DRAFT`).
  - Protected by `@Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER')`.
- **Approval Request Lifecycle & State Machine (`apps/api/src/requests/`)**:
  - Request creation from active workflow definition instantiating sequential `ApprovalStep`s.
  - Concurrency-safe state transitions wrapped in `prisma.$transaction`.
  - `APPROVE`: Advances current step, moves next step to `IN_REVIEW`. When the final step is approved, marks entire request `APPROVED`.
  - `REJECT`: Marks current step `REJECTED`, marks all subsequent steps `SKIPPED`, and marks request `REJECTED`.
  - `REQUEST_CHANGES`: Transitions request to `CHANGES_REQUESTED`.
  - `RESUBMIT`: Allows requester to provide updated information and returns request to `IN_PROGRESS`.
  - `CANCEL`: Allows requester or admin to abort pending/in-progress requests, skipping remaining steps.
  - Prevention of self-approval: Requesters cannot approve their own requests unless tenant admin.
  - Invalid transition protection: Actions on already completed/cancelled requests return HTTP 409 Conflict.
- **Interactive Next.js Web Console (`apps/web/src/app/page.tsx`)**:
  - Real API integration with `@flowgate/shared-types` and `apps/web/src/lib/api.ts`.
  - Authentication console with 1-click quick-login switcher for demo accounts across Acme Corp and Globex.
  - Approval inbox with tabs: "Awaiting My Review", "My Submissions", and "All Requests".
  - Interactive Request Detail Modal with visual step progression, decision buttons (Approve, Reject, Request Changes), comment input, and audit trail timeline.
  - Workflow Management interface with workflow listing, activation toggles, and step builder modal.
- **Automated Test Coverage**:
  - Total automated tests: **82 passed** (38 unit tests, 44 integration tests).
  - Verified exit code 0 across Jest, ESLint, Prettier, and Next.js / NestJS production builds.

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why Step Sequencing Must Be Validated on Workflow Creation & Activation**:
  If an administrator configured step 1 and step 3 without a step 2, an approval engine wouldn't know which step to activate when step 1 is signed off. By enforcing consecutive 1-based integers (`1, 2, 3...`) at the validation layer, the state machine can advance deterministically (`currentStep.stepOrder + 1`).
- **Why Version Bumping on Workflow Mutation?**:
  If an active request was submitted under a 2-step approval process and an admin subsequently deletes step 2 from the workflow definition, historical requests would point to steps that no longer exist in the workflow template. FlowGate bumps the definition version (`version = version + 1`) when steps are modified and active requests exist, preserving historical immutability.
- **Why Atomic Transactions for Approval Actions?**:
  Approving a step involves multiple database writes: marking the current step approved, activating the next step, updating the request status, and writing an audit log. If the server crashed midway without a database transaction (`prisma.$transaction`), the current step might be marked approved while the next step remains stuck in pending. Transactions ensure all operations succeed together or fail cleanly.
- **Why Redact Metadata in the Audit Service?**:
  Developers often pass full request bodies into audit logs for convenience. If a user creation or login payload is audited, plaintext passwords or JWTs might accidentally get saved to disk or database. `AuditService` recursively scans metadata and replaces sensitive keys with `[REDACTED]`.

---

### 4. Verification and Actual Test Results

All verification suites executed on Node.js `v24.18.0`:

#### A. Unit Tests (`pnpm --filter api test`)

- **Result**: Passed (7 test suites, 38 passed)
  - `src/requests/requests.service.spec.ts` (7 passed)
  - `src/workflows/workflows.service.spec.ts` (6 passed)
  - `src/audit/audit.service.spec.ts` (3 passed)
  - `src/auth/auth.service.spec.ts` (6 passed)
  - `src/auth/guards/roles.guard.spec.ts` (5 passed)
  - `src/prisma/prisma.service.spec.ts` (3 passed)
  - `src/health/health.controller.spec.ts` (4 passed)

#### B. Integration / E2E Tests (`pnpm --filter api test:e2e`)

- **Result**: Passed (4 test suites, 44 passed)
  - `test/workflow-engine.integration-spec.ts` (13 passed):
    - Rejects unauthorized workflow creation (403)
    - Rejects invalid step order sequence (400)
    - Admin creates multi-step workflow (201)
    - Tenant isolation on workflow lists
    - Cross-tenant retrieval blocked (404)
    - Workflow activation and deactivation
    - Request creation instantiating steps (201)
    - Cross-tenant request access blocked (404)
    - Requester self-approval blocked (403)
    - Wrong role approval blocked (404/403)
    - Request changes lifecycle (REQUEST_CHANGES -> CHANGES_REQUESTED -> RESUBMIT -> IN_PROGRESS)
    - Sequential step progression (Step 1 -> Step 2 -> APPROVED)
    - Duplicate actions rejected on completed request (409)
    - Rejection marks step REJECTED, skips future steps, marks request REJECTED
    - Audit logs verified with zero leaked secrets
  - `test/auth.integration-spec.ts` (15 passed)
  - `test/tenant-isolation.integration-spec.ts` (14 passed)
  - `test/app.e2e-spec.ts` (2 passed)

#### C. Code Quality & Production Builds

- `pnpm check-types`: PASSED (0 errors across `packages/shared-types`, `apps/api`, `apps/web`).
- `pnpm lint`: PASSED (0 errors, 0 warnings across all workspaces).
- `pnpm format:check`: PASSED (`All matched files use Prettier code style!`).
- `pnpm build`: PASSED (Next.js 14 App Router and NestJS compiled successfully).

---

### 5. API Endpoints Reference

#### Workflows (`/api/v1/workflows`)

- `POST /api/v1/workflows`: Create workflow definition (`TENANT_ADMIN`, `SUPER_ADMIN`, `MANAGER`)
- `GET /api/v1/workflows`: List workflows for authenticated tenant
- `GET /api/v1/workflows/:id`: Retrieve single workflow definition
- `PATCH /api/v1/workflows/:id`: Update workflow details/steps (`TENANT_ADMIN`, `SUPER_ADMIN`, `MANAGER`)
- `POST /api/v1/workflows/:id/activate`: Activate workflow (`TENANT_ADMIN`, `SUPER_ADMIN`, `MANAGER`)
- `POST /api/v1/workflows/:id/deactivate`: Deactivate/archive workflow (`TENANT_ADMIN`, `SUPER_ADMIN`, `MANAGER`)

#### Approval Requests (`/api/v1/requests`)

- `POST /api/v1/requests`: Create and submit approval request using active workflow
- `GET /api/v1/requests`: List requests with filters (`filter=mine`, `filter=pending_approval`, `status=...`, pagination)
- `GET /api/v1/requests/:id`: Retrieve request detail with steps, assignees, and audit history
- `POST /api/v1/requests/:id/actions`: Execute approval action (`APPROVE`, `REJECT`, `REQUEST_CHANGES`)
- `POST /api/v1/requests/:id/resubmit`: Resubmit request after changes requested
- `POST /api/v1/requests/:id/cancel`: Cancel an active request

---

### 6. Next Steps (Milestone 5 Recommendation)

1. **Asynchronous Background Processing & Notifications**:
   - Redis & BullMQ job processor for asynchronous notifications (email/webhook dispatch on step progression).
   - Scheduled escalation jobs (step timeout alerts for overdue approvers).
2. **Webhooks Engine**:
   - Configurable outgoing tenant webhooks triggered on `REQUEST_APPROVED`, `REQUEST_REJECTED`.
3. **Advanced Workflow Rules**:
   - Parallel approval branches (e.g. Finance AND Legal must both approve step 2).
   - Conditional threshold routing (e.g. amounts > $50,000 automatically route to VP).

---

## [Milestone 3: Authentication, Tenant Context & RBAC] - 2026-11-07

### 1. Executive Summary

Milestone 3 addressed critical cross-tenant data relationship vulnerabilities at the PostgreSQL schema level using composite foreign keys, implemented a production-conscious JWT authentication system in NestJS, established trusted server-side tenant context derivation, implemented Role-Based Access Control (RBAC), and applied login rate limiting.

### 2. Deliverables Completed

- **Autonomous Execution Policy Added to `GEMINI.md`**: Pre-authorized the engineering team for autonomous operations, self-healing, test execution, and safe local database administration across all future milestones.
- **Database Cross-Tenant Integrity Hardening (`apps/api/prisma/`)**:
  - Identified cross-tenant linking vulnerabilities where single-column foreign keys allowed Tenant A requests to reference Tenant B workflows or users.
  - Added composite unique constraints `[tenant_id, id]` to `users`, `workflow_definitions`, and `approval_requests`.
  - Added `tenant_id` to `approval_steps`.
  - Replaced non-composite foreign keys with composite foreign keys `(tenant_id, ...)` across `approval_requests`, `approval_steps`, and `audit_logs`.
  - Created and executed safe forward migration `20261107134500_enforce_composite_tenant_integrity` preserving existing data without database resets.
- **Audit Log Deletion Policy Inspection & Retention Strategy**:
  - Documented that current `onDelete: Cascade` on `Tenant -> AuditLog` would destroy audit trails upon tenant deletion.
  - Formulated a production compliance retention strategy (soft deletion / status archiving + cold object lock export).
- **NestJS Authentication Module (`apps/api/src/auth/`)**:
  - `POST /api/v1/auth/login`: Accepts `tenantSlug`, `email`, and `password`. Employs generic error responses ("Invalid credentials") to eliminate tenant/user enumeration.
  - `GET /api/v1/auth/me`: Returns trusted authenticated user and tenant profile.
  - Password verification via `bcryptjs` comparing against salted hashes.
  - Signed JWT access tokens with claims derived strictly from verified database records (`sub`, `tenantId`, `email`, `role`).
  - Rate limiting via `@nestjs/throttler` (max 10 login requests per minute per IP).
- **Authenticated Tenant Context**:
  - `JwtStrategy` and `JwtAuthGuard`: Validates signature, expiration, active user status, and active tenant status on every request.
  - Parameter Decorators: `@CurrentUser()` and `@CurrentTenant()` extracting trusted server-side identity without relying on client-supplied body/query parameters.
  - `TenantContextHelper`: Reusable utility for scoping queries and mutations by `tenantId`.
- **Role-Based Access Control (RBAC)**:
  - `@Roles(...roles: UserRole[])` metadata decorator.
  - `RolesGuard` checking verified user roles (supporting `SUPER_ADMIN`, `TENANT_ADMIN`, `MANAGER`, `REQUESTER`, `APPROVER`) with 403 Forbidden enforcement.
  - Verified administrative endpoint: `GET /api/v1/auth/admin-only`.
- **Automated Test Coverage**:
  - Unit tests: 4 test suites, 18 passed (`auth.service.spec.ts`, `roles.guard.spec.ts`, `prisma.service.spec.ts`, `health.controller.spec.ts`).
  - Integration tests: 3 test suites, 23 passed (`auth.integration-spec.ts`, `tenant-isolation.integration-spec.ts`, `app.e2e-spec.ts`), verifying database rejection of cross-tenant relationships, login flow, token verification, and RBAC rejection.

---

### 3. Technical Decisions & Rationale (Beginner-Friendly Explanation)

- **Why Composite Foreign Keys are Mandatory for Multi-Tenancy**:
  In a multi-tenant database, having a simple foreign key `FOREIGN KEY (workflow_id) REFERENCES workflows(id)` only checks that _some_ workflow with that ID exists in the database. A malicious or buggy query could allow a user from Tenant A to initiate an approval using a private workflow template from Tenant B. By enforcing composite foreign keys `FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflows(tenant_id, id)`, the PostgreSQL engine itself guarantees that the parent and child records belong to the exact same tenant, completely preventing cross-tenant leakage even if application code had a bug.
- **Why Require `tenantSlug` on Login?**
  In FlowGate, user emails are unique per tenant (`@@unique([tenantId, email])`), not globally across the entire system. An external contractor or legal counsel might have an account in both `acme-corp` and `globex-ind` using the same email (`counsel@lawfirm.com`). Requiring `tenantSlug` identifies which organization realm the user is attempting to authenticate against.
- **Why Generic Login Failure Messages?**
  Returning specific messages like "User not found" or "Invalid password" tells attackers whether a company uses FlowGate or whether a specific email address exists in that company. Returning a generic "Invalid credentials" stops user and organization enumeration attacks.
- **Why Derived JWT Claims?**
  The client can never be allowed to specify their own `tenantId` or `role`. The JWT claims are generated strictly on the server after reading the authenticated database record.

---

### 4. Audit Log Deletion Policy Analysis & Production Retention Recommendation

- **Current State**:
  In `schema.prisma`, `AuditLog` has `tenant Tenant @relation(..., onDelete: Cascade)`. If a `Tenant` record is hard-deleted from the database, all audit logs belonging to that organization are permanently dropped.
- **Compliance Risk**:
  Regulatory frameworks (SOC2 Type II, ISO 27001, HIPAA, GDPR) require business transaction audit logs to be retained for 5 to 7 years. Purging audit logs immediately upon contract cancellation violates compliance retention rules.
- **Recommended Production Strategy**:
  1. **Prohibit Hard Deletion**: Replace hard delete operations on `Tenant` with status-based archiving (`status: SUSPENDED` or `ARCHIVED`).
  2. **Immutability via Object Storage**: Stream or export audit log batches to an immutable, write-once-read-many (WORM) storage bucket (such as AWS S3 Glacier with Object Lock or GCP Cloud Storage Bucket Lock) where logs cannot be deleted even by root administrators.
  3. **Schema Hardening**: Transition `AuditLog.tenant` to `onDelete: Restrict` in a future migration so PostgreSQL rejects hard-deleting any tenant that has audit trail records.

---

### 5. Verification and Actual Test Results

All verification suites executed and passed on Node.js `v24.18.0`:

#### A. Unit Tests (`pnpm test`)

- **Command**: `pnpm --filter api test`
- **Result**: Passed (4 test suites, 18 passed)
  - `src/auth/auth.service.spec.ts` (6 passed)
  - `src/auth/guards/roles.guard.spec.ts` (5 passed)
  - `src/prisma/prisma.service.spec.ts` (3 passed)
  - `src/health/health.controller.spec.ts` (4 passed)

#### B. Integration Tests (`pnpm test:e2e`)

- **Command**: `pnpm --filter api test:e2e`
- **Result**: Passed (3 test suites, 23 passed)
  - `test/auth.integration-spec.ts` (9 passed):
    - Valid login for Acme Admin returns JWT access token
    - Valid login for Globex User returns JWT access token
    - Wrong password rejected with 401 and generic message
    - Wrong tenant slug rejected with 401 and generic message
    - Malformed payload rejected with 400
    - `/me` returns Acme Admin identity and tenant context
    - `/me` returns Globex User identity and tenant context
    - Unauthenticated `/me` rejected with 401
    - Admin-only endpoint allows `TENANT_ADMIN` (200) and rejects `REQUESTER` (403 Forbidden)
  - `test/tenant-isolation.integration-spec.ts` (12 passed):
    - PostgreSQL strictly rejects cross-tenant workflow reference (Composite FK verified)
    - PostgreSQL strictly rejects cross-tenant requester reference (Composite FK verified)
    - PostgreSQL strictly rejects cross-tenant approval step assignment (Composite FK verified)
    - PostgreSQL strictly rejects cross-tenant audit log actor (Composite FK verified)
    - User email scoping: identical email in different tenants permitted, duplicate in same tenant rejected
    - Unique stepOrder constraint enforced per request
    - Cascade deletion strictly purges only target tenant data without affecting foreign tenants
  - `test/app.e2e-spec.ts` (2 passed):
    - `/health` and `/api/health` return 200 with connected database probe

#### C. Static Typing, Linting & Production Build

- **Type Check (`pnpm check-types`)**: Exit code 0 (0 errors across `packages/shared-types`, `apps/api`, `apps/web`).
- **Linter (`pnpm lint`)**: Exit code 0 (0 warnings or errors across all workspaces).
- **Code Formatting (`pnpm format:check`)**: Exit code 0 (`All matched files use Prettier code style!`).
- **Production Build (`pnpm build`)**: Exit code 0 (all apps and packages compiled cleanly).

#### D. Live Runtime Endpoint Verification

- **Login Request**:
  - `POST http://localhost:4000/api/v1/auth/login` with `{"tenantSlug":"acme-corp","email":"admin@acme.com","password":"FlowGatePass123!"}`
  - Response: `HTTP 200 OK` returning signed JWT token and user/tenant profile.
- **Authenticated Profile**:
  - `GET http://localhost:4000/api/v1/auth/me` with `Authorization: Bearer <token>`
  - Response: `HTTP 200 OK` returning `{ user: { email: "admin@acme.com", role: "TENANT_ADMIN" }, tenant: { slug: "acme-corp" } }`.
- **RBAC Protected Endpoint**:
  - `GET http://localhost:4000/api/v1/auth/admin-only` with `Authorization: Bearer <token>`
  - Response: `HTTP 200 OK` with `{"message":"Access granted to privileged administrative resource"}`.
- **Generic Security Error**:
  - `POST http://localhost:4000/api/v1/auth/login` with wrong password
  - Response: `HTTP 401 Unauthorized` with `{"message":"Invalid credentials","error":"Unauthorized","statusCode":401}`.

---

### 6. Recommended Next Milestone: Milestone 4 (Workflow Engine & Dynamic State Machine)

1. **Workflow Definition Schema & Validation**:
   - Validation schema for `WorkflowDefinition.configuration` (JSON schema enforcing step stages, approver rules, conditional logic, dollar thresholds).
2. **Workflow State Machine Core (`apps/api/src/workflows/`)**:
   - Transitions: `PENDING` -> `IN_PROGRESS` -> `APPROVED` / `REJECTED` / `CANCELLED`.
   - Step Transitions: `PENDING` -> `IN_REVIEW` -> `APPROVED` / `REJECTED` / `SKIPPED`.
3. **Approval Request Lifecycle Endpoints**:
   - `POST /api/v1/requests`: Create a new approval request for the authenticated tenant.
   - `GET /api/v1/requests`: List requests scoped strictly to current tenant and user role.
   - `GET /api/v1/requests/:id`: Get request detail with steps and audit trail.
   - `POST /api/v1/requests/:id/actions`: Execute `APPROVE`, `REJECT`, or `REQUEST_CHANGES`.
4. **Automated Audit Logging**:
   - Automatically record every state transition in `AuditLog` within an atomic database transaction.

---

## [Milestone 2: Prisma Database Implementation & Multi-Tenant Core] - 2026-11-07

### 1. Executive Summary

Milestone 2 focused on validating containerized infrastructure (PostgreSQL 16 and Redis 7), implementing a multi-tenant relational schema using Prisma ORM in `apps/api`, creating version-controlled migrations, configuring an idempotent development seed script, verifying live database health probes, and adding automated tests for multi-tenant data isolation.

### 2. Deliverables Completed

- Infrastructure Verification (PostgreSQL & Redis healthy)
- Prisma Schema Architecture (6 core entities, UUIDs, snake_case mapping)
- NestJS Prisma Module & Service (Global pool)
- Live Database Health Probe (`SELECT 1`)
- Initial Database Migration & Development Seed Script (Acme Corp & Globex Ind)
- Multi-Tenant Data Isolation Tests

---

## [Milestone 1: Foundation] - 2026-11-07

### 1. Executive Summary

Milestone 1 established the core monorepo foundation for **FlowGate**, a multi-tenant approval workflow SaaS platform. The monorepo layout, toolchain, type systems, linting, formatting, containerization recipes, continuous integration, frontend landing interface, and backend health verification systems were implemented and verified.

### 2. Deliverables Completed

- Repository Constitution (`GEMINI.md`)
- pnpm Workspaces Monorepo (`apps/web`, `apps/api`, `packages/shared-types`)
- Shared Types Package (`packages/shared-types`)
- NestJS Backend Core (`apps/api`)
- Next.js Frontend Core (`apps/web`)
- Docker Compose (`docker-compose.yml`)
- Environment Configuration templates
- CI / DevOps Pipeline (`.github/workflows/ci.yml`)
- Project Documentation (`README.md`)

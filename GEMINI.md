# FlowGate - Project Constitution & Engineering Guide

## 1. Project Description and Objectives

**FlowGate** is a production-grade, multi-tenant approval workflow Software-as-a-Service (SaaS) platform designed for modern businesses. Organizations rely on FlowGate to design, automate, audit, and accelerate multi-step approval workflows across departments—such as finance (purchase orders, invoice signoffs), human resources (leave requests, promotions), legal (contract reviews), and engineering/DevOps (deployment gates, access requests).

### Core Objectives

- **Multi-Tenant Isolation**: Robust logical data and tenant separation ensuring enterprise data confidentiality, tenant-specific settings, and isolated authorization domains.
- **Dynamic Workflow Engine**: Configurable sequential and parallel approval steps, role-based and conditional approval routing, timeout escalation, and delegation.
- **Auditability & Compliance**: Complete, tamper-evident audit trails for all workflow actions, approvals, rejections, comments, and state transitions.
- **Developer & User Experience**: High-performance, responsive web application with real-time notifications, clean UI, clear RESTful APIs, and webhook/event integration capabilities.
- **Reliability & Scalability**: Asynchronous background job processing for notifications, scheduled escalations, and event dispatching backed by Redis and BullMQ.

---

## 2. Technology Stack and Architecture

### Technology Stack

- **Monorepo Architecture**: Managed with `pnpm` workspaces for clean separation of concerns, fast dependency resolution, and efficient code sharing.
- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS, Lucide icons.
- **Backend**: NestJS, TypeScript, class-validator, class-transformer.
- **Database & ORM**: PostgreSQL with Prisma ORM for type-safe schema definitions and migrations.
- **Job Queue & Cache**: Redis with BullMQ for asynchronous task execution (notifications, escalations, webhooks).
- **Containerization**: Docker Compose for reproducible local development services (PostgreSQL, Redis).
- **Continuous Integration**: GitHub Actions CI verifying linting, type-checking, unit tests, and integration builds on pull requests and commits.
- **Testing**: Jest / Supertest for backend unit and API testing; Playwright / React Testing Library for frontend component and end-to-end testing.

### High-Level Architecture

FlowGate follows a modular, decoupled architecture:

1. **Frontend App (`apps/web`)**: Next.js App Router application delivering the landing page, tenant administration dashboards, workflow visualizers, and approval inboxes.
2. **Backend API (`apps/api`)**: NestJS application exposing versioned REST APIs (`/api/v1/...`) and health check endpoints (`/health`). Implements authentication, authorization guards, tenant resolution interceptors, workflow state machines, and business logic.
3. **Shared Packages (`packages/`)**:
   - `packages/shared-types`: Common TypeScript interfaces, DTOs, and workflow enums shared across web and API.
   - `packages/eslint-config`: Shared ESLint configurations across workspaces.
   - `packages/tsconfig`: Base TypeScript configurations.
4. **Data Layer**:
   - PostgreSQL: Stores tenants, users, workflows, approval requests, steps, and audit logs.
   - Redis: Manages distributed locks, BullMQ queue state, session tokens, and cache keys.

---

## 3. Coding Conventions

- **Language & Types**: TypeScript is mandatory across all packages. Avoid `any`; use strict types, unknown with type narrowing, or generics.
- **File & Directory Naming**:
  - `kebab-case` for file names and directories (e.g., `approval-request.service.ts`, `workflow-card.tsx`).
  - PascalCase for React component names and NestJS class names (e.g., `WorkflowCard`, `ApprovalService`).
  - camelCase for function names, methods, and variables.
  - UPPER_SNAKE_CASE for environment variables and static constants.
- **Code Organization in Backend**:
  - NestJS modular pattern: Each domain feature is organized into its own module (`*.module.ts`), controller (`*.controller.ts`), service (`*.service.ts`), and DTOs (`dto/*.dto.ts`).
  - Strict dependency injection: Never instantiate services manually with `new`; let NestJS DI container manage lifetimes.
- **Code Organization in Frontend**:
  - React server components by default; declare `'use client'` only when interactive state, effects, or browser APIs are required.
  - UI components separated into reusable components (`components/ui`) and domain-specific widgets.
- **Code Style & Formatting**:
  - Formatting enforced by Prettier.
  - Linting enforced by ESLint.
  - No dead code, commented-out code blocks, or unused imports.

---

## 4. Security Requirements

- **Tenant Isolation**: Every database query touching tenant-scoped entities must explicitly filter by `tenantId`. Never trust client-supplied tenant identifiers; derive tenant identity from validated authentication tokens or cryptographically signed session contexts.
- **No Hardcoded Secrets**: Zero credentials, tokens, or secret keys committed to Git. All secrets loaded through environment variables validated at application startup using strict schema validation.
- **Defense in Depth**:
  - Input validation: All API request payloads must be strictly validated using class-validator DTOs with `whitelist: true` and `forbidNonWhitelisted: true`.
  - Rate limiting: Public and authentication endpoints must be rate-limited using Redis-backed throttlers.
  - Secure Headers: NestJS applications must utilize Helmet middleware to set standard secure HTTP response headers (CSP, HSTS, X-Content-Type-Options).
  - CORS: Cross-Origin Resource Sharing must be explicitly restricted to approved origins rather than wildcard `*` in production.
- **Authentication & Authorization**: Never create or deploy "fake" or mock authentication in production paths. When auth is implemented, use industry-standard protocols (e.g., JWT with asymmetric signing or secure session cookies) and role-based access control (RBAC).

---

## 5. Database and API Conventions

### Database Guidelines (PostgreSQL & Prisma)

- Table names and column names in PostgreSQL use `snake_case` (mapped via Prisma `@map` and `@@map`).
- Primary keys must use UUIDs or ULIDs for security and distributed generation (avoid auto-incrementing serial IDs for sensitive entities).
- All tables must include `created_at` and `updated_at` timestamps (`DateTime @default(now())`).
- Multi-tenant tables must index `[tenant_id, id]` and common query filter composites.
- Schema migrations must be version-controlled using Prisma Migrate (`prisma migrate dev`). Never make ad-hoc structural changes to production databases.

### REST API Conventions

- Base URL format: `/api/v1/{resource}`.
- Standard HTTP methods:
  - `GET`: Read resource or collection (idempotent, safe).
  - `POST`: Create resource or trigger action.
  - `PUT`: Full update / replacement of resource.
  - `PATCH`: Partial update of resource fields.
  - `DELETE`: Remove resource.
- Standard Status Codes:
  - `200 OK`: Successful retrieval or synchronous update.
  - `201 Created`: Successful creation of resource.
  - `204 No Content`: Successful deletion or action with no response body.
  - `400 Bad Request`: Validation failure or malformed payload.
  - `401 Unauthorized`: Missing or invalid authentication token.
  - `403 Forbidden`: Authenticated user lacks permission for the tenant or resource.
  - `404 Not Found`: Resource does not exist.
  - `409 Conflict`: Conflict with current state (e.g., unique constraint, concurrent modification).
  - `422 Unprocessable Entity`: Business logic validation failure.
  - `500 Internal Server Error`: Unhandled server exception.
- Standard Error Response Structure:
  ```json
  {
    "statusCode": 400,
    "timestamp": "2026-11-07T12:00:00.000Z",
    "path": "/api/v1/approvals",
    "message": "Validation failed",
    "errors": [{ "field": "title", "message": "title must not be empty" }]
  }
  ```

---

## 6. Testing Requirements

- **Test-Driven Rigor**: Every critical path (workflow transition logic, authorization rules, approval status checks) must be covered by automated tests.
- **Backend Testing**:
  - Unit tests (`*.spec.ts`): Test isolated services, state machines, and utility functions using mocks for dependencies.
  - Integration/E2E tests (`*.e2e-spec.ts`): Test full HTTP request/response lifecycles, database transactions, and health endpoints against real or test databases.
- **Frontend Testing**:
  - Component tests: Test interactive UI elements, form validations, and user feedback states.
  - End-to-End tests: Playwright tests verifying end-to-end flows (landing page loads, navigation, submission).
- **Execution Rule**: Never claim tests pass without executing the test suite and observing the exit code and summary.

---

## 7. Git and Documentation Conventions

- **Conventional Commits**: Commit messages follow the conventional format:
  - `feat: <description>` for new capabilities.
  - `fix: <description>` for bug fixes.
  - `chore: <description>` for maintenance, dependencies, configuration.
  - `docs: <description>` for documentation updates.
  - `test: <description>` for adding or updating tests.
  - `refactor: <description>` for code changes that neither fix bugs nor add features.
- **Documentation**:
  - `README.md`: Project overview, architecture summary, local setup guide, and operational instructions.
  - `DEVELOPMENT_LOG.md`: Chronological changelog and milestone execution record.
  - Inline documentation: Clear TSDoc comments on complex workflow domain logic. Avoid obvious comments.

---

## 8. Rules for Autonomous Development & Execution Policy

### Autonomous Execution Policy (Mandatory)

The autonomous engineering team operates with full pre-authorization for routine development actions across all milestones:

- **Pre-Authorized Capabilities**:
  - Read, inspect, create, edit, move, and organize project source files.
  - Install standard open-source dependencies using `pnpm`.
  - Execute terminal commands, scripts, Prisma migrations, and local servers.
  - Execute unit, integration, and end-to-end tests.
  - Diagnose errors, adjust code, and iterate on failed tests without stopping for routine approvals.
  - Update documentation, environment configurations, and development logs.
  - Make sound architectural and engineering decisions aligned with project objectives.
  - Execute local database operations required for development and testing, strictly preserving existing data.
- **Self-Healing & Independence**:
  - Do not ask for user confirmation for individual file edits, package installations, commands, or tests.
  - When an operation encounters a recoverable failure, diagnose and resolve it autonomously.
  - Never stop merely because a task spans multiple files or commands.

### Safety Boundaries (Strict Invariants)

- **Data Protection**: Never delete existing database volumes, drop production/dev databases, or execute destructive resets.
- **Work Integrity**: Never overwrite or discard existing user work without a verified backup.
- **Zero Secrets in Git**: Never expose, log, commit, or transmit secrets or credentials.
- **No External/Paid Engagements**: Never purchase services, provision cloud resources, or deploy publicly.
- **Safety Restrictions**: If an external platform permission or genuine blocker prevents progress, report the exact blocker clearly and continue with safe, unblocked work.
- **Deterministic Workflows**: Inspect existing files before editing; verify compilation, linting, and tests after modifications.
- **Dependency Discipline**: Use pinned, stable, compatible versions of libraries; avoid redundant packages.
- **No Mock Stubs in Place of Working Code**: Deliver real, working, functional implementations.

---

## 9. Requirement to Update DEVELOPMENT_LOG.md After Each Milestone

Upon completing any milestone or significant implementation phase, the team must update `DEVELOPMENT_LOG.md` in the project root. The log entry must contain:

1. **Milestone Name & Date**: Clear identification of the completed milestone.
2. **Summary of Work Completed**: Concrete list of deliverables and architectural decisions.
3. **Technical Decisions & Rationale**: Explanations written in clear, beginner-friendly language justifying design and stack choices.
4. **Verification & Test Results**: Output of test suites, type-checkers, and lint runners actually executed.
5. **Known Limitations or Environmental Blockers**: Any external blockers (e.g., Docker daemon status, missing cloud keys).
6. **Next Steps**: Explicit recommendations for the subsequent milestone.

---

## 10. Requirement to Verify Every Feature Before Declaring It Complete

No milestone or individual feature may be declared complete until:

1. **Compilation & Type-Check**: All workspaces compile with zero TypeScript errors (`pnpm check-types` / `tsc --noEmit`).
2. **Lint & Format**: Linters pass cleanly across all workspaces with zero warnings or errors (`pnpm lint`).
3. **Automated Tests**: Unit, integration, or smoke tests are executed and pass with exit code 0 (`pnpm test`).
4. **Runtime Verification**: Dev servers or target endpoints are launched and verified (e.g., HTTP GET to `/health` returning `{ "status": "ok" }`).
5. **Reproducible Instructions**: Exact CLI commands to build, start, and test the project locally are documented and verified.

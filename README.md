# FlowGate

> A production-quality, multi-tenant approval workflow SaaS platform for modern business operations.

FlowGate provides an enterprise-ready, compliant, and auditable workflow engine for multi-step approvals across departments (Finance, HR, Legal, and DevOps). Built with a decoupled monorepo architecture, FlowGate delivers high developer velocity, strict tenant data isolation, and asynchronous event processing.

---

## Architecture Overview

```mermaid
graph TD
    Client["Browser / Enterprise User"] --> Web["Next.js App Router (apps/web :3000)"]
    Web --> API["NestJS REST API (apps/api :4000)"]
    API --> Shared["Shared Types (@flowgate/shared-types)"]
    Web --> Shared
    API --> Prisma["Prisma ORM (Data Layer)"]
    Prisma --> Postgres[("PostgreSQL 16 (Port 5432)")]
    API --> Redis[("Redis 7 (Port 6379)")]
    Redis --> Worker["BullMQ Worker (Async Queues)"]
```

### Core Technologies

- **Frontend (`apps/web`)**: Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Lucide React.
- **Backend (`apps/api`)**: NestJS 10, TypeScript, Prisma ORM, class-validator, class-transformer, Jest.
- **Shared Packages (`packages/shared-types`)**: Shared TypeScript interfaces, workflow enums, and DTO contracts.
- **Data & Queue Layer**: PostgreSQL 16 (Prisma ORM) and Redis 7 (BullMQ job processing).
- **Tooling & Infrastructure**: `pnpm` workspaces, Docker Compose, GitHub Actions CI.

---

## Database Architecture & Entity Relationships (Prisma)

FlowGate enforces logical multi-tenancy at the database level where every business entity is scoped to a `Tenant`.

```mermaid
erDiagram
    Tenant ||--o{ User : "has many"
    Tenant ||--o{ WorkflowDefinition : "owns"
    Tenant ||--o{ ApprovalRequest : "contains"
    Tenant ||--o{ AuditLog : "records"
    WorkflowDefinition ||--o{ ApprovalRequest : "instantiates"
    User ||--o{ ApprovalRequest : "requests"
    ApprovalRequest ||--o{ ApprovalStep : "sequenced in"
    User ||--o{ ApprovalStep : "assigned to"
    User ||--o{ AuditLog : "performs"
```

### Core Models:

1. **`Tenant`**: Top-level organization boundary (`id`, `name`, unique `slug`, `status`, `settings` JSON, timestamps).
2. **`User`**: Tenant member with role-based access (`id`, `tenantId`, `name`, `email`, `passwordHash`, `role`, `status`, timestamps).
   - _Constraint_: `@@unique([tenantId, email])` guarantees unique emails per tenant while allowing multi-tenant tenancy.
3. **`WorkflowDefinition`**: Configurable approval blueprint (`id`, `tenantId`, `name`, `description`, `status`, `configuration` JSON, `version`, timestamps).
4. **`ApprovalRequest`**: Active approval workflow instance (`id`, `tenantId`, `workflowDefinitionId`, `requestedById`, `title`, `description`, `status`, timestamps).
5. **`ApprovalStep`**: Ordered approval review step (`id`, `approvalRequestId`, `assignedToId`, `stepOrder`, `status`, `comments`, timestamps).
   - _Constraint_: `@@unique([approvalRequestId, stepOrder])` guarantees strict sequential step numbering.
6. **`AuditLog`**: Tamper-evident, immutable audit trail (`id`, `tenantId`, `actorId`, `entityType`, `entityId`, `action`, `metadata` JSON, `createdAt`).
   - _Design_: Strictly append-only with no `updatedAt` field.

---

## Directory Structure

```text
flowgate/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI pipeline with DB services
├── apps/
│   ├── api/                       # NestJS Backend API (Port 4000)
│   │   ├── prisma/
│   │   │   ├── migrations/        # Version-controlled SQL migrations
│   │   │   ├── schema.prisma      # Multi-tenant schema definition
│   │   │   └── seed.ts            # Idempotent multi-tenant seed script
│   │   ├── src/
│   │   │   ├── health/            # Health check with live DB probe
│   │   │   ├── prisma/            # Global PrismaService & PrismaModule
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/                  # E2E & Multi-tenant isolation test suites
│   │   └── package.json
│   └── web/                       # Next.js Frontend (Port 3000)
│       ├── src/
│       │   └── app/               # App router: landing page, layout, styles
│       ├── tailwind.config.ts
│       └── package.json
├── packages/
│   └── shared-types/              # Shared interfaces & domain contracts
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── docker-compose.yml             # Local PostgreSQL 16 & Redis 7 services
├── pnpm-workspace.yaml            # pnpm monorepo workspace definition
├── tsconfig.base.json             # Base TypeScript configuration
├── GEMINI.md                      # Permanent repository constitution & guidelines
├── DEVELOPMENT_LOG.md             # Chronological milestone changelog
├── .env.example                   # Root environment variables template
└── README.md                  # Project documentation & quickstart
```

---

## Quickstart & Local Setup

### 1. Prerequisites

- **Node.js**: v20+ or v24+
- **pnpm**: v9+ / v12+ (`corepack enable pnpm` or `npm install -g pnpm`)
- **Docker & Docker Compose**: For local PostgreSQL and Redis services

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Default ports & connections:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- PostgreSQL: `localhost:5432` (`postgresql://flowgate:flowgate_dev_password@localhost:5432/flowgate_dev?schema=public`)
- Redis: `localhost:6379` (`redis://:flowgate_redis_pass@localhost:6379/0`)

### 4. Start Local Infrastructure (Docker Compose)

Start PostgreSQL and Redis in the background:

```bash
pnpm docker:up
# Or directly: docker compose up -d
```

Verify container health:

```bash
docker compose ps
```

### 5. Run Database Migrations & Seed Data

Apply Prisma migrations to PostgreSQL:

```bash
pnpm db:migrate
```

Seed two sample multi-tenant organizations (`Acme Corporation` and `Globex Industries`):

```bash
pnpm db:seed
```

### 6. Build Shared Packages

```bash
pnpm build:shared
```

### 7. Run the Application

Start both frontend and backend concurrently:

```bash
pnpm dev
```

Or start each service independently in separate terminal sessions:

```bash
# Terminal 1: NestJS API
pnpm dev:api

# Terminal 2: Next.js Frontend
pnpm dev:web
```

---

## Verification & API Endpoints

Once running, access the services:

- **Web Application & Interactive Console**: [http://localhost:3000](http://localhost:3000)
- **API Health Check**: [http://localhost:4000/health](http://localhost:4000/health)

### Demo Seed Accounts (Password: `FlowGatePass123!`)

| Organization (Slug)         | Email                 | Role           | Responsibilities                                               |
| :-------------------------- | :-------------------- | :------------- | :------------------------------------------------------------- |
| **Acme Corp (`acme-corp`)** | `admin@acme.com`      | `TENANT_ADMIN` | Organization administrator, workflow author, executive signoff |
| **Acme Corp (`acme-corp`)** | `finance@acme.com`    | `APPROVER`     | Step 1 budget and finance reviewer                             |
| **Acme Corp (`acme-corp`)** | `engineer@acme.com`   | `REQUESTER`    | Equipment & cloud infrastructure requester                     |
| **Globex (`globex-ind`)**   | `admin@globex.com`    | `TENANT_ADMIN` | Separate tenant realm administrator                            |
| **Globex (`globex-ind`)**   | `hr-lead@globex.com`  | `APPROVER`     | HR approval specialist                                         |
| **Globex (`globex-ind`)**   | `employee@globex.com` | `REQUESTER`    | Allowance requester                                            |

---

## REST API Reference (`/api/v1`)

All endpoints (except login and health) require header `Authorization: Bearer <jwt_access_token>`.

### Authentication (`/api/v1/auth`)

- `POST /api/v1/auth/login`: Authenticate with `tenantSlug`, `email`, `password`. Rate-limited to 10 req/min.
- `GET /api/v1/auth/me`: Retrieve validated profile and active tenant context.
- `GET /api/v1/auth/admin-only`: Privileged endpoint restricted to `TENANT_ADMIN` and `SUPER_ADMIN`.

### Workflows (`/api/v1/workflows`)

- `POST /api/v1/workflows`: Create workflow definition with ordered approval steps (`TENANT_ADMIN`, `MANAGER`).
- `GET /api/v1/workflows`: List workflows belonging to authenticated tenant.
- `GET /api/v1/workflows/:id`: Retrieve individual workflow definition.
- `PATCH /api/v1/workflows/:id`: Update workflow details or approval steps (`TENANT_ADMIN`, `MANAGER`).
- `POST /api/v1/workflows/:id/activate`: Activate workflow (`TENANT_ADMIN`, `MANAGER`).
- `POST /api/v1/workflows/:id/deactivate`: Deactivate/archive workflow (`TENANT_ADMIN`, `MANAGER`).

### Approval Requests (`/api/v1/requests`)

- `POST /api/v1/requests`: Submit request using an active workflow. Instantiates sequential approval steps.
- `GET /api/v1/requests`: List requests with filters (`filter=mine`, `filter=pending_approval`, `status=...`, pagination).
- `GET /api/v1/requests/:id`: Retrieve request detail with step progression and immutable audit trail.
- `POST /api/v1/requests/:id/actions`: Execute approval action (`APPROVE`, `REJECT`, `REQUEST_CHANGES`).
- `POST /api/v1/requests/:id/resubmit`: Resubmit a request that had changes requested.
- `POST /api/v1/requests/:id/cancel`: Cancel an active request.

---

## Available Scripts

| Command             | Description                                                            |
| :------------------ | :--------------------------------------------------------------------- |
| `pnpm dev`          | Starts all applications in parallel in development mode                |
| `pnpm dev:api`      | Starts only the NestJS API in watch mode (`:4000`)                     |
| `pnpm dev:web`      | Starts only the Next.js frontend in dev mode (`:3000`)                 |
| `pnpm build`        | Compiles shared types and builds all workspace applications            |
| `pnpm check-types`  | Executes TypeScript type checks (`tsc --noEmit`) across all workspaces |
| `pnpm lint`         | Runs ESLint across all workspaces                                      |
| `pnpm test`         | Executes backend unit test suites (Jest)                               |
| `pnpm test:e2e`     | Executes backend integration and multi-tenant isolation tests          |
| `pnpm db:generate`  | Generates the Prisma client library                                    |
| `pnpm db:migrate`   | Runs database migrations in development mode                           |
| `pnpm db:deploy`    | Applies pending database migrations in CI/production                   |
| `pnpm db:seed`      | Populates database with sample multi-tenant seed data                  |
| `pnpm format`       | Formats all code files using Prettier                                  |
| `pnpm format:check` | Verifies formatting conformance using Prettier                         |
| `pnpm docker:up`    | Boots local PostgreSQL and Redis containers                            |
| `pnpm docker:down`  | Stops and cleans up local Docker containers                            |

---

## Testing & Quality Assurance

All features must pass static checks, linting, and automated tests before merge:

```bash
# 1. Type checks
pnpm check-types

# 2. Linting
pnpm lint

# 3. Unit tests
pnpm test

# 4. E2E & Multi-Tenant Isolation tests
pnpm test:e2e
```

Continuous integration runs on GitHub Actions on every pull request and push to `main`.

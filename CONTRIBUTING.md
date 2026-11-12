# Contributing to FlowGate

Thank you for your interest in contributing to FlowGate! FlowGate is an enterprise-grade multi-tenant approval workflow platform and Directed Acyclic Graph (DAG) state machine.

---

## 1. Monorepo Architecture

FlowGate is structured as a `pnpm` monorepo:

```
FlowGate/
├── apps/
│   ├── api/             # NestJS 10 REST API (/api/v1), Prisma ORM, BullMQ workers
│   └── web/             # Next.js 14 App Router, React 18, ReactFlow (@xyflow/react)
├── packages/
│   ├── shared-types/    # Shared TypeScript DTOs, AST definitions, DAG contracts
│   ├── eslint-config/   # Shared ESLint configuration
│   └── tsconfig/        # Base TypeScript compiler configurations
├── docs/                # Architecture specifications & Decision Records (ADRs)
└── docker-compose.yml   # PostgreSQL 16 & Redis 7 local services
```

---

## 2. Prerequisites & Local Setup

### System Requirements

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **pnpm**: `v9.x` or `v10.x`
- **Docker & Docker Compose**: For local PostgreSQL and Redis

### Step-by-Step Setup

```bash
# 1. Clone repository
git clone https://github.com/kvijay5/FlowGate.git
cd FlowGate

# 2. Install workspace dependencies
pnpm install

# 3. Start local container services (PostgreSQL :5432, Redis :6379)
docker compose up -d

# 4. Generate Prisma client & apply database migrations
pnpm db:generate
pnpm db:deploy

# 5. Seed development & showcase database
pnpm db:seed

# 6. Start local development servers
pnpm dev
```

- **Frontend Application**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:4000](http://localhost:4000)
- **Health Endpoint**: [http://localhost:4000/health](http://localhost:4000/health)
- **OpenAPI Swagger UI**: [http://localhost:4000/api/docs](http://localhost:4000/api/docs)

---

## 3. Mandatory Quality Gates

Every pull request and commit must pass 100% of the following verification checks:

```bash
# 1. Static Typing (Zero TypeScript errors across all workspaces)
pnpm check-types

# 2. Linting (Zero ESLint warnings or errors)
pnpm lint

# 3. Formatting (Prettier compliance)
pnpm format:check
# Auto-format:
pnpm format

# 4. Unit Test Suite (Zero failures across API and Web)
pnpm test

# 5. End-to-End & Integration Tests (PostgreSQL & Redis integration)
pnpm test:e2e

# 6. Production Monorepo Build
pnpm build
```

---

## 4. Development Guidelines

### Core Invariants

- **Multi-Tenant Isolation**: Never query or mutate tenant entities without filtering by `tenantId`. Never accept client-supplied tenant identifiers; derive tenant identity from validated JWT session contexts.
- **Pure AST Condition Evaluation**: Dynamic workflow branching rules must use the pure AST evaluator (`AstConditionEvaluatorService`). Never use dynamic `eval()` or string templating.
- **Dual-Actor Attribution**: Out-of-office delegations must maintain dual-actor audit attribution (`actionedBy` vs `delegatedFrom`). Transitive delegations ($A \to B \to C$) are strictly prohibited.
- **Shared Contracts**: Whenever modifying shared types in `packages/shared-types`, always run:
  ```bash
  pnpm build:shared
  ```

### Conventional Commits

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard:

- `feat: <description>` for new features or capabilities
- `fix: <description>` for bug fixes
- `refactor: <description>` for code improvements without behavioral changes
- `test: <description>` for test suite additions
- `docs: <description>` for documentation updates
- `chore: <description>` for dependency or build maintenance

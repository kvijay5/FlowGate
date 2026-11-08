# FlowGate — Milestone 6 Architecture Specification

## Advanced Workflow Engine, Directed Acyclic Graph (DAG) Execution, Parallel Approvals, Delegation & Visual Workflow Builder

**Author:** FlowGate Autonomous Engineering Team  
**Status:** APPROVED IN PRINCIPLE — REFINED TECHNICAL SPECIFICATION  
**Date:** November 8, 2026  
**Target Milestone:** Milestone 6

---

## 1. Executive Summary & Existing Architecture Findings

FlowGate is a production-grade multi-tenant approval workflow SaaS platform. Milestones 1 through 5.1 established logical tenant isolation, JWT authentication and RBAC, linear approval state machines, cryptographic SHA-256 audit hash chains, a Transactional Outbox pattern, SSRF protections, and tenant-isolated queue observability, verified by 207 automated tests.

Milestone 6 expands FlowGate from a linear sequential approval engine into an **enterprise-grade Directed Acyclic Graph (DAG) workflow orchestrator**, featuring:

1. **First-Class DAG Execution Engine**: Declarative nodes and directed edges with branching, fork/join parallel execution, and safe condition routing backed by normalized transactional execution records (`WorkflowNodeExecution`, `WorkflowBranchExecution`).
2. **Deterministic Parallel Approvals**: Consensus (`PARALLEL_AND`) and Quorum (`PARALLEL_OR`) approval policies backed by atomic database row locking, with mathematical reachability invariants, `SOFT_REJECTION` default, and optional `STRICT_VETO`.
3. **Time-Bounded, Non-Escalating Approver Delegation**: Scoped, non-transitive delegation with zero RBAC privilege escalation, dynamic role validity checks, and dual-actor audit attribution (`delegatedFrom` vs `actionedBy`).
4. **Permanent Resubmission & Review Round History**: Multi-round versioning (`reviewRound: 1..N`) guaranteeing that previous votes, comments, and decisions remain permanently auditable across resubmissions.
5. **Validated Request-Data Contracts**: Strongly typed, schema-validated request payloads driving pure AST condition evaluation with zero dynamic code interpretation.
6. **Immutable Workflow Versioning**: Published workflow snapshots guaranteeing zero regression or behavioral mutation for in-flight requests.
7. **Visual Workflow Builder & Interactive Audit Inspector**: High-fidelity Next.js visual DAG designer with real-time cycle/reachability validation, coupled with an interactive cryptographic execution inspector.

### 1.1 Architectural Gap Analysis

| Subsystem                  | Existing Implementation (M1–M5.1)                                       | Milestone 6 Architectural Requirement                                                                                      |
| :------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Workflow Topology**      | Strictly linear `stepOrder: 1..N` sequence in JSON array.               | Full Directed Acyclic Graph (DAG) with nodes, directed edges, conditional splits, and parallel forks/joins.                |
| **Approver Assignment**    | Single user or role per step order (`request_step_order_unique`).       | Multi-approver stages with consensus (`AND`) or quorum (`OR`) policies, tracking individual assignee votes.                |
| **Routing Decisions**      | Hardcoded step order increment (`stepOrder + 1`).                       | Dynamic branch routing based on typed, schema-validated request data evaluated via a safe AST rule engine.                 |
| **Delegation**             | Absent; requires tenant admin intervention for out-of-office users.     | Time-bounded, scoped, one-hop delegation preventing circularity, cross-tenant leakage, and privilege escalation.           |
| **Resubmission History**   | In-place status overwrite; overwrites previous review state.            | Explicit review rounds (`reviewRound: 1..N`) preserving historical votes, comments, and decisions immutably.               |
| **Branch Execution State** | None; step order implicitly dictates execution.                         | Normalized database records (`WorkflowNodeExecution`, `WorkflowBranchExecution`) tracking branch readiness and joins.      |
| **Request Data**           | Unstructured title and description strings.                             | Formally validated JSON schema (`inputSchema`) with type safety, field constraints, and freeze-on-submission immutability. |
| **Workflow Immutability**  | Version number bumped only on step count change during active requests. | Immutable published versions with explicit `DRAFT` vs `ACTIVE` states; full JSON graph snapshotted per request.            |
| **User Interface**         | Linear modal form in a 2,200-line monolithic page component.            | Componentized visual canvas for DAG authoring and interactive graphical audit inspector with cryptographic proofs.         |

---

## 2. Directed Acyclic Graph (DAG) Execution Architecture

### 2.1 Graph Metamodel: Nodes, Edges & Execution Semantics

The workflow definition graph is a declarative, directed acyclic graph $G = (V, E)$, persisted as structured JSON within `WorkflowDefinition.configuration`.

```mermaid
flowchart TD
    classDef trigger fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px;
    classDef condition fill:#fef3c7,stroke:#b45309,stroke-width:2px;
    classDef approval fill:#dcfce7,stroke:#15803d,stroke-width:2px;
    classDef parallel fill:#ede9fe,stroke:#6d28d9,stroke-width:2px;
    classDef endNode fill:#fee2e2,stroke:#b91c1c,stroke-width:2px;

    N_TRIGGER["Trigger Node<br/><b>Submit Requisition</b><br/>(Validates Input Schema)"]:::trigger
    N_COND["Condition Node<br/><b>Amount & Dept Split</b>"]:::condition
    N_MGR["Approval Step<br/><b>Direct Manager</b><br/>(Single Approver)"]:::approval
    N_PARALLEL["Parallel Approval<br/><b>Executive Board</b><br/>(Policy: PARALLEL_AND)"]:::parallel
    N_JOIN["Join Node<br/><b>Branch Convergence</b><br/>(Policy: ALL_INCOMING)"]:::condition
    N_END_APP["End Node<br/><b>Request Approved</b>"]:::endNode

    N_TRIGGER --> N_COND
    N_COND -- "branch_under_10k" --> N_MGR
    N_COND -- "branch_over_10k" --> N_PARALLEL
    N_MGR --> N_JOIN
    N_PARALLEL --> N_JOIN
    N_JOIN --> N_END_APP
```

#### Node Metatypes (`WorkflowNodeType`)

1. **`TRIGGER` (Workflow Entrypoint)**:
   - Exactly one per workflow definition.
   - Defines `inputSchema`: field names, data types, validation rules, required attributes, and defaults.
   - Exactly one outgoing edge; zero incoming edges.
2. **`APPROVAL_STEP` (Sequential Approval)**:
   - Represents a stage requiring signoff from a single assigned entity.
   - Configures `assigneeType: 'ROLE' | 'USER'`, target role or specific user ID, timeout escalation, and reminder intervals.
   - One incoming edge; one outgoing edge.
3. **`PARALLEL_APPROVAL` (Multi-Approver Group)**:
   - Represents a stage requiring signoff from multiple approvers simultaneously.
   - Configures `policy: 'PARALLEL_AND' | 'PARALLEL_OR'`, `rejectionPolicy: 'SOFT_REJECTION' | 'STRICT_VETO'`, `requiredApprovals`, approver assignment list, and timeout escalation.
   - One incoming edge; one outgoing edge.
4. **`CONDITION` (Branching Router)**:
   - Evaluates request data against an ordered list of rule expressions.
   - Each rule targets an outgoing handle/edge.
   - Mandatory `defaultTargetNodeId` ensures deterministic fallback when no rules evaluate to true.
   - One incoming edge; multiple outgoing edges (labeled by branch key).
5. **`JOIN` (Branch Convergence)**:
   - Synchronizes converging execution paths.
   - Supported policies:
     - `ALL_INCOMING` (Standard Join): Waits until all active, non-pruned incoming branches have completed before advancing.
     - `ANY_INCOMING` (First-Come Race): Advances as soon as the first incoming branch arrives; marks sibling incoming branches `SKIPPED`.
   - Multiple incoming edges; exactly one outgoing edge.
6. **`END` (Terminal Outcome)**:
   - Marks workflow completion.
   - Configures `outcome: 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED'`.
   - At least one incoming edge; zero outgoing edges.

#### Directed Edges (`WorkflowEdge`)

```typescript
export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string; // Corresponds to branchKey for CONDITION nodes
  label?: string; // Visual label (e.g. "Amount > $10,000")
}
```

### 2.2 Graph Validation & Invariant Enforcement

Before any workflow definition can transition from `DRAFT` to `ACTIVE` (Published), the backend `WorkflowValidatorService` executes a four-pass structural analysis:

1. **Cycle Detection (Strict Acyclicity)**:
   - Executes Tarjan's strongly connected components algorithm or Kahn's topological sort.
   - Any back-edge or loop causes immediate rejection: `INVALID_TOPOLOGY: Graph contains cycles`.
2. **Reachability Analysis (No Orphaned Nodes or Dead Ends)**:
   - **Forward Reachability (BFS from `TRIGGER`)**: Every node $v \in V$ must be reachable from the `TRIGGER` node. Disconnected nodes or island subgraphs trigger `UNREACHABLE_NODE_ERROR`.
   - **Reverse Reachability (Reverse BFS from `END` nodes)**: Every non-terminal node must have a path reaching at least one `END` node. Dead ends trigger `DEAD_END_ERROR`.
3. **Condition Branch Determinism**:
   - Every `CONDITION` node must define at least one rule and a non-null `defaultTargetNodeId`.
   - Every branch target and default target must correspond to an existing node ID.
4. **Join Feasibility & Deadlock Prevention**:
   - An `ALL_INCOMING` join requires synchronization across parallel branches.
   - If incoming edges originate from mutually exclusive branches of an upstream `CONDITION` node without a parallel fork, they can never co-occur, resulting in a permanent engine stall (deadlock). The validator traces branch origins; mutually exclusive inputs to an `ALL_INCOMING` join trigger `DEADLOCK_RISK_ERROR`.

---

## 3. Database Entity & Relationship Design

### 3.1 Normalized Execution Models vs JSONB

A critical architectural decision in Milestone 6 is **rejecting JSONB-only state persistence** for branch execution in favor of **Normalized Database Records**.

#### Concurrency & Correctness Comparison

| Factor                 | JSONB on `ApprovalRequest`                                                                                                           | Normalized Records (`WorkflowNodeExecution`, `WorkflowBranchExecution`)                                  |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| **Concurrent Updates** | High risk of Lost Updates unless entire `ApprovalRequest` row is locked for every branch transition, creating bottleneck contention. | Independent row locks per node/branch execution row. Zero contention between distinct parallel branches. |
| **Join Evaluation**    | Complex JSON queries (`jsonb_array_elements`) susceptible to race conditions.                                                        | Clean, index-backed SQL queries (`SELECT status, count(*) ... GROUP BY status`).                         |
| **Audit & History**    | Overwritten unless arrays of past states are manually appended inside JSON.                                                          | Native, append-friendly rows with full foreign keys, timestamps, and review round numbers.               |
| **Restart Recovery**   | Difficult to query partially completed branches across hundreds of requests.                                                         | Trivial, index-backed queries for stalled or active executions across the tenant.                        |

FlowGate adopts **Normalized Transactional Execution Records**.

### 3.2 Relational Schema (Prisma DDL Specification)

```mermaid
erDiagram
    tenants ||--o{ workflow_definitions : owns
    tenants ||--o{ approval_requests : scopes
    tenants ||--o{ user_delegations : enforces
    tenants ||--o{ audit_logs : chains

    workflow_definitions ||--o{ approval_requests : instantiates
    approval_requests ||--o{ approval_steps : contains
    approval_requests ||--o{ workflow_node_executions : tracks
    approval_requests ||--o{ workflow_branch_executions : synchronizes

    approval_steps ||--o{ approval_step_assignees : tracks

    users ||--o{ approval_requests : requests
    users ||--o{ approval_step_assignees : assigned
    users ||--o{ user_delegations : delegates
```

#### A. Extended Enums

```prisma
enum StepPolicy {
  SEQUENTIAL
  PARALLEL_AND
  PARALLEL_OR

  @@map("step_policy")
}

enum RejectionPolicy {
  SOFT_REJECTION  // Individual reject does not terminate stage unless all reject (Default for PARALLEL_OR)
  STRICT_VETO     // Any single reject immediately terminates stage and request (Default for PARALLEL_AND)

  @@map("rejection_policy")
}

enum DelegationStatus {
  ACTIVE
  REVOKED
  EXPIRED

  @@map("delegation_status")
}

enum WorkflowStatus {
  DRAFT
  ACTIVE
  ARCHIVED

  @@map("workflow_status")
}

enum NodeExecutionStatus {
  PENDING
  IN_REVIEW
  COMPLETED
  SKIPPED
  FAILED
  CANCELLED

  @@map("node_execution_status")
}

enum BranchExecutionStatus {
  NOT_EVALUATED
  ACTIVE
  COMPLETED
  PRUNED_SKIPPED
  FAILED
  CANCELLED

  @@map("branch_execution_status")
}
```

#### B. Updated `ApprovalRequest` (Review Round Aware)

```prisma
model ApprovalRequest {
  id                   String                @id @default(uuid()) @db.Uuid
  tenantId             String                @map("tenant_id") @db.Uuid
  workflowDefinitionId String                @map("workflow_definition_id") @db.Uuid
  requestedById        String                @map("requested_by_id") @db.Uuid
  title                String                @db.VarChar(255)
  description          String?               @db.Text
  requestData          Json                  @default("{}") @map("request_data") // Strongly validated payload
  status               ApprovalRequestStatus @default(PENDING)
  workflowVersion      Int                   @default(1) @map("workflow_version")
  workflowSnapshot     Json?                 @map("workflow_snapshot") // Complete frozen DAG snapshot
  currentNodeId        String?               @map("current_node_id") @db.VarChar(100)
  currentReviewRound   Int                   @default(1) @map("current_review_round") // Explicit review round counter
  createdAt            DateTime              @default(now()) @map("created_at")
  updatedAt            DateTime              @updatedAt @map("updated_at")

  tenant             Tenant                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  workflowDefinition WorkflowDefinition        @relation(fields: [tenantId, workflowDefinitionId], references: [tenantId, id], onDelete: Restrict)
  requestedBy        User                      @relation("UserApprovalRequests", fields: [tenantId, requestedById], references: [tenantId, id], onDelete: Restrict)
  steps              ApprovalStep[]
  nodeExecutions     WorkflowNodeExecution[]
  branchExecutions   WorkflowBranchExecution[]

  @@unique([tenantId, id], name: "tenant_request_id_unique")
  @@index([tenantId, status])
  @@index([tenantId, requestedById])
  @@map("approval_requests")
}
```

#### C. Updated `ApprovalStep` (Stage Execution with Round Tracking)

```prisma
model ApprovalStep {
  id                String          @id @default(uuid()) @db.Uuid
  tenantId          String          @map("tenant_id") @db.Uuid
  approvalRequestId String          @map("approval_request_id") @db.Uuid
  reviewRound       Int             @default(1) @map("review_round") // Review round association
  nodeId            String          @default("legacy_step") @map("node_id") @db.VarChar(100)
  nodeType          String          @default("APPROVAL_STEP") @map("node_type") @db.VarChar(50)
  stepName          String          @default("Approval Step") @map("step_name") @db.VarChar(255)
  stepOrder         Int             @map("step_order")
  branchKey         String?         @map("branch_key") @db.VarChar(100)
  policy            StepPolicy      @default(SEQUENTIAL)
  rejectionPolicy   RejectionPolicy @default(SOFT_REJECTION) @map("rejection_policy")
  totalAssigned     Int             @default(1) @map("total_assigned") // Distinct assigned approvers
  requiredApprovals Int             @default(1) @map("required_approvals") // Required approval threshold
  approvedCount     Int             @default(0) @map("approved_count") // Approvals in this round
  rejectedCount     Int             @default(0) @map("rejected_count") // Rejections in this round
  assignedToId      String?         @map("assigned_to_id") @db.Uuid
  assignedRole      UserRole?       @map("assigned_role")
  actionedById      String?         @map("actioned_by_id") @db.Uuid
  actionedAt        DateTime?       @map("actioned_at")
  status            StepStatus      @default(PENDING)
  comments          String?         @db.Text
  reminderCount     Int             @default(0) @map("reminder_count")
  lastRemindedAt    DateTime?       @map("last_reminded_at")
  isEscalated       Boolean         @default(false) @map("is_escalated")
  escalatedAt       DateTime?       @map("escalated_at")
  escalatedToRole   UserRole?       @map("escalated_to_role")
  escalatedToUserId String?         @map("escalated_to_user_id") @db.Uuid
  escalationReason  String?         @map("escalation_reason") @db.VarChar(255)
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  tenant          Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  approvalRequest ApprovalRequest        @relation(fields: [tenantId, approvalRequestId], references: [tenantId, id], onDelete: Cascade)
  assignedTo      User?                  @relation("UserAssignedSteps", fields: [tenantId, assignedToId], references: [tenantId, id], onDelete: SetNull)
  actionedBy      User?                  @relation("UserActionedSteps", fields: [tenantId, actionedById], references: [tenantId, id], onDelete: SetNull)
  assignees       ApprovalStepAssignee[]

  // Uniqueness includes reviewRound to preserve history across resubmissions
  @@unique([approvalRequestId, reviewRound, stepOrder], name: "request_round_step_order_unique")
  @@index([tenantId])
  @@index([approvalRequestId, reviewRound])
  @@index([tenantId, nodeId])
  @@map("approval_steps")
}
```

#### D. Updated `ApprovalStepAssignee` (Individual Vote with Round Tracking)

```prisma
model ApprovalStepAssignee {
  id                  String     @id @default(uuid()) @db.Uuid
  tenantId            String     @map("tenant_id") @db.Uuid
  stepId              String     @map("step_id") @db.Uuid
  reviewRound         Int        @default(1) @map("review_round")
  assignedToId        String?    @map("assigned_to_id") @db.Uuid
  assignedRole        UserRole?  @map("assigned_role")
  status              StepStatus @default(PENDING)
  actionedById        String?    @map("actioned_by_id") @db.Uuid
  delegatedFromUserId String?    @map("delegated_from_user_id") @db.Uuid
  actionedAt          DateTime?  @map("actioned_at")
  comments            String?    @db.Text
  createdAt           DateTime   @default(now()) @map("created_at")
  updatedAt           DateTime   @updatedAt @map("updated_at")

  tenant            Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  step              ApprovalStep @relation(fields: [tenantId, stepId], references: [tenantId, id], onDelete: Cascade)
  assignedTo        User?        @relation("AssigneeAssignedTo", fields: [tenantId, assignedToId], references: [tenantId, id], onDelete: SetNull)
  actionedBy        User?        @relation("AssigneeActionedBy", fields: [tenantId, actionedById], references: [tenantId, id], onDelete: SetNull)
  delegatedFromUser User?        @relation("AssigneeDelegatedFrom", fields: [tenantId, delegatedFromUserId], references: [tenantId, id], onDelete: SetNull)

  @@index([tenantId])
  @@index([stepId])
  @@index([tenantId, assignedToId, status])
  @@index([tenantId, assignedRole, status])
  @@map("approval_step_assignees")
}
```

#### E. New Model: `WorkflowNodeExecution`

Tracks execution state of every node in the graph:

```prisma
model WorkflowNodeExecution {
  id                String              @id @default(uuid()) @db.Uuid
  tenantId          String              @map("tenant_id") @db.Uuid
  approvalRequestId String              @map("approval_request_id") @db.Uuid
  reviewRound       Int                 @default(1) @map("review_round")
  nodeId            String              @map("node_id") @db.VarChar(100)
  nodeType          String              @map("node_type") @db.VarChar(50)
  status            NodeExecutionStatus @default(PENDING)
  activatedAt       DateTime?           @map("activated_at")
  completedAt       DateTime?           @map("completed_at")
  executionData     Json?               @default("{}") @map("execution_data")
  createdAt         DateTime            @default(now()) @map("created_at")
  updatedAt         DateTime            @updatedAt @map("updated_at")

  tenant          Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  approvalRequest ApprovalRequest @relation(fields: [tenantId, approvalRequestId], references: [tenantId, id], onDelete: Cascade)

  @@unique([approvalRequestId, reviewRound, nodeId])
  @@index([tenantId, status])
  @@map("workflow_node_executions")
}
```

#### F. New Model: `WorkflowBranchExecution`

Tracks state of each graph branch/edge, enabling robust join synchronization:

```prisma
model WorkflowBranchExecution {
  id                String                @id @default(uuid()) @db.Uuid
  tenantId          String                @map("tenant_id") @db.Uuid
  approvalRequestId String                @map("approval_request_id") @db.Uuid
  reviewRound       Int                   @default(1) @map("review_round")
  branchKey         String                @map("branch_key") @db.VarChar(100)
  sourceNodeId      String                @map("source_node_id") @db.VarChar(100)
  targetNodeId      String                @map("target_node_id") @db.VarChar(100)
  status            BranchExecutionStatus @default(NOT_EVALUATED)
  activatedAt       DateTime?             @map("activated_at")
  completedAt       DateTime?             @map("completed_at")
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  tenant          Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  approvalRequest ApprovalRequest @relation(fields: [tenantId, approvalRequestId], references: [tenantId, id], onDelete: Cascade)

  @@unique([approvalRequestId, reviewRound, branchKey])
  @@index([tenantId, targetNodeId, status])
  @@map("workflow_branch_executions")
}
```

#### G. Updated `UserDelegation`

```prisma
model UserDelegation {
  id                   String           @id @default(uuid()) @db.Uuid
  tenantId             String           @map("tenant_id") @db.Uuid
  delegatorId          String           @map("delegator_id") @db.Uuid
  delegateeId          String           @map("delegatee_id") @db.Uuid
  workflowDefinitionId String?          @map("workflow_definition_id") @db.Uuid
  delegateRoles        Boolean          @default(true) @map("delegate_roles")
  startDate            DateTime         @map("start_date")
  endDate              DateTime         @map("end_date")
  status               DelegationStatus @default(ACTIVE)
  reason               String?          @db.VarChar(500)
  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  tenant             Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  delegator          User                @relation("DelegatorUser", fields: [tenantId, delegatorId], references: [tenantId, id], onDelete: Cascade)
  delegatee          User                @relation("DelegateeUser", fields: [tenantId, delegateeId], references: [tenantId, id], onDelete: Cascade)
  workflowDefinition WorkflowDefinition? @relation(fields: [tenantId, workflowDefinitionId], references: [tenantId, id], onDelete: SetNull)

  @@index([tenantId])
  @@index([tenantId, delegateeId, status, startDate, endDate])
  @@index([tenantId, delegatorId, status])
  @@map("user_delegations")
}
```

---

## 4. Immutable Workflow Versioning & Publishing Lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Creator initializes workflow
    DRAFT --> DRAFT : Edit nodes / edges / schema
    DRAFT --> ACTIVE : Publish (Validation passes, version = N)
    ACTIVE --> ACTIVE : Execute in-flight & new requests
    ACTIVE --> DRAFT : "Edit Workflow" (Creates Version N+1 Draft)
    ACTIVE --> ARCHIVED : Decommission workflow
    ARCHIVED --> [*]
```

### 4.1 Publishing Rules & State Isolation

1. **Draft State (`DRAFT`)**:
   - Mutable work-in-progress configuration.
   - May be incomplete or contain validation warnings.
   - **Cannot** be selected by requesters to create approval requests (`BadRequestException`).
2. **Publishing Mutation**:
   - Executes `POST /api/v1/workflows/:id/publish`.
   - Triggers `WorkflowValidatorService.validateDAG(configuration)`.
   - In an atomic transaction:
     - Sets `status: 'ACTIVE'`, `publishedAt: NOW()`.
     - Sets `isLatest: true` on the new version; sets `isLatest: false` on previous versions with the same name.
     - Logs `WORKFLOW_PUBLISHED` to the cryptographic audit chain with the SHA-256 hash of the graph.
3. **Editing a Published Workflow**:
   - Calling `PATCH /api/v1/workflows/:id` on an `ACTIVE` workflow does **not** overwrite the active row.
   - The system automatically creates a new row with `status: 'DRAFT'`, `version: currentVersion + 1`, and copies the configuration.
4. **Historical Request Guarantee**:
   - Every `ApprovalRequest` stores:
     - `workflowVersion`: integer version number.
     - `workflowSnapshot`: complete frozen JSON of `{ nodes, edges, inputSchema }`.
   - Active requests navigate **exclusively** within their snapshotted graph. Even if the workflow definition is archived or updated to version 5, Request #101 runs version 1 until terminal completion.

---

## 5. Decision 1: Parallel Approval Counters, Semantics & Reachability Invariants

### 5.1 Distinct Counter Definitions & Mathematical Formulas

For every parallel approval stage, the engine maintains distinct, non-overlapping metrics on `ApprovalStep` to evaluate consensus, quorum, and reachability:

1. **`totalAssigned`**: Total count of distinct, active approvers assigned to this stage in the current review round (computed after assignment deduplication).
2. **`requiredApprovals`**: Approval threshold required to satisfy the stage:
   - For `PARALLEL_AND`: $\text{requiredApprovals} = \text{totalAssigned}$.
   - For `PARALLEL_OR`: $\text{requiredApprovals} = 1$ (by default), or an explicitly configured quorum threshold $K \in [1, \text{totalAssigned}]$.
3. **`approvedCount`**: Count of distinct assignees who have submitted `APPROVE` in the current review round.
4. **`rejectedCount`**: Count of distinct assignees who have submitted `REJECT` in the current review round.
5. **`deactivatedCount`**: Count of assignees whose user account was suspended or deactivated while the stage was active.
6. **`pendingEligibleCount`**: Count of assignees who remain eligible to vote:
   $$\text{pendingEligibleCount} = \text{totalAssigned} - (\text{approvedCount} + \text{rejectedCount} + \text{deactivatedCount})$$
7. **`maxAchievableApprovals`**: Maximum total approvals that could possibly be accumulated if every remaining eligible approver voted to approve:
   $$\text{maxAchievableApprovals} = \text{approvedCount} + \text{pendingEligibleCount}$$

### 5.2 Terminal Evaluation Invariants & Quorum Loss

Immediately following every approval action, rejection, delegation action, or approver status change within the stage's database transaction, the engine evaluates two deterministic invariants:

#### A. Success Invariant (Quorum / Consensus Achieved)

$$\text{approvedCount} \ge \text{requiredApprovals} \implies \mathbf{STAGE\ COMPLETED\ (APPROVED)}$$

- **Execution Effects**:
  - `ApprovalStep.status` transitions from `IN_REVIEW` to `APPROVED`.
  - All remaining assignees with `status: 'PENDING'` are atomically updated to `status: 'SKIPPED'` (`comments: 'Stage resolved by quorum / peer approval'`).
  - Downstream outgoing branch transitions from `NOT_EVALUATED` to `ACTIVE`.

#### B. Reachability Invariant & `QUORUM_LOST`

$$\text{maxAchievableApprovals} < \text{requiredApprovals} \implies \mathbf{QUORUM\_LOST\ (STAGE\ REJECTED)}$$

- **Terminal Transition**: The engine transitions `ApprovalStep.status` to `REJECTED` and `ApprovalRequest.status` to `REJECTED` with reason `"QUORUM_LOST: Required approval threshold unreachable"`.
- **Cleanup**: Any remaining pending assignees are atomically updated to `status: 'SKIPPED'` (`comments: 'Stage aborted: required approval threshold unreachable'`).
- **Engine Guarantee**: The workflow engine **never** hangs indefinitely in `IN_REVIEW` when the required approval outcome is no longer mathematically achievable.

### 5.3 Metric Mutations Across Lifecycle Events

| Event Trigger                                    | `approvedCount` | `rejectedCount` |     `pendingEligibleCount`     | State Evaluation & Action Taken                                                                                                                                                                        |
| :----------------------------------------------- | :-------------: | :-------------: | :----------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approval**                                     |      $+1$       |       $0$       |              $-1$              | If $\text{approvedCount} \ge \text{requiredApprovals} \implies \mathbf{APPROVED}$; else remains `IN_REVIEW`.                                                                                           |
| **Rejection (`PARALLEL_OR` + `SOFT_REJECTION`)** |       $0$       |      $+1$       |              $-1$              | If $\text{maxAchievableApprovals} < \text{requiredApprovals} \implies \mathbf{QUORUM\_LOST}$; else remains `IN_REVIEW`.                                                                                |
| **Rejection (`PARALLEL_OR` + `STRICT_VETO`)**    |       $0$       |      $+1$       |              $-1$              | Immediately terminates stage and request with $\mathbf{REJECTED\ (VETOED)}$. Remaining assignees marked `SKIPPED`.                                                                                     |
| **Rejection (`PARALLEL_AND`)**                   |       $0$       |      $+1$       |              $-1$              | Since $\text{requiredApprovals} = \text{totalAssigned}$, $\text{maxAchievableApprovals} = \text{totalAssigned} - 1 < \text{requiredApprovals} \implies$ Immediate $\mathbf{QUORUM\_LOST\ (REJECTED)}$. |
| **Delegated Action**                             |   $+1$ or $0$   |   $0$ or $+1$   |              $-1$              | Assignee record updated with `actionedById = delegateeId`, `delegatedFromUserId = delegatorId`. Metric updates identical to direct approver.                                                           |
| **Approver Deactivation**                        |       $0$       |       $0$       | $-1$ (`deactivatedCount` $+1$) | Assignee record marked `status: 'SKIPPED'` (`comments: 'Assignee deactivated'`). Evaluates Reachability Invariant immediately.                                                                         |
| **Role Demotion**                                |       $0$       |       $0$       |           Unchanged            | Action rejected with `HTTP 403 Forbidden`. Seat remains `PENDING` for other valid members of assigned role.                                                                                            |

### 5.4 Comprehensive Case Walkthroughs

#### Case 1: Three Assigned Approvers, Two Required Approvals (`totalAssigned = 3, requiredApprovals = 2`, `PARALLEL_OR` `SOFT_REJECTION`)

- **Initial State**: $\text{totalAssigned} = 3, \text{requiredApprovals} = 2, \text{approvedCount} = 0, \text{rejectedCount} = 0, \text{pendingEligibleCount} = 3, \text{maxAchievableApprovals} = 3$. Status: `IN_REVIEW`.
- **Step 1 (User 1 Rejects)**:
  - $\text{rejectedCount} = 1, \text{pendingEligibleCount} = 2, \text{maxAchievableApprovals} = 0 + 2 = 2$.
  - Evaluation: $\text{maxAchievableApprovals} (2) \ge \text{requiredApprovals} (2)$. Stage remains `IN_REVIEW`.
- **Step 2 (User 2 Approves)**:
  - $\text{approvedCount} = 1, \text{pendingEligibleCount} = 1, \text{maxAchievableApprovals} = 1 + 1 = 2$.
  - Evaluation: $\text{approvedCount} (1) < 2$, but $\text{maxAchievableApprovals} (2) \ge 2$. Stage remains `IN_REVIEW`.
- **Step 3 (User 3 Approves)**:
  - $\text{approvedCount} = 2, \text{pendingEligibleCount} = 0$.
  - Evaluation: $\text{approvedCount} (2) \ge \text{requiredApprovals} (2)$.
  - **Outcome**: Stage successfully transitions to `APPROVED`.

#### Case 2: Three Assigned Approvers, All Three Required (`totalAssigned = 3, requiredApprovals = 3`, `PARALLEL_AND`)

- **Initial State**: $\text{totalAssigned} = 3, \text{requiredApprovals} = 3, \text{pendingEligibleCount} = 3, \text{maxAchievableApprovals} = 3$. Status: `IN_REVIEW`.
- **Step 1 (User 1 Approves)**:
  - $\text{approvedCount} = 1, \text{pendingEligibleCount} = 2, \text{maxAchievableApprovals} = 1 + 2 = 3 \ge 3$. Stage remains `IN_REVIEW`.
- **Step 2 (User 2 Rejects)**:
  - $\text{rejectedCount} = 1, \text{pendingEligibleCount} = 1, \text{maxAchievableApprovals} = 1 + 1 = 2$.
  - Evaluation: $\text{maxAchievableApprovals} (2) < \text{requiredApprovals} (3)$.
  - **Outcome**: **QUORUM_LOST triggered immediately**. Stage and request transition to `REJECTED`. User 3's pending assignment is atomically marked `SKIPPED`.

#### Case 3: Two Rejections with One Pending Approver (`totalAssigned = 3, requiredApprovals = 2`, `PARALLEL_OR` `SOFT_REJECTION`)

- **Initial State**: $\text{totalAssigned} = 3, \text{requiredApprovals} = 2, \text{pendingEligibleCount} = 3$. Status: `IN_REVIEW`.
- **Step 1 (User 1 Rejects)**: $\text{rejectedCount} = 1, \text{pendingEligibleCount} = 2, \text{maxAchievableApprovals} = 2 \ge 2$. Stage remains `IN_REVIEW`.
- **Step 2 (User 2 Rejects)**:
  - $\text{rejectedCount} = 2, \text{pendingEligibleCount} = 1, \text{approvedCount} = 0$.
  - $\text{maxAchievableApprovals} = 0 + 1 = 1$.
  - Evaluation: $\text{maxAchievableApprovals} (1) < \text{requiredApprovals} (2)$.
  - **Outcome**: **QUORUM_LOST triggered immediately**. Stage and request transition to `REJECTED`. User 3 is marked `SKIPPED`. The engine does not wait for User 3 to vote.

#### Case 4: Required Threshold Greater Than Number of Valid Assignments (`requiredApprovals > totalAssigned`)

- **Validation Phase**: At workflow publishing (`POST /workflows/:id/publish`), `WorkflowValidatorService` checks $\text{requiredApprovals} \le \text{totalAssigned}$. If $\text{requiredApprovals} > \text{totalAssigned}$ (e.g. requires 4 approvals but only 3 approvers assigned), publishing is blocked with error `INVALID_APPROVAL_THRESHOLD`.
- **Runtime Guard**: If an existing stage dynamically resolves fewer assignees than $\text{requiredApprovals}$ (e.g. due to missing role assignees):
  - $\text{maxAchievableApprovals} = \text{totalAssigned} < \text{requiredApprovals}$.
  - Instantiation immediately aborts the step with status `REJECTED` and reason `INSUFFICIENT_ASSIGNMENTS: Configured threshold exceeds eligible assignees`.

#### Case 5: Duplicate Assignments (Direct User Assignment + Role Membership)

- **Scenario**: Step configuration assigns User A directly, User B directly, and Role `FINANCE`. User A and User C belong to Role `FINANCE`.
- **Deduplication Algorithm**: Step instantiation computes the set union of assignees:
  $$\text{Assignees} = \{\text{User A}\} \cup \{\text{User B}\} \cup \{\text{Members of FINANCE}\} = \{\text{User A}, \text{User B}, \text{User C}\}$$
- **Result**:
  - $\text{totalAssigned} = 3$ (User A cannot vote twice or receive multiple assignment records).
  - Exactly 3 distinct `ApprovalStepAssignee` records are created.
  - The step cannot be approved prematurely by a single user holding multiple assignment paths.

#### Case 6: Approver Deactivation During Active Review

- **Scenario**: `totalAssigned = 3, requiredApprovals = 3` (`PARALLEL_AND`). User 1 approved, User 2 and User 3 pending.
- **Trigger**: Tenant admin deactivates User 3 (`users.status = 'DEACTIVATED'`).
- **Processing**:
  - Step monitor marks User 3's assignment `status: 'SKIPPED'` (`comments: 'Assignee account deactivated'`).
  - Metric update: $\text{deactivatedCount} = 1, \text{pendingEligibleCount} = 3 - (1 + 0 + 1) = 1$.
  - $\text{maxAchievableApprovals} = \text{approvedCount} (1) + \text{pendingEligibleCount} (1) = 2$.
  - Evaluation: $\text{maxAchievableApprovals} (2) < \text{requiredApprovals} (3)$.
  - **Outcome**: **QUORUM_LOST triggered immediately**. Stage and request transition to `REJECTED` (with audit log `STEP_ABORTED_ASSIGNEE_DEACTIVATED`). User 2 marked `SKIPPED`.

### 5.5 `PARALLEL_OR` Rejection Policies

- **`SOFT_REJECTION` (Default)**:
  - An individual rejection does **not** terminate the stage. The voter's assignment becomes `REJECTED`, and `rejectedCount` increments.
  - Sibling approvers can still approve.
  - One valid approval satisfies the quorum, transitions the step to `APPROVED`, and marks sibling assignees `SKIPPED` (`resolved_by_peer`).
  - Terminal rejection occurs if and only if **all** assignees reject or $\text{maxAchievableApprovals} < \text{requiredApprovals}$.
- **`STRICT_VETO` (Optional Stage Flag)**:
  - Any single rejection immediately transitions the stage and request to `REJECTED`, marking remaining pending assignees `SKIPPED`.

---

## 6. Decision 2: Delegation Permissions & Privilege Escalation Prevention

### 6.1 No General RBAC Escalation

**Delegation does NOT transfer general RBAC roles or administrative permissions.**

- A regular employee delegated by a `TENANT_ADMIN` does **not** gain the `TENANT_ADMIN` role across FlowGate.
- The delegate cannot invite users, modify workflows, access webhook configuration, view platform queue telemetry, or bypass tenant boundaries.
- The delegate receives **strictly scoped approval rights** to act on behalf of the delegator on approval stages matching the delegation contract.

### 6.2 Scope Types & Resolution Hierarchy

1. **Direct-User Approval Delegation**:
   - Applies to approval steps where `assignedToId === delegatorId`.
   - Authorized if active delegation exists from delegator to delegate.
2. **Role-Based Approval Delegation**:
   - Applies to approval steps assigned to a role (e.g. `assignedRole: 'MANAGER'`).
   - Requires explicit authorization: `delegateRoles: true` on the `UserDelegation` record.
   - **Dynamic Role Verification Invariant**: When an approval action is submitted, the engine dynamically checks that the _delegator currently holds the required role_ in `users.role`. If the delegator was demoted from `MANAGER` to `REQUESTER`, the delegation check immediately fails with `HTTP 403 Forbidden: Delegator no longer holds the required role`.
3. **Scope Precedence**:
   - Workflow-specific delegation (`workflowDefinitionId = W`) strictly takes precedence over tenant-wide global delegation (`workflowDefinitionId = NULL`).
4. **Delegate Account State Invariant**:
   - If the delegate user account is suspended, deactivated, or deleted (`users.status !== 'ACTIVE'`), all delegation attempts fail immediately with `HTTP 403 Forbidden: Delegate account is not active`.
5. **Strict One-Hop Constraint**:
   - Transitive delegation is strictly prohibited ($A \rightarrow B \rightarrow C$). Acting users must hold a direct active delegation from the original assignee.
6. **Dual-Actor Representation**:
   - Database record: `ApprovalStepAssignee` stores `actionedById = delegateeId`, `delegatedFromUserId = delegatorId`.
   - Cryptographic Audit Log: Action `STEP_APPROVED` stores `actorId = delegateeId` and metadata:
     ```json
     {
       "delegatedAction": true,
       "delegatedFromUserId": "delegator-uuid",
       "delegatorName": "Jane Doe",
       "delegationId": "delegation-uuid",
       "delegatedRole": "MANAGER"
     }
     ```

---

## 7. Decision 3: Normalized Graph Branch Execution & Join Semantics

### 7.1 Branch Lifecycle States & Allowed Transitions

Every directed edge/branch in the DAG is tracked by a normalized `workflow_branch_executions` row for the active review round. The branch execution state machine enforces strict, deterministic transitions:

```mermaid
stateDiagram-v2
    [*] --> NOT_EVALUATED : Round / Graph initialized
    NOT_EVALUATED --> ACTIVE : Source completes & condition TRUE / unconditional split
    NOT_EVALUATED --> PRUNED_SKIPPED : Source condition FALSE / upstream branch pruned
    NOT_EVALUATED --> CANCELLED : Request cancelled before evaluation
    NOT_EVALUATED --> FAILED : Upstream source node fails

    ACTIVE --> COMPLETED : Branch target node completes successfully
    ACTIVE --> FAILED : Execution error on active branch
    ACTIVE --> CANCELLED : Request cancelled while branch active

    COMPLETED --> [*] : Terminal (Ready for Join)
    PRUNED_SKIPPED --> [*] : Terminal (Bypassed from Join)
    FAILED --> [*] : Terminal (Aborts Join)
    CANCELLED --> [*] : Terminal (Aborts Join)
```

#### Allowed State Transitions Matrix

| Current State        | Next State           | Triggering Condition                                                             | Engine Action                                                                           |
| :------------------- | :------------------- | :------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| **`NOT_EVALUATED`**  | **`ACTIVE`**         | Upstream node finishes; condition evaluates to `TRUE` (or unconditional branch). | Activates target node; creates `workflow_node_executions` row in `PENDING`/`IN_REVIEW`. |
| **`NOT_EVALUATED`**  | **`PRUNED_SKIPPED`** | Upstream condition evaluates to `FALSE` (alternative branch chosen).             | Prunes this branch. Recursively marks exclusively downstream nodes `SKIPPED`.           |
| **`NOT_EVALUATED`**  | **`FAILED`**         | Upstream source node encountered a fatal unhandled error.                        | Marks branch failed; halts forward traversal.                                           |
| **`NOT_EVALUATED`**  | **`CANCELLED`**      | Parent `ApprovalRequest` is cancelled by requester or admin.                     | Halts branch traversal; marks branch cancelled.                                         |
| **`ACTIVE`**         | **`COMPLETED`**      | Branch processing finishes; control arrives at target join input.                | Sets `completedAt = NOW()`. Evaluates target join node readiness.                       |
| **`ACTIVE`**         | **`FAILED`**         | Node on active branch throws fatal error or database exception.                  | Halts branch; sets target join to `FAILED`; marks sibling active branches `CANCELLED`.  |
| **`ACTIVE`**         | **`CANCELLED`**      | Parent `ApprovalRequest` cancelled while branch is executing.                    | Marks branch cancelled; halts active approver steps.                                    |
| **`COMPLETED`**      | _None_               | Terminal state.                                                                  | Immutable within this review round.                                                     |
| **`PRUNED_SKIPPED`** | _None_               | Terminal state.                                                                  | Immutable within this review round.                                                     |
| **`FAILED`**         | _None_               | Terminal state.                                                                  | Halts workflow; requires admin investigation or restart.                                |
| **`CANCELLED`**      | _None_               | Terminal state.                                                                  | Immutable within this review round.                                                     |

### 7.2 Branch Evaluation, Condition Routing & Pruning Rules

1. **Eligibility for Evaluation**:
   - A branch $(u, v)$ becomes eligible for evaluation **only when its source node $u$ transitions to `COMPLETED`**.
   - If node $u$ is in `PENDING` or `IN_REVIEW`, all outgoing branches $(u, \cdot)$ **must strictly remain in `NOT_EVALUATED`**.
2. **Condition Evaluation**:
   - When a `CONDITION` node $u$ completes, the workflow engine evaluates its rule set against the frozen `ApprovalRequest.requestData` within the database transaction using the safe AST evaluator.
   - The matched branch key $k_{\text{match}}$ transitions from `NOT_EVALUATED` to `ACTIVE`.
   - All other outgoing branch keys $k \ne k_{\text{match}}$ transition from `NOT_EVALUATED` to `PRUNED_SKIPPED`.
3. **Recursive Downstream Pruning**:
   - When branch $(u, v)$ transitions to `PRUNED_SKIPPED`, the engine analyzes node $v$:
     - If node $v$ is a `JOIN` node with other incoming branches, the engine does **not** prune node $v$ immediately; node $v$ waits for remaining incoming branches to resolve.
     - If node $v$ is an intermediate step or condition, and **all** incoming paths to $v$ are `PRUNED_SKIPPED`, node $v$ transitions to `SKIPPED` (`NodeExecutionStatus`).
     - All outgoing branches $(v, w)$ from a skipped node $v$ recursively transition from `NOT_EVALUATED` to `PRUNED_SKIPPED`.

### 7.3 Join Node Synchronization Invariants & Failure Policies

```mermaid
flowchart TD
    classDef cond fill:#fef3c7,stroke:#b45309,stroke-width:2px;
    classDef join fill:#ede9fe,stroke:#6d28d9,stroke-width:2px;
    classDef path fill:#dcfce7,stroke:#15803d,stroke-width:2px;
    classDef pruned fill:#f1f5f9,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    C["Condition Node"]:::cond
    P1["Branch A (amount > 10k)<br/><b>ACTIVE / COMPLETED</b>"]:::path
    P2["Branch B (amount <= 10k)<br/><b>PRUNED_SKIPPED</b>"]:::pruned
    J["ALL_INCOMING Join Node<br/><b>Evaluates Resolved Paths</b>"]:::join

    C --> P1
    C -. "Pruned" .-> P2
    P1 --> J
    P2 -.-> J
```

#### A. `ALL_INCOMING` Join Readiness Invariant

Let $In(J) = \{b_1, b_2, \dots, b_m\}$ be the set of all incoming branches targeting join node $J$. Upon completion of any branch $b \in In(J)$, the engine queries:

```sql
SELECT status, count(*)
FROM workflow_branch_executions
WHERE approval_request_id = $requestId
  AND review_round = $currentRound
  AND target_node_id = $joinNodeId
GROUP BY status;
```

**The join node is ready to activate if and only if all four conditions hold:**

1. **Zero Unevaluated Branches**:
   $$\forall b \in In(J): b.\text{status} \ne \text{NOT\_EVALUATED}$$
2. **Zero Active Branches**:
   $$\forall b \in In(J): b.\text{status} \ne \text{ACTIVE}$$
3. **Conclusive Path Resolution**:
   $$\forall b \in In(J): b.\text{status} \in \{\text{COMPLETED}, \text{PRUNED\_SKIPPED}\}$$
4. **At Least One Non-Pruned Path**:
   $$\exists b \in In(J): b.\text{status} = \text{COMPLETED}$$

> [!CRITICAL]
> **Strict Unevaluated Path Invariant**: If **any** branch in $In(J)$ remains in `NOT_EVALUATED`, join readiness is **strictly false**. An unevaluated branch is **never** interpreted as skipped or bypassed. The join engine remains in `PENDING` and takes zero forward action until the upstream condition or source node has fully executed.

#### B. Upstream Failure & Cancellation Policy

- **Branch Failure (`FAILED`)**: If any incoming branch $b \in In(J)$ transitions to `FAILED`:
  - Join node $J$ immediately transitions to `FAILED`. It cannot advance.
  - The parent `ApprovalRequest` transitions to `FAILED` (or triggers administrator intervention).
  - Any remaining sibling active branches targeting $J$ are transitioned to `CANCELLED` to prevent orphaned execution.
- **Branch Cancellation (`CANCELLED`)**: If any incoming branch transitions to `CANCELLED` (due to request cancellation), join node $J$ transitions to `CANCELLED`.
- **All Branches Pruned Edge Case**: If $\forall b \in In(J): b.\text{status} = \text{PRUNED\_SKIPPED}$ (e.g. an upstream condition routed entirely around the join block):
  - Join node $J$ transitions to `SKIPPED`.
  - All outgoing branches from $J$ transition from `NOT_EVALUATED` to `PRUNED_SKIPPED`, propagating the bypass downstream.

#### C. `ANY_INCOMING` Join Readiness

- Advances immediately when the **first** incoming branch reaches `COMPLETED`.
- All other sibling branches in $In(J)$ that are still `ACTIVE` or `NOT_EVALUATED` are atomically transitioned to `PRUNED_SKIPPED`.

### 7.4 Concurrency Control, Database Row Locking & Uniqueness Constraints

When two parallel branches complete at the exact same millisecond, concurrent worker transactions compete to advance the join node. FlowGate guarantees strict atomicity and idempotency via a three-tier synchronization strategy:

```mermaid
sequenceDiagram
    autonumber
    participant W1 as Worker 1 (Branch A)
    participant DB as PostgreSQL Transaction & Locks
    participant W2 as Worker 2 (Branch B)

    Note over DB: Both Branches initially ACTIVE
    W1->>DB: BEGIN Transaction
    W2->>DB: BEGIN Transaction

    W1->>DB: SELECT * FROM workflow_node_executions WHERE node_id = $joinId FOR UPDATE
    Note over DB: W1 acquires row lock on Join Node
    W2->>DB: SELECT * FROM workflow_node_executions WHERE node_id = $joinId FOR UPDATE
    Note over DB: W2 BLOCKED waiting for W1 row lock

    W1->>DB: UPDATE workflow_branch_executions SET status = 'COMPLETED' WHERE branch_key = 'branch_a'
    W1->>DB: SELECT status, count(*) FROM workflow_branch_executions WHERE target_node_id = $joinId
    Note over W1: Branch A: COMPLETED, Branch B: ACTIVE.<br/>Join not ready!
    W1->>DB: COMMIT (Releases row lock)

    Note over DB: W2 unblocked; acquires row lock on Join Node
    W2->>DB: UPDATE workflow_branch_executions SET status = 'COMPLETED' WHERE branch_key = 'branch_b'
    W2->>DB: SELECT status, count(*) FROM workflow_branch_executions WHERE target_node_id = $joinId
    Note over W2: Branch A: COMPLETED, Branch B: COMPLETED.<br/>All branches resolved!
    W2->>DB: UPDATE workflow_node_executions SET status = 'COMPLETED' WHERE node_id = $joinId
    W2->>DB: INSERT INTO workflow_node_executions (node_id = $downstreamNodeId)
    W2->>DB: COMMIT (Releases row lock)
```

1. **Transactional Row Locking (`SELECT ... FOR UPDATE`)**:
   - Before evaluating join readiness, every completing branch transaction acquires an exclusive row lock on the target join's `WorkflowNodeExecution` record:
     ```sql
     SELECT * FROM workflow_node_executions
     WHERE approval_request_id = $requestId
       AND review_round = $currentRound
       AND node_id = $joinNodeId
     FOR UPDATE;
     ```
   - This strictly serializes join readiness evaluations for that request and review round.
2. **Deterministic Join Evaluation Under Lock**:
   - The first worker to acquire the lock marks its branch `COMPLETED` and counts incoming branch statuses. It observes that sibling branches are still `ACTIVE` or `NOT_EVALUATED`. It commits without advancing the join.
   - The subsequent worker acquires the lock, marks its branch `COMPLETED`, evaluates incoming branches, observes that 100% of incoming branches are now `{COMPLETED, PRUNED_SKIPPED}`, and advances the join node to `COMPLETED`.
3. **Database Uniqueness Constraints as the Ultimate Safety Net**:
   - `workflow_node_executions`: `@@unique([approvalRequestId, reviewRound, nodeId])`.
   - `workflow_branch_executions`: `@@unique([approvalRequestId, reviewRound, branchKey])`.
   - If an unexpected concurrency anomaly or retry should attempt to activate the downstream node a second time, the database-level uniqueness constraint on `(approval_request_id, review_round, node_id)` instantly rejects the insert with a unique constraint violation (`23505`), preventing duplicate downstream node activations.

---

## 8. Decision 4: Preserving Resubmission History (Review Rounds)

### 8.1 The Review Round Relational Model & Entity Relationships

When an approver requests changes, **previous approval decisions and comments are never overwritten or deleted**. FlowGate preserves chronological transparency using explicit, versioned Review Rounds (`reviewRound: 1..N`):

```mermaid
sequenceDiagram
    autonumber
    actor Requester
    actor Approver
    participant Engine as Workflow Engine
    participant DB as Database (Rounds 1 & 2)

    Note over DB: Review Round 1
    Requester->>Engine: Submit Request (Round 1)
    Approver->>Engine: Action: REQUEST_CHANGES ("Please attach PO invoice")
    Engine->>DB: ApprovalStepAssignee (Round 1: CHANGES_REQUESTED, comment: "Please attach PO...")
    Engine->>DB: ApprovalRequest status: CHANGES_REQUESTED (currentReviewRound: 1)

    Note over DB: Review Round 2 (Resubmission)
    Requester->>Engine: POST /requests/:id/resubmit (with PO attachment)
    Engine->>DB: UPDATE ApprovalRequest SET currentReviewRound = 2, status = 'IN_PROGRESS'
    Engine->>DB: INSERT ApprovalStep (Round 2: IN_REVIEW, approvedCount: 0)
    Engine->>DB: INSERT ApprovalStepAssignee (Round 2: PENDING)
    Engine->>DB: AuditLog (REQUEST_RESUBMITTED, metadata: { fromRound: 1, toRound: 2 })

    Approver->>Engine: Action: APPROVE ("Invoice looks good!")
    Engine->>DB: ApprovalStepAssignee (Round 2: APPROVED, comment: "Invoice looks good!")
    Engine->>DB: ApprovalStep (Round 2: APPROVED)
```

#### Exact Data Relationships

| Entity                        | Primary Key / Unique Keys                                  | Review Round Relationship & Guarantees                                                                                                                          |
| :---------------------------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ApprovalRequest`**         | `id` (UUID), `[tenantId, id]`                              | Stores `currentReviewRound` (Int, starts at 1, monotonically increments on each resubmission). Current workflow status reflects latest round.                   |
| **`ApprovalStep`**            | `id` (UUID), `[approvalRequestId, reviewRound, stepOrder]` | Explicitly bound to `reviewRound`. Counters (`approvedCount`, `rejectedCount`, `totalAssigned`, `requiredApprovals`) are fresh and independent per round.       |
| **`ApprovalStepAssignee`**    | `id` (UUID), `[stepId, assignedToId]`                      | Foreign key to `ApprovalStep`. Carries `reviewRound`. Records individual vote status, comments, timestamps, and delegation attribution for that round.          |
| **`WorkflowNodeExecution`**   | `id` (UUID), `[approvalRequestId, reviewRound, nodeId]`    | Tracks graph node execution state (`PENDING`, `IN_REVIEW`, `COMPLETED`, `SKIPPED`) independently per review round.                                              |
| **`WorkflowBranchExecution`** | `id` (UUID), `[approvalRequestId, reviewRound, branchKey]` | Tracks edge traversal state (`NOT_EVALUATED`, `ACTIVE`, `COMPLETED`, `PRUNED_SKIPPED`) independently per review round.                                          |
| **`AuditLog`**                | `id` (UUID), `[tenantId, id]`                              | Cryptographic hash-chained log. All lifecycle actions (`REQUEST_RESUBMITTED`, `STEP_APPROVED`, etc.) include `{ reviewRound: currentReviewRound }` in metadata. |

### 8.2 Immutable History Guarantees

1. **Zero Overwrite Guarantee**:
   - All `ApprovalStep` and `ApprovalStepAssignee` rows with `reviewRound = R` are frozen permanently upon transition to `CHANGES_REQUESTED`.
   - Subsequent rounds **never** update, modify, or delete records from prior rounds. Historical comments, rejection reasons, and vote timestamps remain immutably preserved in PostgreSQL.
2. **Independent Counters & Clean State**:
   - Every new round $R+1$ initializes fresh `ApprovalStep` records with `approvedCount = 0`, `rejectedCount = 0`, `deactivatedCount = 0`, and `status = 'IN_REVIEW'`.
   - Prior round counters do not bleed into subsequent rounds.
3. **Permanent Round Association**:
   - Old votes remain linked to their original round via `reviewRound = R`.
   - The UI and API can query `GET /requests/:id?includeHistory=true` to retrieve a complete chronological timeline partitioned by review rounds.

### 8.3 Policies for Carrying Forward vs. Reopening Assignments

Resubmission can follow one of two explicit policies configured at the workflow or step level:

#### Policy A: `REOPEN_ALL` (Default Policy for Compliance & Data Changes)

- **Rationale**: When a requester amends request data (e.g. changing purchase amount, modifying terms, or re-attaching documentation), prior approvals granted on the basis of outdated data are legally and procedurally invalid.
- **Execution**:
  - The workflow restarts from the initial entry approval node for Round $R+1$.
  - All assigned approvers across all stages must re-evaluate and cast new votes based on the updated payload.
  - Round $R$ step records remain frozen with their historical status (`APPROVED` or `CHANGES_REQUESTED`).

#### Policy B: `SELECTIVE_FAST_FORWARD` (Optional for Independent Stages)

- **Rationale**: In low-risk or decoupled workflows, requiring early approvers to re-sign when a late-stage reviewer asked for a minor attachment creates administrative friction.
- **Rules & Guardrails**:
  1. A step can only be carried forward if the workflow definition explicitly sets `fastForwardOnResubmit: true` for that node.
  2. **Data Dependency Guard**: If the fields modified in `ApprovalRequest.requestData` are referenced in the input schema or condition logic for that step, the engine **strictly forces `REOPEN_ALL`**, overriding the flag.
  3. **Fast-Forward Execution**:
     - The engine inserts a Round $R+1$ `ApprovalStep` pre-populated with `status: 'AUTO_APPROVED'` and `comments: 'Carried forward from Round R approval'`.
     - An audit log event `STEP_AUTO_ADVANCED_RESUBMISSION` is written to the cryptographic chain referencing the Round $R$ approval hash and step ID.
     - The engine immediately activates the subsequent node that originally requested changes.

### 8.4 Audit Events & Cryptographic Chain Continuity Across Rounds

1. **Review Round Metadata**:
   Every workflow event emitted to `audit_logs` includes explicit round context:
   ```json
   {
     "reviewRound": 2,
     "previousRound": 1,
     "stepId": "c4d3e2f1-0000-0000-0000-000000000002",
     "nodeId": "legal_review",
     "action": "STEP_APPROVED",
     "actorId": "u-legal-counsel-uuid",
     "resubmissionDeltas": {
       "amount": { "from": 12000, "to": 11500 },
       "contractAttachment": { "added": "PO-v2.pdf" }
     }
   }
   ```
2. **Unbroken Cryptographic Hash Chaining**:
   - The cryptographic SHA-256 audit chain operates sequentially across the entire tenant:
     $$H_i = \text{SHA256}(H_{i-1} \parallel \text{tenantId} \parallel \text{action} \parallel \text{entityType} \parallel \text{entityId} \parallel \text{metadata} \parallel \text{timestamp})$$
   - Because $H_i$ depends strictly on $H_{i-1}$, the resubmission event (`REQUEST_RESUBMITTED`) cryptographically seals the final state of Round 1 before the first event of Round 2 is recorded.
   - An auditor running `AuditService.verifyChain(tenantId)` validates the single continuous chain across all review rounds without gaps, forks, or signature resets.

---

## 9. Request-Data Contracts & Pure AST Condition Engine

### 9.1 Declarative Input Schema (`inputSchema`)

Workflow authors define the expected request payload structure in the `TRIGGER` node configuration:

```json
{
  "fields": [
    {
      "name": "amount",
      "label": "Purchase Amount (USD)",
      "type": "NUMBER",
      "required": true,
      "minimum": 0,
      "maximum": 5000000
    },
    {
      "name": "department",
      "label": "Department",
      "type": "STRING",
      "required": true,
      "allowedValues": ["ENGINEERING", "PRODUCT", "MARKETING", "LEGAL", "FINANCE"]
    },
    {
      "name": "isCapEx",
      "label": "Capital Expenditure",
      "type": "BOOLEAN",
      "defaultValue": false
    }
  ]
}
```

### 9.2 Validation & Immutability Rules

- **Server-Side Enforcement**: `POST /api/v1/requests` validates `requestData` against `inputSchema`:
  - Enforces type matching (`STRING`, `NUMBER`, `BOOLEAN`).
  - Enforces range limits (`minimum`, `maximum`) and enumeration allowlists (`allowedValues`).
  - Rejects unknown fields (`forbidNonWhitelisted: true`).
  - Limits: Maximum payload size 32 KB; maximum nesting depth 2 levels.
- **Immutability Guarantee**: Once written to `approval_requests.requestData`, payload data is immutable. Resubmissions (`RESUBMIT` action) require explicit audit logging of field-level deltas.

### 9.3 Pure AST Condition Evaluator (Zero-Eval Engine)

Condition evaluation is executed by a pure functional, strongly typed AST evaluator. Dynamic string evaluation (`eval`, `Function`, `vm`) is strictly prohibited.

#### Operator Allowlist

- **Numeric**: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `BETWEEN`.
- **String**: `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IN`, `NOT_IN`.
- **Boolean**: `IS_TRUE`, `IS_FALSE`.
- **Compound**: `AND`, `OR`, `NOT` (maximum nesting depth: 5).

---

## 10. Audit Chaining, Transactional Outbox & Failure Guarantees

### 10.1 Single-Transaction Boundary

Every node transition, approval recording, parallel vote update, outbox job dispatch, and audit log write executes within a single PostgreSQL ACID transaction:

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Lock stage row
  const step = await tx.approvalStep.findUnique({ where: { id }, forUpdate: true });

  // 2. Update assignee vote & stage aggregations
  await tx.approvalStepAssignee.update({ ... });
  await tx.approvalStep.update({ ... });

  // 3. Evaluate outgoing edges & activate next node
  const nextNode = this.resolveNextNode(graph, step);
  if (nextNode) {
    await tx.approvalStep.create({ ... });
  }

  // 4. Atomically enqueue outbox event for notifications/webhooks
  await this.outboxService.createEvent(tx, {
    tenantId,
    eventType: OUTBOX_EVENT_NOTIFICATION,
    entityType: 'ApprovalStep',
    entityId: step.id,
    idempotencyKey: `step_${step.id}_action_${Date.now()}`,
    payload: { ... },
  });

  // 5. Serialize into cryptographic SHA-256 audit chain
  await this.auditService.log({
    tenantId,
    actorId: userId,
    action: 'STEP_APPROVED',
    entityType: 'ApprovalStep',
    entityId: step.id,
    metadata: { ... },
  }, tx);
});
```

---

## 11. Explicit Measurable Acceptance Criteria

To declare Milestone 6 complete, the implementation must pass the following verifiable criteria across automated tests:

### 11.1 Backward Compatibility

- [ ] All 207 existing automated tests pass with zero modification.
- [ ] Existing linear workflows execute sequentially without requiring DAG migration.
- [ ] Historical requests retain their immutable `workflowVersion` and `workflowSnapshot`.

### 11.2 Immutable Versioning

- [ ] Publishing a workflow sets `status: 'ACTIVE'`, increments version, and freezes configuration.
- [ ] Editing an active workflow automatically spawns a new `DRAFT` row; active workflow is not mutated.
- [ ] When a new workflow version is published, in-flight requests continue executing against their original snapshot.

### 11.3 Parallel Approvals & Reachability Invariants

- [ ] Under `PARALLEL_AND`, all assignees must approve; a single rejection terminates the stage and request.
- [ ] Under `PARALLEL_OR` (`SOFT_REJECTION`), an individual rejection does not terminate the stage; exactly one approval satisfies the quorum and marks sibling assignees `SKIPPED`.
- [ ] Under `PARALLEL_OR` (`STRICT_VETO`), a single rejection immediately vetoes the stage.
- [ ] When rejections or deactivations make it mathematically impossible to satisfy `requiredApprovals`, the stage immediately terminates with reason `"THRESHOLD_UNREACHABLE"`.
- [ ] 10 simultaneous approvals fired in parallel (`Promise.all`) on a `PARALLEL_OR` stage result in exactly 1 stage completion and 9 clean conflict handlings with zero duplicate activations or deadlocks.

### 11.4 Normalized Graph Branch Execution & Join Recovery

- [ ] Branch execution states (`NOT_EVALUATED`, `ACTIVE`, `COMPLETED`, `PRUNED_SKIPPED`, `FAILED`, `CANCELLED`) are persisted in `workflow_branch_executions`.
- [ ] Branches pruned by an upstream `CONDITION` node are marked `PRUNED_SKIPPED` and do not block downstream `ALL_INCOMING` joins.
- [ ] `ALL_INCOMING` joins correctly synchronize converging parallel paths, advancing only when all non-skipped branches are completed.
- [ ] Simulated server crashes during step activation or branch transition recover cleanly from PostgreSQL on application restart.

### 11.5 Resubmission & Review Round History

- [ ] Submitting `REQUEST_CHANGES` freezes Round 1 votes and comments permanently.
- [ ] Resubmitting increments `ApprovalRequest.currentReviewRound` and creates Round 2 records with reset counters.
- [ ] Historical votes for Round 1 remain visible in the audit inspector alongside Round 2 votes.
- [ ] The cryptographic audit hash chain links all events across rounds without broken hashes.

### 11.6 Delegation Security & Privilege Boundaries

- [ ] Delegation does not grant general RBAC privileges (e.g. delegate cannot manage tenant settings or access admin endpoints).
- [ ] Delegate can approve direct assignments and role assignments (when `delegateRoles: true`).
- [ ] If delegator loses their required role, role-based delegation attempts are immediately rejected (`403 Forbidden`).
- [ ] Expired delegations (`endDate < NOW()`) are strictly rejected.
- [ ] Cross-tenant delegations and circular delegations ($A \rightarrow B \rightarrow A$) are strictly blocked.
- [ ] Audit logs and step records attribute both the acting delegatee and the delegator.

### 11.7 Quality Gates & Documentation

- [ ] Monorepo passes `pnpm check-types` with 0 TypeScript errors.
- [ ] Monorepo passes `pnpm lint` with 0 warnings or errors.
- [ ] Monorepo passes `pnpm format:check` with 100% Prettier compliance.
- [ ] Production build (`pnpm build`) succeeds cleanly for Next.js 14 and NestJS.
- [ ] `DEVELOPMENT_LOG.md` is updated with complete milestone changelog.

### 11.8 Measurable Integration & Failure Scenario Acceptance Tests

To guarantee total reliability, the automated test suite must execute and verify the following explicit end-to-end integration test scenarios:

#### Test 1: Unevaluated Incoming Branch Blocking an `ALL_INCOMING` Join

- **Graph Topology**: Fork node creates Branch A (Sequential Approval Node 1) and Branch B (Sequential Approval Node 2), converging on an `ALL_INCOMING` Join Node J.
- **Initial State**: Branch A and Branch B are initialized in `NOT_EVALUATED`.
- **Step Execution**: Node 1 is activated (`Branch A` -> `ACTIVE`). Node 2 remains pending (`Branch B` -> `NOT_EVALUATED`).
- **Trigger**: Node 1 completes approval (`Branch A` -> `COMPLETED`).
- **Verifiable Assertions**:
  1. Join Node J remains in `PENDING` (`status = PENDING`).
  2. Downstream node following Join Node J has **zero** records in `workflow_node_executions`.
  3. `workflow_branch_executions` confirms Branch B is `NOT_EVALUATED` (not mistaken for `PRUNED_SKIPPED`).
  4. System takes zero forward action until Node 2 finishes.

#### Test 2: Simultaneous Branch Completion Without Duplicate Downstream Activation

- **Graph Topology**: Two parallel branches (Branch A and Branch B) converging on Join Node J, followed by Sequential Approval Node 3.
- **Trigger**: Fire simultaneous approval completions on Branch A and Branch B concurrently using `Promise.all([approveBranchA(), approveBranchB()])`.
- **Verifiable Assertions**:
  1. Both worker transactions commit with HTTP `200 OK`.
  2. Join Node J execution row transitions to `COMPLETED` exactly once.
  3. Exactly **one** `WorkflowNodeExecution` record and **one** `ApprovalStep` record are created for Node 3.
  4. Database unique constraint `@@unique([approvalRequestId, reviewRound, nodeId])` guarantees zero duplicate activations or deadlocks under concurrent execution.

#### Test 3: Quorum Loss with Different Approval Thresholds

- **Subtest 3A (`PARALLEL_AND`, 3 assigned, 3 required)**:
  - Approver 1 approves; Approver 2 rejects.
  - Evaluation: $\text{maxAchievableApprovals} = 1 + 1 = 2 < 3$.
  - Assert: Stage and request immediately transition to `REJECTED` (`QUORUM_LOST`). Approver 3 is marked `SKIPPED`.
- **Subtest 3B (`PARALLEL_OR` `SOFT_REJECTION`, 3 assigned, threshold $K = 2$)**:
  - Approver 1 rejects; stage remains `IN_REVIEW` ($\text{maxAchievableApprovals} = 2 \ge 2$).
  - Approver 2 rejects; $\text{maxAchievableApprovals} = 0 + 1 = 1 < 2$.
  - Assert: Stage and request immediately transition to `REJECTED` (`QUORUM_LOST`). Approver 3 is marked `SKIPPED`.
- **Subtest 3C (`PARALLEL_OR` `STRICT_VETO`, 3 assigned, 1 required)**:
  - Approver 1 rejects.
  - Assert: Single rejection immediately triggers veto. Stage and request transition to `REJECTED` (`VETOED`). Remaining approvers marked `SKIPPED`.

#### Test 4: Duplicate Assignment Deduplication & Atomicity

- **Setup**: Stage configured with direct assignees User A, User B, and Role `FINANCE` (where Role `FINANCE` contains User A and User C).
- **Execution**: Create approval request targeting this stage.
- **Verifiable Assertions**:
  1. `ApprovalStep.totalAssigned` equals exactly 3 (User A, User B, User C).
  2. Exactly 3 distinct `ApprovalStepAssignee` records are created.
  3. Submitting an approval as User A updates User A's single record and increments `approvedCount` by exactly 1.
  4. User A cannot submit a second approval under the `FINANCE` role seat.

#### Test 5: Approver Deactivation During an Active Stage

- **Setup**: Stage with `totalAssigned = 3, requiredApprovals = 3` (`PARALLEL_AND`). User 1 approved, User 2 and User 3 pending.
- **Trigger**: Tenant admin calls `PATCH /api/v1/users/:id` to deactivate User 3 (`status = 'DEACTIVATED'`).
- **Verifiable Assertions**:
  1. User 3's pending assignment is updated to `status: 'SKIPPED'` (`comments: 'Assignee account deactivated'`).
  2. Reachability invariant re-evaluates: $\text{maxAchievableApprovals} = 1 + 1 = 2 < 3$.
  3. Stage and request transition immediately to `REJECTED` (`QUORUM_LOST`).
  4. User 2 is marked `SKIPPED`. Engine does not wait indefinitely for impossible quorum.

#### Test 6: Resubmission Preserving All Previous Decisions & Comments

- **Setup**: Request submitted (Round 1). Approver 1 approves; Approver 2 requests changes with comment `"Attach vendor quote"`.
- **Trigger**: Requester calls `POST /api/v1/requests/:id/resubmit` with updated JSON payload.
- **Verifiable Assertions**:
  1. `ApprovalRequest.currentReviewRound` equals 2.
  2. Round 1 records remain immutable: Step 1 retains `CHANGES_REQUESTED` and Approver 2's comment `"Attach vendor quote"`.
  3. Round 2 records are instantiated with `reviewRound = 2`, `status = 'IN_REVIEW'`, `approvedCount = 0`, `rejectedCount = 0`.
  4. Querying historical steps returns both Round 1 and Round 2 records without data loss or overwrites.

#### Test 7: Audit-Chain Verification Across Multiple Review Rounds

- **Setup**: Run complete lifecycle through Round 1 (`SUBMIT` -> `APPROVE` -> `REQUEST_CHANGES`) and Round 2 (`RESUBMIT` -> `APPROVE` -> `APPROVED`).
- **Trigger**: Execute `AuditService.verifyChain(tenantId)`.
- **Verifiable Assertions**:
  1. `verifyChain()` returns `{ verified: true, chainLength: N }`.
  2. Every log record from Round 1 and Round 2 satisfies $H_i = \text{SHA256}(H_{i-1} \parallel \dots)$.
  3. Resubmission event (`REQUEST_RESUBMITTED`) cryptographically binds Round 1 state to Round 2 start with zero chain breakage or forks.

---

## 12. Dependency-Aware Implementation Sequence

```mermaid
flowchart LR
    P1["Phase 6.1<br/>Schema, Normalized Records & AST Evaluator"] --> P2["Phase 6.2<br/>DAG Traversal & Parallel Engine"]
    P2 --> P3["Phase 6.3<br/>Review Rounds & Delegation Engine"]
    P3 --> P4["Phase 6.4<br/>REST APIs & Publishing Controls"]
    P4 --> P5["Phase 6.5<br/>Visual Workflow Builder"]
    P5 --> P6["Phase 6.6<br/>Interactive Audit Inspector"]
    P6 --> P7["Phase 6.7<br/>E2E Hardening & Acceptance"]
```

---

## 13. Unresolved Decisions Status

**All previously open design questions have been conclusively resolved with full mathematical and relational specifications:**

1. **Branch Execution States & Join Readiness Lifecycle**: Conclusively resolved. Explicit 6-state lifecycle (`NOT_EVALUATED`, `ACTIVE`, `COMPLETED`, `PRUNED_SKIPPED`, `FAILED`, `CANCELLED`), strict transition matrix, recursive pruning, unevaluated branch blocking, upstream failure policy, and row locking (`FOR UPDATE`) with database uniqueness constraints.
2. **Parallel Approval Reachability & Quorum Loss**: Conclusively resolved. Explicit formulas for `totalAssigned`, `requiredApprovals`, `approvedCount`, `rejectedCount`, `deactivatedCount`, and `pendingEligibleCount`. Mathematical reachability invariant immediately triggers `QUORUM_LOST` when $\text{maxAchievableApprovals} < \text{requiredApprovals}$, preventing engine stalls across all 6 edge cases.
3. **Resubmission History & Carry-Forward Policies**: Conclusively resolved. Versioned review rounds (`reviewRound: 1..N`) with composite unique keys ensure zero overwrites. Explicit `REOPEN_ALL` default and `SELECTIVE_FAST_FORWARD` policies documented with continuous cryptographic audit hash chaining.
4. **Final Acceptance Test Suites**: Conclusively resolved. 7 explicit, measurable integration and failure scenario tests defined with preconditions, triggers, DB assertions, and negative invariants.

**There are zero remaining unresolved architectural decisions.** The specification is 100% complete and ready for Phase 6.1 implementation upon user authorization.

---

_End of FlowGate Milestone 6 Technical Specification_

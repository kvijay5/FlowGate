# Security Policy

## Reporting Security Issues

FlowGate is designed for mission-critical enterprise approval workflows. We treat security vulnerabilities with paramount urgency.

If you believe you have discovered a security vulnerability in FlowGate, **please do not disclose it publicly or open a public GitHub issue.** Instead, please follow our responsible disclosure process:

1. **Email Vulnerability Details**: Send a detailed advisory to `security@flowgate.dev` (or the project maintainer).
2. **Include Reproduction Steps**: Provide a minimal reproducible example, proof of concept, impacted version, and assessment of potential impact.
3. **Response SLA**:
   - Initial confirmation of receipt: within **24 hours**.
   - Vulnerability assessment & reproduction: within **72 hours**.
   - Remediation patch and advisory publication: within **7 calendar days**.

---

## Security Architecture & Invariants

FlowGate enforces multi-layered defense-in-depth across the application and data layers:

### 1. Multi-Tenant Cryptographic & Row Isolation

- Every tenant-scoped entity in PostgreSQL is constrained with physical composite primary and foreign keys: `[tenant_id, id]`.
- Cross-tenant queries are blocked at the relational engine level. A user in Tenant $A$ cannot query, reference, or mutate approval requests, workflow definitions, steps, assignees, or delegations belonging to Tenant $B$.

### 2. Tamper-Evident SHA-256 Audit Chain

- Every state transition, approval action, delegation, and parameter modification is recorded in an immutable, append-only hash chain.
- Each `AuditLog` record contains:
  $$\text{hash}_n = \text{SHA-256}(\text{hash}_{n-1} \parallel \text{sequenceNumber} \parallel \text{action} \parallel \text{entityId} \parallel \text{payload})$$
- The ledger integrity can be validated at any time via `GET /api/v1/audit/verify`. Any out-of-band database update or deletion breaks the sequence contiguity and hash verification immediately.

### 3. Zero-`eval()` Safe AST Condition Evaluator

- Workflow branching conditions evaluate dynamic, user-submitted request data (e.g. `amount > 50000`, `department == 'FINANCE'`).
- Under no circumstances does FlowGate use JavaScript `eval()`, `new Function()`, or dynamic code execution.
- Condition expressions are parsed into a strictly typed Abstract Syntax Tree (`AstNode`) containing only safe literals, property lookups, logical operators (`AND`, `OR`, `NOT`), and comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`).
- Payload depth is bounded ($\le 8$ levels), payload byte size is capped ($\le 64\text{ KB}$), and evaluation execution is deterministic and memory-bounded.

### 4. Server-Side Request Forgery (SSRF) Defense

- All outbound webhook dispatches to customer URLs are routed through `SsrfGuard`.
- Destination URLs are resolved via DNS pre-flight checks, IP-pinned, and filtered against:
  - Loopback addresses (`127.0.0.0/8`, `::1`).
  - RFC 1918 private IPv4 spaces (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Link-local and cloud metadata addresses (`169.254.169.254`, `fe80::/10`).
  - Non-standard protocols (only `https://` is permitted in production).

### 5. Transactional Outbox Pattern & Background Workers

- Asynchronous notifications and outbound webhooks are committed atomically to PostgreSQL within the primary business transaction via the Transactional Outbox pattern.
- Redis and BullMQ manage asynchronous queues with exponential backoff and dead-letter queue isolation, ensuring zero duplicate dispatches and at-least-once guaranteed delivery.

---

## Supported Versions

| Version                   | Supported      |
| ------------------------- | -------------- |
| `v0.1.x` (Current `main`) | ✅ Supported   |
| `< v0.1.0`                | ❌ End of Life |

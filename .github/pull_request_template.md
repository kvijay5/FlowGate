## Description

Brief summary of the changes introduced in this pull request and context for reviewers.

---

## Type of Change

- [ ] `feat`: New feature or capability
- [ ] `fix`: Bug fix
- [ ] `refactor`: Code refactoring without behavior change
- [ ] `perf`: Performance optimization
- [ ] `test`: Adding or updating test suites
- [ ] `docs`: Documentation updates
- [ ] `chore`: Build, dependency, or configuration maintenance

---

## Architectural Checklist & Invariants

- [ ] **Tenant Isolation**: All database queries explicitly filter by `tenantId`.
- [ ] **Zero-`eval()` Security**: Condition evaluation uses pure AST evaluation.
- [ ] **Audit Trail**: State transitions record cryptographic SHA-256 audit logs.
- [ ] **Dual-Actor Attribution**: Delegated actions preserve `actionedBy` and `delegatedFrom`.
- [ ] **DTO Validation**: All new endpoints use `class-validator` DTOs with `whitelist: true`.

---

## Verification & Quality Gates

Run and verify the following commands before requesting review:

- [ ] `pnpm check-types` (0 errors)
- [ ] `pnpm lint` (0 errors, 0 warnings)
- [ ] `pnpm format:check` (100% Prettier compliant)
- [ ] `pnpm test` (All unit tests pass)
- [ ] `pnpm test:e2e` (All E2E/integration tests pass against PostgreSQL & Redis)
- [ ] `pnpm build` (All monorepo packages compile cleanly)

---

## Related Issues / Milestones

Closes # (issue number)

# AGENTS.md — CHB BÁNH CHƯNG TẾT 2027

## 1. MISSION

Build and maintain the CHB Bánh Chưng Tết 2027 internal web app.

The app replaces Excel/Zalo for the campaign and must reliably manage:

**Sales → Orders → Customers → Inventory → Transfers → Production → Payments → Delivery → Commission → Reports**

This is a business-critical internal operations system. Prioritize **data integrity, traceability, simple UX, and predictable behavior** over cleverness.

---

## 2. READ THIS FIRST

Before changing code, read the relevant project documents in this order:

1. `docs/product/PRD_UIUX_v1.1.md`
2. `docs/architecture/TECH_DESIGN_v1.0.md`
3. `docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md`
4. The active task/ExecPlan under `docs/exec-plans/active/`, if one exists.

Responsibilities:

- **PRD/UIUX** = product behavior and user experience.
- **TECH_DESIGN** = database, state machines, permissions, service boundaries, technical invariants.
- **IMPLEMENTATION_PLAN** = task IDs, dependencies, infrastructure, tests and release process.
- **AGENTS.md** = how an AI coding agent must work in this repository.

If documents appear to conflict:

1. Do not silently invent a new rule.
2. Prefer the document responsible for that concern.
3. Preserve already-approved business rules.
4. Record the conflict in the task summary and request a decision only if implementation is genuinely blocked.

---

## 3. WORK BY TASK ID

Implement one scoped task at a time.

Examples: `ORD-005`, `INV-004`, `PAY-007`, `DEL-006`.

Before coding:

1. Locate the task in the implementation plan.
2. Check dependencies.
3. Read related PRD/Tech Design sections.
4. Inspect the existing implementation.
5. Identify files likely to change.
6. Identify required tests.

Do not bundle unrelated features into the same change.

For complex work spanning multiple modules, migrations, or significant refactors, create/update:

`docs/exec-plans/active/<TASK-ID>-<short-name>.md`

Move completed plans to:

`docs/exec-plans/completed/`

---

## 4. NON-NEGOTIABLE BUSINESS INVARIANTS

### Orders

- Confirmed orders cannot have item quantities edited.
- Quantity change after confirmation = cancel old order + create new order.
- Transaction records are never hard-deleted.
- “Delete” in the UI means void/soft-delete with reason + audit.
- One order may contain multiple deliveries.
- Delivery quantities may not exceed ordered quantities.

### Pricing and commission

- Money is stored as integer VND. Never use floating-point money.
- Gross sales = list price × quantity.
- Customer discount cannot exceed the salesperson’s base commission ceiling for the order.
- Commission becomes eligible only when the order is completed and remaining amount is zero.
- Returns reduce revenue/commission according to approved rules.

### Inventory

- Negative inventory is forbidden.
- `inventory_movements` is the inventory source of truth.
- `inventory_balances` is derived/cache data only.
- Client code must never directly mutate inventory balances.
- Every stock change must create a traceable movement.
- Manual adjustment requires Admin permission + reason + audit.
- Safety stock is defined per Location × SKU.
- FEFO is the default allocation rule.
- Sales users do not manually choose batches.
- Franchise locations are internal inventory locations for this campaign.
- Transfer to franchise is not revenue.

### Reservations

- Temporary reservation TTL is configurable.
- Expired temporary reservations release automatically.
- Future confirmed demand and physical inventory allocation are separate concepts.
- Physical allocation follows configurable allocation lead time.

### Returns

- Returned stock goes to `Pending Inspection`.
- Returned stock does not become sellable immediately.
- Inspection decides Restock vs Damaged.
- Exchange = return old item + new outbound item; do not rewrite original transaction history.

### Payments

- Payment processing must be idempotent.
- Duplicate SePay/webhook events must never double-credit an order.
- Provider transaction/reference IDs must be deduplicated.
- Secrets must never be exposed to browser code.

---

## 5. STATE MACHINES ARE AUTHORITATIVE

Do not set statuses arbitrarily from React components.

Order, Delivery, Transfer, Production, Payment, Return, and Commission transitions must follow:

`docs/architecture/TECH_DESIGN_v1.0.md`

Transitions should occur through domain/service/RPC logic that validates:

- current state,
- requested next state,
- permission,
- business preconditions,
- side effects,
- audit requirements.

If adding a status is necessary, update the specification and tests before relying on it.

---

## 6. ARCHITECTURE RULES

### Frontend

Use feature-oriented modules.

React components should focus on:

- presentation,
- local interaction,
- invoking typed application services/hooks.

Do not place critical business rules directly inside page/component event handlers.

Prefer pure domain functions for calculations and transition rules.

Reuse shared components for status, money, date/time, alerts, dialogs, tables, forms and standard loading/empty/error states.

Do not introduce a major UI framework or state-management library without a clear need and explicit project decision.

### Backend / Supabase

Database changes must be migration-driven.

Never make an untracked production-only schema change.

Critical multi-step operations should be atomic through PostgreSQL transaction/RPC or trusted server/Edge Function logic.

Examples:

- create order,
- allocate stock,
- dispatch delivery,
- approve transfer,
- complete production,
- confirm payment,
- process return inspection.

RLS is part of feature implementation, not a cleanup task for later.

### Generated database types

If Supabase/Postgres TypeScript types are generated, regenerate them after relevant schema changes and commit the result.

---

## 7. SECURITY RULES

- Never commit `.env*` secrets.
- Never expose Supabase service-role/server secrets in browser code.
- Never expose SePay/HMAC secrets to client bundles.
- Use environment separation: Local / Staging / Production.
- Production data must not be used as casual test data.
- Validate webhook authentication.
- Audit sensitive Admin actions.
- Apply least-privilege RLS policies.
- Do not weaken RLS just to make a test pass.

Fix permission boundaries correctly instead of bypassing security.

---

## 8. UX RULES

The application must feel simpler than an ERP.

User-facing Vietnamese must be clear, natural and fully accented.

### Sales/store users

Optimize for:

1. Customer
2. Product
3. Quantity
4. Delivery
5. Deposit/QR
6. Save

Use profile defaults to avoid repetitive input.

Do not expose Batch/FEFO complexity unless the role needs it.

### Errors

Prefer actionable language.

Good:

> Kho này không đủ hàng có thể bán. Hệ thống đề xuất chuyển 30 bánh từ VP Minh Khai.

Bad:

> Insufficient allocatable inventory.

### Destructive actions

Do not use generic “Bạn có chắc không?” dialogs.

Explain the consequence.

Example:

> Vô hiệu hóa đơn #TET-1020? Hàng đang giữ sẽ được giải phóng và thao tác sẽ được lưu Audit Log.

Every data screen must support:

- loading,
- empty,
- error,
- no-permission states.

Mobile behavior must be considered for all sales/store workflows.

---

## 9. CODE STYLE

- TypeScript strict mode.
- Prefer explicit types at service/domain boundaries.
- Code identifiers: English.
- User-facing copy: Vietnamese.
- Comments: concise and useful.
- Keep functions testable.
- Avoid duplicate calculation logic across UI and backend.
- Centralize money/date/status formatting.
- Avoid magic numbers; use settings/constants.
- Do not refactor unrelated modules during a scoped task.

---

## 10. DATABASE CHANGE RULES

Every schema change requires a migration under:

`supabase/migrations/`

Typical workflow:

```bash
npx supabase migration new <name>
npx supabase db reset
```

A local reset must reconstruct the database from migrations + seed.

Never rely on manually configured local state.

For production:

- review migration,
- dry-run where supported,
- confirm backup,
- apply through the approved release process.

Never run destructive reset commands against the linked production project.

---

## 11. TESTING REQUIREMENTS

### Unit tests

Required for pure business logic such as:

- pricing,
- discount ceiling,
- commission,
- production need,
- stock forecast,
- state transition validation.

### Integration tests

Required for critical database flows:

- create order,
- reserve inventory,
- FEFO allocation,
- no-negative inventory,
- confirm payment,
- transfer,
- production completion,
- return inspection.

### E2E

Minimum critical path:

```text
Login
→ Customer
→ Order
→ Deposit
→ Allocation
→ Delivery
→ Full payment
→ Completed
→ Commission eligible
```

### Concurrency

Inventory must have a test where two processes attempt to consume the last available stock.

---

## 12. REQUIRED CHECKS BEFORE MARKING A TASK DONE

Run all checks that exist in the repository.

Baseline target:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx supabase db reset
```

If additional integration/E2E commands exist, run those relevant to the task.

Do not claim success if a required check failed.

If a check cannot run:

1. State exactly which check was not run.
2. State why.
3. Do not mark it as passed.

---

## 13. DEFINITION OF DONE

A task is Done only when applicable requirements are satisfied:

- implementation complete,
- acceptance criteria met,
- permission/RLS correct,
- loading state handled,
- empty state handled,
- error state handled,
- audit added where required,
- migrations included where required,
- tests added/updated,
- lint passes,
- typecheck passes,
- tests pass,
- build passes,
- local DB reset succeeds,
- mobile impact checked,
- staging verification completed when appropriate.

---

## 14. CHANGE DISCIPLINE

Before editing:

- inspect current files,
- understand existing patterns,
- preserve working behavior outside the task.

While editing:

- keep changes scoped,
- avoid speculative abstractions,
- do not rewrite modules only for style.

After editing:

- review diff,
- verify no secrets,
- verify no unrelated changes,
- run checks,
- summarize what changed.

---

## 15. TASK REPORT FORMAT

At the end of an implementation task, report:

```text
Task: <TASK-ID>

Implemented:
- ...

Files changed:
- ...

Database:
- migrations/RPC/RLS changed or “none”

Tests:
- ...

Validation:
- lint: pass/fail/not run
- typecheck: pass/fail/not run
- tests: pass/fail/not run
- build: pass/fail/not run
- db reset: pass/fail/not run

Notes / risks:
- ...
```

Do not say “done” if required validation has not passed.

---

## 16. DO NOT DO THESE THINGS

- Do not invent business rules not present in approved specs.
- Do not hard-delete business transactions.
- Do not directly mutate inventory balances from the client.
- Do not permit negative stock.
- Do not bypass RLS using client-side secrets.
- Do not put service-role credentials in `VITE_*`.
- Do not process a payment webhook twice.
- Do not let a React component become the source of truth for business state.
- Do not change confirmed order quantities.
- Do not merge unrelated refactors into feature tasks.
- Do not claim tests passed without running them.
- Do not use production as a testing sandbox.

---

## 17. PROJECT SUCCESS CRITERIA

The system succeeds when CHB can operate the Tết bánh chưng campaign without parallel Excel/Zalo order management and can reliably answer:

- What was sold?
- Who sold it?
- Which channel/source generated it?
- What stock is available and where?
- What is reserved?
- What needs transfer?
- What needs production?
- What must be delivered today/tomorrow/next 7 days?
- What has been paid?
- What commission is owed?
- What changed, by whom, and when?

When uncertain, protect **inventory integrity, payment integrity, auditability, and approved business rules** first.

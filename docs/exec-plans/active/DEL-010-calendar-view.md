# DEL-010 — Delivery Calendar View

Task owner: Codex fallback in the isolated `codex-cus-006` worktree. Claude's TRF-001 attempt, session and write scopes remain reserved in the root workspace.

## Scope and dependencies

PRD §17 calls for today, tomorrow, seven days and a Calendar View with time, customer, order, address, SKU, quantity, source, owner, status and remaining payment. TECH_DESIGN §25 shows the delivery calendar as an operating screen. E07's `DEL-007..009` schedule board, schedule service and delivery actions already exist in this worktree. This task adds a month grid to that board and reuses the existing detailed delivery cards for the selected day. It changes no schema, RPC, service contract, app route or TRF-001 scope.

Write scopes: `src/features/deliveries/pages/DeliveryBoardPage.tsx`, `src/features/deliveries/components/DeliveryCalendarView.tsx`, `src/domain/deliveries/calendar.ts`, `tests/unit/domain/delivery-calendar.test.ts`, this plan.

## Implementation

- Use Vietnam's business date to initialize the month. Query the first through last day of the chosen calendar month; keep the three existing quick views unchanged.
- Show a Monday-first month grid with a day count and stock-risk cue. Users can move a month back/forward or return to the current month. Selecting a date shows that day's existing detailed cards and actions, preserving all operational fields.
- Keep loading/error/no-permission behavior on the board. The empty month still shows the calendar and an actionable selected-day empty state. Day controls are keyboard buttons with accessible labels and touch height; a narrow phone may scroll the grid horizontally.
- Keep date math pure and test leap years, year boundaries and Monday alignment.

## Validation and pending acceptance

Run the shared `task:finish` pipeline. This detached historical worktree lacks the root TRF-001/RES-005 migrations; DB reset and DB-backed suites must be reported `not_run` to avoid resetting the shared local DB to an older schema. Existing repository-wide format failures and browser/mobile/staging acceptance remain pending, so do not mark Done solely from local lint/typecheck/unit/build.

Implementation evidence: the board now queries exact calendar-month bounds, displays a Monday-first grid with count and stock-risk indicators, and reuses the selected day's delivery cards/actions. The pure date helper has leap-year, year-rollover and weekday-alignment tests. Before task:finish, scoped lint, typecheck and the calendar unit tests passed; scoped Prettier and the pipeline remain to verify the final source.

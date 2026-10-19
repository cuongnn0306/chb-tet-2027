# SEC-005 — Payment review payload guard and narrow-screen wrapping

## Dependency and scope

Implementation plan SEC-005 input validation, existing E01 Admin route/permissions and E06
payment services are the foundation. Parent b1bb1c5 contains reviewed delivery/allocation,
pipeline correction, catalog RLS guard and immutable payment-decision audit. Updated develop
does not contain this foundation. No unfinished Claude scope or dirty-primary source taken.

Three closed-lane files copied from sec005-committed-base after LF SHA-256 verification
against SEC-005-2026-10-06T15-03-57-125Z. All target paths unchanged from 2df547e to parent:

- `src/domain/payments/review-payload.ts`:
  af68a64b6e1198204459581fe310fc46bbc6ae1b78215dbf857837c7e3fe8e2a.
- `src/features/payments/pages/PaymentReviewPage.tsx`:
  42b0efa9b978888c7aed866413f403931aceefa1817831a479a71216559a7e2e.
- `tests/unit/domain/payment-review-payload.test.ts`:
  6790f459fdc4053efc548afe09cf65b25cced70b60fc21f8aee0c309e6006c0b.

Pure parser normalizes unknown JSON, invalid amounts and non-string text. Amount bounds
match webhook validation: positive integer VND, maximum 9,999,999,999,999. JSX text children
escape markup. Invalid amounts offer no assignment entry and disable assignment form submit.
Server RPC/role/RLS remains authoritative. No DB/schema/config/service-contract changes.

Independent review found a mobile overflow in the copied page: the gateway paragraph is a
flex item with default min-width:auto. Add min-w-0 to this paragraph only, allowing inherited
break-words to wrap long gateway values. No unrelated pending-payment error-UI refactor.

## Browser acceptance

Ignored temporary QA harness renders the actual PaymentReviewPage with seeded QueryClient
data and MemoryRouter. Queries are fresh indefinitely; dummy local connection configuration,
no auth/backend requests or business writes. Fixture scenarios: valid amount with literal
markup, object fields, null payload and 300-character unbroken gateway/content. This tests
component rendering/interaction, not authenticated end-to-end acceptance.

Before correction at viewport 320x780: document scrollWidth 2954; long-gateway card
scrollWidth 2941 versus clientWidth 279. Valid cards have assignment, both invalid cards do
not; markup is visible text and zero img elements are rendered.

After correction: document scrollWidth 305 at viewport 320; all four cards scrollWidth equal
clientWidth 279. Both valid cards retain assignment, both invalid cards have none, zero img
elements. Opened valid assignment dialog: submit disabled with empty code, enabled after
typing TET000123. Closed dialog without submitting or backend write. Screenshot evidence:
`docs/reviews/evidence/SEC005-mobile-320.png`. Temporary viewport reset, tab and server closed.

## Validation gates

After browser checks, run task:finish for all required checks under shared local DB lease.
Existing helper regression tests cover malformed amounts, JSON types, text fallbacks and
markup. External CI, authenticated mobile workflow, staging and Owner acceptance remain
pending; CHB separate staging unconfigured and Claude/Vercel access not restored.
No Done, merge or deploy certification.

Fresh report SEC-005-2026-10-12T16-24-03-985Z: all 12 local check rows pass, including 62 pipeline tests, lint, typecheck, 287 unit tests, build, format, environment, shared lease, local reset, 318 pgTAP assertions, 344 integration tests and lease release. Three scoped source hashes remain current. External acceptance remains pending; status needs_validation.

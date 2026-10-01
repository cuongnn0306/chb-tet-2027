# E01 — Auth, Roles, Master Data

Source: IMPLEMENTATION_INFRA_PLAN §E01, TECH_DESIGN §2–3 (roles, profiles, master tables), PRD §3, §4, §6, §13, §29, B9.

## Task order and branches

Stacked branches (each branch starts from the previous task's branch); PRs target the previous branch until it merges.

| Task                                                    | Branch                          | Status        |
| ------------------------------------------------------- | ------------------------------- | ------------- |
| AUTH-003 roles + permission helper                      | `feature/AUTH-003-roles`        | done, PR open |
| AUTH-002 profiles (+ locations/channels/sources tables) | `feature/AUTH-002-profiles`     |               |
| AUTH-004 RLS baseline, audit log                        | `feature/AUTH-004-rls-baseline` |               |
| AUTH-001 login/logout/session/guard                     | `feature/AUTH-001-login`        |               |
| MD-001..003 locations/channels/sources CRUD             |                                 |               |
| MD-004 products CRUD                                    |                                 |               |
| MD-005 commission rules CRUD                            |                                 |               |
| MD-006 safety stock CRUD                                |                                 |               |
| MD-007 app settings CRUD                                |                                 |               |

## Decisions

- Roles are system reference data and live in a migration (needed in every environment, not test data). The six codes and the permission matrix come from TECH_DESIGN §2.
- `roles.permissions` is a UI/documentation hint (object: `true` or `"rule"`); enforcement is RLS/RPC, never the client.
- Master data is never hard-deleted: tables have `is_active`, and no DELETE policy exists.
- Self sign-up is disabled (internal app). A profile is created by an Admin; a trigger creates it from `raw_app_meta_data` (admin-only), and a user without a profile has no access (fail closed).
- Seed (local/staging test data only) adds one test user per role; test credentials live only in `supabase/seed.sql`.
- Integration tests refuse to run against any non-local Supabase URL.

## Open items

- Login field: PRD B9 says "Email/SĐT". Phone+password login needs GoTrue's phone provider enabled (SMS settings) — a config/provider decision. Implemented email login first; phone login deferred pending that decision.

## Validation log

- MD-007: lint, typecheck, unit (54), build, integration (84, rerunnable) pass; browser-verified (list with units/enum labels, validation message, save). Known keys only, typed validation in BOTH the UI (`src/domain/settings/definitions.ts`) and a DB trigger (TTL 0 rejected, unknown keys rejected, `sepay_config` refuses secret-looking keys). Admin-only table: values needed by other roles must come from a feature-specific RPC/view later. Seed holds example values (TTL 24h / prefix TET come from the docs; others are examples). Browser-verified safety stock too: no status column, location/product locked on edit.
- MD-006: lint, typecheck, unit (47), build, integration (78, rerunnable) pass. Safety stock = one row per Location x SKU (unique), `minimum_qty >= 0`, set to 0 instead of deleting; readable by every active role (all roles see stock), written by Admin only (the docs name no other role — flag if Warehouse should manage it). Added shared `private.set_updated_by()` trigger (stamps `updated_by`/`updated_at`; reused by MD-007). UI check pending in the combined MD-006/007 browser pass.
- MD-005: lint, typecheck, unit (45), build, integration (73) pass; browser-verified. A rule targets exactly one of user/role (DB check) with optional product; Admin-only read/write (commission = Admin data per matrix). Overlapping periods are NOT blocked: precedence/period resolution belongs to COM-001. Date display centralised in `src/lib/date.ts`.
- MD-004: lint, typecheck, unit (39), build, integration (68, rerunnable) pass; browser-verified list (VND grouping). `default_commission_rate` is `NOT NULL DEFAULT 0` (0 = no default commission) to avoid null semantics in the later discount-ceiling/commission logic — flag if the business wants "unset" to mean something else. Money helpers centralised in `src/lib/money.ts`. Observed while testing: a session for a user that no longer exists correctly lands on the fail-closed "no role" screen.
- MD-001..003: lint, typecheck, unit (32), build, integration (62) pass. Verified in browser as Admin: guarded route, list, validation messages, create (code normalised to upper case), edit, deactivate with consequence warning + audit rows. Generic `ResourceAdminPage` + `createCrudService` (no delete operation by design) will be reused by MD-004..007. Added `@tanstack/react-query` (lists + mutations across ~7 admin screens). Not manually checked: non-admin hitting the URL directly (covered by RLS integration tests and the PermissionGate unit-tested matrix) and phone viewport layout.
- AUTH-001: lint, typecheck, unit (22), build, integration (50, stable over 2 runs, files run sequentially) pass. Manually verified in the browser against local Supabase: guard redirect to /login, wrong-password message, successful login + redirect, session survives reload, logout. Added `react-router` (routing named in PROJECT_STRUCTURE). Inactive users are blocked at login (signed out) and, if deactivated mid-session, on the next profile re-check (tab becomes visible) via the blocked screen; RLS independently denies them data. Mobile layout uses responsive Tailwind classes but was not visually checked on a phone viewport.
- AUTH-004: lint, typecheck, unit, build, `db reset`, integration (44) pass. Notes: helpers live in non-exposed `private` schema (`current_role_code`, `is_active_user`, `is_admin`, `has_role`); `anon` has no table privileges (also revoked as default for future tables); `delete/truncate` revoked from `authenticated` on master tables/profiles/roles; `audit_logs` immutable (trigger, also vs service role) and fed by generic `private.audit_row_change()` — attach it to every later master/transaction table. `[auth.email] enable_signup` must stay true (it is the email provider switch); self sign-up is blocked by `[auth] enable_signup=false`.
- AUTH-002: lint, typecheck, unit (13), build, `db reset`, integration (8, rerunnable) pass. Found that GoTrue's admin API sets app_metadata after INSERT, so the profile trigger also fires on app_metadata update. Sign-up disabled in `config.toml` (needs `supabase stop/start` to apply locally).
- AUTH-003: lint, typecheck, unit (13), build, `db reset`, integration (2) all pass.

## E01 status

All E01 tasks are implemented and validated locally. Acceptance: Admin configures all master data (verified in UI + 84 integration tests); non-admin users cannot write master data or see commission/settings (RLS tests); profile defaults (location/channel/source) load with the session (`CurrentProfile`) and are ready for order creation (E03).
Not yet done, so this plan stays in `active/`: PR review/merge of the stacked PRs (#1–#10) and staging verification (staging project not provisioned).

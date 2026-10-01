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

- AUTH-002: lint, typecheck, unit (13), build, `db reset`, integration (8, rerunnable) pass. Found that GoTrue's admin API sets app_metadata after INSERT, so the profile trigger also fires on app_metadata update. Sign-up disabled in `config.toml` (needs `supabase stop/start` to apply locally).
- AUTH-003: lint, typecheck, unit (13), build, `db reset`, integration (2) all pass.

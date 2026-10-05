# SEC-011: Admin access review

Source: IMPLEMENTATION_INFRA_PLAN §E13 (SEC-011 "Admin access review", no acceptance text) and §18 (Production access
control), PRD §3.1, TECH_DESIGN §2.2 and §41, `docs/reviews/2026-10-02-project-review.md` RV-14, PROJECT_PROGRESS row
SEC-011 ("Repo public, main protected=true, develop protected=false; Admin platform access/MFA/required checks/bypass
chưa review đầy đủ RV-14").
Dependencies: none blocking. This is an independent documentation/security review, not delivery implementation. It
relates to INF-001 (repository/protection), INF-008 (staging gating), INF-009..012 (platform provisioning, Owner),
SEC-001/002 (audit), SEC-003 (RLS tests), SEC-004 (secret scan), SEC-010 (backup, separate).

## Scope

In: `docs/runbooks/ADMIN_ACCESS_REVIEW.md` (new), this plan, plus the generated task report, `tasks.json` and `STATUS.md`.
Out: source, migrations, workflows, generated types, any permission/account/security setting, any cloud API call, any
credential or `.env` read, any DB tool, git commit/push/deploy. No new business rule is introduced; every concrete
finding is recorded in the runbook checklist (section 4) with severity, files, evidence and a follow-up task.

## Method

- Read AGENTS.md, the three specifications, PROJECT_PROGRESS, STATUS, WORKFLOW, the continuation prompt and RV-14.
- Read in full: `roles`, `profiles`, `rls_baseline_audit` migrations, `supabase/config.toml`, the three workflows, the PR
  template, STAGING/PRODUCTION runbooks and SEPAY_SETUP.
- Pattern-read (permission gates, grants/revokes, audit triggers) in the payments, inventory, reservations, deliveries and
  opening-stock migrations, `sepay-webhook/index.ts`, and test names. Policies for `app_settings`, `commission_rules`,
  `safety_stock_rules`, `customers` and `orders` were not re-read.
- Every statement is labelled `[CODE]` (read in this workspace), `[SNAPSHOT]` (dated cloud figure from an older document)
  or `[CLOUD-UNVERI]` (needs a human with platform access).

## Result

Fourteen findings (AR-01..AR-14). Three are P1 (AR-01, AR-02, AR-03) and need the Owner before production; eight are P2
and three are P3. Corrective attempt: AR-06 was P1 on the premise that creating an Admin was unaudited. That premise was
wrong (see Correction), so AR-06 is now P2; the reviewer may re-grade.

## Correction (second attempt)

The first attempt said creating an Admin through Auth `app_metadata.role_code` had no audit in `audit_logs`. Read-only
static trace of the chain: `on_auth_user_created` (after insert or update of `raw_app_meta_data` on `auth.users`) →
`handle_new_auth_user` inserts into `profiles` (`on conflict do nothing`) → `audit_profiles` (after insert/update/delete)
→ `private.audit_row_change` inserts into `audit_logs` with `after_data = to_jsonb(new)` including `role_id`. So the
creation **is** audited. The real gaps are:

- Missing human platform-admin attribution: `actor_user_id` is `auth.uid()`, typically NULL for Auth admin API, service
  role, SQL editor or migrations (AR-07).
- Auth-only changes (email, password, MFA, `app_metadata` of a user who already has a profile) create no `audit_logs`
  row: no trigger on `auth.users`, and `on conflict do nothing` inserts nothing (AR-07).
- Other claims kept, worded as supported: the `profiles_update_admin` policy has no column restriction and the audit
  reason is optional. "Last-Admin" and self-demotion protection is a proposed operational safeguard that needs a
  decision; it is not an approved specification requirement.
- None of this DB behaviour was executed. It is read from SQL. No existing test asserts an audit row for profile creation
  from Auth (the existing audit test covers `locations`).

| Group                               | Findings     | Nature                                                              |
| ----------------------------------- | ------------ | ------------------------------------------------------------------- |
| Repository and CI/CD                | AR-01..AR-05 | Mostly external (Owner) plus small workflow changes under INF-008   |
| Admin lifecycle in the application  | AR-06..AR-08 | No user-management flow, attribution/Auth-audit and revocation gaps |
| MFA, service identities, seed       | AR-09..AR-11 | Platform decisions and a missing rotation procedure                 |
| Test and least-privilege follow-ups | AR-12..AR-14 | SEC-003 follow-ups and an Owner question on Warehouse scope         |

Positive facts worth keeping (all `[CODE]`): role and active status are re-read from `profiles` on every call, so a role
change or deactivation takes effect at the DB immediately; `user_metadata` never decides a role and a missing profile
means no access; Admin-only RPCs raise `42501` for other roles; `process_sepay_webhook` is `service_role` only;
`audit_logs` is immutable even for the service role; self sign-up is disabled in local config; integration tests refuse
non-localhost targets.

## Decisions

- **No cloud claim without evidence.** MFA, branch protection, backup, member lists and token scopes are listed as
  `NOT VERIFIED` checklist items (CV-01..CV-19). `config.toml` is a local file and no workflow or runbook pushes it, so
  its values (for example MFA disabled, password minimum 6) are not treated as cloud state in either direction.
- **Old snapshots stay snapshots.** The `private=false`, `main protected=true`, `develop protected=false` figures come from
  the 02/10/2026 review and are quoted with that date.
- **`app_metadata.role_code` is not authority.** The trigger only creates a missing profile; the source of truth is
  `profiles.role_id`. The runbook includes a query to detect drift.
- **Findings are not fixed here.** AR-06 (no user-management flow; proposed last-Admin/self-demotion safeguard) would need
  a product decision and a task ID the plan does not have; it is recorded for Codex/Owner to assign.
- **Conflict recorded, not resolved:** plan §18 says "ít admin nhất có thể" while recovery from losing the last Admin
  is easier with more than one independent path. That path and the AR-06 safeguard are proposed operational measures,
  not approved requirements. The Owner decides.
- **Procedures are drafts.** Emergency and revocation steps name the platform actions but not exact UI paths, because
  those were not verified. The Owner records exact steps after the first real execution.

## Limitations (explicit, do not claim more)

- No cloud state was read. Vercel, Supabase and other platform connectors were available in the session; none was called.
- Nothing about MFA, branch protection, member roles, secrets, token scopes, Auth settings or backups is verified.
- Test existence was checked by name only; no test was executed by this review. Docker is blocked in this workspace, so
  `task:finish` records DB reset, pgTAP and integration as `not_run`.
- The workspace contains uncommitted work from other tasks (including `20261002*` migrations); the review reflects it as
  found.
- The read-only queries in the runbook were not run.
- DB behaviour (trigger chain, policies, `on conflict`, `auth.uid()` values) is inferred from SQL and not executed.
- All cloud controls remain unverified.
- SEC-011 is **not Done**. It needs the Owner to complete the verification table, action on AR-01..AR-03, a decision on
  AR-06/AR-07, and an independent review.

## Tests / validation

Documentation only; no tests added. `task:finish` runs the normal checks (pipeline tests, lint, typecheck, unit, build,
format, env check). The runbook and this plan are formatted with `npx prettier` before finish. DB checks are `not_run`
(inherited Docker blocker). The earlier report is immutable; this attempt writes a new one.

## Next

- Codex review of the runbook and findings, then Owner verification of CV-01..CV-19.
- Follow-ups by owner: INF-001 (AR-01/02/05), INF-008 (AR-02/03/04), INF-009..012 (AR-03/08/09/11), SEC-001/002 (AR-06/07),
  SEC-003 (AR-12..14), SEC-004 (AR-10); a task ID for Admin user management (AR-06) to be assigned.

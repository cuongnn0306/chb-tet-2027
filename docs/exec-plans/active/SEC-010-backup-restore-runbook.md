# SEC-010: backup/restore runbook

> **Historical plan (first attempt).** The canonical, current plan is
> [`SEC-010-backup-restore.md`](SEC-010-backup-restore.md). This file is kept unchanged below for history; where it
> says R9 was "deliberately not written", that was corrected in the corrective attempt.

Task: SEC-010 (E13), agent claude, 2026-10-03. Deliverable: `docs/runbooks/BACKUP_RESTORE.md`.
Documentation only. No migration, RPC, RLS, source or pipeline change. No commit, push or deploy.

## Scope

- Actionable backup and restore runbook grounded in files actually in the repo (local Supabase config, CI,
  staging/production workflows, migrations, Edge Function secrets).
- Role responsibilities, local rehearsal procedure, data-integrity reconciliation checklist, evidence template.
- Out of scope and not done: any production/staging access, provider backup configuration, account or plan
  change, real restore, deleting data, a Docker-dependent rehearsal.

## Dependencies and sources

IMPLEMENTATION_INFRA_PLAN §12.4, §14, §15, §22-24, §27; PRODUCTION_DEPLOY.md; STAGING_DEPLOY.md; LOCAL_SETUP.md;
`supabase/config.toml`; `.github/workflows/{ci,staging,production}.yml`; migrations for ledger, payments,
reservations, audit, order/payment code sequences. SEC-010 has only a heading in the plan: no RPO/RTO, frequency
or retention is specified, so the runbook lists them as undecided Owner decisions rather than inventing rules.

## Findings recorded in the runbook

1. Repo contains no backup configuration at all (no schedule, PITR, dump job, retention). Staging and
   production are documented as "not configured". Provider backup state is unverified and is Owner work.
2. Restore hazard: `orders_assign_code` and `payments_before_write` overwrite `order_code`/`payment_code` on
   INSERT; audit triggers add `audit_logs` rows; ledger/balance guards reject direct writes. A data-only reload
   with triggers on would renumber codes (the order code is the SePay transfer reference), duplicate audit
   history and be refused by the ledger. Runbook therefore prefers whole-database restore and requires the
   rehearsal to prove any trigger-bypass technique before production use.
3. Secrets, SePay configuration and Auth dashboard settings are outside DB backups. No storage bucket exists.
4. `pg_cron` job `expire-temporary-reservations` must be re-checked after restore.
5. `public.verify_inventory_balances()` already reconciles ledger vs cache and reservations; reused in R3.

## Acceptance and evidence

| Criterion                                  | Status       | Evidence                                                           |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------ |
| Runbook with backup + restore procedures   | met (doc)    | BACKUP_RESTORE.md §5, §7                                           |
| Role responsibilities                      | met (doc)    | §3; named owners left unassigned                                   |
| Local rehearsal procedure                  | met (doc)    | §8; NOT executed                                                   |
| Integrity/reconciliation checklist         | met (doc)    | §10 R1-R11; SQL read but not executed; R9 deliberately not written |
| Evidence requirements                      | met (doc)    | §11                                                                |
| Documents actual configured infrastructure | met          | §1 cites each file                                                 |
| Restore rehearsal performed                | NOT verified | Docker blocked; no DB; no result exists                            |
| Provider backup / staging verified         | NOT verified | External, not configured                                           |

## Validation

Pipeline `task:finish` runs the standard checks. Docker is a confirmed, inherited blocker: DB reset, pgTAP and
integration are expected to be recorded `not_run`, so the report stays `needs_validation`. Prettier format
check applies to the two Markdown files.

## Follow-up

Owner: confirm Supabase plan/backups, assign roles, decide RPO/RTO. Engineer: start Docker, run BACKUP_RESTORE §8,
attach evidence; then staging rehearsal (§9) once staging exists. Write R9 after reading the latest delivery
migration. Codex review of this attempt is pending.

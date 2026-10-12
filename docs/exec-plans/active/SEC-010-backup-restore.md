# SEC-010: backup/restore runbook (canonical ExecPlan)

Task: SEC-010 (E13), agent claude. Deliverable: `docs/runbooks/BACKUP_RESTORE.md`.
This is the canonical plan. `SEC-010-backup-restore-runbook.md` is the historical plan of the first attempt and is
kept unchanged except for a pointer here. Documentation only: no migration, RPC, RLS, source or pipeline change,
no commit, push or deploy, no database or cloud command.

## Attempts

1. First attempt (report `SEC-010-2026-10-02T19-42-48-989Z`, `needs_validation`, immutable). Runbook written;
   review found restore-safety and reconciliation defects.
2. Corrective attempt (report `SEC-010-2026-10-03T00-44-46-305Z`, `needs_validation`, immutable; one `task:start`,
   resumed after quota without a second start). Fixes below. Admin context and writer freeze accepted at document level.
3. Scoped lease/R9 attempt (this attempt; one `task:start` "Correct shared DB lease protocol and R9 minor findings").
   Corrections are listed in "Attempt 3 corrections" below.

## Review findings and corrections

| #   | Finding                                                                                                   | Correction in `BACKUP_RESTORE.md`                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | R3 used a standalone `set_config(..., true)`; the identity is transaction-local and is lost in autocommit | R3 runs in `begin read only` … `rollback`, picks and verifies an active ADMIN, sets the request context, calls `verify_inventory_balances()`. No Admin = failed prerequisite (exit code, `PREREQUISITE FAILED`), never a silent pass.                                   |
| 2   | Cutover only said "freeze users"                                                                          | §7.0–7.2: every writer (UI/RPC, SePay webhook, pg_cron) is listed and controlled; durable provider event capture/retry policy confirmed by the Owner BEFORE webhook suspension; final delta reconciliation; exactly one writable destination. Nothing is suspended now. |
| 3   | R9 missing                                                                                                | R9-0 applicability check, R9a–R9g read-only delivery/product/batch vs `SALE_OUT` reconciliation plus binding counts, permissions and guard checks, R9-L for the pre-binding schema. Legacy ambiguity and snapshot applicability explained.                              |
| 4   | Infra inventory ignored that the coordinator snapshot lacks the root's latest migration                   | §1 states the two sources (snapshot 26 files to `060000`; root checkout 27 files including `070000`) and requires validation against the target schema (R1, R9-0).                                                                                                      |
| 5   | Formatting                                                                                                | `npx prettier --write` on the runbook and both SEC-010 plans before finish. The Owner's inbox file is not touched.                                                                                                                                                      |

Additional independent review items for the same correction:

- Backup command examples write to an explicitly approved directory outside the repo (`<BACKUP_DIR>`); `*.sql` names
  are not protected by `.gitignore` (only `.dump`/`.backup`).
- R6b detects canonical numeric SePay transaction-key collisions (`00123` vs `123`) consistently with migration
  `20261002050000`, read-only, without altering immutable records.
- §8.1 spells out single-owner, continuous ownership of the shared DB lease across reset, dump, restore and
  reconciliation, no stealing of live leases, no bypass. The procedure is reviewed-owner, execution pending.
- Raw SHA-256 of the reviewed runbook and both plans is recorded in the handoff evidence (summary notes). The pipeline
  code fingerprint excludes docs, so it does not prove document freshness.

## Attempt 3 corrections (runbook §8.1, §10 R9)

- **Shared DB lease (§8.1) now matches the reviewed `scripts/db-validation-lock.mjs`.** Documented from the code: the
  lease path is the absolute `dbLockPath` of the controller's worker config, exported as `CHB_DB_LOCK_PATH`; the repo
  declares no fixed value (tests use `<workspace>/tmp/db.lock`), so the real path is **not determined** here and
  must come from the controller config (not from `printenv`). Acquisition is an atomic exclusive create
  (`openSync(path, 'wx')`) writing `{pid, token, createdAt}`; poll/timeout on `EEXIST`; no borrowed tokens; no
  symlinks; release only by the owner with matching `token` and `pid`; stale/foreign leases are never removed
  automatically.
- **Unsupported shapes are named and forbidden:** check-then-run (`existsSync`/`Test-Path` then run), hand-made lease
  files, and the earlier manual "inspect owner then continue" procedure (removed).
- **Rehearsal is explicitly BLOCKED / not executable** until a reviewed runner exists that holds the lease in the same
  process that spawns every DB tool, continuously from reset through cleanup. The pipeline's own lease only wraps
  `db reset`/`pgTAP`/integration, so a hand-run dump/restore would sit outside it. No such runner is in the repo; the
  procedure is not described as approved.
- **Release / stale recovery:** a dead parent PID is insufficient; all descendants must be proven stopped (job-object
  `ActiveProcesses = 0`, no psql/pg_dump/pg_restore/supabase/docker-exec of the session, no active connections to port
  56322). Timeout or uncertain lifetime retains the lease (`db lease retained`); writing a stopping reason is not a
  release. Recovery needs the owner's `pid`/`token`/`createdAt` recorded, descendants proven stopped, and Owner
  pipeline approval; any doubt keeps the lease.
- **R9f** is a baseline count (not zero-row); its heading is split from R9a–R9e.
- **R9-L** is rewritten as a full join of aggregated expected (`delivery_items`) and actual (`SALE_OUT`) per delivery
  and product, detecting missing `SALE_OUT`, extra products, wrong source location, quantity mismatch and `SALE_OUT`
  on non-`DELIVERED` deliveries. Still not executed.

## Facts relied on (read, not executed)

- `public.verify_inventory_balances()` is Admin-only via `private.is_admin()` / `auth.uid()`; repo tests simulate the
  caller with `set_config('request.jwt.claim.sub', <admin id>, true)` inside a transaction.
- Triggers rewrite `order_code`/`payment_code` on INSERT, duplicate `audit_logs`, and guard ledger/balances
  (`app.inventory_posting`); prefer whole-database restore.
- Root migration `20261002070000_delivery_batch_binding.sql`: batch/quantity bound once at first dispatch in
  `delivery_item_batches`, consumed at `DELIVERED`, backfilled from `SALE_OUT` for completed deliveries (so R9a is
  circular for legacy rows), upgrade blocked while pre-migration deliveries are in flight. It states it is unreleased.
- Migration `20261002050000`: SePay transaction id canonicalised to a positive integer without leading zeros;
  older non-canonical keys are not rewritten.

## Acceptance and evidence

| Criterion                                               | Status       | Evidence                                                                   |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| Runbook with backup + restore procedures and roles      | met (doc)    | `BACKUP_RESTORE.md` §3, §5, §7                                             |
| Writer coordination, event capture policy, one writer   | met (doc)    | §7.0–7.2; not exercised                                                    |
| Local rehearsal procedure incl. DB lease ownership      | BLOCKED      | §8.1: not executable until a reviewed lease-holding runner exists; not run |
| Reconciliation checklist R1–R11 incl. R3, R6b, R9       | written only | §10; **SQL NOT EXECUTED** (no DB); no acceptance claimed on these queries  |
| Evidence requirements incl. document SHA-256            | met (doc)    | §11, §12                                                                   |
| Documents actual infra and migration applicability      | met (doc)    | §1; checkout tích hợp có 31 migration tại thời điểm kiểm kê                |
| Restore rehearsal performed with passing reconciliation | NOT verified | Docker blocked; no result exists                                           |
| Provider backup/PITR and staging verified               | NOT verified | External; not configured; no account access used                           |

## Validation

`task:finish` runs the standard checks. `CHB_DB_VALIDATION_BLOCKER` is inherited: DB reset, pgTAP and integration are
recorded `not_run` without a reset. The report therefore stays `needs_validation`. `format:check` should pass for the
three files owned here; the Owner's inbox file may still fail and is reported as such.

## Follow-up

Owner: confirm Supabase plan/backups, assign roles, decide RPO/RTO, confirm provider event capture/retry policy, name the
approved `<BACKUP_DIR>`. Pipeline owner: review the DB lease procedure. Engineer: run `BACKUP_RESTORE.md` §8 once Docker
works and execute the §10 SQL (fix syntax issues and record them); staging rehearsal (§9) after staging exists.
Codex review of this attempt is pending.

## Integration attempt — 12/10/2026

Codex copied the previously reviewed runbook and historical plans into a clean worktree at committed HEAD
`2df547e`, then reconciled §1/§10/§12 with its 31 migration files. The earlier coordinator snapshot is no longer
described as the current checkout. Owner responsibility now reflects the decision dated 11/10/2026; backup
capability, operator assignments and RPO/RTO still require evidence. The runbook remains a written procedure,
not proof that any backup or restore worked. A fresh `task:finish` report records the checks for this attempt.

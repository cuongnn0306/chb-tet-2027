# E00 — Project Foundation & Infrastructure

## Objective

Leave the repo reproducible and verified, ready for E01 (Auth, Roles, Master Data). No business features.

## Repository audit (start of session)

- Git: not a repository (initialized this session, branch `main`, no remote).
- App / Supabase / tests / CI / env files: none.
- Docs existed with long flat names under `docs/`; moved to the canonical paths in PROJECT_STRUCTURE §21 (content unchanged). Old `PRD_v1.0` kept at `docs/archive/PRD_v1.0.md`.
- Tooling present: Node 22.14, npm 11.15, Docker 29.6, Git 2.53.

## Tasks

| Task        | Scope                                                                                   | Status                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| INF-001     | Git repo, `main`/`develop`, PR template. GitHub repo + branch protection need the human | repo-side done (git init, PR template); GitHub repo, `develop` branch (needs first commit), branch protection pending — human |
| INF-002     | React + TS (strict) + Vite + Tailwind, ESLint, Prettier, Vitest                         | done; lint, typecheck, test, build pass                                                                                       |
| INF-003     | Supabase CLI as devDependency, `supabase init`                                          | done (`supabase@2.119.0` devDependency, `supabase init`)                                                                      |
| INF-004     | `supabase start` (local stack)                                                          | done: stack up (Postgres, Auth, REST, Studio); auth health 200                                                                |
| INF-005     | Baseline migration, `db reset`                                                          | done: `db reset` applies migration + seed                                                                                     |
| INF-006     | `seed.sql` foundation (no business data)                                                | done (empty by design; applied by `db reset`)                                                                                 |
| INF-007     | `.env.example`, env parsing in `src/lib`                                                | done (`.env.example`, `src/lib/env.ts`, `check:env`, unit tests)                                                              |
| INF-008     | CI workflow (`ci.yml`), staging/production workflow stubs                               | done (ci.yml with app + database jobs; staging/production stubs); not yet run on GitHub                                       |
| INF-009/010 | Supabase staging / production projects                                                  | human action                                                                                                                  |
| INF-011     | Vercel project                                                                          | human action                                                                                                                  |
| INF-012     | Environment variable separation                                                         | documented in runbooks                                                                                                        |

## Decisions

- Tailwind CSS is the stack named in PRD §26, so it is used; no component library.
- Vitest for unit tests (shares Vite config); Playwright deferred until the first E2E flow exists.
- Seed and baseline migration contain no business tables: those arrive with E01+ per the plan, and AGENTS.md says no final business seed yet.
- Integration tests (needs local Supabase) are a separate `test:integration` script; CI runs them after `db reset` once tests exist.
- `develop`/`main` branch mapping follows plan §4.

## Blockers / human action

Recorded in `docs/runbooks/` and the final report.

## Validation status

- lint: pass · typecheck: pass · test: pass (5 tests) · build: pass · format:check: pass · check:env: pass
- `supabase start`: pass (ports moved to 563xx; see decisions)
- `supabase db reset`: pass (migration + seed applied)
- `npm run test:integration`: pass (no tests yet, runner works)
- Dev server: serves the app on a local port (checked via HTTP)

E00 repo-side Definition of Done met. Remaining items are human/account actions (GitHub repo + branch protection, staging/production Supabase, Vercel) documented in `docs/runbooks/`.

## Decisions (later)

- Client env var is `VITE_APP_ENV` (plan §INF-007 shows `APP_ENV`, which Vite would not expose to the browser).
- TypeScript pinned `~6.0` because typescript-eslint supports `<6.1`.
- Local Supabase ports moved to 563xx because other local Supabase projects occupy 543xx/553xx.
- Docker Desktop initially crashed on stale socket files; fixed by renaming the stale folders (documented in LOCAL_SETUP).

## Final verification (re-run from a clean `db reset`)

All exit 0: `supabase db reset`, `lint`, `typecheck`, `test` (5 passed), `build`, `check:env`, `format:check`, `test:integration` (no tests yet). Dev server served the index page and transformed `App.tsx` (HTTP 200).
Diff review: no tracked secrets (only Supabase's public local demo keys inside gitignored `supabase/.temp/`), no `node_modules`/`dist`/`.env*` staged, no unrelated changes.

## Definition of Done

Met for repo/local scope. Open human actions: GitHub repo + branch protection + `develop` (INF-001), Supabase staging/production (INF-009/010), Vercel (INF-011), env separation (INF-012) — see `docs/runbooks/`.

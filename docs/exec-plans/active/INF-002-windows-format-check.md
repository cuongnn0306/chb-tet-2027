# INF-002 — cross-platform Prettier check

The repository uses `core.autocrlf=true` on this Windows host. Prettier's default
`endOfLine=lf` made `npm run format:check` fail on 297 inherited files even though
`npx prettier --check . --end-of-line auto` passed across the entire repository.
Formatting one sample file to LF made Git mark it modified, so rewriting the
whole checkout would create an unrelated diff.

Scope: add `endOfLine: auto` to `.prettierrc.json`. This preserves each file's
existing line ending while checking all other formatting rules. It changes no
application, database or business behavior and installs no dependency.

Acceptance: repository-wide `npm run format:check` passes on this Windows
checkout; pipeline tests, lint, typecheck, unit tests, build, env, local DB
reset, pgTAP and integration still pass under the shared DB lease. The task
report records actual results and any remaining external review/staging gaps.

Status: the standard `npm run format:check` now passes across the repository on
the Windows checkout. The full task pipeline remains to be recorded.

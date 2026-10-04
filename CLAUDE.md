# CHB Bánh Chưng Tết 2027 — Claude continuation

Follow `AGENTS.md` in full. Read the specifications in its required order before coding.
The current repository handoff is in `docs/handoff/CLAUDE_CONTINUE_PROMPT.md`.

Before each task read `docs/handoff/PROJECT_PROGRESS.md`, `docs/handoff/STATUS.md`,
the latest task report and applicable ExecPlan. Security/integrity fixes from
`docs/reviews/2026-10-02-project-review.md` precede new epics.

One canonical task ID per implementation attempt. Start and finish every attempt:

```bash
npm run task:start -- SEC-007 claude "SePay webhook authentication correction"
npm run task:finish -- SEC-007 tmp/SEC-007-summary.json
```

Fill summary from `docs/handoff/summary.example.json`. Read `docs/handoff/WORKFLOW.md`
for commands, report locations, status meanings and CI gate. Finish also on failure
so Codex can read the blocker. Never call `needs_validation` or `validated_local` Done
without remaining AGENTS.md requirements. Commit reports with the implementation.
Do not hard-delete transactions, weaken RLS, expose secrets, or deploy to production.

Read `docs/handoff/QUOTA_WORKFLOW.md` for quota fallback ownership. A usage-limited
task remains yours while Codex works on independent tasks in a separate worktree.
Resume the exact assigned session; do not take Codex's reserved task or release
your reservation without coordinator review/handoff.

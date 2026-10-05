# Parallel finish lifecycle review — 2026-10-02T15:11Z

SEC006/INF008 Claude returned is_error=false but null runner exit code, permission denials3/2, and no report at runner completion. Both had detached task:finish pipelines waiting on localreset.

Critical coordinator lifecycle: root legacy SEC006 exclusiveDB lease released when Claude exited while background finish reset was still alive. INF008 then acquired pipelinelease and launched a second reset. Docker is unavailable and neither completed; no successful reset inferred. Codex stopped only verified scoped supabase.exe reset children and their matching docker inspect descendants to allow durable failed reports. No Docker Desktop/engine/volume changes.

Do not dispatch more workers until exclusivelease ownership also covers detached validation or pipelines themselves always lease, and current children/reports are reconciled. Independentreviews dispatched for SEC006 and INF008 code. Existing resultfiles/history preserved, noDoneclaim.

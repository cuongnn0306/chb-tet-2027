# SEC-009 / SEC-010 post-quota runner evidence

Dispatches: SEC-009-1790970118467-a8fdfb30 and SEC-010-1790970119726-88dfb383.
Reports: SEC-009-2026-10-02T19-48-13-253Z and SEC-010-2026-10-02T19-42-48-989Z.

Both native exits are 0; is_error false; no permission denials; stdin delivered; stdout/stderr complete; one final result at end; malformed lines 0; live children 0. This is actual post-reset execution evidence. No new dispatch is authorized by this evidence alone.

All source fingerprint entries match their current workspace after CRLF normalization. SEC-009 records seven application checks passing. SEC-010 records six passing and format failing in BACKUP_RESTORE.md, its ExecPlan and SEC-010 inbox prompt. Both honestly record DB reset/pgTAP/integration not_run under the inherited Docker blocker. Neither task is Done.

Independent code/runbook reviews are in progress in security_review and parallel_review. SEC-009 uses safe-log.ts / safe-log.test.ts instead of declared safe-logging names; both lanes renamed ExecPlans. Treat those scope deviations as review items, not automatic approval. SEC-010 needs a fresh corrective attempt for formatting and any substantive runbook findings. No report was edited and no integration, DB command or next task was dispatched.

# DEL-011 review — parallel run 1790931444684-540cefe7

Report: DEL-011-2026-10-02T09-07-18-182Z. Not accepted for next task.

P1: no safe upgrade handling for existing dispatched deliveries. delivery_item_batches starts empty; historical dispatched_at is already populated, so dispatch skips binding and delivery consumption rejects missing bindings. Existing OUT_FOR_DELIVERY/FAILED/rescheduled deliveries can become stuck.

P1: redispatch skips batch sellability assertions because these are inside first-bind branch only. Failed/rescheduled deliveries can redispatch inactive/expired bound goods.

Required: migration-upgrade fixtures and failed redispatch inactive/expired rollback tests. Safe backfill must use existing evidence; ambiguous historical batch provenance requires explicit blocker rather than fabricated batch facts.

Infrastructure: snapshot tmp/** excluded from root ESLint discovery; coordinator documents formatted. Previous failed report remains immutable. Root source changed, therefore a fresh task attempt/report is required. Worker exit code was null even though terminal result/report existed; no successful runner exit inferred.

DEL-005 remains blocked by this local review. No production changes or commits.

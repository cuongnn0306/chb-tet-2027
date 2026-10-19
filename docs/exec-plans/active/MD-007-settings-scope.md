# MD-007 settings account isolation

Existing E01 Settings Admin-only permission preserved. Outer page renders loading/denied state before query-bearing content mounts. Keyed Admin content resets editor and notice on account change; app_settings query key includes account. Existing prefix invalidation preserved. No settings values, defaults, service/schema/RLS/pipeline config changes. Database remains authoritative for writes; in-flight write may complete after unmount. No reproduced UI bypass claim.

Full taskfinish validates current combined source; no mirrored tests for this component boundary. Browser/mobile/staging/real RLS pending. Shared DB preserved.

# AUTH-003 profile identity boundary

Pure resolveAccess now rejects a profile whose ID differs from authenticated userId before inspecting role or exposing inactive account name. Existing provider normally correlates loadedFor; this is boundary hardening, no reproduced UI privilege escalation claim. No service/provider/schema/contracts/config changes. Regression checks active Admin and inactive foreign profiles fail closed; matching-account behavior unchanged.

Taskfinish runs combined source checks; DB preservation blocker applies. Browser/mobile/staging pending, not Done.

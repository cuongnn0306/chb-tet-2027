# AUTH-002 profile defaults editor

Independent quota fallback in own worktree. PRD attribution defaults, TECH3.1 and existing Admin-only profiles RLS/audit trigger; no schema, role, account provisioning or delivery/service contracts changed. Admin route/menu/page gate edits existing profiles nullable location/channel/source defaults only; service payload drops privileged fields. Full-name list, loading/empty/error, retry and save states. Existing inactive default is displayed without silently clearing it.

Validation: unit guards malformed IDs and privileged-field stripping; real browser/mobile/RLS and stale auth profile refresh behavior remain pending. Existing order form defaults read auth profile; user may need fresh session after defaults edit (not retroactive orders). taskfinish mandatory, shared DB intentionally blocked to preserve Claude reserved schema; no Done.

Follow-up: corrected denied-page regression assertion to existing shared Vietnamese copy. Focused 8 cases pass; fresh task finish required. Prior failed report preserved.

# Parallel runner TLS blocker — 2026-10-02

Runs: DEL-011-1790932822201-aec822e7 and SEC-004-1790932853158-a343214a.
Both ended with is_error=true, DEPTH_ZERO_SELF_SIGNED_CERT, no new reports, and null recorded exit code. No implementation/validation success inferred. One observed TLS failure per lane; do not auto-retry unchanged network configuration.

Shared DB lease is absent and both runner PIDs are gone. Existing dirty code/reports preserved. Task registry remains authoritative; no manual Done/status promotion.

Recovery requires a trusted CA bundle supplied/approved by organization IT or restored normal trusted network path. Official Claude documentation supports NODE_EXTRA_CA_CERTS configured before process launch. Never set NODE_TLS_REJECT_UNAUTHORIZED=0 or trust an arbitrary certificate automatically. No credentials read or printed.

Pending DEL-011 findings: safe historical dispatch upgrade, redispatch sellability, concurrency/RLS evidence.
Pending SEC-004 findings: silent >50k line/>1MB skips and custom envPrefix warning-only fail-open. Colon syntax observation was withdrawn. Add actual installed Vite prefix exposure regression.
Future resume must read the current inbox prompts and start/finish only according to actual registry state, because failed CLI may have started an attempt before network error.

Source: https://code.claude.com/docs/en/network-config

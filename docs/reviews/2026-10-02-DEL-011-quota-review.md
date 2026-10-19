# DEL-011 coordinator: usage limit

Dispatch: `DEL-011-recovery-20261002T082213607Z`.
Session: `166d0ce3-cfb5-4259-9b19-eeb34debc8ee`.
Finished: 2026-10-02T08:24:39.9099076Z.

The saved runner result records exit 1, is_error=true, zero permission denials,
no new reports and the provider message:

> You've hit your session limit · resets 3:30pm (Asia/Bangkok)

This is a usage limit, separate from the earlier authentication and permission
issues. No validation or task completion can be inferred. Existing source,
reports and the in_progress pipeline attempt are preserved.

Coordinator classification: waiting_quota. The reported reset maps to
2026-10-02T08:30:00Z (15:30 Asia/Bangkok); the next eligible recovery is after
08:31:00Z with a one-minute buffer, on the next heartbeat. The reset is provider
reported, not an independently guaranteed restoration of access.

Do not repeatedly probe before that time. Resume the exact session and existing
DEL-011 attempt once eligible, using the saved validation recovery prompt and
current scoped permissions. If another limit is reported, record its actual
reset/backoff rather than launching a tight retry loop. Do not buy credits,
change billing/account/model/provider or certify Done.

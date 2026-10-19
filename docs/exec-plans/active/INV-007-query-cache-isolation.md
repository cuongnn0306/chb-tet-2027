# INV-007 inventory summary query isolation

E01/E04 schema and summary RPC already exist at9548886. Persistent QueryClient retained summary/catalog cache across account and role changes. Added active identity/role to both query keys and disabled both requests without an active account. No service, auth, schema, role visibility or stock calculations changed. All active roles retain summary access per TECH41.

Existing CUS006 QueryClient regression demonstrates account/role keys do not share cache entries; INV007 uses the same explicit tuple construction locally without modifying customer source. Routine key changes need no mirrored tests. Run complete task pipeline; DB remains not_run to preserve current root schema. Browser account-switch/mobile/staging acceptance remains pending. Previous CUS006 source/report preserved.

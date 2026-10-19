# CUS-006 customer query cache isolation

E01/E02 dependencies implemented at9548886. Providers retains QueryClient across auth changes; customer keys omitted identity/role and list retained previous rows. Scope now includes active user and role for list, picker, history and duplicate queries; inactive sessions disable queries. Removed list placeholder data to avoid carrying previous scope rows.
No AuthProvider, service/RLS/schema, delivery or Claude pipeline contract changes. Existing customer picker value supplied by parent and other feature caches are outside scope; this is not certification of global auth cache isolation.
Tests use actual QueryClient/QueryObserver for cross-account/role cache misses and immediate clearing during unresolved next-account fetch. Browser/mobile/RLS/staging pending. Own worktree pipeline bootstrap tracked as pre-existing infrastructure; reports append-only. Shared DB blocked to preserve root schema. Not Done.

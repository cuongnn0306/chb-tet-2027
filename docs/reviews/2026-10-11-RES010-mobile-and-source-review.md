# RES-010 mobile impact and source provenance — 11/10/2026

This review is a static impact check, not a browser viewport test or staging UAT.
The RES-010 code change is one private SQL function replacement and one
integration test. There is no change to a React component, CSS class, public RPC
signature, response field or Vietnamese copy. The migration and test have the
same LF-normalized SHA-256 hashes as the previously reviewed integration
manifest (`tmp/RES010-integration-review/manifest.json`):

| File                                                              | SHA-256                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/20261003044700_transfer_source_priority.sql` | `20462cc0f4de419ada7b551575387810eb11732ddd835fecd45fbe8b6611544c` |
| `tests/integration/transfer-source-priority.test.ts`              | `1eb57a13c209cebaf5707ba5ac5e163fd132b0862c743ea0d09b66a6b37bd485` |

The `stock_check_lines` response still provides the same `suggestions` fields.
`src/domain/inventory/shortage.ts` reads the first suggestion and renders one
Vietnamese sentence. The existing `OrderFormPage`, `OrderStockPanel` and
`DeliveryAllocationDialog` show that sentence in normal-flow text inside their
mobile layouts. A changed source ranking can change the named warehouse and
quantity in the sentence, but not its shape, controls or layout. No new mobile
interaction is introduced. A physical/mobile viewport check remains pending.

The five RES-010 integration regressions and the complete combined-source
integration suite passed in the latest task report. This static assessment does
not substitute for an independent final code review or staging UAT. GitHub
staging remains unconfigured: no repository variable is listed, and the
`staging` environment lookup returns 404. The repository remains public, so no
branch was pushed for external review.

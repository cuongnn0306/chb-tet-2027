# E02 — Customer

Source: IMPLEMENTATION_INFRA_PLAN §E02, PRD §5 and §25/B11.1, TECH_DESIGN §3.6, wireframe 04.
Branch: `feature/CUS-001-customers` (stacked on `feature/MD-007-app-settings`).

| Task                                                               | Status                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| CUS-001 customer schema (individual + company)                     | done                                                                                                                       |
| CUS-002 create/edit                                                | done (UI + service)                                                                                                        |
| CUS-003 phone normalization                                        | done (SQL `normalize_phone` + TS `normalizePhone`, parity test)                                                            |
| CUS-004 duplicate suggestion                                       | done (`find_similar_customers` RPC, `DuplicateSuggestion` component reusable by E03 order form)                            |
| CUS-005 customer history (orders count, total gross, latest order) | done (after E03): `customer_order_summary` RPC; shown in the duplicate suggestion, order customer picker and customer list |
| CUS-006 list/search/filter                                         | done (`search_customers` RPC, accent-insensitive, type + archived filters, paging)                                         |

## Decisions (docs are silent; least privilege, flag if wrong)

- Roles that can create orders (Admin, Sale B2B, Store, Franchise — `private.can_create_orders()`) can read and create customers. Reads are not limited to own customers because duplicate detection must see other users' customers (PRD §5.3).
- Only the creator or an Admin can edit/archive a customer; `created_by` is stamped by the database and cannot be spoofed or reassigned.
- Warehouse and Production have no access to customers.
- Customers are archived (`is_archived`), never deleted; changes are audited.
- Duplicates are never blocked: no unique constraint on phone or tax code.
- Required fields mirror the DB check: an individual needs a name, a company needs its company name. Phone is optional but validated (9–11 digits) when entered; tax code format check is deliberately lenient.
- Search ignores accents ("nguyen" finds "Nguyễn") via the `unaccent` extension; `%`/`_` are treated literally.

## Validation log

- Data layer: lint, typecheck, unit (65), build, integration (101, stable over 2 runs) pass.
- UI verified in the browser as Sale B2B: guarded `/customers`, unaccented search, duplicate suggestion with a phone typed as `+84 90 000 0001` (matches stored `0900000001` and `090.000.0001`), "Vẫn tạo khách mới", creation succeeded.
- Not manually checked: phone viewport layout; store/franchise views of others' customers (covered by RLS integration tests).

## CUS-005 notes

- Counts real orders only: past DRAFT and not CANCELLED/VOIDED; total is gross (list price x quantity), not cash collected.
- SECURITY DEFINER on purpose: a salesperson sees a customer's whole history (all users' orders) so repeat customers are recognised, but only these three aggregates, never other users' individual orders.
- Verification: unit (100), integration 141 (4 new) stable on two runs. List/picker/suggestion wiring is type-checked but not manually clicked through.

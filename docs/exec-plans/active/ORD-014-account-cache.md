# ORD-014 — Account-scoped printed order

Read-only print page existed. Query is enabled only for active access and uses account, role and order id. No prior account data reused; existing RLS service controls visibility. Printed fields, money calculations and quantity rules unchanged. Source review complete; account-switch/browser print, mobile/staging pending. No schema/service changes; Claude RES005 preserved. Not Done.

Follow-up review: preserve existing `[order, orderId]` invalidation prefix and append account/role scope. This lets existing order mutations invalidate printed data while keeping identity separation. Earlier immutable report preserved; new pipeline required.

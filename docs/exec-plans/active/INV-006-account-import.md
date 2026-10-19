# INV-006 — Account-scoped import preview

Existing Excel/CSV parser and Admin-only atomic inventory RPC stay unchanged. Outer active Admin guard prevents form mounting without permission; account-keyed content clears selected file, pasted rows, dry-run report, confirmation dialog and result on account change. A submitted request may finish through the existing backend policy. Browser/mobile/staging and real workbook acceptance pending. No schema/service changes. Not Done.

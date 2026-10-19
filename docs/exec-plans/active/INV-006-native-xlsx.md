# INV-006 native xlsx import

PRD Import Excel: Kho/SKU/Batch/NSX/HSD/SL. Existing import RPC, six-column text parser and dry-run then atomic apply remain authoritative. Own task started; no schema/service contracts or Claude scopes.

Dependency candidate read-excel-file9.3.10, Node>=18, official https://github.com/catamphetamine/read-excel-file. Browser API changed in current major: inspect exact pinned package types/docs before integration. Not installed yet.

Implementation next: bound file size/rows, single sheet or explicit sheet selection, preserve source row numbers, typed dates without timezone shift, reject unsupported cell types/formulas as appropriate to parser behavior, convert escaped six-column rows to existing validator, protect stale asynchronous file selection and disable apply while loading. Tests need meaningful workbook fixtures and dates/invalid files/row limits; no DB direct commands.

Validation not run yet; task remains in_progress. Preserve existing CUS006/INV007/INV009/INV008 source/reports. Finish through own pipeline with shared DB preservation blocker. Browser/mobile/staging pending.

Progress21:25Z: pinned read-excel-file9.3.10 installed, npm audit reports0 vulnerabilities. Exact types show default returns Sheet[] and readSheet returns SheetData. Six-column conversion helper drafted; UI integration/tests/pipeline still pending. No successful validation claimed.

21:35Z: UI decoder integrated; one-sheet/5MB guard, async selection sequence, clear previous checked/apply state, dates escaped through existing parser. Strict typecheck first found possibly undefined sheet; guard corrected. Tests, final checks and async dry-run race review still pending. ZIP decompression is library-managed; 5MB compressed size is not decompressed-memory guarantee. Formula cached values may be accepted by library; never executed.

21:55Z: strict typecheck corrected by browser-compatible Blob workbook fixture; three focused tests passed. No mirrored tests. Complete pipeline follows, DB preservation blocker applies. UI disables text/file changes during check/apply, clears prior checked data on file selection.

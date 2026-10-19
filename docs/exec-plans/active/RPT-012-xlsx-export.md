# RPT-012: Generic XLSX export engine

Source: IMPLEMENTATION_INFRA_PLAN §E12 RPT-012 ("Excel export engine"; acceptance: filter date/location/user/channel,
export matches the filter, Gross and Cash Collected are not conflated), PRD "XLSX Export", TECH_DESIGN §13
(Gross Sales = SUM(order.gross_amount) of non-cancelled/voided orders; Cash Collected = SUM(CONFIRMED payments)) and
§45 (nine exports, "Export phải tôn trọng filter đang chọn").

## Scope

In: `src/lib/report-xlsx-export.ts`, `tests/unit/lib/report-xlsx-export.test.ts`, this plan, and the
coordinator-installed pinned `@excel.js/exceljs@0.15.0` in `package.json` / `package-lock.json` (no other dependency).
Out: any report query, RPC, schema/RLS, service contract, UI/button/download wiring, KPI definitions (RPT-001),
the nine concrete export column sets, and any date-range / time-zone policy.

## Contract

`buildXlsxExport({ sheetName, filenameBase, columns, rows, filters, exportedAtLabel? })` returns
`{ buffer: Uint8Array, filename, mimeType, rowCount }`.

- **Serializes only what it is given.** It never fetches, filters, sorts, de-duplicates or totals. Authorization and
  filtering belong to the caller; the engine records the caller's filter snapshot on a second sheet, "Bộ lọc"
  (filter label/value pairs, `Số dòng dữ liệu`, optional caller-supplied `Thời điểm xuất`). The caller passes the
  export time as a string so the engine owns no clock or time-zone rule.
- **Explicit columns** (`key`, Vietnamese `header`, `type`: `text` | `vnd` | `integer`). Keys and headers must be
  unique, so two measures (e.g. `Doanh số gộp (Gross Sales)` and `Tiền đã thu (Cash Collected)`) can never be merged
  under one header. The engine does not know what the columns mean and computes no KPI.
- **Money** is a real numeric cell holding a safe integer (`#,##0` format). Floats, NaN, ±Infinity, values beyond
  2^53-1 and strings in `vnd`/`integer` columns are rejected with the row number and header named. Negative integers are
  allowed (returns/adjustments). `null` is an empty cell; a missing key is an error, not a silent blank.
- **Formula injection:** any text (cells, headers, filter labels/values) starting with `= + - @`, tab or CR, also after
  leading whitespace/control characters, is stored with a leading `'`. Cells are written as strings, never formulas.
- **Limits:** 1,048,575 data rows (header takes row 1), 16,384 columns, 32,767 characters per cell, sheet names of
  1-31 characters without `[ ] : * ? / \` or edge apostrophes, and not the reserved filter sheet name. Violations throw
  `XlsxExportError` with a code and a Vietnamese message. Everything is validated before the workbook is built, so a
  bad row fails the whole export rather than producing a partial file.
- **XML safety:** control characters XML 1.0 cannot carry are removed; `& < > "` round-trip losslessly.
- **Filename:** ASCII only (diacritics folded, `đ` → `d`), path separators/unsafe characters removed, ≤ 80 characters
  plus `.xlsx`, Windows reserved device names suffixed, fallback `bao-cao.xlsx`.

## Decisions

- The package ships `index.d.ts` that its `exports` map hides from TypeScript, and the ESM build only has a default
  export (a named `Workbook` import would fail at runtime). The engine imports the default and types the few members
  it uses locally, with one `@ts-expect-error TS7016`, rather than editing tsconfig (outside the write scope).
- Formula escaping uses the visible `'` prefix: it is the OWASP guidance, survives copy-paste and CSV re-export, and is
  visible to a reviewer. The cost is that a legitimate text value such as `-5 ngày` shows a leading `'`.
- A lone CR in text comes back as LF after a read (XML line-end normalization). The prefix is still applied.
- The data sheet has the header in row 1 and no title/total rows so it stays machine-readable and re-importable.

## Acceptance evidence (engine only)

All in `tests/unit/lib/report-xlsx-export.test.ts`, which reopens the generated workbook with the same library:
exact cell values and supplied row order/count (no selection, reordering or dropping); empty result keeps headers and the
filter sheet with `Số dòng dữ liệu = 0`; Gross vs Cash in separate columns with distinct values (cash `0` stays `0`);
duplicate header/key rejected; integer VND and unsafe-number rejection; null/missing keys; formula payloads including
tab/CR/leading space in cells, headers and filter snapshot; XML special and control characters; row, column, sheet-name
and cell limits; filename sanitation.

## Not met by this task (recorded limits)

- "Filter date/location/user/channel" and "Export khớp filter": the engine cannot apply or verify these. It only
  serializes the rows a caller passes and records the filter labels the caller supplies. There is no report query, so
  an export matching a selected filter is **not yet demonstrable**; this needs the report queries (RPT-002..RPT-011) and
  an integration test per export that compares the workbook to the same filtered query.
- "Gross and cash collected not conflated": only the engine-level guarantee (distinct headers/columns, no merging)
  is verified. The actual definitions (TECH §13, RPT-001) and their SQL belong to the report queries.
- The nine concrete exports of TECH §45 (Orders, Customers, Inventory snapshot, Inventory movements, Deliveries,
  Payments, Commission, Production, Transfers), role/permission checks on who may export, audit of exports, UI
  buttons/download, mobile behavior, and large-export strategy (the whole workbook is built in memory) are not done.
- Not validated: DB reset, pgTAP and integration (Docker validation blocked; coordinator runs `task:finish`).

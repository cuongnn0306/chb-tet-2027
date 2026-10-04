# Tiến độ dự án — baseline 02/10/2026

HEAD `9548886`, branch `feature/DEL-001-deliveries`. Kiểm kê theo toàn bộ task ID trong implementation plan. Không coi số task có code là phần trăm hoàn thành/go-live.

Tổng 164 task canonical. Trạng thái: partial: 35; implemented_unreleased: 68; external_not_verified: 7; not_started: 54. **Không task nào được review này chứng nhận Done toàn bộ DoD.**

GitHub: 18 stacked PR OPEN; CI E07 đúng HEAD green gồm DB reset, 111 pgTAP assertions, 17 integration files. Repository đang public, trái INF-001. main protected=true, develop protected=false; chi tiết required checks/bypass và remote staging/production chưa xác minh.

Local: 163 unit tests, lint/typecheck/build/format/env pass. Docker ban đầu không chạy; đã khởi động Docker và Supabase, db reset --local pass, 111 pgTAP assertions và 231 integration tests/17 files pass. Kết quả pipeline mới xem STATUS/report INF-008.

## Cách đọc

| Status                 | Ý nghĩa                                                     |
| ---------------------- | ----------------------------------------------------------- |
| implemented_unreleased | Có code/test; chưa review/merge/staging/mobile đủ DoD       |
| partial                | Có một phần hoặc gap/finding cần xử lý                      |
| not_started            | Chưa có module/task đầy đủ                                  |
| needs_revalidation     | Evidence cũ có, môi trường hiện tại chưa xác minh lại       |
| external_not_verified  | Cần account/infra/UAT/approval hoặc evidence bên ngoài repo |

Đây là snapshot baseline, không tự cập nhật khi Claude code thêm. Đầu phiên đọc STATUS.md + latest reports; update baseline nếu review lại với evidence mới. Machine-readable baseline: backlog.json.

## Thứ tự tiếp tục

1. SEC-007 → PAY-007 → DEL-012 → DEL-011 → DEL-005 → RES-005 → RES-010; kiểm tra RV-09/RV-12 cùng task liên quan, một task mỗi attempt.
2. INF-001/009–012: Owner xác minh private/protection/provisioning; INF-008 sửa staging gating; SEC-004/006/009–011 hardening.
3. E08 Transfer → E09 Production → E10 Return/Exchange → E11 Commission → E12 Reports, theo dependency.
4. E13 đầy đủ, E14 E2E/UAT/mobile/reconciliation → approved go-live.

## E00 — PROJECT FOUNDATION & INFRA

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                                                                                      |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INF-001 | partial                | GitHub repository và main/develop tồn tại; 18 PR OPEN; API private=false trái spec; main protected=true, develop protected=false; required checks/bypass chưa review đầy đủ. |
| INF-002 | implemented_unreleased | Vite/React/TS strict/lint/format/unit/build; local baseline pass, historical CI pass.                                                                                        |
| INF-003 | implemented_unreleased | Supabase CLI dependency có trong package-lock.                                                                                                                               |
| INF-004 | implemented_unreleased | Docker Desktop khởi động thành công; local Supabase start pass trong phiên review; historical CI stack pass.                                                                 |
| INF-005 | implemented_unreleased | 23 migrations; db reset --local pass sau khi khởi động Docker; 111 pgTAP và 231 integration pass.                                                                            |
| INF-006 | partial                | Seed roles/test accounts/master/customers có; chưa có đầy đủ UAT orders/batches/returns dataset.                                                                             |
| INF-007 | implemented_unreleased | Client/function env examples có, không có real env tracked; check:env còn giới hạn RV-11.                                                                                    |
| INF-008 | partial                | Historical CI green; task-report pipeline mới thêm trong phiên này chưa push; staging CI dependency thiếu RV-10.                                                             |
| INF-009 | external_not_verified  | Staging workflow/runbook có; STAGING_CONFIGURED/account/env/project chưa xác minh.                                                                                           |
| INF-010 | external_not_verified  | Production deploy workflow placeholder; account/backup/secrets chưa xác minh.                                                                                                |
| INF-011 | external_not_verified  | Vercel/domain/deploy/config chưa xác minh ngoài runbooks.                                                                                                                    |
| INF-012 | partial                | Env separation documented, local config có; remote env chưa xác minh.                                                                                                        |

## E01 — AUTH, ROLE, MASTER DATA

| Task     | Trạng thái             | Evidence / việc còn lại                                                                                 |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| AUTH-001 | partial                | Email login/session/inactive guard có; PRD phone login còn deferred; mobile/staging chưa kiểm chứng.    |
| AUTH-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| AUTH-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| AUTH-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-001   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-002   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-003   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-004   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-005   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-006   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| MD-007   | implemented_unreleased | Code/migrations/tests + ExecPlan E01; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |

## E02 — CUSTOMER

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| CUS-001 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| CUS-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| CUS-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| CUS-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| CUS-005 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| CUS-006 | implemented_unreleased | Code/migrations/tests + ExecPlan E02; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |

## E03 — ORDER CORE

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| ORD-001 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-005 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-006 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-007 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-008 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-009 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-010 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-011 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-012 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-013 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| ORD-014 | implemented_unreleased | Code/migrations/tests + ExecPlan E03; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |

## E04 — INVENTORY LEDGER & BATCH

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| INV-001 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-005 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-006 | partial                | Paste/CSV import atomic+dry-run; chưa native .xlsx upload theo task gốc.                                |
| INV-007 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-008 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-009 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-010 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| INV-011 | implemented_unreleased | Code/migrations/tests + ExecPlan E04; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |

## E05 — RESERVATION, FEFO, ALLOCATION

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| RES-001 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-003 | partial                | pg_cron/lazy release/admin RPC có; migration catch cron failure, remote scheduled job chưa xác minh.    |
| RES-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-005 | partial                | Setting tồn tại; delivery-date allocation job/lead-time enforcement chưa làm.                           |
| RES-006 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-007 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-008 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-009 | implemented_unreleased | Code/migrations/tests + ExecPlan E05; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| RES-010 | partial                | Suggestions có; ORDER BY cột 5 sai expiry (RV-08); ít split chưa chứng minh.                            |

## E06 — PAYMENT & SEPAY

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| PAY-001 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-004 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-005 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-006 | external_not_verified  | SePay setup runbook có; real staging Test Mode chưa có evidence.                                        |
| PAY-007 | partial                | Edge/RPC/key auth có, HMAC provider mismatch RV-01, account/payload validation gaps RV-02.              |
| PAY-008 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-009 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| PAY-010 | implemented_unreleased | Code/migrations/tests + ExecPlan E06; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |

## E07 — MULTI-DELIVERY

| Task    | Trạng thái             | Evidence / việc còn lại                                                                                 |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| DEL-001 | partial                | Schema/code có; code count concurrency/99+ cần regression RV-09.                                        |
| DEL-002 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-003 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-004 | partial                | Builder ở detail, thiếu order-form flow so với yêu cầu gốc.                                             |
| DEL-005 | partial                | Chọn kho xuất có; UI/RPC allocation chưa hoàn chỉnh theo từng kho/delivery RV-06.                       |
| DEL-006 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-007 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-008 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-009 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-010 | partial                | 31-day grouped list; Calendar View chưa có evidence accepted.                                           |
| DEL-011 | partial                | Atomic SALE_OUT at DELIVERED có; batch pick/reverse delivery/expiry gaps RV-04/05.                      |
| DEL-012 | partial                | Fail+reason/keep reservation có; chưa bảo vệ footprint FAILED RV-03.                                    |
| DEL-013 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-014 | implemented_unreleased | Code/migrations/tests + ExecPlan E07; CI HEAD green lịch sử; PR còn OPEN, staging/mobile chưa xác minh. |
| DEL-015 | partial                | Issue note FEFO slice có; không binding batch theo delivery RV-04.                                      |

## E08 — TRANSFER

| Task    | Trạng thái  | Evidence / việc còn lại                                            |
| ------- | ----------- | ------------------------------------------------------------------ |
| TRF-001 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-002 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-003 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-004 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-005 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-006 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-007 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-008 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| TRF-009 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |

## E09 — PRODUCTION PLANNING

| Task    | Trạng thái  | Evidence / việc còn lại                                            |
| ------- | ----------- | ------------------------------------------------------------------ |
| PRD-001 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-002 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-003 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-004 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-005 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-006 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-007 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-008 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-009 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-010 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| PRD-011 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |

## E10 — RETURN / EXCHANGE

| Task    | Trạng thái  | Evidence / việc còn lại                                            |
| ------- | ----------- | ------------------------------------------------------------------ |
| RET-001 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-002 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-003 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-004 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-005 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-006 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-007 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RET-008 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |

## E11 — COMMISSION

| Task    | Trạng thái  | Evidence / việc còn lại                                                                                            |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| COM-001 | partial     | private.resolve_commission_rate đã có 5-level priority phục vụ ORD-005; chưa module commission/snapshot lifecycle. |
| COM-002 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-003 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-004 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-005 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-006 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-007 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-008 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |
| COM-009 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                                                 |

## E12 — DASHBOARD & REPORTS

| Task    | Trạng thái  | Evidence / việc còn lại                                            |
| ------- | ----------- | ------------------------------------------------------------------ |
| RPT-001 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-002 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-003 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-004 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-005 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-006 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-007 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-008 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-009 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-010 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-011 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |
| RPT-012 | not_started | Không tìm thấy module đầy đủ trong source/migrations tại baseline. |

## E13 — AUDIT, SECURITY, HARDENING

| Task    | Trạng thái  | Evidence / việc còn lại                                                                                                               |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | partial     | private.audit_row_change/helper immutable có; Audit Log UX còn thiếu.                                                                 |
| SEC-002 | partial     | Audit master/order/inventory/payment/delivery có; event review thiếu RV-12; E08+ chưa có.                                             |
| SEC-003 | partial     | RLS integration tests E01–E07 có; epics sau chưa có; local chưa rerun.                                                                |
| SEC-004 | partial     | Ignore env/check-env có; full secret/history/mode scan chưa có RV-11.                                                                 |
| SEC-005 | partial     | React escaping/input validators có; chưa security review/test toàn diện.                                                              |
| SEC-006 | not_started | Không thấy rate/body limit sensitive webhook RV-13.                                                                                   |
| SEC-007 | partial     | API-key/fail-closed có; HMAC contract sai và không timestamp RV-01.                                                                   |
| SEC-008 | partial     | PAY-008 provider-id uniqueness/concurrent duplicate tests có; E13/staging acceptance chưa xác minh.                                   |
| SEC-009 | partial     | DB error mapping/Edge error codes có; centralized errors/correlation/alert chưa đầy đủ.                                               |
| SEC-010 | partial     | Production runbook nêu backup/restore; chưa dedicated recovery runbook/rehearsal evidence.                                            |
| SEC-011 | partial     | Repo public, main protected=true, develop protected=false; Admin platform access/MFA/required checks/bypass chưa review đầy đủ RV-14. |

## E14 — UAT & GO-LIVE

| Task    | Trạng thái            | Evidence / việc còn lại                                                                 |
| ------- | --------------------- | --------------------------------------------------------------------------------------- |
| UAT-001 | partial               | Seed giả có 6 roles/multiple products/locations; complete cross-module dataset chưa có. |
| UAT-002 | partial               | Local integration inventory/reservation concurrency + CI có; staging UAT chưa chạy.     |
| UAT-003 | partial               | Reservation expiry integration/pgTAP có; staging scheduled job UAT chưa chạy.           |
| UAT-004 | partial               | FEFO integration/pgTAP có; delivery-expiry/reverse-pick regression thiếu.               |
| UAT-005 | partial               | 16 delivery integration tests/CI có; full mobile+multi-source UAT chưa chạy.            |
| UAT-006 | not_started           | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                      |
| UAT-007 | not_started           | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                      |
| UAT-008 | external_not_verified | Local historical smoke có; real SePay Test Mode/staging chưa có evidence.               |
| UAT-009 | partial               | Concurrent duplicate webhook tests có; staging provider replay verification chưa có.    |
| UAT-010 | not_started           | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                      |
| UAT-011 | not_started           | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                      |
| UAT-012 | partial               | Current role/RLS tests có; full-system UAT roles chưa đủ.                               |
| UAT-013 | not_started           | Không tìm thấy module đầy đủ trong source/migrations tại baseline.                      |
| UAT-014 | external_not_verified | Chưa có production smoke evidence.                                                      |
| UAT-015 | external_not_verified | Chưa có go-live approval.                                                               |

## Module còn thiếu

Transfers/production/returns/commission lifecycle/reports-export chưa có schema/service/UI hoàn chỉnh. HomePage còn placeholder; Audit Log viewer và user-management/default settings UI chưa đầy đủ. .xlsx upload và calendar/order-form UX cần nghiệm thu so với yêu cầu gốc. tests/e2e chỉ .gitkeep.

Chi tiết risk: [Review](../reviews/2026-10-02-project-review.md). Prompt triển khai: [Claude](CLAUDE_CONTINUE_PROMPT.md). Báo cáo liên tục: [STATUS](STATUS.md).

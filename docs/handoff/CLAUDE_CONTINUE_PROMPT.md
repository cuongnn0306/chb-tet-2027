# Prompt bàn giao cho Claude Code

Copy toàn bộ phần dưới vào Claude đang mở repository `D:\Projects\chb-ban-hang`.
Không tạo agent chạy song song trên cùng checkout. Mỗi lần xử lý một task ID.

---

Bạn tiếp tục triển khai CHB Bánh Chưng Tết 2027. Hãy thực hiện công việc, không chỉ lập kế hoạch.
Đọc AGENTS.md, CLAUDE.md, rồi lần lượt:

1. docs/product/PRD_UIUX_v1.1.md
2. docs/architecture/TECH_DESIGN_v1.0.md
3. docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md
4. ExecPlan liên quan trong docs/exec-plans/active/
5. docs/reviews/2026-10-02-project-review.md
6. docs/handoff/PROJECT_PROGRESS.md, backlog.json, STATUS.md và report mới nhất
7. docs/handoff/WORKFLOW.md

Snapshot review ngày 02/10/2026 ở HEAD 9548886, nhánh feature/DEL-001-deliveries.
Phải kiểm tra git status/log/branch thực tế trước khi sửa; code có thể đã tiến thêm.
Không ghi đè thay đổi sẵn có. Không coi bảng “done” cũ trong ExecPlan là chứng cứ staging/DoD.
E00–E07 đã có phần lớn code; RES-005 còn thiếu. E08–E12 còn thiếu module hoàn chỉnh.
E13 đã có audit/RLS/test một phần, E14 chưa có E2E/UAT hoàn chỉnh.
GitHub review: 18 stacked PR đang OPEN; CI HEAD hiện tại đã green gồm DB tests.
Repository API trả private=false dù INF-001 yêu cầu private: ghi blocker Owner xử lý visibility,
branch protection và access; không suy ra production secret đã lộ hoặc tự đổi thiết lập account.
Branch API cho main protected=true và develop protected=false; kiểm tra required CI checks/bypass,
không coi CI gate mới là đủ nếu nhánh develop chưa được bảo vệ.

## Ưu tiên và thứ tự

Làm từng task theo chuỗi sau; không gom tất cả thành một PR:

1. **SEC-007**: sửa HMAC theo tài liệu chính thức SePay: timestamp header và raw body,
   chữ ký `{timestamp}.{raw_body}`, cửa sổ thời gian chống replay, fail closed.
   Đọc lại tài liệu chính thức vì có thể thay đổi. Giữ API-key mode khi được cấu hình,
   không bắt SePay gửi đồng thời hai cơ chế vốn là các mode thay thế nếu không có quyết định.
   Cập nhật runbook/env example/tests. Test valid provider fixture, payload sửa, thiếu timestamp,
   cũ/tương lai, sai secret; test không có secret. Chạy Edge runtime check/smoke khi khả dụng.
2. **PAY-007**: validation fail closed cho id/direction/amount/destination account,
   malformed payload, missing fields, wrong bank account. Giữ toàn bộ processing atomic.
   Event không hợp lệ không auto-credit; không tự nghĩ ra refund/split policy.
3. **DEL-012**, rồi **DEL-011**, rồi **DEL-005**: giải quyết từng finding giao thất bại,
   pick list/SALE_OUT không khớp khi giao ngược thứ tự, lô hết hạn sau allocation,
   phân bổ theo kho xuất. Dùng migration mới, regression tests thực tế và audit.
   Giữ quy tắc SALE_OUT tại DELIVERED theo TECH_DESIGN §7; §40 có mô tả dispatch mâu thuẫn,
   ghi conflict và ưu tiên phần state machine. Không tự thêm logistics state khi chưa cập nhật spec.
4. **RES-005**: allocation lead time theo setting, delivery date/location/line demand,
   allocation theo từng đợt, job idempotent, không khóa toàn bộ đơn giao xa;
   test clock/timezone, partial allocation, rerun, reschedule, missing setting/cron.
5. **RES-010**: sửa source suggestion đang ORDER BY cột 5 (sellable_qty), không phải expiry;
   regression với các kho có cùng region/coverage nhưng expiry khác nhau.
6. **INF-008**: hoàn thiện gating staging chỉ deploy đúng commit sau CI green; giữ manual
   dispatch có kiểm tra commit đã pass. Pipeline báo cáo đã có; bảo tồn nó.
7. **SEC-004**, **SEC-006**, **SEC-009**, **SEC-010**, **SEC-011**: secret scan thực tế,
   kiểm tra Vite env file/key contents, size/rate limit webhook, logging không lộ PII/secret,
   backup/restore rehearsal và quyền Admin. Audit log viewer chưa có task riêng trong plan:
   ghi scope dưới SEC-001/002 theo PRD, không tự tuyên bố đã đủ Audit UX.
8. Khi các fix tiên quyết đạt local, triển khai **E08 TRF-001..009** theo dependency;
   sau đó **E09 PRD-001..011**, **E10 RET-001..008**, **E11 COM-001..009**,
   **E12 RPT-001..012**, hoàn tất **E13**, và **E14 UAT-001..015**.
   COM-001 resolver đã có trong order SQL, tái sử dụng thay vì làm lại;
   cần kiểm tra snapshot/tie-break và hoa hồng completed + paid full + return adjustments.

## Quy tắc thực hiện

Chọn task đầu tiên còn mở/không được chứng minh đã sửa; xác minh finding với code hiện tại.
Trước code: nêu task ID, dependency, PRD/Tech Design liên quan, file thay đổi và test cần chạy.
Nếu multi-module/migration, tạo ExecPlan riêng task ID. Mọi DB change qua migration mới,
regenerate database.generated.ts từ local DB sau reset; không sửa migration đã dùng ở môi trường khác.
Critical operations qua RPC/transaction, RLS least privilege; frontend chỉ gọi typed services.
VND integer; ledger là nguồn tồn; no-negative; webhook idempotent; audit đủ; no hard-delete transaction.
Test concurrency stock cuối, webhook lặp, qty nhiều delivery, sai quyền/inactive ở server.
UI tiếng Việt có dấu, loading/empty/error/no-permission, và kiểm tra mobile sales/store.
Với DEL-004, INV-006, DEL-010: đọc gap đã ghi trong baseline; chưa có phê duyệt thay đổi UX
thì không tự coi order-detail builder/paste CSV/month list đã đủ yêu cầu gốc.

## Pipeline bắt buộc mỗi task

```bash
npm run task:start -- SEC-007 claude "Sửa xác thực SePay HMAC"
```

Thay SEC-007 bằng task đang xử lý. Điền summary JSON tại tmp/<TASK-ID>-summary.json
theo docs/handoff/summary.example.json. Evidence phải là điều đã chạy/đã thấy.

```bash
npm run task:finish -- SEC-007 tmp/SEC-007-summary.json
```

Lệnh này tự chạy checks và tạo MD/JSON report + cập nhật STATUS/tasks.json.
Nếu fail hoặc bị chặn, vẫn lưu report needs_validation; không gọi Done, không bỏ qua bằng cách sửa report.
Không có Docker thì khởi động local stack khi khả dụng; không reset linked/staging/production.
Commit implementation, ExecPlan, report MD+JSON và STATUS/tasks.json cùng nhau.
Nếu sửa code sau checks, chạy lại start/finish. CI kiểm tra report khớp source hiện tại.

Sau task báo đúng format AGENTS §15, dẫn link report, nêu task tiếp theo.
Tiếp tục task tiếp theo khi dependency đã đạt và không có blocker; không cần hỏi lại cho các
thay đổi local nằm trong scope. Nếu cần tài khoản/provisioning, quyết định business còn mâu thuẫn
hoặc release production, ghi blocker cụ thể và giữ evidence; không tự vượt gate.

## Gate cuối

Chưa được tuyên bố hệ thống sẵn sàng vận hành cho đến khi transfers, production, returns,
commission, reports/export, Audit UX, staging SePay Test Mode, E2E critical path,
UAT/mobile/role/reconciliation, backup, production infra và go-live approval đều có evidence.
Không merge/deploy production chỉ vì tests local green.

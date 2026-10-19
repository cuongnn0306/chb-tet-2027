# Review code, bảo mật và tiến độ — 02/10/2026

Repository: CHB Bánh Chưng Tết 2027. Baseline: HEAD `9548886`, branch
`feature/DEL-001-deliveries`. Working tree sạch khi bắt đầu. Review dựa trên PRD/UIUX v1.1,
Tech Design v1.0, implementation plan, ExecPlans, source/frontend/service/domain,
migrations/RLS/RPC, Edge Function, tests, dependency audit, CI và trạng thái GitHub.

**Kết luận: chưa đủ điều kiện go-live.** Luồng nền từ Auth tới Delivery đã có code
và tests đáng kể, nhưng còn lỗi payment/delivery integrity và các module E08–E12 thiếu.
Không sửa business code trong lần review này; các finding dưới đây là backlog cho Claude.

## Bằng chứng và giới hạn

- Local baseline: lint, typecheck, 163 unit tests/20 files, build, format:check,
  check:env đạt trong lần chạy review trước thay đổi pipeline. Build cảnh báo bundle ~750.70 kB
  (gzip ~210.36 kB). Không coi cảnh báo bundle là build fail.
- `npm audit --json`: 0 vulnerabilities theo registry tại lúc kiểm tra; đây không phải chứng nhận
  code/RLS/webhook an toàn.
- `npx supabase db reset --local` ban đầu fail: Docker Linux engine pipe không tồn tại.
  Đã khởi động Docker Desktop và local Supabase; reset sau đó pass,
  111 pgTAP assertions và 231 integration tests/17 files pass trên checkout này.
  Hai report fail trước đó được giữ nguyên để truy vết. E2E/mobile/staging không chạy trong phiên review.
- GitHub read-only: 18 stacked PR (#1–#18) đều OPEN tại lúc kiểm tra;
  CI cho E07 và bốn PR trước đó đều success. [CI E07](https://github.com/cuongnn0306/chb-tet-2027/actions/runs/36920791380).
  Run E07 đúng HEAD 9548886547e79a5eb21898e287f1303f4bd2fbe9: app và database jobs success,
  111 pgTAP assertions (2 files) và 17 integration test files pass.
  Evidence CI lịch sử không xác minh các chỉnh sửa pipeline chưa push của phiên này.
- Có `.env.local`/function `.env` local bị ignore. `git ls-files` chỉ thấy hai `.env.example`.
  Không đọc/in secret thật ra báo cáo. Chưa chạy secret scanner toàn Git history hoặc rà quyền platform.
- Không kiểm tra UI bằng browser trong phiên này; ghi nhận browser checks cũ của ExecPlans là historical evidence.
  Static review không thay thế kiểm chứng concurrency/DB thực tế; finding ghi rõ nơi cần regression.
- GitHub branch API: main `protected=true`, develop `protected=false`; chưa kiểm tra đầy đủ
  nội dung protection/rulesets, required checks hay quyền bypass của từng người.

## Findings ưu tiên

### RV-01 — P1: HMAC không tương thích SePay và thiếu chống replay (SEC-007)

`supabase/functions/_shared/webhook-auth.ts:48` ký chỉ `rawBody`; endpoint
`supabase/functions/sepay-webhook/index.ts:24–35` không đọc timestamp.
Theo [SePay authentication](https://developer.sepay.vn/en/sepay-webhooks/xac-thuc),
HMAC ký timestamp nối raw body, timestamp ở header riêng và cần cửa sổ thời gian.
Bật mode HMAC theo provider hiện tại sẽ làm request hợp lệ bị từ chối;
helper cũ cũng chấp nhận payload ký theo cách cũ mà không giới hạn tuổi.
Unit test `tests/unit/functions/webhook-auth.test.ts` tự tạo chữ ký body-only nên pass dù contract sai.
Synthetic provider-contract signature đã chạy qua helper local bằng fixture secret giả:
`providerContractSignatureAccepted=false`, tái hiện mismatch; không dùng secret thật.

Fix: provider contract fixture, timestamp parsing/time window, constant-time compare,
fail closed; cập nhật runbook/env và kiểm tra Edge runtime. API key và HMAC là mode
thay thế trong provider; việc cấu hình cả hai nhưng đòi cả hai phải được làm rõ.

### RV-02 — P1: Webhook chưa kiểm tra tài khoản nhận và mặc định direction thiếu là tiền vào (PAY-007)

`supabase/migrations/20261001194323_payments_rpcs.sql:528` dùng missing transferType = `in`;
processor không kiểm tra `accountNumber`/gateway với tài khoản cấu hình trước auto-credit.
Với webhook cấu hình nhiều tài khoản, một giao dịch sang tài khoản khác có code đúng vẫn có thể
được cộng vào đơn. Auth chứng minh người gửi, không chứng minh tiền vào đúng tài khoản chiến dịch.
[SePay payload](https://developer.sepay.vn/en/sepay-webhooks/tich-hop-webhook) có các trường này.

Fix: validate payload bắt buộc và account binding server-side; sai account/direction không credit,
ghi outcome có thể truy vết. Fixtures hiện tại chưa mô phỏng đủ trường provider.

### RV-03 — P1: Hàng giao thất bại được tính lại là còn dùng cho đợt khác (DEL-012)

`supabase/migrations/20261001200342_deliveries_workflow.sql:278` chỉ trừ các đợt
OUT_FOR_DELIVERY khỏi reservation chung. Khi đợt A chuyển FAILED, hàng vẫn ở logistics
nhưng A không còn được trừ. Scenario hợp lệ để test: đơn 10 allocate ở source X 5/source Y 5,
A từ X 5 thất bại và B từ X 5 (plan qty toàn đơn vẫn 10) có thể vượt số thực sẵn có ở X.
Không có binding reservation theo delivery để xác nhận hàng nào đã rời kho.

Fix: giữ footprint logistics của FAILED cho tới nghiệp vụ kho nhận lại theo rule đã duyệt;
không giải phóng ngầm khi đổi status. Regression phải phân biệt hàng còn tại kho với hàng đã đi.

### RV-04 — P1: Phiếu pick và movement có thể khác lô khi giao ngược thứ tự (DEL-011/015)

`delivery_detail` tại `...deliveries_workflow.sql:755–776` chia lô dựa vào thứ tự created_at
của delivery. `consume_order_item_stock` tại `:209–225` luôn lấy reservation FEFO đầu tiên
của cả dòng đơn. A pick lô 1, B pick lô 2; nếu B được xác nhận DELIVERED trước A, ledger
ghi B lấy lô 1. Phiếu xuất và nguồn thực tế không khớp, ảnh hưởng truy vết hàng hoàn.

Fix: binding batch/pick theo delivery trong transaction hoặc giải pháp được spec chấp nhận;
test hai lô, hai deliveries, deliver ngược thứ tự; reprint sau delivered phải dùng ledger đã lưu.

### RV-05 — P1: Không kiểm tra lại lô hết hạn/ngừng hoạt động trước dispatch/deliver (DEL-011)

FEFO allocation lọc ACTIVE và expiry tại ngày allocate trong `...reservations.sql:179`.
`assert_delivery_stock` và `consume_order_item_stock` không áp dụng lại điều kiện batch;
posting chỉ kiểm tra batch thuộc product (`...deliveries_workflow.sql:50–54`).
Lô hết hạn sau allocation vẫn có thể dispatch/deliver. Cần test thay đổi ngày và batch status.
Fix theo inventory sellable/FEFO rules, có xử lý allocation lỗi thời và audit; không tự đổi HSD.

### RV-06 — P1: Chọn kho giao khác nhưng không có luồng phân bổ tương ứng (DEL-005/RES-007)

`src/services/orders.service.ts` allocate không truyền location; UI OrderStockPanel chỉ cho Admin
allocate ở creation location và ẩn khi order đi PREPARING/WAITING_DELIVERY.
RPC `...reservations.sql:551` chỉ nhận CONFIRMED và phân bổ phần thiếu toàn dòng đơn.
Delivery builder cho chọn kho khác; sau full allocation ở kho A, đợt giao kho B không đi được,
không có UI/RPC reallocation theo delivery. Kho cũng không truy cập order allocation UI.

Fix theo từng delivery/item/location và role; không allocate lại toàn ordered qty sau partial delivered.
Test một SKU chia 2 kho, warehouse thao tác, thiếu hàng ở một kho, không double-reserve.

### RV-07 — P1: RES-005 chưa triển khai, đơn giao xa vẫn có thể khóa toàn bộ hàng hiện tại

Setting `allocation_lead_days` tồn tại nhưng không có job đọc ngày giao để allocate đúng thời điểm;
E05/E07 ExecPlans đều thừa nhận chưa làm. RPC manual không có lead-time guard và allocate toàn đơn.
Cần job idempotent, date/location demand, reschedule, thiếu config/cron và kiểm thử timezone.
Không tuyên bố E05 hoàn tất chỉ vì FEFO primitive hoạt động.

### RV-08 — P2: Source recommendation sắp theo nhầm cột (RES-010)

`supabase/migrations/20261001192601_reservations.sql:396` dùng `ORDER BY 5 ASC`;
cột 5 là sellable_qty, cột expiry là 9. Do đó không đảm bảo ưu tiên lô hết hạn sớm,
sau đó biểu thức sellable_qty DESC gần như không giúp tie-break. Sửa tên biểu thức/cột
rõ ràng và thêm regression theo region/coverage/expiry/fewer splits.

### RV-09 — P2: Delivery code phát sinh bằng count không được serialize trước insert (DEL-001)

`...deliveries_schema.sql:83–84` dùng count+1; `save_delivery` đọc order không FOR UPDATE
trước insert. Hai plan đồng thời có thể tính cùng code, unique constraint làm một request fail
dù tổng quantity hợp lệ. Existing concurrency test “một thắng” không chứng minh lỗi qty là lý do.
Code suffix dùng `lpad(...,2,'0')` cũng cần kiểm tra khi có >99 đợt.
Fix counter/lock strategy, test hai plan hợp lệ cùng thành công và hai plan over-qty bị chặn đúng rule.

### RV-10 — P1: Staging migration có thể chạy trước CI green (INF-008/009)

`.github/workflows/staging.yml:10–13,35–36` chạy độc lập trên push develop và workflow_dispatch,
không có dependency vào kết quả CI cùng commit. `db push --dry-run` không thay thế tests.
Workflow production chỉ là placeholder echo thành công, chưa deploy thực.
Fix gating commit chính xác + environment protections + smoke/Edge deployment theo runbook;
không tự bật staging/prod hay tạo secret/account trong task review này.

### RV-11 — P2: Env check chưa kiểm tra các file Vite thực sự tải (SEC-004)

`scripts/check-env.ts` chỉ xem process.env và tên biến, không load `.env.local`/`.env.production`,
không phát hiện service-role JWT bị đặt vào biến tên hợp lệ VITE_SUPABASE_ANON_KEY.
CI gốc chưa chạy check này. Pipeline mới thêm CI check:env nhưng giới hạn của script vẫn còn.
Fix scanner kiểm tra file/mode/key type không in giá trị; secret scan Git history riêng.

### RV-12 — P2: Audit payment event review còn thiếu (SEC-002)

`payment_events` có guard bảo vệ payload, nhưng không có `audit_row_change` trigger.
`dismiss_payment_event` có thể ghi đè note/resolution mà không có before/after audit;
`assign_payment_event` có payment audit nhưng không giữ toàn bộ event decision history.
Thêm audit cho action Admin và regression reason/actor/immutability phù hợp.

### RV-13 — P2: Sensitive endpoint chưa có request size/rate limit (SEC-006)

Edge endpoint gọi request.text() trước auth, không có body-size bound hoặc rate limit;
requests lỗi có thể tiêu thụ tài nguyên/log. Thêm giới hạn ở gateway/endpoint theo tài liệu
platform và tests. Không tự giảm an toàn bằng cách tắt auth/RLS.

### RV-14 — P1: Repository đang public, trái output INF-001

`gh api repos/cuongnn0306/chb-tet-2027` trả `private: false` tại lúc review.
INF-001 yêu cầu private repository cho hệ thống nội bộ. Code, schema, workflow,
seed/test credential giả và báo cáo nội bộ hiện có thể đọc công khai.
Không phát hiện bằng chứng secret production đã commit trong kiểm tra đường dẫn;
không suy ra đã leak secret chỉ vì repo public. Chưa scan toàn history.
Branch API cũng trả main protected=true nhưng develop protected=false; đường PR vào staging
chưa có branch protection được chứng minh. Owner cần xử lý visibility/develop protection/access theo INF-001/SEC-011;
không tự thay đổi thiết lập GitHub trong task review này.

## Những phần tốt cần bảo tồn

- Feature/service/domain separation, TS strict, format money/date tập trung.
- Role lấy từ profile/server-managed app_metadata, không từ user-editable metadata.
- RLS từ đầu, anon revoked, critical writes qua RPC, security definer với search_path rỗng.
- Ledger immutable, balance cache được guard, row locks/checks chống âm,
  reservations TTL/FEFO/safety, reconciliation RPC và concurrency tests đã có.
- Payment idempotency theo SePay id có unique constraint + order lock;
  provider docs xác nhận id ổn định khi retry. Không coi referenceCode khác là lỗi dedup đã chứng minh.
- Customer/order/payment visibility server-side; audit master/order/inventory/payment;
  generated DB types đã có deliveries/payment RPCs.
- Existing integration chỉ localhost, seed giả, `.env` ignored.

## Gaps sản phẩm / tài liệu cần đối chiếu

- INV-006 là paste/CSV, chưa upload native .xlsx như task gốc.
- DEL-004 builder ở order detail; sales flow gốc yêu cầu nhập delivery ngay khi tạo order.
- DEL-010 là list 31 ngày; Calendar View chưa có evidence đã được user nghiệm thu.
- Admin user-management UI và Audit Log viewer thiếu; profile defaults chưa có UI thiết lập đầy đủ.
- Dashboard HomePage là placeholder; transfers/production/returns/commission entries/reports/export chưa có.
- COM-001 SQL resolver có sẵn; không có commission lifecycle completed+paid full/returns/finalize.
- Tests/e2e chỉ .gitkeep; chưa có Playwright critical path hay mobile verification mới.
- Warehouse xem logistics toàn hệ thống là quyết định triển khai cũ; rà lại least privilege với vận hành.
- PRD nói store xem mình/cơ sở, Tech Design RLS ưu tiên owner/creator; giữ concern ownership,
  ghi conflict, chỉ xin quyết định khi feature thực sự phụ thuộc yêu cầu location visibility.
- Tech Design §7 SALE_OUT tại DELIVERED mâu thuẫn §40 dispatch consume; code hiện theo §7.
- Production schema/status STOCKED cũng cần làm rõ §3/§9 trước E09, không thêm status tùy tiện.

## Kế hoạch tiếp theo

Thực hiện các finding P1 trên task canonical tương ứng trước E08.
Sau đó E08 → E09 → E10 → E11 → E12, E13 xuyên suốt, E14/UAT và infra go-live cuối.
Các task chưa có evidence không được gọi Done. Chi tiết từng ID trong
[PROJECT_PROGRESS](../handoff/PROJECT_PROGRESS.md) và [Claude prompt](../handoff/CLAUDE_CONTINUE_PROMPT.md).

Pipeline bàn giao mới: MD/JSON mỗi attempt, STATUS/tasks registry, CI freshness gate và
artifact download. Kết quả kiểm tra thay đổi mới nằm trong report INF-008; review baseline
ở đây không tự chứng nhận pipeline đã pass local DB/GitHub/staging.

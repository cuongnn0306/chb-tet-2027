# SEC-005: rà soát XSS và làm sạch đầu vào (ExecPlan)

Task: SEC-005 (E13), agent claude. Deliverable: [`docs/runbooks/XSS_INPUT_REVIEW.md`](../../runbooks/XSS_INPUT_REVIEW.md).
Chỉ tài liệu: không sửa source, migration, RPC, RLS; không cloud, không DB, không đọc env/credential; không commit/push/deploy.

## Phụ thuộc

Task không có phụ thuộc kỹ thuật được ghi trong implementation plan (mục SEC-005 chỉ có tiêu đề). Rà soát cần
code hiện có (E01–E07) và đã được đọc từ snapshot. Chi tiết nghiệm thu không được bịa; xem "Giả định" bên dưới.

## Giả định và hạn chế

- Implementation plan không nêu tiêu chí nghiệm thu cho SEC-005. Tiêu chí dưới đây lấy từ yêu cầu của attempt này, không phải spec đã duyệt.
- Snapshot = worktree coordinator tại HEAD `9548886` + thay đổi chưa commit có sẵn. Thay đổi về delivery/logging ở root checkout **không có**
  trong snapshot nên không được rà soát.
- Attempt kế thừa `CHB_DB_VALIDATION_BLOCKER`: mọi kiểm tra DB là `not_run`; không reset, không truy cập DB trực tiếp.
- Lệnh vitest **tập trung riêng** bị chế độ quyền từ chối; không dùng đường vòng, nên các test tập trung là `not_run`. Tuy vậy
  `npm test` (bộ unit test đầy đủ có sẵn) **đã chạy trong pipeline `task:finish`** của attempt đầu: pass, 21 file / 174 test. Đây là bộ
  test sẵn có, không test nào được thêm cho SEC-005 và không test nào kiểm tra phát hiện F1–F10; nó không chứng minh XSS/đầu vào an toàn.
- Tên tệp deliverable: phạm vi ghi do điều phối đặt trước ghi `docs/runbooks/INPUT_SECURITY_REVIEW.md`, nhưng deliverable thật là
  `docs/runbooks/XSS_INPUT_REVIEW.md` (tệp kia chưa từng được tạo). Phạm vi của lần sửa này là `XSS_INPUT_REVIEW.md` + ExecPlan này.
- Dọn dữ liệu giả khi chạy S1–S7 **không được là xóa cứng** (AGENTS.md §4, §16): dùng DB dùng một lần hoặc fixture cô lập rồi vô
  hiệu hóa kèm lý do và Audit Log (runbook §5).

## Công việc

| #   | Việc                                                                                                             | Trạng thái                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Đọc AGENTS, handoff, quy trình, báo cáo gần nhất, plan; kiểm tra registry (không có SEC-005 dở dang)             | Xong                               |
| 2   | Quét sink HTML/URL/CSV/lưu trữ trong `src/`; đọc trang in, validation, nhập CSV, QR, Edge Function, SQL tìm kiếm | Xong (có lấy mẫu)                  |
| 3   | Viết runbook với phát hiện, mức độ, file, chuỗi giả để tái hiện, task theo dõi                                   | Xong                               |
| 4   | Chạy test tập trung hiện có                                                                                      | **not_run** (bị từ chối)           |
| 5   | Chạy tái hiện S1–S7 trên local/staging                                                                           | **Chưa làm** (cần DB, trình duyệt) |
| 6   | Sửa lỗi                                                                                                          | **Ngoài phạm vi**                  |
| 7   | `npx prettier --write` trên các file tài liệu của task trước khi finish                                          | Xem báo cáo finish                 |

## Phát hiện (tóm tắt; chi tiết ở runbook §3–§4)

F1 không có sink HTML thô (đã lấy mẫu) · F2 thiếu CSP/header (Trung bình) · F3 QR bên thứ ba (Thấp) · F4 không giới hạn độ dài (Thấp) ·
F5 SĐT chỉ kiểm tra ở client (Thấp) · F6 bộ lọc `.or()` danh sách đơn (Thấp) · F7 công thức CSV/Excel khi có RPT-012 (Trung bình, dự kiến) ·
F8 hiển thị `payload.content` không kiểm tra kiểu (Thấp) · F9 điều hướng, không thấy open redirect · F10 kích thước thân webhook (Thấp).
Không có phát hiện Cao/Nghiêm trọng trong phần đã đọc; điều đó không chứng minh phần chưa đọc là an toàn.

## Tiêu chí nghiệm thu (của attempt này)

| Tiêu chí                                                                               | Trạng thái     | Bằng chứng/lý do                                |
| -------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------- |
| Phát hiện thực tế, có tái hiện bằng chuỗi giả, mức độ, file, task theo dõi canonical   | met (tài liệu) | Runbook §3–§6. Tái hiện suy từ code, chưa chạy. |
| Phân biệt escaping và business validation; mã hiện có và module dự kiến                | met (tài liệu) | Runbook §1, §4.                                 |
| Không tuyên bố phần chưa lấy mẫu là an toàn; nêu thay đổi root không có trong snapshot | met (tài liệu) | Runbook §1, §2.                                 |
| Test tập trung đã chạy và đạt                                                          | not_verified   | Lệnh bị từ chối bởi chế độ quyền.               |
| Kiểm tra DB / tích hợp                                                                 | not_run        | `CHB_DB_VALIDATION_BLOCKER`.                    |
| XSS không tái hiện được trên trình duyệt thật (local/staging)                          | not_verified   | Chưa chạy S1–S7.                                |
| Mobile, staging, review bên ngoài                                                      | not_verified   | Ngoài phạm vi.                                  |
| Sửa lỗi đã áp dụng                                                                     | not_started    | Documentation-only.                             |

## Bước tiếp theo

1. Khi DB local không còn bị chặn và root delivery/logging đã hợp nhất: attempt SEC-005 mới (một `task:start`) để chạy S1–S7 và mở rộng rà soát.
2. Attempt có sửa code riêng (F6, F8) cần phê duyệt; thêm unit test.
3. INF-011 (CSP/header), RPT-012 (vô hiệu hóa công thức), SEC-006/SEC-009 (kích thước thân, log) theo bảng runbook §6.
4. Owner quyết định giới hạn độ dài và quy tắc SĐT phía DB (F4, F5) trước khi có migration.

SEC-005 vẫn `needs_validation`; không được gọi Done.

## Hiệu đính sau review độc lập (03/10/2026, attempt claude thứ hai)

Chỉ tài liệu (`XSS_INPUT_REVIEW.md` và ExecPlan này); không sửa source, schema, RPC, RLS. Báo cáo cũ giữ nguyên. Chi tiết từng finding và
nơi đã sửa: runbook §9. Tóm tắt: dọn dữ liệu giả không xóa cứng; đối chiếu 174 unit test của pipeline với lệnh tập trung bị từ chối; `dry_run`
không lưu gì; parser viết hoa mã; ví dụ CSV 6 cột trích dẫn đúng; F8 gồm `gateway`/`transferAmount`; F6 ghi rõ chưa kiểm chứng; tên tệp deliverable.

Trạng thái: **needs_validation**. Vẫn chưa chạy S1–S7 trên trình duyệt thật, chưa rà soát các file "chưa rà soát", chưa có staging/mobile. DB checks
`not_run` theo blocker kế thừa (không reset, không truy cập DB trực tiếp trong attempt này). Không gọi Done.

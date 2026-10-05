# Quyết định và kế hoạch commit cho các thay đổi đang treo: 04/10/2026

Người lập: Claude (phiên tương tác). Người dùng giao toàn quyền chọn phương án tối ưu. Văn bản này ghi **quyết định đã chọn và lý do**; kết quả nằm ở `git log`.
**Chỉ commit local. Không `git push`, không mở PR, không đổi nhánh của người khác.**

## 1. Hiện trạng trước khi commit

- Nhánh `feature/DEL-012-failed-logistics`, HEAD `9548886` (commit E07). Từ đó chưa có commit nào; có **252 file** thay đổi chưa commit, tất cả chưa staged.
- Mọi kiểm chứng (pipeline, DB reset, pgTAP, integration) đã chạy trên **cây làm việc tích lũy**. Báo cáo gần nhất: `TRF-001-2026-10-04T14-59-42-545Z`
  (mọi check đạt; trạng thái vẫn `needs_validation` vì acceptance chưa kiểm chứng). Không có task nào đang `in_progress`, không có khóa DB.
- Quét bí mật trên mọi file sẽ commit: **sạch** (chỉ chuỗi giả trong test và các regex che bí mật). Không có `.env` thật, không có file lớn.

## 2. Phương án đã chọn: B có hiệu chỉnh

Sáu commit theo thứ tự phụ thuộc, mọi file thuộc đúng một nhóm:

| Nhóm    | Nội dung                                                                                                                                                                | File |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| G0      | Hạ tầng và tài liệu: INF-008 (pipeline, `scripts/*`, `tests/pipeline`, `.github`, `package.json`), SEC-011, `docs/handoff`, `docs/reviews`, báo cáo INF-008             | 131  |
| G1      | Webhook: SEC-007, PAY-007, SEC-006, SEC-009: `supabase/functions/**`, migration `…040000`, `…050000`, test, `SEPAY_SETUP`, báo cáo                                      | 29   |
| G2      | Giao hàng: DEL-012, DEL-011, DEL-005: migration `…060000`, `…070000`, `…080000`, `…090000`, UI giao hàng, test, ExecPlan, **`database.generated.ts`** (xem §3), báo cáo | 34   |
| G3      | RES-005: migration `…100000`, pgTAP, integration, ExecPlan, báo cáo                                                                                                     | 9    |
| G4      | TRF-001: migration `…110000`, pgTAP, integration, unit, `src/{domain,features}/transfers`, service, router/menu, báo cáo                                                | 25   |
| G5      | Sổ đăng ký `tasks.json` và bảng `STATUS.md` (tách riêng để chúng chỉ tham chiếu báo cáo đã có trong cây)                                                                | 2    |
| (ngoài) | `AUTOMATION_STATE.json`, `PARALLEL_STATUS.md` và 20 prompt trong `claude-inbox`: **cố ý không commit**, vẫn nằm nguyên trên đĩa                                         | 22   |

Lý do từng lựa chọn:

- **Không chọn một commit snapshot (A):** lịch sử một khối khó xem lại, khó hoàn tác từng phần. Không chọn commit theo từng task ID: 10 file bị nhiều task cùng sửa
  (ví dụ `sepay-webhook/index.ts` bốn task, `database.generated.ts` năm task), tách phải chia theo hunk mà môi trường này không hỗ trợ.
- **Nhóm theo phụ thuộc:** migration giữ nguyên thứ tự thời gian; mã giao hàng gọi RPC qua bộ trợ giúp không kiểu và TRF-001 dùng cast cấu trúc.
  `database.generated.ts` là ngoại lệ: lớp G2 cần bảng `delivery_item_batches`, nên file này nằm ở G2 (xem §3).
- **Loại tệp biến động của điều phối:** chúng được ghi lại thường xuyên; commit chúng chụp một trạng thái đang di chuyển và dễ xung đột. Điều phối quyết định số phận của chúng.
- **`tasks.json` và `STATUS.md` đi cuối (G5):** chúng liệt kê báo cáo của mọi task; để cuối bảo đảm mỗi báo cáo được tham chiếu đã nằm trong cây.
- **Nhánh tích hợp mới `feature/integration-e07-e08-20261004`:** nhánh hiện tại mang tên một task nhưng chứa công việc của nhiều task; commit trên nhánh mới giữ nguyên nhánh cũ tại `9548886`.

## 3. Cách xác minh từng lớp (không chỉ cây cuối)

Cây trung gian chưa từng được pipeline chạy. Sau khi commit, mỗi commit được kiểm tra trong một git worktree tạm **có `node_modules` riêng (`npm ci`)**, không chạm DB dùng chung:
`typecheck`, `lint` và toàn bộ unit test (cộng bộ test pipeline ở lớp đầu và lớp cuối). Pipeline đầy đủ cùng DB reset, pgTAP và integration **chỉ** có cho cây cuối (đã chạy).

Kết quả của lần xác minh đầu tiên đã sửa hai lỗi mà chỉ kiểm tra từng lớp mới thấy:

1. **`safe-log.test.ts` không an toàn với CRLF:** test cắt bình luận bằng `split("\n")`, nên trên một checkout Windows có `autocrlf` (dòng kết thúc CRLF) bình luận còn lại và test thất bại;
   cây làm việc gốc có LF nên không thấy. Đã sửa bằng `split(/\r?\n/)`.
2. **`database.generated.ts` đặt sai lớp:** nằm ở G4 nhưng G2 và G3 gọi `.from("delivery_item_batches")` có kiểu, nên typecheck của hai lớp đó thất bại. Đã chuyển sang G2.

Sự cố trong quá trình làm: tôi dùng liên kết junction cho `node_modules` của worktree tạm, và `git worktree remove --force` đã đi theo liên kết, **làm rỗng `node_modules` của root**. Đã khôi phục bằng
`npm ci` (lockfile không đổi) và ghi bài học vào memory; các lần xác minh sau dùng `npm ci` riêng cho từng worktree.

## 4. Những gì vẫn chưa xong sau commit

- **Cổng CI `task:verify`** đòi một báo cáo `validated_local` khớp cây hiện tại; chưa có báo cáo nào đạt vì acceptance còn `not_verified` (staging, mobile, review). PR sẽ đỏ ở bước đó dù mọi check kỹ thuật đạt.
  Cần quyết định chính sách của Owner/điều phối.
- Đẩy nhánh, mở PR, và quan hệ với 18 PR đang xếp chồng: **chưa làm**, cần người dùng cho phép.
- `AUTOMATION_STATE.json` do điều phối ghi có thể làm `format:check` đỏ trở lại.

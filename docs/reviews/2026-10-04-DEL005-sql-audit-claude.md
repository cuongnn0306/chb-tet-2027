# Kiểm toán SQL DEL-005 (phân bổ hàng theo từng đợt giao): 04/10/2026

Người thực hiện: Claude (phiên tương tác, theo yêu cầu của người dùng). Đây là **bản đọc và phân tích**, không phải một attempt triển khai:
không `task:start`/`task:finish`, không sửa source, không báo cáo pipeline mới. Không dùng để gọi DEL-005 là Done.

## 1. Phạm vi và phương pháp

Đã đọc đủ (không lấy mẫu):

- `supabase/migrations/20261003080000_delivery_source_allocation.sql` (707 dòng): bảng `delivery_stock_allocations`, các hàm kế toán
  (`reserved_physical_qty`, `delivery_open_qty`, `bound_batch_qty`, `delivery_stock_coverage`, `releasable_surplus_qty`), `stock_quota`,
  `reserve_line_stock`, `release_line_stock`, bộ gắn lô `bind_delivery_item_batches`, RPC `allocate_delivery_stock` và
  `delivery_allocation_status`.
- `supabase/migrations/20261004090000_delivery_allocation_coverage_cap.sql` (bản sửa trần độ phủ).
- Đối chiếu: `assert_delivery_stock` (DEL-012), phần RES-005 tái sử dụng lõi phân bổ (chỉ các điểm đặt cờ), `order_items` (unique
  `(order_id, product_id)`), các test `deliveries-source-allocation.test.ts`.
- **Thực nghiệm chỉ-đọc:** 7 truy vấn bất biến (và một truy vấn đếm dòng) chạy trên DB local trong một giao dịch `READ ONLY` rồi `ROLLBACK`, dữ liệu là kết quả của lần chạy
  integration gần nhất (202 dòng đơn). Chúng được chạy **trực tiếp bằng `psql`, không qua `task:finish`**, nên không nằm trong báo cáo pipeline nào.
  Không có thay đổi dữ liệu nào. Truy vấn gọi `verify_inventory_balances` bị từ chối vì cần phiên Admin (nên không được tính); hàm đó đã được các test integration
  khẳng định riêng.

Không làm: không chạy test mới, không tái hiện đồng thời hai giao dịch, không kiểm tra trình duyệt/mobile/staging, không rà RES-005 hay DEL-011 ngoài các điểm giao.

## 2. Kết luận

**Không tìm thấy lỗi đúng-sai dữ liệu mức P1/P2 trong phần đã đọc.** Mọi bất biến đo được đều đúng. Có 4 quan sát mức thấp (§4); không quan sát nào là bằng chứng
đã xảy ra sự cố. Kết luận này chỉ áp dụng cho phần đã đọc và cho dữ liệu của bộ test hiện có, **không** phải chứng nhận an toàn.

## 3. Bất biến đã đo (DB local, 202 dòng đơn, chỉ đọc)

| Bất biến                                                                                           | Vi phạm |
| -------------------------------------------------------------------------------------------------- | ------- |
| `order_items.allocated_quantity` = tổng hàng đang giữ (`ACTIVE` `PHYSICAL_ALLOCATION`) của dòng    | 0       |
| `delivered_quantity` = tổng số lượng các đợt `DELIVERED` của dòng                                  | 0       |
| `allocated_quantity + delivered_quantity <= quantity` (không hứa quá số đặt)                       | 0       |
| Mỗi đợt đã rời kho và chưa đóng: tổng lô đã gắn (`delivery_item_batches`) = số lượng của dòng giao | 0       |
| Mỗi đợt `DELIVERED`: tổng lô đã gắn = tổng `SALE_OUT` đã ghi trong sổ kho                          | 0       |
| Hàng đang ở logistics tại kho nguồn không vượt hàng đang giữ ở kho đó (theo dòng đơn và kho)       | 0       |
| `inventory_balances`: không âm, `reserved_qty <= available_qty`                                    | 0       |

## 4. Quan sát

Mức độ theo ảnh hưởng, đều thấp. "Suy luận" nghĩa là rút ra từ việc đọc code, chưa tái hiện.

### Q1 (P3, suy luận): thứ tự khóa giữa các kho có thể gây deadlock hiếm

`allocate_delivery_stock` khóa theo thứ tự: đợt giao, đơn, các dòng số dư tại **kho nguồn** (`stock_quota` ở khâu lập kế hoạch, theo FEFO), dòng đơn, rồi — khi giải phóng phần dư —
khóa các reservation của đơn và cập nhật số dư tại **kho khác** (`release_line_stock`). Hai đơn khác nhau chuyển phân bổ giữa cùng cặp kho theo hai chiều ngược nhau cùng lúc
(đơn A lấy từ Y, nhả ở X; đơn B lấy từ X, nhả ở Y) có thể giữ khóa chéo. PostgreSQL phát hiện và hủy một giao dịch với `40P01`. Giao dịch bị hủy được hoàn tác nguyên vẹn,
không hỏng dữ liệu; thử lại thành công. Chưa tái hiện; cần nhiều hơn một test hai-giao-dịch để xác nhận. Nếu muốn loại bỏ: khóa trước toàn bộ số dư sẽ chạm tới theo một
thứ tự toàn cục (kho, sản phẩm, hạn dùng) rồi mới ghi. Cũng nên cho `describeDbError` một thông báo thử lại cho `40P01`.

### Q2 (P3, đã ghi trong ExecPlan): độ phủ theo từng đợt chỉ mang tính tư vấn so với cổng xuất kho

Cổng `assert_delivery_stock` kiểm tra hàng giữ ở kho nguồn trừ hàng đang ở logistics của đợt khác; nó **không** dùng phần "đã phân bổ riêng cho đợt này".
Hệ quả có thể xảy ra: kho nguồn giữ 5, đợt D1 (đã được phân bổ riêng 5) và D2 (chưa phân bổ, cùng kho nguồn). Màn hình báo D2 còn thiếu, nhưng D2 vẫn xuất kho được trước D1 và chiếm số hàng của D1; khi đó D1 bị
cổng chặn. Không có sử dụng hàng hai lần và không có tồn kho âm, chỉ là thứ tự ưu tiên không khớp với cách hiển thị. ExecPlan đã ghi đây là quyết định còn mở (siết cổng sẽ đổi hợp đồng RPC hiện có).

### Q3 (P3): các bảng "chỉ thêm" không chặn TRUNCATE ở mức trigger

Các bảng sổ phụ `delivery_stock_allocations` (chỉ thêm: trigger chặn UPDATE/DELETE), `delivery_item_batches` và `inventory_reservations` có từ trước (ghi qua cờ `app.inventory_posting`) đều được thu hồi
INSERT/UPDATE/DELETE/TRUNCATE khỏi `authenticated`, nhưng không có trigger chặn `TRUNCATE` như `inventory_movements`, `audit_logs`, `order_status_history` và `transfers`. Vai trò service hoặc chủ sở hữu vẫn có thể `TRUNCATE`.
Không thể dùng từ trình duyệt. Nếu muốn cùng mức bảo vệ với sổ kho và audit, cần một migration mới thêm trigger cấp câu lệnh; đây là thay đổi lược đồ nên cần phê duyệt.

### Q4 (thông tin): không có đối chiếu toàn cục cho `allocated_quantity`

`verify_inventory_balances()` đối chiếu số dư với sổ kho và hàng đang giữ, nhưng không so `order_items.allocated_quantity` với hàng đang giữ. Hiện có ba nơi ghi
cache này (`reserve_line_stock`, `release_line_stock`, tiêu thụ khi giao) và truy vấn ở §3 cho kết quả đúng, nhưng không có kiểm tra thường trực nào phát hiện lệch sau này.
Đề xuất: thêm bất biến đó vào hàm đối chiếu hoặc vào một test pgTAP chạy sau các kịch bản phân bổ.

## 5. Những gì đã kiểm tra và đúng

- **Quyền:** cả hai RPC công khai kiểm tra vai trò Admin/Kho trước mọi thao tác (`42501`); tồn an toàn chỉ Admin; mọi hàm trợ giúp ở schema `private`, thu hồi quyền khỏi `public/anon/authenticated`;
  `SECURITY DEFINER` luôn có `set search_path = ''` và tên được xác định schema. RLS của `delivery_stock_allocations`: chỉ Admin/Kho đọc, không client ghi.
- **Nguyên tử và idempotent:** một giao dịch; thiếu hàng trả kết quả mà không đổi gì; gọi lặp hoặc đồng thời cho cùng đợt giao được tuần tự hóa bởi khóa đợt giao và khóa đơn, lần sau không còn gì để đặt
  (không ghi audit khi không có thay đổi).
- **Không âm tồn và không đặt trùng:** chỉ đặt đúng khoảng thiếu của đợt tại kho nguồn; `CHECK` của số dư chặn đặt quá số khả dụng; phần giải phóng chỉ lấy hàng dư, lô hết hạn muộn trước, và không bao giờ
  lấy lô đã gắn cho hàng đang ở logistics hay số lượng mà đợt mở khác cần; kiểm tra `allocated + delivered + requested <= quantity` trước khi đặt.
- **Không đặt lại phần đã giao:** `v_over` dùng `quantity - delivered_quantity`, nên đợt giao một phần không làm phân bổ cả đơn lặp lại số đã giao.
- **Bản sửa trần độ phủ đúng hướng:** độ phủ được ghi cho một đợt không vượt số lượng của đợt và không vượt số đang giữ thật tại kho; thứ tự ưu tiên của đợt đang ở logistics đúng như DEL-012.
- **Bộ gắn lô:** gắn theo phần còn trống mỗi lô (không theo vị trí hàng đợi), có kiểm tra lô còn bán được (DEL-011), chỉ gắn lần xuất kho đầu; truy vấn 4 và 5 ở §3 xác nhận kết quả khớp số lượng và sổ kho.
- **Audit:** reservation đi qua trigger audit có sẵn kèm lý do, bản ghi phân bổ có trigger audit, và một dòng `audit_logs` rõ ràng cho mỗi lần thay đổi thực sự.
- **Dòng đơn trùng sản phẩm:** `order_items` có ràng buộc duy nhất `(order_id, product_id)`, nên không có trường hợp hai dòng cùng sản phẩm tranh một hạn mức.

## 6. Bằng chứng chưa có (DEL-005 vẫn chưa Done)

Hai-giao-dịch cho Q1; đối chiếu `allocated_quantity` thường trực (Q4); trình duyệt, mobile, staging; review độc lập của người khác; quyết định Q2 và Q3.
`src/types/database.generated.ts` được pipeline sinh ở các lần chạy sau (TRF-001: không đổi) nên trở ngại sinh kiểu đã được giải quyết.

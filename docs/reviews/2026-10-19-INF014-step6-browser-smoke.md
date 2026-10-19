# INF-014 Bước 6: kiểm tra nhanh trên trình duyệt (19/10/2026)

Người thực hiện: Claude, trên cây tích hợp `integration/wave-2` tại `d146eeb`, Vite dev server cục bộ (`127.0.0.1:5173`) nối với Supabase local (39 migration, khớp với nhánh). Dùng hai tài khoản thử nghiệm của seed local (Admin, Sale). Không đụng tới dữ liệu thật, staging hay production. **Đây là kiểm tra khói có chủ đích, không phải QA đầy đủ và không thay thế nghiệm thu di động hay staging.**

## Đã chạy

| Việc                                     | Kết quả                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đăng nhập Admin                          | Vào được trang chủ, menu đầy đủ                                                                                                                                                                                                                                                                                                                                |
| AUTH-002 `/admin/profile-defaults`       | Liệt kê 10 người dùng; nút "Sửa mặc định" mở biểu mẫu (điểm tạo đơn, kênh bán, nguồn khách, "Lưu mặc định", "Quay lại"). **Không bấm Lưu.**                                                                                                                                                                                                                    |
| DEL-010 lịch giao hàng, tab "Lịch tháng" | Hiển thị "Tháng 10/2026", 7 cột thứ (bắt đầu từ thứ hai), số đợt giao mỗi ngày kèm cảnh báo "Thiếu hàng", nút tháng trước/hôm nay/tháng sau, và danh sách đợt của ngày chọn bên dưới. Nút "Phân bổ hàng" (DEL-005) vẫn có.                                                                                                                                     |
| Trang khác, Admin                        | `/customers`, `/orders`, `/inventory`, `/audit-log`, `/transfers`, `/payments/review`, `/inventory/import` (nhắc chọn file Excel .xlsx/CSV), `/inventory/movements` đều hiển thị nội dung đúng, **không có lỗi console**                                                                                                                                       |
| Màn hình 375 px (điện thoại), 2 trang    | Không tràn ngang cấp trang (0 px). Lưới lịch tháng nằm trong vùng cuộn ngang riêng, đúng như ExecPlan DEL-010 mô tả. Ô ngày cao 64 px, nút "Sửa mặc định" cao 44 px. Biểu mẫu mặc định hiển thị đủ trường.                                                                                                                                                     |
| Đổi tài khoản Admin → Sale               | Sau khi đăng nhập Sale, trang quản trị cuối cùng bị từ chối ("Bạn chưa có quyền truy cập"); `/audit-log` và `/payments/review` cũng bị từ chối; menu Sale không có mục của Admin; trang giao hàng đổi tiêu đề thành "Các đợt giao của đơn do bạn phụ trách" và **không có** nút "Phân bổ hàng"; không có lỗi console. Dữ liệu cache của Admin không xuất hiện. |

## Không chạy (không được coi là đã kiểm chứng)

- Mọi thao tác ghi: tạo đơn, lưu mặc định, phân bổ, xuất kho, thanh toán, nhập tồn bằng file thật.
- In phiếu, mobile thật (chỉ giả lập khổ 375 px trong một trình duyệt), trình duyệt khác, bàn phím và trợ năng.
- Vai trò khác ngoài Admin và Sale (kho, sản xuất, cửa hàng, franchise).
- Dữ liệu lớn hoặc dữ liệu thật; DB local chứa nhiều dòng thử nghiệm do bộ integration tạo (danh sách kho rất dài trong biểu mẫu).

## Kết luận

Các phần giao diện mới của Bước 6 (hồ sơ mặc định AUTH-002, lịch tháng DEL-010, cô lập quyền và cache theo tài khoản) chạy đúng ở mức khói và không có lỗi console. Nghiệm thu di động, trình duyệt chéo và luồng ghi vẫn **chưa được thực hiện**.

# Quyết định nghiệp vụ được Owner chốt ngày 17/10/2026

Bổ sung cho `OWNER_DECISIONS_2026-10-11.md` (mục hoa hồng). Phạm vi: COM-002 và điều kiện đầu vào của COM-003. Các văn bản đã cập nhật: PRD §19.3–19.4, TECH_DESIGN §12, kế hoạch triển khai COM-002/COM-003.

## 1. Thời điểm chốt tỷ lệ

Tỷ lệ từng dòng được chốt tại **lần chuyển trạng thái thực sự sang `CONFIRMED`**, không phải thao tác Admin bấm xác nhận khi đơn còn đi vào `WAITING_DEPOSIT`. Tỷ lệ đổi giữa hai thời điểm đó vẫn có hiệu lực. Cách ghi trước đây ("lần đầu Admin xác nhận đơn", 11/10/2026) được làm rõ như trên.

## 2. Chiết khấu vượt hoa hồng tại `CONFIRMED`

Nếu quy tắc/tỷ lệ giảm sau khi tạo đơn và chiết khấu khách đã chốt vượt hoa hồng gốc tại `CONFIRMED`:

- đơn **vẫn xác nhận**; khoản thu/cọc đã ghi **không** bị hoàn tác hoặc ghi hai lần;
- hoa hồng bị **khóa** (không đủ điều kiện nhận) cho tới khi **Admin duyệt ngoại lệ** với lý do bắt buộc, có audit;
- **không tự duyệt**; chỉ Admin duyệt; duyệt lặp lại là idempotent và không tạo audit thứ hai.

Cách ghi trước đây (PRD §19.3 trước 17/10/2026: "vượt thì không cho lưu đơn") chỉ còn áp dụng lúc tạo/lưu/gửi đơn.

## 3. Hoa hồng từng dòng không âm

Phần chiết khấu do hoa hồng gánh được phân bổ lại để **mọi dòng có hoa hồng thực nhận ≥ 0**, bằng số nguyên VND và quy tắc phần dư cố định (phần dư lớn nhất trước; hòa theo SKU theo thứ tự byte, rồi mã dòng):

- đơn thông thường: tổng chiết khấu được bảo toàn, hoa hồng nhân viên = base − chiết khấu;
- chiết khấu > tổng base: hoa hồng nhân viên = 0, phần vượt là **công ty chịu** và hiển thị rõ;
- chiết khấu khách theo dòng và doanh thu thuần của đơn giữ nguyên đủ, để hoàn hàng tính chính xác; không xóa hay làm tròn mất VND nào.

Dòng 0% không hiển thị hoa hồng âm. Ví dụ đối soát: giá 33.333 / 30.003 / 6.993 VND, tỷ lệ 7,5% / 12,34% / 0%, chiết khấu 5.000 VND → chiết khấu theo dòng 2.370 / 2.133 / 497; hoa hồng gốc 2.500 / 3.702 / 0; khấu trừ 2.408 / 2.592 / 0; hoa hồng thực nhận 92 / 1.110 / 0 (tổng 1.202).

## Chưa thuộc quyết định này

Vòng đời `ELIGIBLE`/`FINALIZED`/`REVERSED` (COM-003+), điều chỉnh hàng hoàn (COM-005) và giao diện duyệt ngoại lệ cho Admin nếu chưa có màn hình; các mục này giữ trạng thái chưa nghiệm thu cho đến khi có bằng chứng riêng.

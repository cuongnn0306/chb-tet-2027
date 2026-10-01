# CHB BÁNH CHƯNG TẾT 2027
## PRODUCT REQUIREMENTS DOCUMENT — PRD v1.0

**Trạng thái:** Requirement Lock v1.0  
**Phạm vi:** Web app nội bộ phục vụ chiến dịch bán bánh chưng Tết 2027  
**Mục tiêu:** Thay thế hoàn toàn Excel/Zalo trong quản lý đơn hàng, khách hàng, tồn kho, sản xuất, giao hàng và hoa hồng.

---

# 1. PRODUCT VISION

Web app là hệ thống trung tâm để CHB quản lý:

**SALE → ORDER → CUSTOMER → INVENTORY → PRODUCTION → DELIVERY → COMMISSION**

Mục tiêu cốt lõi:

- Tổng hợp toàn bộ đơn hàng từ nhiều kênh.
- Biết chính xác đơn do ai bán, từ nguồn nào.
- Theo dõi doanh số từng nhân viên.
- Biết tồn kho theo từng SKU, lô và địa điểm theo thời gian gần thực.
- Không cho bán vượt tồn.
- Điều phối hàng giữa các kho/cơ sở.
- Dựa trên đơn tương lai để lập kế hoạch sản xuất.
- Theo dõi lịch giao hàng.
- Tính hoa hồng nhân viên cuối chiến dịch.

Ứng dụng chỉ tập trung cho chiến dịch bánh chưng trước. Việc mở rộng sang sản phẩm khác sẽ được đánh giá sau chiến dịch.

---

# 2. PHẠM VI V1

## 2.1 Module bắt buộc

1. Bán hàng & đơn hàng
2. Khách hàng
3. Tồn kho
4. Điều chuyển
5. Sản xuất
6. Thanh toán/cọc
7. Giao hàng
8. Hoa hồng
9. Dashboard & báo cáo
10. Import/Export Excel
11. Audit Log
12. Thiết lập hệ thống

## 2.2 Không thuộc V1

- P&L
- Kế toán tổng thể
- Xuất hóa đơn điện tử
- Tích hợp MISA
- CRM marketing automation
- Loyalty
- Tích hợp Grab/Ahamove API
- ERP toàn CHB
- DAMALA / CHB Chocolate / Phở Đức
- Workflow OEM/MT chuyên biệt

---

# 3. USER & PERMISSION

## 3.1 Admin HQ

Toàn quyền:

- Quản lý user
- Quản lý sản phẩm
- Quản lý giá
- Quản lý % hoa hồng
- Quản lý chiết khấu
- Điều chỉnh tồn kho
- Duyệt điều chuyển
- Xác nhận thanh toán
- Quản lý sản xuất
- Quản lý cấu hình hệ thống
- Xem báo cáo toàn hệ thống
- Vô hiệu hóa đơn
- Override Batch khi cần
- Xem Audit Log

## 3.2 Sale B2B

- Nhập đơn
- Nhập khách hàng
- Xem đơn của mình
- Xem doanh số
- Xem tồn hệ thống
- Đề xuất điều chuyển
- Theo dõi giao hàng
- Xem hoa hồng dự kiến

## 3.3 Nhân viên cửa hàng CHB

- Nhập đơn
- Xem đơn của mình/cơ sở
- Xem doanh số
- Xem tồn
- Đề xuất điều chuyển
- Theo dõi giao hàng

## 3.4 Nhân viên cơ sở nhượng quyền

Tương tự cửa hàng CHB.

Hàng chuyển tới franchise vẫn thuộc tồn hệ thống CHB. Franchise là điểm trưng bày/phân phối; điều chuyển tới franchise không ghi nhận doanh thu.

## 3.5 Kho/Xưởng

- Xem nhu cầu
- Xem kế hoạch sản xuất
- Cập nhật sản xuất
- Nhập Batch
- Xác nhận nhập/xuất kho
- Xử lý hàng hoàn
- Xem điều chuyển

Mỗi nhân viên dùng tài khoản riêng.

---

# 4. ATTRIBUTION — NGUỒN ĐƠN

Mỗi Order có bốn trường độc lập:

## 4.1 Kênh bán

Ví dụ:

- Cửa hàng trực thuộc
- Franchise
- Online
- B2B
- CTV

## 4.2 Nguồn khách

- Facebook
- TikTok
- Zalo
- Hotline
- Website
- Khách doanh nghiệp
- Nhân viên giới thiệu
- Cộng tác viên
- Walk-in
- Khác

## 4.3 Người phụ trách

User chịu trách nhiệm bán đơn.

## 4.4 Điểm tạo đơn

- Cửa hàng
- Văn phòng
- Franchise
- B2B
- Địa điểm khác

Hệ thống cho từng user thiết lập:

**Default Channel + Default Source + Default Location**

để giảm thao tác nhập liệu.

---

# 5. CUSTOMER

## 5.1 Khách cá nhân

- Tên
- SĐT
- Địa chỉ

## 5.2 Khách doanh nghiệp

- Tên công ty
- MST
- Người liên hệ
- Chức vụ
- SĐT
- Email
- Địa chỉ công ty

## 5.3 Xử lý khách trùng

Không khóa việc tạo khách trùng.

Khi nhập SĐT đã tồn tại:

> “Khách hàng này có thể đã tồn tại”

Người dùng có thể:

- Chọn khách cũ
- Hoặc vẫn tạo khách mới

Mục đích: giữ UX đơn giản nhưng vẫn có khả năng phân tích khách quay lại.

---

# 6. PRODUCT

Dự kiến khoảng 10–12 SKU:

- Bánh theo vị
- Bánh theo trọng lượng/size
- Hộp quà
- Các SKU đóng gói khác

Mỗi SKU có:

- SKU Code
- Tên
- Nhóm
- Khối lượng
- Giá niêm yết
- Trạng thái Active/Inactive
- % hoa hồng mặc định nếu cần

Giá niêm yết là cơ sở tính **doanh số sale và hoa hồng**, không phải số tiền khách thực trả.

---

# 7. ORDER MODEL

## 7.1 Order State Machine

```text
NHÁP
↓
CHỜ XÁC NHẬN
↓
CHỜ CỌC
↓
ĐÃ XÁC NHẬN
↓
GIỮ HÀNG
↓
CHUẨN BỊ HÀNG
↓
CHỜ GIAO
↓
HOÀN THÀNH
```

Nhánh ngoại lệ:

```text
HỦY
HOÀN
ĐỔI
ĐÃ VÔ HIỆU HÓA
```

## 7.2 Quy tắc thay đổi đơn

Không sửa số lượng đơn sau khi xác nhận.

Nếu khách thay đổi:

**Hủy đơn cũ → tạo đơn mới.**

Mục tiêu:

- Bảo vệ tồn kho
- Bảo vệ audit
- Bảo vệ doanh số
- Bảo vệ hoa hồng
- Bảo vệ production planning

---

# 8. ĐƠN ĐẶT XA & RESERVATION

Tách hai khái niệm.

## 8.1 Demand Commitment

Khách đã cọc/xác nhận nhưng giao sau 1–2 tháng.

Được tính vào:

- Nhu cầu tương lai
- Kế hoạch sản xuất
- Forecast

Nhưng chưa khóa tồn vật lý hiện tại.

## 8.2 Physical Reservation

Tới gần ngày giao mới khóa tồn thật.

Admin cấu hình:

> Allocation Lead Time = X ngày trước giao

Ví dụ:

- 3 ngày
- 5 ngày
- 7 ngày
- Custom

Không hard-code.

---

# 9. GIỮ HÀNG TẠM THỜI

Khi tạo đơn:

→ hệ thống có thể giữ tồn tạm.

Nếu khách chưa cọc/thanh toán sau thời gian quy định:

→ tự động giải phóng hàng.

Admin cấu hình:

```text
Reservation TTL
12h / 24h / 48h / Custom
```

Mặc định vận hành ban đầu có thể đặt 24 giờ.

---

# 10. INVENTORY MODEL

Địa điểm tồn:

- Bếp tổng
- Văn phòng
- Cửa hàng CHB
- Franchise

Mỗi tồn kho luôn gắn:

```text
Location
+
SKU
+
Batch
```

Batch gồm:

- Mã lô
- SKU
- Ngày sản xuất
- Hạn sử dụng
- Số lượng

## 10.1 Trạng thái hàng

- Available — khả dụng
- Reserved — giữ đơn
- Damaged — hỏng/hủy
- Sample — hàng mẫu
- Gift — hàng biếu
- Pending Inspection — chờ kiểm tra
- In Transfer — đang điều chuyển

Không cho tồn âm.

---

# 11. INVENTORY LEDGER

Không cho sửa trực tiếp con số tồn kho.

Mọi thay đổi phải tạo **Inventory Movement**:

```text
PRODUCTION_IN
SALE_OUT
TRANSFER_OUT
TRANSFER_IN
RETURN_IN
DAMAGE_OUT
SAMPLE_OUT
GIFT_OUT
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

Mỗi movement lưu:

- SKU
- Batch
- From Location
- To Location
- Quantity
- User
- Timestamp
- Reason
- Related Order/Transfer

Admin chỉnh tồn bắt buộc nhập lý do.

---

# 12. FEFO

Hệ thống tự phân bổ lô theo:

**First Expired — First Out**

Lô có HSD gần hơn được ưu tiên xuất trước.

Người bán không phải chọn Batch.

Admin/Kho có thể override nhưng:

- Phải chọn Batch khác
- Phải nhập lý do
- Ghi Audit Log

---

# 13. SAFETY STOCK

Thiết lập tồn an toàn theo:

```text
Warehouse × SKU
```

Ví dụ:

| Kho | SKU | Safety Stock |
|---|---|---:|
| VP | Bánh truyền thống 1.2kg | 50 |
| Store A | Bánh truyền thống 1.2kg | 20 |
| Store A | Bánh cốm | 10 |

Tồn có thể bán:

```text
SELLABLE STOCK
=
AVAILABLE STOCK
-
RESERVED STOCK
-
SAFETY STOCK
```

---

# 14. AUTO TRANSFER SUGGESTION

Nếu kho được chọn không đủ hàng:

App tự tìm kho phù hợp.

Priority:

1. Cùng khu vực
2. Có đủ số lượng
3. Không phá Safety Stock
4. Batch hết hạn sớm hơn
5. Hạn chế chia đơn qua nhiều kho

Ví dụ:

> Thiếu 30 bánh tại Cơ sở A  
> Đề xuất chuyển 30 bánh từ VP Minh Khai.

Workflow:

```text
Nhân viên yêu cầu
→ Admin duyệt
→ Xuất kho nguồn
→ In Transfer
→ Kho đích nhận
→ nhập tồn
```

---

# 15. PRODUCTION PLANNING

Công thức cơ bản:

```text
PRODUCTION NEED
=
FUTURE COMMITTED DEMAND
+
SAFETY STOCK TARGET
-
AVAILABLE STOCK
-
SCHEDULED PRODUCTION
```

Dashboard xưởng hiển thị theo:

- SKU
- Ngày cần
- Nhu cầu giao
- Tồn hiện tại
- Safety Stock
- Đang sản xuất
- Thiếu
- Đề xuất sản xuất

Production Workflow:

```text
ĐỀ XUẤT
↓
KẾ HOẠCH SẢN XUẤT
↓
ĐANG SẢN XUẤT
↓
HOÀN THÀNH
↓
NHẬP KHO
```

Khi hoàn thành:

xưởng nhập:

- SKU
- Số lượng thực tế
- Batch
- NSX
- HSD
- Kho nhận

Sau đó hệ thống tự tạo Inventory Movement `PRODUCTION_IN`.

---

# 16. DELIVERY

Một Order có thể có nhiều Delivery Batch.

Ví dụ:

```text
ORDER #1001
500 bánh

Delivery 01
200 bánh
20/01
Hà Nội

Delivery 02
100 bánh
21/01
Bắc Ninh

Delivery 03
200 bánh
24/01
Hà Nội
```

Mỗi đợt lưu:

- Ngày giao
- Địa chỉ
- Người nhận
- SĐT
- Kho xuất
- SKU/SL
- Hình thức giao
- Phí ship
- Trạng thái

Tổng Delivery Items không được vượt Order Items.

## 16.1 Delivery Status

```text
CHỜ CHUẨN BỊ
↓
CHỜ GIAO
↓
ĐANG GIAO
↓
GIAO THÀNH CÔNG
```

Ngoại lệ:

```text
GIAO THẤT BẠI
```

Không tích hợp Grab/Ahamove V1.

---

# 17. DELIVERY CALENDAR

Có ba chế độ nhanh:

- Hôm nay
- Ngày mai
- 7 ngày tới

Ngoài ra có Calendar View.

Mỗi dòng:

- Giờ
- Khách
- Mã đơn
- Địa chỉ
- SKU
- Số lượng
- Kho xuất
- Người phụ trách
- Trạng thái
- Số tiền còn phải thu

Đây là một màn hình vận hành chính của hệ thống.

---

# 18. PAYMENT

Phương thức:

- Tiền mặt
- Chuyển khoản
- QR
- COD

Order lưu:

```text
Gross Amount
Discount
Net Amount
Deposit Required
Paid Amount
Remaining Amount
```

Có trạng thái:

```text
CHƯA THANH TOÁN
ĐÃ CỌC
THANH TOÁN MỘT PHẦN
ĐÃ THANH TOÁN
```

## 18.1 SePay

Thiết kế Payment Adapter cho phép:

- Sinh QR theo Order
- Gắn nội dung chuyển khoản với Order Code
- Nhận webhook thanh toán
- Tự matching giao dịch
- Cập nhật Paid Amount
- Chuyển trạng thái đơn khi đủ điều kiện

Tỷ lệ/số tiền cọc không hard-code.

Admin cấu hình chính sách cọc.

---

# 19. HOA HỒNG

## 19.1 Doanh số tính hoa hồng

```text
COMMISSION REVENUE
=
LIST PRICE × QUANTITY
```

Không dùng Net Revenue.

## 19.2 Hoa hồng gốc

```text
BASE COMMISSION
=
COMMISSION REVENUE × COMMISSION RATE
```

## 19.3 Hoa hồng thực nhận

```text
FINAL COMMISSION
=
BASE COMMISSION
-
CUSTOMER DISCOUNT
```

Điều kiện:

```text
CUSTOMER DISCOUNT ≤ BASE COMMISSION
```

Nếu vượt:

→ không cho lưu đơn.

Ví dụ:

```text
Giá niêm yết:        1.000.000
Hoa hồng 20%:          200.000
Giảm cho khách:         50.000

Khách trả:             950.000
Nhân viên nhận:        150.000
```

Hoa hồng chỉ được ghi nhận khi:

- Order = Hoàn thành
- Remaining Amount = 0

---

# 20. RETURN / EXCHANGE

## 20.1 Hàng trả về

Không nhập Available ngay.

Đi vào:

**Pending Inspection**

Kho kiểm tra và quyết định:

```text
RESTOCK
hoặc
DAMAGED
```

Khi Return:

- Giảm doanh số tương ứng
- Giảm hoa hồng tương ứng

## 20.2 Đổi hàng

Không sửa Order gốc.

Xử lý:

```text
RETURN SKU A
+
NEW OUTBOUND SKU B
```

---

# 21. SOFT DELETE & AUDIT

Không hard-delete dữ liệu giao dịch.

“Xóa đơn” thực tế:

```text
status = VOIDED
```

Lưu:

- Người thực hiện
- Thời gian
- Lý do
- Dữ liệu trước thay đổi
- Dữ liệu sau thay đổi

Audit áp dụng cho:

- Đơn
- Thanh toán
- Giá
- Discount
- Inventory
- Transfer
- Batch
- Return
- Commission
- Production

---

# 22. CEO / ADMIN DASHBOARD

## 22.1 Sales

- Tổng đơn
- Doanh số niêm yết
- Doanh thu thực thu
- Bánh đã bán
- Đơn đã hoàn thành
- Đơn hủy

## 22.2 Inventory

- Tồn thực tế
- Tồn khả dụng
- Đang giữ
- Safety Stock
- Hàng chờ kiểm tra
- Hàng hỏng/hủy

## 22.3 Delivery

- Giao hôm nay
- Giao ngày mai
- Giao 7 ngày
- Đơn quá hạn

## 22.4 Analytics

- Doanh số theo kênh
- Doanh số theo nguồn khách
- Doanh số theo sale
- Doanh số theo cơ sở
- Top khách doanh nghiệp

## 22.5 Alert

- SKU sắp thiếu
- Kho sắp thiếu
- Đơn chưa cọc sắp hết thời gian giữ
- Đơn sắp giao nhưng chưa đủ hàng
- Đơn sắp giao nhưng chưa thu đủ tiền
- Batch gần HSD

---

# 23. FORECAST

Hệ thống cần trả lời:

> Tồn hiện tại đủ bán bao lâu?

V1 sử dụng:

```text
Days of Stock
=
Sellable Inventory
/
Average Daily Demand
```

Average Daily Demand có thể tính:

- 3 ngày gần nhất
- 7 ngày gần nhất
- Hoặc Admin chọn

Ngoài lịch sử bán, forecast cần tính cả future committed orders.

---

# 24. UI/UX INFORMATION ARCHITECTURE

## 24.1 User thường

Navigation:

```text
Trang chủ
Tạo đơn
Đơn của tôi
Tồn kho
Lịch giao
Doanh số
```

Trang chủ User:

- Doanh số của tôi
- Đơn hôm nay
- Đơn chờ cọc
- Hoa hồng dự kiến

CTA chính:

> + TẠO ĐƠN

## 24.2 Admin

Navigation:

```text
Dashboard
Orders
Customers
Inventory
Transfers
Production
Delivery
Payments
Commissions
Reports
Master Data
Settings
Audit Log
```

---

# 25. CREATE ORDER UX

Thiết kế thành một màn hình nhanh.

## Khu 1 — Khách hàng

```text
SĐT
Tên
Địa chỉ
Loại khách
```

Nếu SĐT cũ:

> Có khách hàng tương tự → Xem

## Khu 2 — Attribution

Tự fill từ user default:

```text
Kênh bán
Nguồn khách
Người phụ trách
Điểm tạo đơn
```

## Khu 3 — Sản phẩm

```text
SKU
SL
Giá
Thành tiền
```

## Khu 4 — Chiết khấu

Hiển thị:

```text
Doanh số niêm yết
Hoa hồng tối đa
Chiết khấu khách
Hoa hồng còn lại
Khách cần thanh toán
```

## Khu 5 — Giao hàng

Nút:

> + Thêm đợt giao

Mỗi đợt chọn:

- Ngày
- Địa chỉ
- SKU/SL
- Kho đề xuất
- Hình thức giao

## Khu 6 — Cọc

Hiển thị:

```text
Tổng đơn
Tiền cọc
QR
Countdown giữ hàng
```

---

# 26. TECH STACK ĐỀ XUẤT

## Frontend

- React
- TypeScript
- Tailwind CSS
- Responsive Web App

## Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security
- Realtime
- Edge Functions

## Hosting

- Vercel

## File

- Supabase Storage

## Payment

- Payment Adapter
- Provider đầu tiên: SePay

## Report

- XLSX Export
- Printable HTML/PDF cho:
  - Đơn hàng
  - Phiếu xuất
  - Phiếu giao
  - Phiếu điều chuyển

Không cần microservices ở V1.

---

# 27. DATA MODEL — CORE ENTITIES

```text
users
profiles
roles

locations

sales_channels
lead_sources

customers

products
product_batches

orders
order_items

inventory_reservations
inventory_movements
inventory_balances

transfers
transfer_items

production_plans
production_runs

deliveries
delivery_items

payments

returns
return_items

commission_rules
commission_entries

app_settings

audit_logs
```

---

# 28. NGUYÊN TẮC DATABASE QUAN TRỌNG

## Inventory

`inventory_movements` là source of truth.

`inventory_balances` chỉ là balance được tổng hợp/cache.

Không sửa balance bằng tay.

## Money

Dùng integer:

```text
950000
```

Không dùng float.

## Quantity

Nếu bánh luôn tính cái:

integer.

## Audit

Các transaction table không hard-delete.

---

# 29. ADMIN SETTINGS

Admin có thể cấu hình mà không sửa code:

```text
Temporary Reservation TTL
Physical Allocation Lead Time
Default Deposit Rule
Commission %
Safety Stock
Order Number Prefix
Payment QR Settings
Batch Expiry Alert
Forecast Window
Channel List
Source List
Locations
```

---

# 30. REPORT SAU TẾT

Hệ thống phải trả lời được:

1. Tổng bán bao nhiêu bánh?
2. Doanh số bao nhiêu?
3. Doanh thu thực thu bao nhiêu?
4. Khách đến từ nguồn nào?
5. Kênh nào bán nhiều nhất?
6. Sale nào bán nhiều nhất?
7. Sale nào có hoa hồng bao nhiêu?
8. Chiết khấu khách bao nhiêu?
9. Khách nào mua lại?
10. Khách doanh nghiệp nào mua nhiều nhất?
11. Bao nhiêu đơn bị hủy?
12. Bao nhiêu hàng bị hoàn?
13. Bao nhiêu hàng hỏng/hủy?
14. Kho nào quay vòng nhanh?
15. Bao nhiêu doanh thu từ cửa hàng/B2B/franchise/social/CTV?
16. SKU nào bán tốt?
17. Batch nào còn tồn?
18. Sản xuất thực tế so với nhu cầu thế nào?
19. Có bao nhiêu lần điều chuyển?
20. Sai lệch tồn kho cuối chiến dịch bao nhiêu?

---

# 31. IMPLEMENTATION PLAN

## PHASE 0 — FOUNDATION

- Khóa requirement
- Danh mục SKU
- Danh sách cơ sở/kho
- Danh sách user
- Channel
- Source
- Commission policy
- Deposit policy

## PHASE 1 — AUTH + MASTER DATA

- Login
- User
- Role
- Location
- Product
- Channel
- Source
- Settings

## PHASE 2 — CUSTOMER + ORDER

- Customer
- Create Order
- Attribution
- Discount
- Order State
- Order History

## PHASE 3 — INVENTORY

- Batch
- Inventory Ledger
- Balance
- Reservation
- Safety Stock
- FEFO
- Không tồn âm

## PHASE 4 — TRANSFER

- Đề xuất nguồn
- Transfer Request
- Admin approval
- Dispatch
- Receive

## PHASE 5 — PAYMENT

- Deposit
- Cash
- Transfer
- QR
- COD
- Remaining Balance
- SePay adapter/webhook

## PHASE 6 — DELIVERY

- Multiple Delivery per Order
- Delivery Calendar
- Today/Tomorrow/7 days
- Delivery status
- Print delivery documents

## PHASE 7 — PRODUCTION

- Forecast demand
- Production suggestion
- Production plan
- Production run
- Batch generation
- Nhập kho

## PHASE 8 — COMMISSION

- Commission rules
- Commission calculation
- Discount deduction
- Return deduction
- Final payable commission

## PHASE 9 — DASHBOARD + REPORT

- CEO Dashboard
- Sales Analytics
- Inventory Analytics
- Channel Analytics
- Delivery Analytics
- Excel export

## PHASE 10 — CONTROL & UAT

Kiểm thử bắt buộc:

- 2 user cùng bán SKU cuối cùng
- Không cho tồn âm
- Reservation hết hạn
- Đơn đặt trước 2 tháng
- Một đơn nhiều ngày giao
- Một đơn nhiều kho
- Điều chuyển chưa nhận
- Hoàn hàng
- Đổi hàng
- Batch hết hạn trước
- Sale giảm giá hết hoa hồng
- Sale cố giảm vượt hoa hồng
- Giao thất bại
- Webhook thanh toán gửi lặp
- Admin vô hiệu hóa đơn
- Sản xuất thiếu/thừa kế hoạch
- Import tồn đầu kỳ

---

# 32. INITIAL INVENTORY

Admin có hai cách.

## Nhập tay

```text
Location
SKU
Batch
NSX
HSD
Quantity
```

## Import Excel

| Kho | SKU | Batch | NSX | HSD | SL |
|---|---|---|---|---|---:|

Sau khi Go-live:

**mọi thay đổi tồn phải đi qua app.**

Không tiếp tục Excel/Zalo song song.

---

# 33. PRODUCT PRINCIPLES

V1 ưu tiên:

**Nhanh hơn đầy đủ.**

Nhân viên bán hàng không nên phải hiểu ERP.

Một đơn thông thường cần:

1. Chọn khách
2. Chọn bánh
3. Nhập số lượng
4. Chọn giao
5. Nhận QR cọc
6. Lưu

Hệ thống phía sau tự xử lý:

- Attribution mặc định
- Giá
- Hoa hồng
- Tồn
- Reservation
- FEFO
- Warehouse suggestion
- Production demand
- Delivery schedule
- Analytics
- Audit

Mục tiêu UX:

> **Nhân viên chỉ tập trung bán hàng — hệ thống chịu trách nhiệm kiểm soát vận hành.**

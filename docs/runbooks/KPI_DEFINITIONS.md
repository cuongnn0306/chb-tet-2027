# RPT-001 — Định nghĩa KPI và ngày ghi nhận

Nguồn: PRD v1.1 §22, B21, B22; TECH v1.0 §13 và §3.8; quyết định Owner ngày 11/10/2026. Đây là từ điển cho triển khai report, chưa phải truy vấn hoặc dashboard đã kiểm chứng. RPT-002..012 không được hoàn tất bởi tài liệu này.

| KPI                                 | Định nghĩa theo TECH §13                                                        | Phạm vi và lưu ý                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gross Sales / Doanh số niêm yết     | Tổng các dòng sự kiện gross xác nhận, trừ dòng đảo hủy/vô hiệu hóa và giảm hoàn | Không thay bằng tiền đã thu hoặc giá sau giảm; chi tiết mốc thời gian bên dưới.                                                              |
| Net Sales                           | Gross trừ chiết khấu, ghi sự kiện cùng mốc gross và điều chỉnh tương ứng        | Tiền VND nguyên; phần chiết khấu của hàng hoàn phân bổ theo quy tắc đã duyệt.                                                                |
| Cash Collected / Tiền thực thu      | Tổng thanh toán `CONFIRMED` trừ tiền hoàn đã thực hiện                          | Theo ngày xác nhận khoản thu hoặc ngày hoàn tiền; tách khỏi doanh số.                                                                        |
| Units Sold / Số bánh đã bán         | SUM(order_items.quantity - returned_quantity), loại đơn CANCELLED và VOIDED     | Không đồng nghĩa hàng đã giao; không tính transfer tới franchise thành doanh số.                                                             |
| Sellable Inventory / Tồn có thể bán | available_qty - reserved_qty - safety_stock                                     | TECH §13; triển khai phải tái sử dụng định nghĩa sellable/FEFO hiện hành, không tự trừ reservation lần hai hoặc dùng balance như ledger gốc. |
| Days of Stock                       | sellable_inventory / average_daily_demand                                       | Chưa được phép tự chọn cửa sổ tính nhu cầu hoặc giá trị khi mẫu số bằng 0.                                                                   |

PRD B21 yêu cầu top row: Tổng đơn, Gross Sales, Cash Collected, Units Sold, Reserved, Sellable Stock; cảnh báo ngay dưới KPI. PRD B22 yêu cầu mỗi tab có khoảng ngày, bộ lọc phù hợp, bảng, tổng hợp và xuất Excel. Không triển khai BI builder. Không tự cấp quyền report cho role ngoài đặc tả.

## Sự kiện, ngày và quy nguồn

| Sự kiện                                          | Gross / Net                                                                          | Ngày ghi nhận                    | Lưu ý                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Xác nhận đơn lần đầu                             | `+gross_amount` / `+net_amount`                                                      | `confirmed_at`                   | Một lần mỗi đơn, dù có nhiều đợt giao. Đơn chưa xác nhận không ghi doanh số.                                      |
| Đơn đã xác nhận chuyển `CANCELLED` hoặc `VOIDED` | `-gross_amount` / `-net_amount`                                                      | `cancelled_at` / `voided_at`     | Chính xác một dòng đảo; không xóa dòng ở kỳ xác nhận. Đơn hủy trước xác nhận không có dòng cộng hoặc đảo.         |
| Kho thực nhận hàng hoàn                          | Trừ gross đúng số lượng nhận; net giảm bằng gross hoàn trừ phần chiết khấu tương ứng | Ngày Kho xác nhận thực nhận      | Loại điều chỉnh riêng; tạo yêu cầu hoàn chưa đổi doanh số. Không giảm lần hai khi kiểm tra `RESTOCKED`/`DAMAGED`. |
| Khoản thanh toán được xác nhận                   | Không đổi doanh số                                                                   | Ngày xác nhận khoản thanh toán   | Cộng vào tiền thực thu; webhook trùng không được tính hai lần.                                                    |
| Hoàn tiền cho khách                              | Không đổi doanh số                                                                   | Ngày hoàn tiền                   | Trừ tiền thực thu; không trừ lại gross/net.                                                                       |
| Giao thành công                                  | Không ghi lại doanh số đơn                                                           | `delivered_at` của từng delivery | KPI giao hàng theo từng đợt.                                                                                      |

Attribution người phụ trách, kênh, nguồn và điểm tạo đơn được chốt tại lần đầu xác nhận đơn. Dòng đảo hủy và giảm hoàn dùng attribution đã chốt; đổi người phụ trách về sau phải có audit và không tự sửa kỳ cũ. Dashboard và export phải tách doanh số xác nhận, giảm hủy/vô hiệu hóa, giảm hoàn, doanh số sau điều chỉnh và tiền thực thu. Tổng lũy kế sau điều chỉnh phải đối soát với tổng hiện trạng loại đơn hủy/vô hiệu hóa và trừ hàng hoàn hợp lệ.

Chiết khấu cấp đơn phân bổ cho từng dòng theo tỷ trọng giá niêm yết, dùng VND nguyên và quy tắc phần dư cố định để tổng phần dòng bằng đúng chiết khấu đơn. RPT-001 ghi hợp đồng tính; code tính và kiểm thử nằm ở task triển khai doanh số/hoàn liên quan.

## Điểm còn cần chốt trước một số KPI khác

- Tổng đơn: chưa chốt có loại DRAFT, CANCELLED, VOIDED hay hiển thị số lượng riêng; không suy rộng bộ lọc của doanh số sang KPI này.
- Các KPI tồn kho dạng snapshot cần mốc chụp tồn và cách xử lý filter khoảng ngày; ledger là nguồn thật, `inventory_balances` chỉ là cache.
- Returned quantity: E10 chưa có lifecycle đầy đủ trong source đã tích hợp. Không dùng 0 để khẳng định không có hàng trả, không suy ra từ `CANCELLED` delivery.
- Reserved/Sellable: ledger là nguồn thật; filter active reservation, trạng thái lô, HSD và bucket phải khớp RPC hiện hành. Tránh cộng tồn nhiều lô rồi trừ safety stock một lần cho mỗi lô; safety stock theo Location × SKU.
- Days of Stock: cửa sổ `average_daily_demand`, timezone và trường hợp demand = 0 chưa được chốt; chưa tính hoặc hiển thị số giả.

## Ví dụ đối soát chính sách đã duyệt

Đơn gross 1.000.000 VND, discount 50.000 VND xác nhận ngày 11/10: kỳ 11/10 ghi +1.000.000 gross và +950.000 net. Nếu hủy hợp lệ ngày 13/10: kỳ 13/10 ghi -1.000.000 gross và -950.000 net; tổng hai kỳ bằng 0. Khoản thanh toán được xác nhận hoặc hoàn tiền ở ngày khác nằm trong dòng tiền của ngày đó. Không xóa payment ledger hoặc đếm lại giao hàng thành doanh số.

Tiền giữ integer VND, không làm tròn floating-point thành tiền. Không hard-delete giao dịch. Tất cả ví dụ là số giả; chưa có query, UI, mobile, staging hay nghiệm thu toàn bộ report.

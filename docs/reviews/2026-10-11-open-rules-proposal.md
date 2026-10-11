# Ba quy tắc được Owner duyệt — 11/10/2026

**Trạng thái: Owner duyệt cả ba phương án ngày 11/10/2026.** Quy tắc hiện hành được ghi tại [OWNER_DECISIONS_2026-10-11.md](../product/OWNER_DECISIONS_2026-10-11.md), PRD và TECH_DESIGN; tài liệu này giữ ví dụ, tình huống kiểm thử và thứ tự triển khai. Việc duyệt không chứng nhận migration, code hoặc task đã hoàn thành. Căn cứ kỹ thuật: [đề xuất giao hàng 05/10](2026-10-05-delivery-business-decisions.md), `RES-005`, `DEL-005`, `DEL-013`, `ORD-009` và `RPT-001`.

## A. Dời đợt giao ra ngoài thời gian phân bổ

**Quy tắc được duyệt:** Chỉ áp dụng cho delivery chưa từng xuất kho (`dispatched_at IS NULL`). Khi ngày giao mới nằm ngoài thời gian phân bổ cấu hình (`scheduled_date - allocation_lead_days > ngày nghiệp vụ tại Việt Nam`), hệ thống giữ nhu cầu đã xác nhận của đơn nhưng giải phóng **đúng phần tồn vật lý đã gắn với delivery đó**. Không giải phóng hàng của delivery khác, không xóa lịch sử phân bổ và không thay đổi TTL giữ hàng tạm của đơn. Khi ngày giao trở lại trong thời gian phân bổ, job hiện có phân bổ lại theo FEFO, kho nguồn và safety stock. Dời lịch khi đã xuất kho không giải phóng hàng; nếu giao thất bại, xử lý việc hàng quay về theo quyết định Owner đã duyệt.

Nếu một phần hàng giữ ở pool chung chưa thể quy chính xác cho delivery, không giải phóng theo ước lượng. Trả lỗi có hướng xử lý để Admin/Kho gắn hoặc đối soát phần giữ trước khi dời lịch. Thao tác dời lịch và giải phóng là một transaction có audit; lỗi ở bước nào thì không đổi ngày hoặc số hàng giữ.

**Ví dụ:** Lead time 5 ngày, hôm nay 11/10, delivery dự kiến 14/10 đang giữ 20 bánh. Dời sang 25/10: trả 20 bánh thuộc delivery đó về lượng có thể phân bổ, còn nhu cầu giao ngày 25/10 vẫn được tính. Delivery khác của cùng đơn giữ 10 bánh không đổi. Đến 20/10, hệ thống phân bổ lại 20 bánh nếu còn hàng; nếu thiếu thì báo thiếu/đề xuất điều chuyển.

**Task triển khai:** sửa theo một attempt mới của `DEL-013` (reschedule) và cập nhật engine/kiểm thử `RES-005` trong phạm vi phụ thuộc đã review; nếu vượt một task, tách thành hai attempt/task theo kế hoạch trước khi code. Kiểm thử ngày sát ranh lead time, pool chung, hai delivery cùng đơn, đổi kho, giao đã xuất, đồng thời reschedule/auto-allocation, không âm tồn và audit.

## B. Cổng xuất kho theo phân bổ của từng đợt

**Quy tắc được duyệt:** Chỉ cho `READY → OUT_FOR_DELIVERY` khi từng SKU/số lượng của **chính delivery đó** được phân bổ đủ tại kho nguồn hiện tại, gắn với lô còn hợp lệ. Tồn/giữ hàng của delivery anh em không được dùng thay. Phần giữ ở pool chung chỉ được tính sau khi hệ thống **gắn nguyên tử** đúng số lượng/lô cho delivery sắp xuất; không tự coi toàn bộ pool là coverage. Nếu không gắn đủ, chặn xuất và hiển thị thiếu bao nhiêu, tại kho nào, cùng gợi ý điều chuyển hoặc phân bổ lại. Admin/Kho dùng quyền phân bổ/override có lý do đang được đặc tả; không thêm nút bỏ qua cổng xuất.

**Ví dụ:** Đơn 10 bánh có D1: 5 và D2: 5 cùng kho. D1 đã được gắn 5 bánh, D2 chưa có phần giữ. Xuất D2 phải bị chặn, dù màn hình tồn gộp còn thấy 5 bánh dành cho D1. Sau khi gắn thêm 5 bánh hợp lệ cho D2, xuất D2 thành công; D1 vẫn giữ đủ 5 bánh.

**Task triển khai:** attempt mới của `DEL-005` sau khi tích hợp và xác minh phần allocation hiện có; thay dispatch guard ở service/RPC, không đặt quy tắc trong React. Kiểm thử nhiều kho, hai delivery tranh lượng cuối, pool chung gắn nguyên tử, lô hết hạn/ngừng dùng, thao tác lặp, quyền, audit và không âm tồn.

## C. Hủy/vô hiệu hóa đơn đã xác nhận trong báo cáo theo ngày

**Quy tắc được duyệt:** Báo cáo theo kỳ dùng **dòng sự kiện cộng/trừ**, không viết lại kỳ xác nhận. Khi đơn được xác nhận, ghi doanh số niêm yết và doanh số sau chiết khấu một lần vào ngày `confirmed_at`. Nếu đơn đã xác nhận chuyển sang `CANCELLED` hoặc `VOIDED`, ghi một dòng đảo tương ứng vào ngày `cancelled_at`/`voided_at`, đúng một lần và theo attribution đã chốt khi xác nhận. Đơn hủy/vô hiệu hóa trước xác nhận không tạo doanh số hay dòng đảo. Hàng hoàn là loại điều chỉnh khác, ghi tại ngày Kho thực nhận theo quyết định đã duyệt. Hoa hồng dự kiến của đơn hủy không trở thành đủ điều kiện nhận.

Tiền thực thu vẫn theo sự kiện xác nhận thanh toán và hoàn tiền, không bị trừ thêm bởi dòng đảo doanh số. Giữ điều kiện hiện có: đơn đã thu tiền chỉ được hủy/vô hiệu hóa sau khi xử lý khoản thu theo quy trình refund/void; phải có lý do và audit. Dashboard tách **doanh số đơn xác nhận**, **giảm do hủy/vô hiệu hóa**, **giảm do hàng hoàn**, **doanh số sau điều chỉnh** và **tiền thực thu**. Tổng lũy kế sau hủy khớp việc loại đơn `CANCELLED`/`VOIDED` khỏi tổng hiện trạng, trong khi từng kỳ vẫn giữ lịch sử gốc.

**Ví dụ:** Đơn 1.000.000đ, chiết khấu 50.000đ xác nhận 11/10; báo cáo 11/10 ghi +1.000.000đ gross và +950.000đ net. Admin hủy hợp lệ ngày 13/10; báo cáo 13/10 ghi -1.000.000đ gross và -950.000đ net. Tổng hai ngày bằng 0; hoàn tiền (nếu có) xuất hiện riêng theo ngày thực trả.

**Task triển khai:** cập nhật định nghĩa `RPT-001` trước, rồi triển khai truy vấn/báo cáo liên quan; `ORD-009`/`ORD-010` chỉ đổi nếu sự kiện hủy/vô hiệu hóa hiện tại thiếu dữ liệu cần thiết. Kiểm thử hủy trước/sau xác nhận, nhiều khoản thanh toán, hoàn tiền khác ngày, hủy lặp, lọc kỳ, attribution, Excel export và đối soát tổng kỳ với tổng hiện trạng.

## Thứ tự triển khai sau quyết định của Owner

1. Ghi ba quy tắc vào PRD, TECH_DESIGN và acceptance của task liên quan. Review dependency và source hiện tại, bảo toàn worktree/report dở.
2. Tích hợp/kiểm tra `DEL-005` và `RES-005` hiện có trên cùng source, khôi phục DB local rồi xử lý **B**, sau đó **A** theo một task ID mỗi lần. Mỗi thay đổi DB qua migration, RLS/RPC/audit và task:start/task:finish.
3. Chốt định nghĩa **C** trong `RPT-001`, rồi triển khai báo cáo. Có thể chuẩn bị định nghĩa và test case song song với bước 2; không công bố dashboard là đúng trước khi đối soát dữ liệu thật.
4. Sau mỗi task, review diff, kiểm tra local bắt buộc, mobile và staging khi phù hợp. `needs_validation` hoặc `validated_local` không tự động là Done.

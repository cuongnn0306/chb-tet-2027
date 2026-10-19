# Quyết định nghiệp vụ được Owner chốt ngày 11/10/2026

Nguồn: Owner xác nhận trong cuộc trao đổi dự án ngày 11/10/2026 sau khi xem đề xuất về giao thất bại, hoàn một phần, quyền, hoa hồng, KPI và người phụ trách các tài khoản nền tảng. PRD v1.1 chịu trách nhiệm hành vi sản phẩm; TECH_DESIGN v1.0 chịu trách nhiệm trạng thái, dữ liệu và quyền; IMPLEMENTATION_INFRA_PLAN v1.0 chịu trách nhiệm task/release. Tài liệu này ghi nguồn quyết định và phạm vi; việc sửa đặc tả không chứng nhận code đã triển khai hoặc task đã Done.

## 1. Giao thất bại và lô hết hạn sau khi rời kho

- Hàng giao thất bại trở lại **kho xuất giao**. Account đã tạo đơn xác nhận hàng được đưa về; Kho kiểm đếm số lượng/lô thực nhận và chuyển vào `Pending Inspection`. Chỉ sau kiểm tra mới quyết định bán lại hoặc hỏng. Ghi đầy đủ audit và không cộng tồn hai lần cho hàng chưa tạo `SALE_OUT`.
- Lô hết hạn sau khi rời kho **không tự động thu hồi**. Admin phối hợp Account/Kho xử lý từng trường hợp, ghi quyết định và lý do. Trước khi giải quyết, không tự đánh dấu giao thành công hoặc đưa lô về tồn có thể bán. Đây là quyết định thay thế đề xuất tự động thu hồi/chặn rồi bắt buộc đưa về kho trong review ngày 05/10.

## 2. Hoàn một phần và quyền

- Tạo yêu cầu hoàn không đổi trạng thái đơn hoặc KPI. Khi Kho thực nhận, return vào `RECEIVED_PENDING_INSPECTION`, hàng vào `Pending Inspection` và đơn `COMPLETED` → `RETURNED` kể cả hoàn một phần. Màn hình ghi rõ lượng đã hoàn và lượng khách còn giữ. Giảm doanh số/hoa hồng đúng phần hàng thực nhận; tiền hoàn là nghiệp vụ thanh toán riêng.
- Account phụ trách hoặc người tạo đơn và Admin được tạo/xem yêu cầu thuộc đơn mình; Admin xem toàn bộ. Kho tại điểm nhận xem yêu cầu liên quan, kiểm đếm và kiểm tra. Account không tự nhập tồn; Admin duyệt điều chỉnh ngoại lệ tiền/hoa hồng.

## 3. Hoa hồng và KPI

- Tỷ lệ hoa hồng của từng dòng sản phẩm được chốt ở lần đầu Admin xác nhận đơn. Trước đó là dự kiến; sửa rule/vai trò sau đó không sửa lịch sử. Hoa hồng đủ điều kiện nhận khi đơn hoàn thành và thu đủ tiền.
- Doanh số niêm yết ghi một lần theo ngày xác nhận đơn; giảm hàng hoàn theo ngày Kho thực nhận. Tiền thực thu theo ngày xác nhận khoản thanh toán, tiền hoàn ghi giảm theo ngày hoàn tiền. Delivery KPI theo từng đợt và ngày giao thực tế. Attribution theo account/kênh/nguồn/điểm tạo đơn tại lúc xác nhận; sửa sau đó cần audit và không tự ghi lại kỳ cũ.
- Chiết khấu cấp đơn phân bổ theo tỷ trọng giá trị niêm yết từng dòng bằng VND nguyên; quy tắc làm tròn cố định bảo toàn tổng. Hoàn một phần đảo doanh số/hoa hồng đúng lượng và phần chiết khấu tương ứng.

## 4. Owner hạ tầng

Chủ dự án trực tiếp là đầu mối quản trị GitHub, Supabase Staging/Production, Vercel và SePay/tài khoản nhận tiền. Các task INF-001/009/010/011, PAY-006 và release gate vẫn cần bằng chứng cấu hình thực tế. Không lưu mật khẩu, token, secret trong repository hay tài liệu quyết định.

## 5. Dời lịch giao vượt thời gian phân bổ

- Chỉ delivery chưa từng xuất kho (`dispatched_at IS NULL`) mới được giải phóng tồn vật lý khi ngày giao mới nằm ngoài cửa sổ `allocation_lead_days` tính theo ngày nghiệp vụ Việt Nam. Giữ nguyên nhu cầu tương lai đã xác nhận, lịch sử phân bổ và TTL giữ hàng tạm; chỉ giải phóng phần giữ truy vết được của chính delivery đó.
- Khi trở lại cửa sổ phân bổ, phân bổ lại theo FEFO, kho nguồn và safety stock. Nếu phần giữ chung chưa thể quy chính xác cho delivery, chặn dời lịch và yêu cầu Admin/Kho đối soát; không giải phóng ước lượng. Dời lịch và giải phóng phải nguyên tử, có audit. Delivery đã xuất kho theo quy trình giao thất bại và nhận lại đã chốt ở mục 1.

## 6. Cổng xuất kho theo từng delivery

- `READY` → `OUT_FOR_DELIVERY` chỉ khi **chính delivery đó** đủ từng SKU/số lượng tại kho nguồn hiện tại và lô hợp lệ. Không dùng phần giữ của delivery khác. Phần giữ chung chỉ được tính sau khi gắn số lượng/lô cho delivery sắp xuất trong cùng giao dịch nguyên tử.
- Nếu thiếu, chặn xuất với số lượng/kho thiếu và gợi ý phân bổ hoặc điều chuyển; không có đường bỏ qua cổng xuất. Kiểm tra quyền, đồng thời, không âm tồn và audit.

## 7. Đơn hủy/vô hiệu hóa sau xác nhận trên báo cáo theo kỳ

- Báo cáo theo kỳ giữ dòng doanh số tại `confirmed_at`. Đơn đã xác nhận chuyển sang `CANCELLED`/`VOIDED` tạo **một** dòng đảo gross/net tại `cancelled_at`/`voided_at`, theo attribution đã chốt; không viết lại kỳ cũ. Hủy/vô hiệu hóa trước xác nhận không tạo doanh số hoặc dòng đảo.
- Tách dòng giảm hủy/vô hiệu hóa khỏi giảm do hàng hoàn. Tiền thực thu/hoàn vẫn theo ngày nghiệp vụ thanh toán, không bị trừ thêm bởi dòng đảo doanh số. Tổng lũy kế sau điều chỉnh đối soát với tổng hiện trạng loại đơn `CANCELLED`/`VOIDED`. Đơn đã thu tiền chỉ hủy/vô hiệu hóa sau quy trình refund/void hiện hành, có lý do và audit.

## Ranh giới và công việc tiếp theo

Ba quyết định ở mục 5–7 được Owner duyệt ngày 11/10/2026 theo [đề xuất chi tiết](../reviews/2026-10-11-open-rules-proposal.md). Cần task/ExecPlan riêng, migration, RLS/RPC, audit, test cạnh tranh và kiểm tra mobile/staging trước khi coi là đã triển khai. Không sửa trực tiếp dữ liệu giao dịch cũ hoặc coi tài liệu này là chứng nhận task Done.

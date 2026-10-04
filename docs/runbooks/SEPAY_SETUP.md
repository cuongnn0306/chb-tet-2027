# SePay setup (PAY-006): việc con người cần làm

Repo đã có sẵn: bảng/hàm xử lý thanh toán idempotent, Edge Function `sepay-webhook`, màn hình QR và hàng đợi xử lý. **Chưa có tài khoản SePay hay endpoint thật nào được cấu hình**: các bước dưới đây cần tài khoản của bạn.

## 1. Cấu hình tài khoản nhận tiền trong app (Admin)

Danh mục → Cấu hình → "Cấu hình mã QR thanh toán", nhập JSON công khai, ví dụ:

```json
{ "bank": "MBBank", "account_no": "0123456789", "account_name": "CONG TY ..." }
```

Chỉ nhập thông tin công khai để tạo QR. **Không nhập secret/HMAC/token** (hệ thống từ chối). Giá trị `bank` phải là mã ngân hàng mà dịch vụ QR của SePay chấp nhận; kiểm tra theo tài liệu SePay.

**Cấu hình này cũng là tài khoản nhận tiền tin cậy của webhook (PAY-007).** Hệ thống chỉ tự cộng tiền khi `accountNumber` và `gateway` trong webhook khớp `account_no` và `bank` ở đây:

- `account_no` là **mã định danh**, không phải tên: nhập đúng như ngân hàng cấp, **chỉ gồm chữ và số liền nhau (3-30 ký tự), không khoảng trắng, dấu gạch hay dấu chấm, giữ nguyên số 0 đầu**. Webhook phải gửi `accountNumber` là chuỗi đúng định dạng đó; so khớp chính xác từng ký tự (chỉ không phân biệt hoa/thường) nên `0123456789` khác `123456789`. Hệ thống không tự bỏ dấu câu hay ký tự lạ để "sửa" dữ liệu sai thành đúng. `account_no` cấu hình sai định dạng thì coi như chưa cấu hình (từ chối mọi giao dịch, không nới lỏng).
- `bank` (hoặc `gateway`) là **tên ngân hàng**: so khớp không phân biệt hoa/thường và bỏ khoảng trắng, dấu chấm, gạch nối, gạch dưới (`MB Bank` = `MBBank`); các ký tự khác, kể cả chữ Unicode, giữ nguyên. Nếu tên SePay gửi trong `gateway` khác mã dùng để tạo QR, thêm khóa `gateway` cho đúng giá trị SePay gửi, ví dụ `{ "bank": "MBB", "gateway": "MBBank", "account_no": "...", "account_name": "..." }`.
- Chưa cấu hình, sai định dạng hoặc không khớp thì giao dịch **không được cộng tiền**: vào "Thanh toán cần xử lý" với trạng thái "Cần xem xét" kèm lý do.

Cũng cần đặt: Tiền tố mã đơn (ví dụ `TET`), Kiểu/Giá trị tiền cọc, Thời gian giữ hàng tạm.

## 2. Deploy Edge Function (staging trước, production sau)

```bash
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase secrets set SEPAY_WEBHOOK_HMAC_SECRET=<secret-key-lấy-từ-SePay>   # chế độ HMAC (khuyến nghị)
# hoặc, nếu SePay được cấu hình chế độ API Key:
npx supabase secrets set SEPAY_WEBHOOK_API_KEY=<khóa-ngẫu-nhiên-dài>
npx supabase functions deploy sepay-webhook --no-verify-jwt
```

URL webhook: `https://<project-ref>.supabase.co/functions/v1/sepay-webhook`

- `--no-verify-jwt` là bắt buộc vì SePay không gửi JWT của Supabase; function tự xác thực theo một trong hai chế độ **thay thế nhau** của SePay (tài liệu: https://developer.sepay.vn/en/sepay-webhooks/xac-thuc):
  - **HMAC-SHA256 (khuyến nghị cho production, phát hiện cả việc sửa nội dung):** SePay gửi `X-SePay-Timestamp` (Unix giây) và `X-SePay-Signature: sha256=<hex>`; chữ ký là HMAC-SHA256 của chuỗi `{timestamp}.{raw_body}` bằng Secret Key. Function từ chối khi thiếu/sai timestamp, timestamp lệch quá **5 phút** (cả quá khứ lẫn tương lai, chống replay), sai secret hoặc body bị sửa.
  - **API Key:** `Authorization: Apikey <khóa>` (chỉ chứng minh người gửi).
  - Có thể cấu hình cả hai secret; mỗi request chỉ cần đúng chế độ nó dùng. Request có gửi chữ ký thì chữ ký phải hợp lệ (API key không "cứu" chữ ký sai hoặc quá hạn). Không đặt secret nào thì **mọi request đều bị từ chối** (fail closed).
  - Đồng hồ máy chủ phải chuẩn (cửa sổ chỉ 5 phút). Tên header cố định theo tài liệu SePay, không còn biến `SEPAY_SIGNATURE_HEADER`.
- Staging và production dùng khóa **khác nhau**. Không dùng khóa production trong staging.
- Chạy thử local: copy `supabase/functions/.env.example` thành `supabase/functions/.env`, rồi `npx supabase functions serve sepay-webhook --env-file supabase/functions/.env`.

### Giới hạn kích thước và tần suất request (SEC-006)

Function áp dụng hai lớp bảo vệ **trước khi xác thực**, để request lỗi hoặc quá lớn không tiêu tốn tài nguyên:

- **Giới hạn body: có hiệu lực cho từng request**, không phụ thuộc số instance. Tối đa 64 KiB (`SEPAY_WEBHOOK_MAX_BODY_BYTES`). `Content-Length` lớn hơn mức này bị từ chối **trước khi đọc byte nào**; body dạng stream bị ngắt ngay khi vượt mức. Quá mức: HTTP 413; `Content-Length` sai định dạng: 400.
- **Thời hạn đọc body:** tối đa 10 giây tổng cộng (`SEPAY_WEBHOOK_BODY_TIMEOUT_MS`, phạm vi 1.000–30.000 ms). Body nhỏ nhưng không kết thúc, hoặc gửi nhỏ giọt liên tục, bị 408 khi hết thời hạn. Hủy stream không được chặn response nếu callback hủy không hoàn tất. Giá trị sai/thiếu quay về mặc định; cần đối chiếu độ trễ và retry thật của SePay trước go-live.
- **Giới hạn tần suất: chỉ best-effort.** Mặc định 120 request/phút mỗi địa chỉ nguồn (`SEPAY_WEBHOOK_RATE_LIMIT_PER_MINUTE`); địa chỉ đã gửi sai xác thực 10 lần/phút (`SEPAY_WEBHOOK_AUTH_FAILURES_PER_MINUTE`) bị từ chối sớm. Vượt mức: HTTP 429 kèm `Retry-After`. Bộ đếm nằm trong bộ nhớ từng instance Edge Function (xem giới hạn bên dưới).

Cấu hình tùy chọn qua `supabase secrets set` (bỏ trống = dùng mặc định). Giá trị thiếu, không phải số nguyên hoặc ngoài khoảng cho phép sẽ **quay về mặc định**; không có cách tắt giới hạn bằng cấu hình. Chữ ký HMAC vẫn tính trên đúng raw body như trước; body trong giới hạn được đọc nguyên văn.

**Giới hạn đã biết, đừng coi là bảo vệ phân tán:**

- Bộ đếm là của từng instance: reset khi instance khởi động lại và **không chia sẻ** giữa các instance/vùng chạy đồng thời. Kẻ tấn công được phân phối qua nhiều instance có thể vượt mức; đây không phải rate limit toàn cục.
- Khóa nguồn lấy từ header proxy (`cf-connecting-ip`, phần tử **ngoài cùng bên phải** của `X-Forwarded-For`, `X-Real-IP`). Chỉ đáng tin nếu nền tảng tự ghi các header này; **chưa kiểm chứng** với Supabase Edge Functions trong task này (không đọc được tài liệu platform). Nếu header không dùng được, mọi request chung một nhóm (chặt hơn, không lỏng hơn).
- Hệ quả phụ: một nguồn giả mạo được địa chỉ của SePay có thể làm SePay bị 429 tạm thời. Webhook không bị mất vì SePay retry và hệ thống xử lý trùng lặp an toàn, nhưng cần kiểm tra trong SePay Test Mode rằng SePay retry khi nhận 429/413 (chưa kiểm chứng) và chính sách retry của họ đủ dài.
- Giá trị mặc định (64 KiB, 120/phút, 10 lần sai/phút) là lựa chọn kỹ thuật cho tải một cửa hàng, **chưa được đối chiếu với payload/tần suất thật của SePay**. Đối chiếu ở Test Mode trước khi go-live.

**Cần Owner/DevOps quyết định để có rate limit mạnh (không tự tạo hạ tầng trong repo):** áp dụng giới hạn ở tầng gateway/WAF của nền tảng đang dùng, hoặc chỉ cho phép dải IP công bố của SePay nếu SePay cung cấp và nền tảng hỗ trợ. Cho đến khi có quyết định đó, SEC-006 chỉ đạt mức "giới hạn body có hiệu lực + giảm nhẹ tần suất theo từng instance".

### Nhật ký lỗi đã làm sạch (SEC-009)

Function chỉ ghi **một dòng JSON** cho mỗi sự kiện đáng chú ý, dựng từ danh sách giá trị cố định trong `supabase/functions/_shared/safe-log.ts`. **Không bao giờ ghi**: payload, `content`, số tài khoản, tên/số điện thoại khách, header (`Authorization`, chữ ký), khóa/secret, địa chỉ nguồn, nội dung thông báo lỗi của exception hoặc của database (các thông báo này có thể trích nguyên giá trị từ payload).

Ví dụ dòng log:

```json
{
  "fn": "sepay-webhook",
  "level": "warn",
  "event": "unauthorized",
  "reason": "stale_timestamp",
  "cid": "9f2c…32 ký tự hex"
}
```

| Trường       | Ý nghĩa                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`      | `rejected` (bị chặn bởi giới hạn), `unauthorized` (xác thực sai), `bad_request` (payload không dùng được), `failed` (lỗi xử lý)                             |
| `reason`     | Mã ổn định, ví dụ `payload_too_large`, `read_timeout`, `rate_limited`, `bad_signature`, `stale_timestamp`, `invalid_json`, `rpc_error`, `rpc_rejected`      |
| `cid`        | Mã tương quan ngẫu nhiên cho từng request, lặp lại trên mọi dòng của request đó; không suy ra từ nội dung request. Dùng để nối các dòng, không để tra khách |
| `sql_state`  | Chỉ có ở lỗi database: mã SQLSTATE 5 ký tự (ví dụ `P0001`, `23505`); giá trị sai định dạng thành `unknown`                                                  |
| `error_name` | Chỉ có ở exception không lường trước: tên lớp chuẩn (`TypeError`…); tên lạ thành `unknown`                                                                  |

- Giá trị `reason` là **hợp đồng ổn định**: có thể dựng bộ lọc/cảnh báo theo chuỗi này. Muốn thêm lý do mới thì thêm giá trị mới trong `WEBHOOK_LOG_REASONS`, không đổi tên giá trị cũ. Giá trị không có trong danh sách luôn thành `unknown`.
- Lọc nhanh trong Supabase Dashboard → Edge Functions → `sepay-webhook` → Logs: tìm `"event":"unauthorized"` hoặc `"reason":"rpc_error"`. Lỗi xác thực lặp lại (`bad_signature`, `bad_api_key`) có thể là sai secret sau khi xoay khóa hoặc có người dò; `stale_timestamp` kéo dài thường do đồng hồ lệch.
- Giới hạn tần suất chỉ ghi dòng đầu tiên của mỗi cửa sổ (`rate_limited`, `auth_failure_limit_reached`) để không tràn log. Phản hồi HTTP không đổi so với trước.
- Exception không lường trước giờ được bắt: ghi `unexpected_exception` kèm `error_name` rồi trả HTTP 500 (SePay sẽ retry), như hành vi cũ khi exception không được bắt.
- **Chưa làm và cần Owner/DevOps quyết định:** lưu trữ log dài hạn, bảng điều khiển, cảnh báo (email/Slack…), thời gian giữ log. Task này không tạo hạ tầng giám sát hay thông tin đăng nhập nào.
- **Chưa kiểm chứng:** định dạng dòng log hiển thị thế nào trong Logs của Supabase thật (chưa chạy Edge runtime/staging trong task này; chỉ kiểm thử đơn vị với dữ liệu giả).

## 3. Cấu hình webhook trong SePay

1. Staging: dùng **SePay Test Mode** để tạo webhook trỏ tới URL staging.
2. Kiểu xác thực: chọn **HMAC** (Secret Key trùng `SEPAY_WEBHOOK_HMAC_SECRET`) hoặc API Key (header `Authorization: Apikey <khóa ở bước 2>`).
3. Chỉ gửi giao dịch tiền vào; bật retry (hệ thống xử lý trùng lặp an toàn).
4. Nếu dùng HMAC: kiểm tra trong SePay Test Mode rằng chữ ký đúng định dạng `sha256=<hex>` trên `{timestamp}.{raw_body}`; gửi lại một webhook cũ hơn 5 phút phải bị từ chối (401).
5. Cấu hình nhận diện mã thanh toán theo tiền tố đơn hàng (ví dụ `TET`) để trường `code` của SePay khớp mã đơn. Nếu SePay không trả `code`, hệ thống tự tìm mã `TET######` trong nội dung chuyển khoản.
6. Đối chiếu payload thật với giả định trong `docs/exec-plans/active/E06-payment-sepay.md` (các trường `id`, `transferType`, `transferAmount`, `code`, `content`, `transactionDate`).

## 4. Kiểm thử trước khi go-live

- Chuyển khoản thử vào đơn staging: đơn tự đủ cọc và chuyển "Đã xác nhận" không cần tải lại trang.
- Gửi lại cùng giao dịch (retry): không cộng tiền lần hai (`DUPLICATE`).
- Chuyển thiếu/thừa/sai nội dung: vào "Thanh toán cần xử lý" (không tự cộng tiền).
- Webhook của tài khoản khác, thiếu `accountNumber`/`gateway`, thiếu hoặc sai `transferType`: vào "Cần xem xét", không tạo khoản thanh toán. Tiền ra (`out`) và số tiền không hợp lệ được bỏ qua và ghi vết. `id` phải là số nguyên dương (SePay gửi số; chuỗi chỉ gồm chữ số cũng được nhận). Mọi biểu diễn của cùng một số (`123`, `"123"`, `"0123"`) là **cùng một giao dịch** và chỉ được ghi nhận một lần; `id` khác dạng này, hoặc số lớn hơn 2^53 gửi dưới dạng số, bị từ chối (HTTP 400).
- Giới hạn request (SEC-006): body lớn hơn 64 KiB trả 413 và không được xử lý; vượt tần suất trả 429 kèm `Retry-After`. Xác nhận trong SePay Test Mode rằng giao dịch bình thường không bị chặn và SePay retry sau 429/413.
- Production: chỉ bật sau UAT, bằng khóa và tài khoản riêng.

## 5. Vận hành

- Màn hình "Thanh toán cần xử lý" (Admin): gán giao dịch chưa khớp vào đơn, hoặc đánh dấu đã xử lý (ghi chú cách xử lý, ví dụ đã hoàn tiền cho khách). Hệ thống không tự chuyển tiền hoàn.
- Mọi webhook được lưu trong `payment_events` (không lưu header/khóa) để truy vết.

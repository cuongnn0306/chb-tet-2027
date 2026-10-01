# SePay setup (PAY-006): việc con người cần làm

Repo đã có sẵn: bảng/hàm xử lý thanh toán idempotent, Edge Function `sepay-webhook`, màn hình QR và hàng đợi xử lý. **Chưa có tài khoản SePay hay endpoint thật nào được cấu hình**: các bước dưới đây cần tài khoản của bạn.

## 1. Cấu hình tài khoản nhận tiền trong app (Admin)

Danh mục → Cấu hình → "Cấu hình mã QR thanh toán", nhập JSON công khai, ví dụ:

```json
{ "bank": "MBBank", "account_no": "0123456789", "account_name": "CONG TY ..." }
```

Chỉ nhập thông tin công khai để tạo QR. **Không nhập secret/HMAC/token** (hệ thống từ chối). Giá trị `bank` phải là mã ngân hàng mà dịch vụ QR của SePay chấp nhận; kiểm tra theo tài liệu SePay.

Cũng cần đặt: Tiền tố mã đơn (ví dụ `TET`), Kiểu/Giá trị tiền cọc, Thời gian giữ hàng tạm.

## 2. Deploy Edge Function (staging trước, production sau)

```bash
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase secrets set SEPAY_WEBHOOK_API_KEY=<khóa-ngẫu-nhiên-dài>
npx supabase functions deploy sepay-webhook --no-verify-jwt
```

URL webhook: `https://<project-ref>.supabase.co/functions/v1/sepay-webhook`

- `--no-verify-jwt` là bắt buộc vì SePay không gửi JWT của Supabase; function tự xác thực bằng API key (và HMAC nếu bạn đặt `SEPAY_WEBHOOK_HMAC_SECRET`). Nếu không đặt secret nào, **mọi request đều bị từ chối** (fail closed).
- Staging và production dùng khóa **khác nhau**. Không dùng khóa production trong staging.
- Chạy thử local: copy `supabase/functions/.env.example` thành `supabase/functions/.env`, rồi `npx supabase functions serve sepay-webhook --env-file supabase/functions/.env`.

## 3. Cấu hình webhook trong SePay

1. Staging: dùng **SePay Test Mode** để tạo webhook trỏ tới URL staging.
2. Kiểu xác thực: API Key, header `Authorization: Apikey <khóa ở bước 2>`.
3. Chỉ gửi giao dịch tiền vào; bật retry (hệ thống xử lý trùng lặp an toàn).
4. Nếu SePay hỗ trợ ký HMAC: đặt `SEPAY_WEBHOOK_HMAC_SECRET` và `SEPAY_SIGNATURE_HEADER` đúng tên header theo tài liệu SePay (repo chưa xác minh tên header thật).
5. Cấu hình nhận diện mã thanh toán theo tiền tố đơn hàng (ví dụ `TET`) để trường `code` của SePay khớp mã đơn. Nếu SePay không trả `code`, hệ thống tự tìm mã `TET######` trong nội dung chuyển khoản.
6. Đối chiếu payload thật với giả định trong `docs/exec-plans/active/E06-payment-sepay.md` (các trường `id`, `transferType`, `transferAmount`, `code`, `content`, `transactionDate`).

## 4. Kiểm thử trước khi go-live

- Chuyển khoản thử vào đơn staging: đơn tự đủ cọc và chuyển "Đã xác nhận" không cần tải lại trang.
- Gửi lại cùng giao dịch (retry): không cộng tiền lần hai (`DUPLICATE`).
- Chuyển thiếu/thừa/sai nội dung: vào "Thanh toán cần xử lý" (không tự cộng tiền).
- Production: chỉ bật sau UAT, bằng khóa và tài khoản riêng.

## 5. Vận hành

- Màn hình "Thanh toán cần xử lý" (Admin): gán giao dịch chưa khớp vào đơn, hoặc đánh dấu đã xử lý (ghi chú cách xử lý, ví dụ đã hoàn tiền cho khách). Hệ thống không tự chuyển tiền hoàn.
- Mọi webhook được lưu trong `payment_events` (không lưu header/khóa) để truy vết.

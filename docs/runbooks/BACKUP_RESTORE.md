# Backup và restore (SEC-010)

**Trạng thái: runbook đã viết, CHƯA có bằng chứng thực thi.** Chưa có backup nào được xác nhận, chưa có
restore rehearsal nào chạy (Docker Linux engine không kết nối được ngày 12/10/2026; staging/production chưa cấu hình).
Mọi lệnh bên dưới là quy trình để người có quyền thực hiện, chưa được chạy trong lần soạn này. Xem §12 cho danh sách
chính xác điều gì đã/chưa được kiểm chứng.

Tài liệu này không thay `PRODUCTION_DEPLOY.md` / `STAGING_DEPLOY.md`; nó bổ sung phần phục hồi dữ liệu.
Nguồn quy định: `IMPLEMENTATION_INFRA_PLAN_v1.0.md` §12.4, §14, §15, §24, §27 và `PRODUCTION_DEPLOY.md`.

## 1. Hạ tầng thực tế theo file trong repo

| Hạng mục       | Cấu hình hiện có (nguồn)                                                                                                                                                                                   | Backup/restore                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local          | Supabase CLI + Docker, `project_id = "chb-ban-hang"`, API 56321, DB 56322, shadow 56320, Studio 56323, Postgres major 17 (`supabase/config.toml`). `supabase db reset` = migrations + `supabase/seed.sql`. | Dữ liệu giả, dựng lại được. Dùng làm nơi diễn tập (§8), không phải nguồn sự thật. |
| CI             | `.github/workflows/ci.yml` job `database`: `supabase start`, `db reset`, `test:db`, `test:integration`.                                                                                                    | Chứng minh schema dựng lại từ migration. **Không** phải bằng chứng restore.       |
| Staging        | `.github/workflows/staging.yml`: `db push --dry-run` rồi `db push` khi `develop` đổi; tắt trừ khi `vars.STAGING_CONFIGURED == 'true'`. `STAGING_DEPLOY.md` ghi "CHƯA cấu hình".                            | Không có cấu hình backup nào trong repo. Bên ngoài repo, chưa xác minh.           |
| Production     | `.github/workflows/production.yml` chỉ là placeholder (`workflow_dispatch` in một dòng echo). `PRODUCTION_DEPLOY.md` ghi "CHƯA cấu hình"; tên dự kiến `chb-tet-2027-prod`.                                 | Không có job backup/dump/PITR nào. Bên ngoài repo, chưa xác minh.                 |
| Migration      | Checkout tích hợp có 31 migration, mới nhất `20261004110000_trf001_transfer_request.sql` (kiểm kê 12/10/2026).                                                                                             | Schema khôi phục được từ git; dữ liệu thì không.                                  |
| Edge Function  | `supabase/functions/sepay-webhook` (`verify_jwt = false`, tự xác thực). Secret: `SEPAY_WEBHOOK_API_KEY`, `SEPAY_WEBHOOK_HMAC_SECRET` (`supabase/functions/.env.example`).                                  | Code ở git. **Secret không nằm trong backup DB** (§2).                            |
| Frontend       | Vercel (`main` → Production, `develop` → Preview/Staging) theo runbook; biến `VITE_*` chỉ chứa URL + anon key.                                                                                             | Rollback bằng promote deployment cũ (infra plan §24), không cần restore DB.       |
| Storage bucket | Không cấu hình bucket nào (`config.toml` chỉ có ví dụ bị comment; không migration nào tạo bucket).                                                                                                         | Không có file người dùng cần backup. Xem lại nếu sau này thêm bucket.             |
| Job định kỳ    | `pg_cron` job `expire-temporary-reservations` (mỗi phút) tạo trong `20261001192601_reservations.sql` nếu extension có sẵn; thất bại chỉ phát `notice`.                                                     | Phải kiểm tra lại sau restore (§7 bước 7).                                        |
| `.gitignore`   | `*.dump`, `*.backup`, `.env*`, `tmp/*` bị bỏ qua.                                                                                                                                                          | File backup chứa dữ liệu thật: **không bao giờ commit**.                          |

Không có trong repo: gói Supabase đang dùng, lịch backup tự động, PITR, thời gian lưu giữ, nơi lưu dump.
Owner đã xác nhận trực tiếp quản trị GitHub, Supabase, Vercel và SePay; trạng thái cấu hình backup vẫn **chưa xác minh** (§12).

**Áp dụng theo phiên bản schema đích.** Bản tích hợp này có migration `20261002070000` và các migration sau đó;
những bản backup cũ hoặc môi trường chưa triển khai có thể thiếu bảng gán lô. Hệ quả:

- Tên bảng/cột/hàm trong §6 và §10 mới được đối chiếu bằng cách đọc migration; chưa truy vấn nào được chạy
  trên database phục hồi thực tế.
- **Trước khi chạy bất kỳ truy vấn §10 nào, người thực hiện phải xác nhận schema đích**: liệt kê `supabase/migrations`
  của commit đang chạy và so với `select version from supabase_migrations.schema_migrations` (R1). Truy vấn
  nào tham chiếu đối tượng không có trong schema đích (ví dụ `delivery_item_batches` trên DB trước `070000`)
  là **không áp dụng**, không phải "pass"; R9 có bước kiểm tra áp dụng riêng.
- Số lượng file và "mới nhất" ở trên sẽ lỗi thời khi có migration mới; không dùng chúng làm bằng chứng cho
  bản đang chạy production.

## 2. Cái gì cần bảo vệ, và cái gì KHÔNG nằm trong backup DB

Trong database (nguồn sự thật cần backup):

- `inventory_movements` (sổ kho bất biến, nguồn sự thật tồn), `audit_logs` (bất biến).
- `orders`, `order_items`, `order_status_history`, `payments`, `payment_events`, `deliveries`, `delivery_items`.
- `inventory_reservations`, `product_batches`, `customers`, `products`, `locations`, `profiles`, `roles`,
  `app_settings`, `commission_rules`, `safety_stock_rules`.
- Tài khoản đăng nhập nằm ở schema `auth` của Supabase; `profiles` tham chiếu tới đó. Backup mà thiếu `auth`
  thì khôi phục xong không ai đăng nhập được.

Dữ liệu **dẫn xuất / cache** (có thể tính lại, nhưng phải đối soát): `inventory_balances` (cache của sổ kho),
`orders.paid_amount` (tổng các payment `CONFIRMED`).

KHÔNG nằm trong backup DB — phải khôi phục riêng:

- Secret Edge Function (`npx supabase secrets set ...`), secret Vercel server, mật khẩu DB, access token.
  Nguồn là password manager của Owner, không phải repo.
- Cấu hình phía SePay (URL webhook, API key/HMAC secret, tài khoản nhận tiền).
- Cấu hình dashboard Supabase (Auth settings, MFA, network restriction) nếu không được mô tả trong `config.toml`.

## 3. Vai trò và trách nhiệm

Owner dự án đã nhận vai trò quản trị các tài khoản nền tảng ngày 11/10/2026. Cần gán người thực hiện kỹ thuật,
Admin, Kho và đối soát trước go-live; ô chưa gán nghĩa là chưa có người được chỉ định cho vai trò đó.

| Vai trò                                      | Trách nhiệm                                                                                                                                                                            | Người phụ trách |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Owner (chủ tài khoản GitHub/Supabase/Vercel) | Chọn gói Supabase có backup; bật và xác nhận backup/PITR; quyết định RPO/RTO; giữ secret; **duy nhất** quyết định restore production; bật MFA. Ký duyệt bằng chứng rehearsal.          | Chủ dự án       |
| Kỹ thuật (người chạy release)                | Chạy backup trước mỗi `db push`; chạy rehearsal; thực hiện restore khi Owner duyệt; ghi bằng chứng (§11).                                                                              | _chưa gán_      |
| Admin ứng dụng (role `ADMIN`)                | Chạy đối soát trong app/`verify_inventory_balances()`; xác nhận số liệu nghiệp vụ sau restore; xử lý hàng đợi thanh toán cần xem xét; đóng băng nhập liệu khi được yêu cầu.            | _chưa gán_      |
| Kho (role `WAREHOUSE`)                       | Đếm tồn thực tế các kho trọng điểm để so với tồn sau restore; ghi nhận giao/xuất phát sinh trong khoảng mất dữ liệu.                                                                   | _chưa gán_      |
| Sale / Cửa hàng                              | Khi được yêu cầu: liệt kê đơn/thu tiền tạo trong khoảng mất dữ liệu để nhập lại hoặc xác nhận.                                                                                         | _chưa gán_      |
| Agent AI (Codex/Claude)                      | Chỉ soạn tài liệu và chạy trên **local**. Không truy cập production/staging, không restore, không đổi tài khoản, không giữ secret. Không được tuyên bố đã diễn tập khi chưa chạy thật. | n/a             |

## 4. Chính sách backup

### 4.1 Đã được quy định trong spec (bắt buộc)

- Trước mỗi migration production quan trọng: tạo backup/snapshot theo khả năng platform, hoặc dump theo
  quy trình đã duyệt; ghi **release tag** và **migration version** (infra plan §15, `PRODUCTION_DEPLOY.md`).
- Production gate: "Backup confirmed" trước khi deploy (infra plan §14, §27).
- Không dựa vào "rollback migration" tự động; ưu tiên forward-fix; restore chỉ khi sự cố nghiêm trọng và có
  quyết định rõ (infra plan §24).
- Cấm `supabase db reset --linked` và seed test trên production.

### 4.2 Đề xuất, CHƯA được Owner phê duyệt (không coi là quy tắc)

Spec không định nghĩa RPO/RTO, tần suất hay thời gian lưu giữ. Bảng dưới là câu hỏi cần Owner quyết định
cùng đề xuất tham khảo; không có giá trị nào là cam kết.

| Quyết định cần có                            | Đề xuất để cân nhắc                                                                                      | Trạng thái      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------- |
| RPO (tối đa mất bao nhiêu dữ liệu)           | Mùa cao điểm nhận tiền/đơn qua ngày, nên cân nhắc PITR hoặc backup nhiều lần/ngày, không chỉ 1 lần/ngày. | chưa quyết định |
| RTO (tối đa bao lâu để chạy lại)             | Quyết định cùng Owner dựa trên thời gian restore đo được ở rehearsal, không đoán trước.                  | chưa quyết định |
| Tần suất backup ngoài release                | Hằng ngày trong chiến dịch, cộng một backup thủ công ngay trước mỗi `db push`.                           | chưa quyết định |
| Thời gian lưu giữ + nơi lưu bản dump riêng   | Nơi lưu mã hóa, ngoài laptop cá nhân, truy cập giới hạn; xóa khi hết hạn lưu giữ.                        | chưa quyết định |
| Có cần bản sao ngoài nhà cung cấp (provider) | Cân nhắc nếu rủi ro "mất cả tài khoản provider" không chấp nhận được.                                    | chưa quyết định |

## 5. Quy trình backup

Mọi bước là thao tác của **con người có quyền**. Agent không chạy các bước này.

### 5.1 Trước mỗi `db push` lên production (bắt buộc theo spec)

1. Xác nhận release tag và migration version sẽ đẩy (`git describe`/PR Release; liệt kê `supabase/migrations`).
2. Xác nhận trong Supabase Dashboard (mục Database → Backups) rằng có backup/PITR **mới và còn hạn**, hoặc tạo
   bản dump theo 5.2. Ghi thời điểm và định danh bản backup vào bằng chứng (§11). Không ghi "đã backup" khi
   chưa nhìn thấy bản backup cụ thể.
3. Chỉ sau đó mới chạy `npx supabase db push --dry-run`, được duyệt rồi mới `db push`
   (xem `PRODUCTION_DEPLOY.md`).

### 5.2 Dump logic thủ công (khi platform không đủ, hoặc cần bản ngoài provider)

Phiên bản CLI cài trong repo: `supabase ^2.119.0`. **Đọc `npx supabase db dump --help` của phiên bản đang
dùng trước khi chạy**; lệnh dưới là mẫu chưa được chạy trong lần soạn này và cờ có thể khác:

```bash
# <BACKUP_DIR> = thư mục tuyệt đối do Owner DUYỆT TRƯỚC, nằm NGOÀI repo (không phải thư mục con của
# checkout, không phải tmp/), mã hóa ổ đĩa, quyền truy cập giới hạn. Không có thư mục được duyệt thì dừng.
# Chạy sau khi đã `supabase link` tới đúng project (xác minh ref bằng mắt, 2 người nếu là production).
npx supabase db dump --linked -f <BACKUP_DIR>/backup-<env>-<UTC>-schema.sql
npx supabase db dump --linked --data-only --use-copy -f <BACKUP_DIR>/backup-<env>-<UTC>-data.sql
npx supabase db dump --linked --role-only -f <BACKUP_DIR>/backup-<env>-<UTC>-roles.sql
```

Lưu ý bắt buộc khi dùng cách này:

- `db dump` mặc định có thể **không** gồm các schema do Supabase quản lý như `auth`. Phải xác minh bản dump có
  tài khoản đăng nhập (đếm `auth.users` trước/sau). Nếu không có, bản dump không đủ để khôi phục hệ thống.
- **Không dựa vào `.gitignore`.** Các mẫu bị chặn commit chỉ là đuôi `.dump`/`.backup`; tên `*.sql` ở trên KHÔNG
  được bảo vệ, nên bắt buộc ghi vào `<BACKUP_DIR>` ngoài repo. Sau khi dump, kiểm tra `git status` của repo để chắc
  không có file dump nào xuất hiện. Bản dump chứa số điện thoại, địa chỉ, đơn hàng thật: lưu mã hóa, ghi nơi lưu,
  không gửi qua chat/email, xóa khi hết hạn lưu giữ.
- Ghi SHA-256 của từng file dump và kích thước vào bằng chứng để phát hiện hỏng file khi restore.

## 6. Guard và trigger của hệ thống ảnh hưởng thế nào tới restore

Đây là rủi ro đặc thù của repo này. Restore **chỉ dữ liệu** (data-only `INSERT`/`COPY`) vào schema đã có từ
migration, với trigger đang bật, sẽ làm hỏng dữ liệu hoặc thất bại:

| Cơ chế (nguồn)                                                                                                 | Hậu quả nếu nạp dữ liệu khi trigger đang bật                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orders_assign_code` (`order_code.sql`): luôn gán `order_code` mới từ `private.order_code_seq`                 | **Mã đơn bị đánh số lại.** Mã đơn là nội dung chuyển khoản khách đã dùng để ghép thanh toán SePay → ghép sai đơn.                                                                                |
| `payments_before_write` (`payments_schema.sql`): `INSERT` gán lại `payment_code` từ `private.payment_code_seq` | Mã thanh toán bị đổi, sequence bị tiêu thụ, dữ liệu không còn khớp bản gốc.                                                                                                                      |
| `inventory_movements_guard_insert` / `inventory_balances_guard`: chặn ghi nếu `app.inventory_posting` ≠ `on`   | Nạp thẳng sổ kho/cache bị từ chối; cố ép qua RPC thì **ghi thêm movement mới** thay vì khôi phục movement cũ.                                                                                    |
| `audit_row_change` trigger (ví dụ `audit_payments`)                                                            | Mỗi dòng nạp lại **sinh thêm dòng `audit_logs`**, làm nhân đôi lịch sử audit. `audit_logs` lại bất biến nên không dọn được.                                                                      |
| `payments_refresh_order` / `orders_guard`                                                                      | `paid_amount` bị tính lại giữa chừng khi `payments` chưa nạp đủ; giá trị trung gian sai.                                                                                                         |
| `private.order_code_seq`, `private.payment_code_seq`                                                           | Nếu sequence không được đặt lại ≥ mã lớn nhất, đơn/payment mới sẽ **trùng mã** hoặc đặt sai thứ tự.                                                                                              |
| `delivery_item_batches_guard_write` + trigger audit (chỉ schema có migration `070000`, xem §1)                 | Nạp thẳng bị từ chối nếu `app.inventory_posting` ≠ `on`; nếu ép được thì trigger audit **nhân đôi `audit_logs`**. Lô đã gán cho đợt giao là sự thật vật lý đã ghi: không được tái tạo bằng FEFO. |

Hệ quả quy trình:

1. Ưu tiên **khôi phục nguyên database** (provider restore/PITR vào project mới, hoặc dump đầy đủ schema+data
   nạp vào database rỗng) thay vì "migration rồi nạp dữ liệu". Trong dump đầy đủ, trigger được tạo sau dữ liệu.
2. Nếu bắt buộc nạp data-only vào schema từ migration, phải tắt trigger/rule trong lúc nạp bằng cơ chế được
   xác nhận (ví dụ `session_replication_role = replica` với quyền phù hợp — **chưa kiểm chứng trên stack này**,
   phải chứng minh ở rehearsal), rồi đặt lại sequence và chạy toàn bộ đối soát §10. Không dùng cách này trên
   production nếu rehearsal chưa chứng minh nó giữ nguyên `order_code`, `payment_code` và số dòng `audit_logs`.
3. Không bao giờ "sửa" dữ liệu sau restore bằng `UPDATE`/`DELETE` thẳng vào ledger/audit; các bảng này bất biến
   có chủ đích. Sai lệch được xử lý bằng movement điều chỉnh có lý do (Admin) hoặc restore lại.

## 7. Quy trình khôi phục khi có sự cố (production) — chỉ con người, cần Owner duyệt

Nguyên tắc: **forward-fix trước, restore là phương án cuối** (infra plan §24). Không restore chỉ vì một
migration lỗi nhỏ mà có thể vá bằng migration mới tương thích ngược.

### 7.0 Mọi nguồn ghi (writer) phải được kiểm soát — không chỉ người dùng

"Ngừng nhập liệu" bằng thông báo là **không đủ**. Có nhiều đường ghi vào DB, và nhiều đường trong số đó tự chạy.
Bảng dưới là các writer suy ra từ repo; người thực hiện phải đối chiếu với thực tế triển khai và bổ sung nếu thiếu.
Mọi hành động "dừng/bật" là thao tác thủ công của con người có quyền; tài liệu này không thực hiện chúng.

| Writer                                                            | Ghi vào đâu                                                                               | Cách chặn có thể thi hành (do Owner/Kỹ thuật chọn)                                                                                                  | Bằng chứng đã chặn                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Giao diện web / RPC của người dùng                                | `orders`, `payments`, `inventory_*`, `deliveries`… qua PostgREST/RPC với JWT người dùng   | Trỏ Vercel sang trang bảo trì hoặc đổi biến môi trường; khóa phía server, không chỉ báo miệng                                                       | Gọi thử một RPC ghi bằng tài khoản thử → bị từ chối               |
| Webhook SePay (Edge Function)                                     | `payment_events`, `payments`, `orders.paid_amount`; xác thực bằng API key/HMAC, không JWT | Xem §7.1: chỉ ngừng sau khi đã xác nhận chính sách giữ/thử lại sự kiện bền vững                                                                     | Nhật ký phía nhà cung cấp cho thấy endpoint cũ không còn nhận     |
| Job `pg_cron` `expire-temporary-reservations`                     | `inventory_reservations`, `inventory_balances`, `audit_logs` (mỗi phút)                   | Lưu ý: job **nằm trong DB**, nên bản khôi phục có thể tự chạy ngay. Chụp baseline R2/R3 **trước** lần chạy đầu; quyết định tạm tắt trên bản cách ly | `cron.job` / `cron.job_run_details` trên đích cho thấy trạng thái |
| Kết nối trực tiếp (Kỹ thuật, `db push`, script, CI staging)       | Mọi bảng, bỏ qua RLS nếu dùng vai trò đặc quyền                                           | Thu hồi/đổi mật khẩu DB và token của đích cũ; tạm dừng workflow triển khai                                                                          | Đăng nhập thử bằng thông tin cũ thất bại                          |
| Service role / secret còn nằm ở Vercel server env hay Edge secret | Bất kỳ                                                                                    | Đổi (rotate) secret của đích cũ khi đã chuyển sang đích mới                                                                                         | Secret cũ không còn dùng được                                     |

Quy tắc bất biến cho cả quy trình: **tại mọi thời điểm chỉ có MỘT đích có thể ghi.** Cụ thể, tại một thời điểm,
chỉ một DB đồng thời (a) là đích của biến môi trường ứng dụng, (b) là đích của URL webhook ở nhà cung cấp,
(c) có job `pg_cron` hoạt động, (d) có mật khẩu/khóa còn hiệu lực. DB còn lại phải bị chặn bằng cơ chế bắt buộc
(thu hồi khóa, tạm dừng project, đổi cấu hình), không bằng thông báo. Ghi thời điểm UTC mỗi lần chuyển trạng thái.
Nếu không thể chứng minh điều này, **không cutover**.

### 7.1 Chính sách giữ sự kiện thanh toán và ngừng webhook

Repo **không** có lớp lưu sự kiện bền vững nằm ngoài DB (không có hàng đợi, không có endpoint thu-chỉ-lưu); sự kiện
SePay chỉ được lưu khi Edge Function ghi được vào DB. Repo cũng không ghi chính sách thử lại của SePay. Vì vậy:

1. **Trước khi ngừng/đổi webhook**, Owner phải xác nhận **bằng tài liệu/bảng điều khiển chính thức của SePay tại
   thời điểm đó** (không dựa vào trí nhớ hay tài liệu này) và ghi vào bằng chứng: SePay có thử lại khi không nhận
   2xx không; thử lại trong bao lâu và bao nhiêu lần; có xem lại/gửi lại được lịch sử giao dịch không; và nơi giữ
   bản ghi độc lập (nhật ký của SePay, sao kê ngân hàng).
2. Chọn một trong các phương án và ghi rõ vào quyết định (§7 bước 4): (a) endpoint cũ trả lỗi tạm thời để nhà cung
   cấp thử lại, **chỉ khi** cửa sổ thử lại lớn hơn thời gian dự kiến gián đoạn; (b) chấp nhận không có thử lại và
   dựa vào đối soát thủ công theo sao kê; (c) dựng lớp thu-chỉ-lưu — đây là việc **mới, cần quyết định riêng và
   task riêng**, không được tự thêm trong lúc xử lý sự cố.
3. Nếu không xác nhận được mục 1, **không ngừng webhook trước**; thay vào đó giữ nó ở trạng thái đã biết và ưu
   tiên đối soát delta (bước 6) thay vì giả định không mất giao dịch.

Mọi nhánh đều kết thúc bằng **đối soát delta cuối cùng** (bước 6) trước khi mở ghi trên đích mới. Tính idempotent
(unique `(provider, provider_event_id)` và `(provider, provider_reference)`) làm cho việc phát lại an toàn, nhưng
chỉ khi phát lại vào **đúng một** đích đang ghi được.

### 7.2 Các bước

1. **Phân loại sự cố** theo infra plan §23 (P0: không tạo được đơn, tồn sai nghiêm trọng, thu tiền hai lần,
   truy cập trái phép, production không chạy). Ghi thời điểm phát hiện (UTC).
2. **Kiểm soát mọi writer theo §7.0**, không chỉ yêu cầu người dùng ngừng nhập liệu. Việc ngừng webhook chỉ
   được làm theo §7.1. Ghi thời điểm đóng băng (UTC): đó là mốc kết thúc "khoảng mất dữ liệu".
3. **Xác định điểm khôi phục.** Release nào đang chạy, migration cuối, backup/PITR gần nhất trước sự cố, app
   có rollback được không, thay đổi DB có tương thích ngược không (infra plan §15). Ghi lại: thời điểm sự cố,
   thời điểm backup định dùng, **khoảng mất dữ liệu** = từ thời điểm backup đến lúc đóng băng.
4. **Owner ra quyết định bằng văn bản** (restore vào đâu, điểm thời gian nào, chấp nhận mất gì).
5. **Khôi phục vào một project/database mới trước** (không ghi đè production đang có): dùng chức năng restore
   của provider hoặc dump đầy đủ (§6). Giữ nguyên production hỏng để điều tra cho tới khi dữ liệu mới được
   đối soát xong. Không dùng `db reset` ở bất kỳ môi trường linked nào.
6. **Đối soát delta cuối cùng** (làm trước khi cho nhập liệu lại, và lặp lại ngay trước cutover nếu còn writer nào
   đã chạy sau lần đối soát trước):
   - Khoảng cần phủ: từ (thời điểm backup − biên an toàn do Owner chọn) đến thời điểm đóng băng ở bước 2.
   - Thanh toán SePay phát sinh trong khoảng đó: lấy danh sách giao dịch từ SePay **và** sao kê ngân hàng (hai
     nguồn độc lập), so với `payment_events`/`payments` trên bản khôi phục theo `(provider, provider_event_id)`.
     Phần thiếu được phát lại qua đường idempotent bình thường vào **đích duy nhất đang được phép ghi** (không
     phát lại vào hai nơi). Giao dịch không tự ghép được sẽ vào hàng đợi cần xem xét; không tự nghĩ ra chính
     sách hoàn/tách tiền.
   - Đơn/giao hàng/xuất kho phát sinh trong khoảng: Sale/Kho liệt kê từ chat/Excel/Zalo, Admin nhập lại qua
     chức năng bình thường (tạo đơn mới, movement mới). Không chèn thẳng vào bảng. Lưu ý mã đơn/mã thanh toán
     sẽ **khác** mã cũ (đánh số lại từ sequence): ghi bảng ánh xạ cũ→mới và thông báo khách nếu mã chuyển khoản
     đã phát cho họ.
7. **Chạy đối soát §10 trên bản đã khôi phục** (R1 xác nhận schema đích trước; R9 chỉ khi áp dụng) và kiểm tra:
   `pg_cron` job `expire-temporary-reservations` tồn tại và trạng thái bật/tắt đúng ý định; secret Edge Function đã
   đặt lại; URL webhook SePay vẫn **chưa** trỏ vào đích này cho tới bước 8; tài khoản Admin đăng nhập được.
8. **Cutover có thứ tự, một đích ghi được**: (i) xác nhận đích cũ đã bị chặn theo §7.0; (ii) trỏ biến môi trường
   Vercel sang đích mới ở chế độ chỉ đọc/kiểm thử; (iii) smoke test (infra plan §22, dữ liệu kiểm thử có kiểm
   soát, dọn bằng void/soft-delete); (iv) bật `pg_cron` nếu đã tắt; (v) trỏ URL webhook sang đích mới và chạy
   lần đối soát delta cuối (bước 6) cho khoảng từ lần trước; (vi) mở ghi cho người dùng. Mỗi bước ghi thời điểm
   UTC. Nếu bước (v) hoặc (vi) thất bại, **không** hoàn nguyên bằng cách mở lại đích cũ khi đích mới đã nhận ghi:
   đó là quyết định của Owner kèm đối soát hai chiều, vì sẽ có hai tập dữ liệu khác nhau.
9. **Hậu kiểm**: viết báo cáo sự cố gồm mốc thời gian, dữ liệu mất, hành động đã làm, bằng chứng đối soát, bài học;
   lưu theo §11. Cập nhật runbook nếu quy trình thực tế khác.

Không làm khi khôi phục: hard-delete giao dịch; sửa schema production bằng Dashboard không qua migration;
nạp seed test; đưa dữ liệu production vào local/staging để thử (AGENTS §7).

## 8. Diễn tập local (rehearsal) — quy trình, chưa chạy

Mục tiêu: chứng minh một bản dump **đầy đủ** của DB local khôi phục được vào database rỗng và vượt qua đối soát
§10, đồng thời đo thời gian. Local chỉ có dữ liệu giả từ `seed.sql`; kết quả chứng minh quy trình và các hazard ở
§6, **không** chứng minh backup của production.

### 8.1 Điều kiện tiên quyết (bắt buộc, kiểm tra trước)

- `docker info` chạy được (xem `LOCAL_SETUP.md`). **Nếu Docker không chạy, dừng và ghi "blocked: Docker" — không
  được ghi rehearsal là đã chạy hoặc đạt.**
- `npx supabase start` đã chạy và DB local có dữ liệu cần thiết. `supabase db reset` xóa DB local: chỉ chạy khi
  chắc chắn không còn dữ liệu local cần giữ.
- **Lease DB dùng chung — TRẠNG THÁI: BLOCKED, KHÔNG THỂ THỰC THI cho tới khi có runner rehearsal đã được duyệt.**
  Mục này mô tả đúng cơ chế hiện có (đọc từ `scripts/db-validation-lock.mjs`, `scripts/task-pipeline.mjs`,
  `scripts/claude-worker.ps1`, `docs/handoff/PARALLEL_WORKFLOW.md`) và điều nó ngụ ý cho rehearsal. Đây **không phải**
  quy trình đã được duyệt; không ai được coi nó là thủ tục chạy tay.

  **Đường dẫn lease thực tế.** Là giá trị tuyệt đối `dbLockPath` trong cấu hình worker do controller sinh ra; worker
  chép nó vào biến môi trường `CHB_DB_LOCK_PATH` cho các tiến trình con, và `task:finish` đọc biến đó. Repo **không**
  khai báo một đường dẫn cố định (các test chỉ dùng `<workspace>/tmp/db.lock` làm fixture). Vì vậy giá trị thật
  của môi trường này là **chưa xác định trong lần soạn này** (cũng không được dò bằng `printenv`/dump môi trường).
  Người chạy phải lấy đường dẫn từ file cấu hình worker của controller, ghi vào bằng chứng, và dùng đúng giá trị đó;
  không đoán, không tự tạo đường dẫn khác (lease ở đường dẫn khác không loại trừ ai cả).

  **Giao thức chiếm lease (nguyên tử, token).** Đúng như mã đã duyệt, và chỉ như vậy:
  1. Đường dẫn phải tuyệt đối và không được là symlink; thư mục cha được tạo nếu thiếu.
  2. Chiếm bằng một thao tác tạo file độc quyền `openSync(path, 'wx')` (hoặc tương đương `O_CREAT|O_EXCL`): hệ điều
     hành bảo đảm chỉ **một** tiến trình tạo được. Ngay sau đó ghi JSON `{ pid, token, createdAt }` với `token` là UUID
     ngẫu nhiên do chính tiến trình đó sinh ra.
  3. Nếu file đã tồn tại (`EEXIST`) thì **chờ và thử lại** (mặc định `poll` 500 ms, timeout 1.200.000 ms hoặc
     `CHB_DB_LOCK_TIMEOUT_MS`). Hết thời gian = thất bại, **chưa chạy gì**; không xóa lease, không ghi đè.
  4. Lease không bao giờ được "mượn" (`ownerToken` bị từ chối): mỗi tiến trình giữ lease phải tự chiếm bằng bước 2.
  5. Lease do **tiến trình Node** thực thi `task:finish` giữ từ lúc bắt đầu bước `db reset` cho tới sau
     `pgTAP`/integration; nó chỉ nhả khi `token` **và** `pid` trong file khớp tiến trình đó rồi `unlink`.

  **Cấm kiểu "kiểm tra rồi chạy" (check-then-run).** Việc xem file có tồn tại (`ls`, `Test-Path`, `existsSync`)
  rồi mới chạy lệnh DB là **không được hỗ trợ**: hai bên cùng thấy "chưa có" rồi cùng chạy. Cũng **cấm** tạo file lease
  bằng tay (`touch`, `echo >`): file đó chặn pipeline nhưng không có `pid`/`token` thuộc về tiến trình nào, nên không
  ai có thể nhả nó đúng quy tắc, và sẽ buộc phải xóa tay — điều bị cấm. Quy trình thủ công 5-bước kiểu "kiểm tra
  chủ sở hữu rồi tiếp tục" mà bản trước của tài liệu này mô tả đã bị **loại bỏ**.

  **Vì sao rehearsal đang bị chặn.** Pipeline chỉ giữ lease quanh ba bước `db reset`/`pgTAP`/integration của
  `task:finish`; không có bước dump, tạo DB rỗng, restore hay đối soát §10 nào nằm trong lease đó. Một rehearsal chạy
  tay sẽ nằm **ngoài** lease, nên có thể giẫm lên `task:finish` của task khác (hoặc ngược lại). Để thực thi an toàn cần
  một **runner rehearsal do người duyệt (Codex/Owner pipeline) viết và xem lại**, đặt ngoài workspace triển khai, thỏa:
  - chiếm lease bằng đúng `acquireDbValidationLock` (hoặc hàm đã duyệt tương đương), giữ **trong cùng một tiến trình**
    đã sinh ra mọi lệnh con (reset, dump, tạo DB, restore, truy vấn §10, dọn) và **liên tục** cho tới hết bước dọn;
  - không bao giờ nhả lease chỉ vì đã ghi một "lý do dừng"; xem "Nhả lease" bên dưới;
  - ghi lại đường dẫn lease, `pid`, `token` (không ghi secret), thời điểm chiếm/nhả vào bằng chứng §11.
    **Chưa có runner như vậy trong repo.** Do đó trạng thái rehearsal là `blocked`/`not_run` với lý do "Docker bị
    chặn; chưa có runner rehearsal giữ lease đã được duyệt". Không được gọi quy trình này là đã duyệt.

  **Nhả lease và phục hồi lease cũ — phải chứng minh MỌI tiến trình con đã dừng.**
  - Chỉ chính chủ (khớp `token` + `pid`) được nhả, và chỉ khi **toàn bộ cây tiến trình con** do nó sinh ra đã được
    **chứng minh** đã dừng: Windows job object cho phiên có `ActiveProcesses = 0` (đây là cơ chế `claude-worker.ps1`
    dùng để đếm con cháu), và không còn `psql`/`pg_dump`/`pg_restore`/`supabase`/`docker exec` nào thuộc phiên, và không
    còn kết nối hoạt động tới cổng DB local 56322 từ phiên đó.
  - **PID cha đã chết là chưa đủ.** Tiến trình con/cháu (ví dụ `pg_restore` đang chạy trong container) có thể còn sống
    và vẫn ghi vào DB sau khi cha chết. Không được coi "cha chết" là bằng chứng lease an toàn để xóa.
  - **Hết thời gian chờ/vòng đời không chắc chắn thì GIỮ lease.** Khi một bước DB bị timeout, bị tín hiệu, hoặc
    không có mã thoát, pipeline ghi `db lease retained` và **không** nhả (`dbLifetimeUncertain`); rehearsal phải cư xử
    y hệt. Việc ghi một lý do dừng/nhật ký **không** phải là nhả lease và không cho phép nhả.
  - Phục hồi lease cũ/lạ chỉ được làm theo quy trình phục hồi đã duyệt của Owner pipeline sau khi (a) đọc và ghi lại
    `pid`/`token`/`createdAt` trong lease, (b) chứng minh mọi tiến trình con của chủ đó đã dừng như trên, (c) có
    duyệt của Owner pipeline. Nếu **bất kỳ** điều nào không chắc chắn thì giữ nguyên lease và dừng. Không phát minh cách
    bỏ qua lease; không bao giờ xóa lease tự động.

- Chỉ nhắm vào cổng local 56322 / container local. Tuyệt đối không có `--linked`, URL staging/production, hay
  biến môi trường trỏ ra ngoài trong cùng shell.

### 8.2 Các bước

1. Dựng dữ liệu nguồn: `npx supabase db reset` (migration + seed), tùy chọn thêm một ít dữ liệu mẫu bằng chức năng
   bình thường của app để có đơn, payment, delivery, movement.
2. Chụp **baseline** từ DB nguồn: kết quả toàn bộ truy vấn §10 (R1–R10) lưu vào file `tmp/` (bị gitignore).
3. Tạo bản dump đầy đủ định dạng custom từ container DB local (tên container mặc định theo `project_id`:
   `supabase_db_chb-ban-hang` — xác nhận bằng `docker ps` trước), ví dụ:
   ```bash
   docker exec supabase_db_chb-ban-hang pg_dump -U postgres -d postgres -Fc --no-owner -f /tmp/rehearsal.dump
   ```
   Lệnh mẫu chưa chạy; cờ cần điều chỉnh theo kết quả thật. Ghi kích thước và SHA-256 của file dump.
4. Tạo database rỗng riêng trong cùng container (không ghi đè `postgres`): `create database restore_rehearsal;`.
5. Khôi phục vào database đó bằng `pg_restore -d restore_rehearsal ...`; ghi lại **mọi cảnh báo/lỗi** (extension,
   role, owner, schema do Supabase quản lý có thể cần xử lý). Đo thời gian bắt đầu → kết thúc.
6. Chạy lại toàn bộ truy vấn §10 trên `restore_rehearsal` và so với baseline: số dòng, `order_code` / `payment_code`
   giữ nguyên, số dòng `audit_logs` không đổi, sequence ≥ mã lớn nhất, `verify_inventory_balances()` rỗng.
7. **Thử nghiệm đối chứng hazard §6** (tùy chọn, trên DB rỗng thứ hai): nạp data-only với trigger bật để xác nhận
   bằng mắt rằng mã bị đánh số lại/audit bị nhân đôi/ledger bị từ chối. Đây là bằng chứng cho khuyến nghị "restore
   nguyên database".
8. Dọn: `drop database restore_rehearsal;`, xóa file dump trong container và `tmp/`. Không đụng DB `postgres`
   nguồn ngoài những gì bước 1 đã nêu.
9. Điền bằng chứng theo mẫu §11. Nếu có bất kỳ bước nào không chạy được, ghi rõ bước nào và lý do; trạng thái
   rehearsal là `not_run`/`partial`, không phải `pass`.

## 9. Diễn tập trên staging (bên ngoài repo, chưa thực hiện)

Staging chưa được cấu hình (`STAGING_DEPLOY.md`), nên chưa thể diễn tập backup của nhà cung cấp. Khi staging có:
Owner xác nhận gói và bật backup; Kỹ thuật tạo dữ liệu thử có kiểm soát (không dùng dữ liệu khách thật), chụp
baseline §10, dùng chức năng restore của provider vào **project thứ hai**, chạy lại §10, đo RTO, ghi bằng chứng.
Rehearsal staging là điều kiện thực tế để tin được con số RTO; local chỉ là bước chuẩn bị.

## 10. Checklist đối soát toàn vẹn (chỉ đọc)

Chạy trên DB nguồn trước backup (baseline) và trên bản đã khôi phục. Mọi truy vấn chỉ `SELECT`, không sửa dữ liệu.
Các truy vấn dưới đây **đã đối chiếu tên cột với migration nhưng chưa được thực thi** trong lần soạn này; khi chạy
lần đầu hãy sửa lỗi cú pháp nếu có và ghi lại.

Hai lưu ý chung:

- **Định danh Admin chỉ tồn tại trong một transaction.** Các hàm Admin đọc `auth.uid()`; `set_config(..., true)` là
  _transaction-local_. Trong `psql` ở chế độ autocommit, mỗi câu lệnh là một transaction riêng nên giá trị bị mất ngay
  sau câu `select set_config(...)` — hàm Admin sau đó sẽ báo "Chỉ Admin…" hoặc, tệ hơn, bị hiểu nhầm là "không có
  lệch". Vì vậy R3 dưới đây dùng một transaction tường minh (`begin read only` … `rollback`) trong **một** phiên `psql`.
- **Đặt `\set ON_ERROR_STOP on` đầu phiên.** Thiếu điều kiện tiên quyết (không có Admin) phải làm phiên thất bại với mã
  thoát khác 0, không được kết thúc êm với kết quả rỗng được đọc thành "pass".

| #   | Kiểm tra                                                                                      | Kỳ vọng                                                                   |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R1  | Migration version cuối khớp thư mục `supabase/migrations`                                     | Khớp với bản đang chạy lúc backup                                         |
| R2  | Số dòng các bảng lõi                                                                          | Khớp baseline (hoặc chênh đúng bằng khoảng mất dữ liệu đã ghi)            |
| R3  | Sổ kho khớp cache và reservation                                                              | `verify_inventory_balances()` trả về 0 dòng                               |
| R4  | Không có tồn âm / reserved vượt available                                                     | 0 dòng                                                                    |
| R5  | `paid_amount` = tổng payment `CONFIRMED`; không vượt `net_amount`                             | 0 dòng                                                                    |
| R6  | Không trùng tham chiếu thanh toán / sự kiện webhook, kể cả sau chuẩn hóa số (`00123` = `123`) | 0 dòng (R6 và R6b)                                                        |
| R7  | Sự kiện `CREDITED` luôn có payment; hàng đợi cần xem xét                                      | 0 CREDITED mồ côi; số `UNMATCHED`/`NEEDS_REVIEW` chưa xử lý khớp baseline |
| R8  | Sequence mã đơn/mã thanh toán không thấp hơn mã lớn nhất                                      | `last_value` ≥ số lớn nhất đã dùng                                        |
| R9  | Đợt giao ↔ lô đã gán ↔ `SALE_OUT` (R9-0 quyết định truy vấn nào áp dụng)                      | R9a–R9e: 0 dòng; R9f: so với baseline; R9g: đúng kỳ vọng. Chưa chạy.      |
| R10 | Mốc thời gian mới nhất của từng luồng                                                         | Dùng để xác định khoảng mất dữ liệu; so với thời điểm backup              |
| R11 | Đăng nhập & phân quyền                                                                        | `auth.users` khớp `profiles`; Admin đăng nhập được; RLS còn bật           |

```sql
-- R1: migration version đang áp dụng (so với tên file mới nhất trong supabase/migrations)
select version from supabase_migrations.schema_migrations order by version desc limit 5;

-- R2: số dòng bảng lõi (lưu lại để so sánh)
select 'orders' as t, count(*) from public.orders
union all select 'order_items', count(*) from public.order_items
union all select 'order_status_history', count(*) from public.order_status_history
union all select 'payments', count(*) from public.payments
union all select 'payment_events', count(*) from public.payment_events
union all select 'inventory_movements', count(*) from public.inventory_movements
union all select 'inventory_balances', count(*) from public.inventory_balances
union all select 'inventory_reservations', count(*) from public.inventory_reservations
union all select 'deliveries', count(*) from public.deliveries
union all select 'delivery_items', count(*) from public.delivery_items
union all select 'audit_logs', count(*) from public.audit_logs
union all select 'customers', count(*) from public.customers
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users;

-- R3 chạy riêng ở khối bên dưới (cần transaction tường minh để mang định danh Admin).

-- R4: không âm, reserved không vượt available (các ràng buộc phải chặn sẵn; đây là kiểm tra lại)
select * from public.inventory_balances
where available_qty < 0 or reserved_qty < 0 or in_transfer_qty < 0 or pending_inspection_qty < 0
   or damaged_qty < 0 or sample_qty < 0 or gift_qty < 0 or reserved_qty > available_qty;

-- R5: paid_amount là dẫn xuất từ payment CONFIRMED
select o.id, o.order_code, o.paid_amount, coalesce(p.confirmed, 0) as confirmed_sum, o.net_amount
from public.orders o
left join (select order_id, sum(amount) as confirmed from public.payments
           where status = 'CONFIRMED' group by order_id) p on p.order_id = o.id
where o.paid_amount <> coalesce(p.confirmed, 0) or o.paid_amount > o.net_amount;

-- R6: trùng tham chiếu / sự kiện (unique index phải chặn sẵn)
select provider, provider_reference, count(*) from public.payments
where provider is not null and provider_reference is not null
group by provider, provider_reference having count(*) > 1;
select provider, provider_event_id, count(*) from public.payment_events
group by provider, provider_event_id having count(*) > 1;

-- R6b: va chạm khóa giao dịch SePay sau CHUẨN HÓA SỐ (ví dụ '00123' và '123' là cùng một giao dịch).
-- Migration 20261002050000 chuẩn hóa mã giao dịch về số nguyên (bỏ số 0 đầu) trước khi chống trùng, nên bản ghi
-- cũ lưu dạng không chuẩn (có số 0 đầu) KHÔNG được sửa (bất biến) mà được tra qua giá trị chuẩn. Kiểm tra chỉ đọc
-- dưới đây tìm các nhóm có >1 dòng cùng khóa chuẩn; kỳ vọng 0 dòng. Chỉ áp dụng khi schema đã có migration đó.
select provider, ltrim(provider_event_id, '0') as canonical_key,
       count(*) as n, array_agg(provider_event_id order by received_at) as stored_keys
from public.payment_events
where provider = 'SEPAY' and provider_event_id ~ '^[0-9]+$'
group by provider, ltrim(provider_event_id, '0')
having count(*) > 1;
select provider, ltrim(provider_reference, '0') as canonical_key,
       count(*) as n, array_agg(provider_reference order by created_at) as stored_refs
from public.payments
where provider = 'SEPAY' and provider_reference ~ '^[0-9]+$'
group by provider, ltrim(provider_reference, '0')
having count(*) > 1;
-- Nếu có dòng: KHÔNG sửa/xóa bản ghi (payment_events/payments bất biến). Ghi nhận cả hai khóa gốc, báo Admin để
-- xử lý bằng bút toán/hoàn tiền có lý do. Nếu là khóa đã bị chuẩn hóa thì kỳ vọng chỉ còn một dòng mỗi nhóm.

-- R7: CREDITED mồ côi và hàng đợi cần xem xét
select * from public.payment_events where outcome = 'CREDITED' and payment_id is null;
select outcome, count(*) from public.payment_events
where outcome in ('UNMATCHED', 'NEEDS_REVIEW') and resolved_at is null group by outcome;

-- R8: sequence phải >= mã lớn nhất đã cấp (mã dạng <tiền tố><6 chữ số>, PAY<6 chữ số>)
select (select last_value from private.payment_code_seq) as payment_seq_last,
       (select max(substr(payment_code, 4)::bigint) from public.payments) as payment_max_code,
       (select last_value from private.order_code_seq) as order_seq_last;
-- So order_seq_last với phần số của order_code lớn nhất (tiền tố nằm ở app_settings.order_prefix).

-- R10: mốc mới nhất của từng luồng (xác định khoảng mất dữ liệu)
select (select max(received_at) from public.payment_events) as last_payment_event,
       (select max(created_at) from public.payments) as last_payment,
       (select max(created_at) from public.inventory_movements) as last_movement,
       (select max(created_at) from public.audit_logs) as last_audit,
       (select max(created_at) from public.orders) as last_order;

-- R11: tài khoản vs hồ sơ và RLS còn bật trên bảng nhạy cảm
select count(*) as profiles_without_auth_user
from public.profiles p left join auth.users u on u.id = p.id where u.id is null;
select c.relname, c.relrowsecurity from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('orders', 'payments', 'payment_events', 'inventory_movements', 'inventory_balances', 'audit_logs')
order by c.relname;
```

### R3 — sổ kho / cache / reservation (hàm Admin, cần định danh trong transaction)

Chạy trong **một phiên `psql`** (biến `admin_id` của `\gset` sống theo phiên, `set_config(..., true)` sống theo
transaction). Không có Admin hoạt động là **điều kiện tiên quyết thất bại**, không phải kết quả "sạch":

```sql
\set ON_ERROR_STOP on
begin read only;

-- Chọn một Admin đang hoạt động (xác định, không ngẫu nhiên). \gset báo lỗi nếu không có dòng nào.
select p.id::text as admin_id
from public.profiles p join public.roles r on r.id = p.role_id
where r.code = 'ADMIN' and p.is_active
order by p.id limit 1
\gset

-- Phòng thủ lần hai: nếu biến chưa được đặt thì dừng, không đi tiếp.
\if :{?admin_id}
\else
  \echo 'PREREQUISITE FAILED: khong co profile ADMIN dang hoat dong'
  \quit 3
\endif

-- Đặt ngữ cảnh người gọi (cùng cách supabase/tests/inventory_posting.test.sql dùng) rồi XÁC MINH nó có hiệu lực.
select set_config('request.jwt.claim.sub', :'admin_id', true);
select private.is_admin() as admin_context_ok
\gset
\if :admin_context_ok
\else
  \echo 'PREREQUISITE FAILED: dinh danh Admin khong co hieu luc trong transaction'
  \quit 3
\endif

-- Kết quả: chỉ liệt kê chỗ lệch. 0 dòng = khớp.
select * from public.verify_inventory_balances();

rollback;
```

Cách đọc: thoát với mã ≠ 0 hoặc có dòng `PREREQUISITE FAILED` = R3 **không chạy được** (ghi `blocked`/`fail`, không
ghi `pass`). Chỉ khi cả hai kiểm tra tiên quyết qua và truy vấn cuối trả 0 dòng mới là `pass`. Transaction chỉ đọc nên
không để lại thay đổi; `rollback` ở cuối là chủ đích. (Cú pháp `\if`/`\gset`/`\quit` là của `psql` — chưa chạy ở đây.)

### R9 — đợt giao ↔ lô đã gán ↔ xuất kho (chỉ áp dụng cho schema có migration `070000`)

**Nguồn sự thật hiện hành.** Trong migration `20261002070000_delivery_batch_binding.sql` trong checkout tích hợp (đã đọc, không
sao chép), lô/số lượng FEFO của mỗi dòng đợt giao được **gán một lần** vào bảng `delivery_item_batches` tại lần
xuất kho đầu tiên (`dispatched_at` còn null → có giá trị, không gán lại khi giao lại sau thất bại), rồi **đúng các
dòng gán đó** được dùng để ghi `SALE_OUT` khi đợt giao thành `DELIVERED`. Bản xem trước pick-list trước khi xuất kho
chỉ là ước tính, không phải sự thật. Hệ quả cho đối soát: nguồn đúng để hỏi "hàng nào đã đi" là bảng gán + sổ kho,
**không** phải cột `delivery_items.batch_id` (ghi chú trong schema nói lô thực lấy nằm ở sổ kho) và không phải kết
quả FEFO tính lại hôm nay.

**Bước R9-0 — kiểm tra áp dụng (bắt buộc làm trước, và ghi kết quả):**

```sql
select to_regclass('public.delivery_item_batches') is not null as has_bindings,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'deliveries'
                 and column_name = 'dispatched_at') as has_dispatched_at,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'inventory_movements'
                 and column_name = 'delivery_id') as movements_have_delivery_id;
```

- `has_bindings = false` → R9a–R9f **không áp dụng** (ghi `not_applicable`, không phải `pass`). Dùng R9-L ở dưới.
- `has_dispatched_at = false` hoặc `movements_have_delivery_id = false` → schema quá cũ cho cả R9-L; ghi `not_applicable`
  và dựa vào đối soát nghiệp vụ (đếm hàng/sổ kho) thay thế.
- Schema trước migration `070000` có `dispatched_at` nhưng không có bảng gán: trên schema đó chỉ R9-L chạy được.

**R9a–R9e — chỉ đọc, mỗi truy vấn kỳ vọng 0 dòng** (chạy trong `begin read only; … rollback;`; chưa thực thi). R9f
bên dưới là số đếm baseline, **không** kỳ vọng 0 dòng:

```sql
-- R9a: với đợt giao DELIVERED, số lượng đã gán theo (đợt, sản phẩm, lô) phải bằng SALE_OUT đã ghi.
with bound as (
  select di.delivery_id, di.product_id, dib.batch_id, sum(dib.quantity) as bound_qty
  from public.delivery_item_batches dib
  join public.delivery_items di on di.id = dib.delivery_item_id
  join public.deliveries d on d.id = di.delivery_id and d.status = 'DELIVERED'
  group by di.delivery_id, di.product_id, dib.batch_id
), sold as (
  select m.delivery_id, m.product_id, m.batch_id, sum(m.quantity) as sold_qty
  from public.inventory_movements m
  join public.deliveries d on d.id = m.delivery_id and d.status = 'DELIVERED'
  where m.movement_type = 'SALE_OUT'
  group by m.delivery_id, m.product_id, m.batch_id
)
select delivery_id, product_id, batch_id, b.bound_qty, s.sold_qty
from bound b full join sold s using (delivery_id, product_id, batch_id)
where coalesce(b.bound_qty, 0) <> coalesce(s.sold_qty, 0);

-- R9b: SALE_OUT của đợt giao phải xuất từ đúng kho xuất của đợt đó.
select m.id, m.delivery_id, m.from_location_id, d.source_location_id
from public.inventory_movements m join public.deliveries d on d.id = m.delivery_id
where m.movement_type = 'SALE_OUT' and m.from_location_id is distinct from d.source_location_id;

-- R9c: tổng số lượng đã gán của mỗi dòng đợt giao = số lượng dòng nếu hàng đã rời kho (dispatched_at có giá trị),
--      và = 0 nếu chưa xuất kho hoặc đã hủy. Đối chiếu cả đợt FAILED/redispatch (giữ nguyên gán).
select d.delivery_code, d.status, di.id as delivery_item_id, di.quantity as line_qty,
       coalesce(sum(dib.quantity), 0) as bound_qty
from public.deliveries d
join public.delivery_items di on di.delivery_id = d.id
left join public.delivery_item_batches dib on dib.delivery_item_id = di.id
group by d.id, di.id
having coalesce(sum(dib.quantity), 0) <>
  case when d.status = 'CANCELLED' then 0
       when d.dispatched_at is not null then di.quantity
       else 0 end;

-- R9d: lô đã gán phải thuộc đúng sản phẩm của dòng đợt giao.
select dib.id, di.product_id as line_product, pb.product_id as batch_product
from public.delivery_item_batches dib
join public.delivery_items di on di.id = dib.delivery_item_id
join public.product_batches pb on pb.id = dib.batch_id
where pb.product_id <> di.product_id;

-- R9e: hàng đang ở logistics (đã xuất kho, chưa DELIVERED/CANCELLED) phải còn được giữ chỗ vật lý ACTIVE
--      đủ cho phần đã gán, theo (dòng đơn, kho xuất, lô).
with inflight as (
  select di.order_item_id, d.source_location_id, dib.batch_id, sum(dib.quantity) as bound_qty
  from public.delivery_item_batches dib
  join public.delivery_items di on di.id = dib.delivery_item_id
  join public.deliveries d on d.id = di.delivery_id
  where d.dispatched_at is not null and d.status not in ('DELIVERED', 'CANCELLED')
  group by di.order_item_id, d.source_location_id, dib.batch_id
), held as (
  select order_item_id, location_id, batch_id, sum(quantity) as held_qty
  from public.inventory_reservations
  where status = 'ACTIVE' and reservation_type = 'PHYSICAL_ALLOCATION'
  group by order_item_id, location_id, batch_id
)
select i.*, coalesce(h.held_qty, 0) as held_qty
from inflight i
left join held h on h.order_item_id = i.order_item_id
                and h.location_id = i.source_location_id and h.batch_id = i.batch_id
where i.bound_qty > coalesce(h.held_qty, 0);
```

**R9f — số đếm baseline (KHÔNG kỳ vọng 0 dòng).** Lưu kết quả trên DB nguồn trước backup rồi so từng dòng với bản
khôi phục; khác biệt phải giải thích được bằng khoảng mất dữ liệu đã ghi. Chưa thực thi:

```sql
select d.status, (d.dispatched_at is not null) as dispatched,
       count(distinct d.id) as deliveries, count(dib.id) as binding_rows,
       coalesce(sum(dib.quantity), 0) as bound_qty
from public.deliveries d
left join public.delivery_items di on di.delivery_id = d.id
left join public.delivery_item_batches dib on dib.delivery_item_id = di.id
group by d.status, (d.dispatched_at is not null)
order by d.status, dispatched;
```

**R9g — quyền và guard của bảng gán** (kỳ vọng ghi trong chú thích; đối chiếu với migration `070000`):

```sql
-- Kỳ vọng: relrowsecurity = true.
select relname, relrowsecurity from pg_class where oid = 'public.delivery_item_batches'::regclass;

-- Kỳ vọng: authenticated chỉ SELECT (true); INSERT/UPDATE/DELETE/TRUNCATE đều false. anon: tất cả false.
select r.role_name,
       has_table_privilege(r.role_name, 'public.delivery_item_batches', 'select')   as can_select,
       has_table_privilege(r.role_name, 'public.delivery_item_batches', 'insert')   as can_insert,
       has_table_privilege(r.role_name, 'public.delivery_item_batches', 'update')   as can_update,
       has_table_privilege(r.role_name, 'public.delivery_item_batches', 'delete')   as can_delete,
       has_table_privilege(r.role_name, 'public.delivery_item_batches', 'truncate') as can_truncate
from (values ('authenticated'), ('anon')) as r(role_name);

-- Kỳ vọng: 2 trigger (guard ghi + audit) và 1 policy select; ràng buộc unique (delivery_item_id, batch_id) tồn tại.
select tgname from pg_trigger
where tgrelid = 'public.delivery_item_batches'::regclass and not tgisinternal order by tgname;
select polname, polcmd from pg_policy where polrelid = 'public.delivery_item_batches'::regclass;
select conname from pg_constraint
where conrelid = 'public.delivery_item_batches'::regclass and contype in ('u', 'p') order by conname;

-- Kỳ vọng: false cho cả hai vai trò (hàm nội bộ không được gọi từ client).
select has_function_privilege(r.role_name, f.sig, 'execute') as can_execute, r.role_name, f.sig
from (values ('authenticated'), ('anon')) as r(role_name),
     (values ('private.bind_delivery_item_batches(uuid)'), ('private.assert_batch_sellable(uuid)')) as f(sig);
```

**R9-L — phiên bản cũ (schema chưa có bảng gán), kỳ vọng 0 dòng.** Cộng gộp **cả hai phía** theo (đợt giao, sản phẩm)
rồi `full join`, nên phát hiện được: thiếu `SALE_OUT`, `SALE_OUT` của sản phẩm không có trong đợt giao, xuất sai kho,
lệch số lượng, và `SALE_OUT` gắn vào đợt giao **chưa** `DELIVERED`. Chạy trong `begin read only; … rollback;`; chưa
thực thi:

```sql
with expected as (
  select d.id as delivery_id, d.delivery_code, d.source_location_id,
         di.product_id, sum(di.quantity) as expected_qty
  from public.deliveries d
  join public.delivery_items di on di.delivery_id = d.id
  where d.status = 'DELIVERED'
  group by d.id, d.delivery_code, d.source_location_id, di.product_id
), actual as (
  select m.delivery_id, m.product_id, d.status as delivery_status,
         sum(m.quantity) as actual_qty,
         coalesce(sum(m.quantity) filter (where m.from_location_id is not distinct from d.source_location_id), 0)
           as actual_qty_right_source
  from public.inventory_movements m
  join public.deliveries d on d.id = m.delivery_id
  where m.movement_type = 'SALE_OUT'
  group by m.delivery_id, m.product_id, d.status
), joined as (
  select coalesce(e.delivery_id, a.delivery_id) as delivery_id,
         coalesce(e.product_id, a.product_id) as product_id,
         e.expected_qty, a.actual_qty, a.actual_qty_right_source, a.delivery_status,
         case
           when e.delivery_id is null and a.delivery_status <> 'DELIVERED' then 'SALE_OUT_ON_NON_DELIVERED'
           when e.delivery_id is null then 'EXTRA_PRODUCT'
           when a.delivery_id is null then 'MISSING_SALE_OUT'
           when a.actual_qty_right_source <> a.actual_qty then 'WRONG_SOURCE'
           when e.expected_qty <> a.actual_qty then 'QTY_MISMATCH'
         end as problem
  from expected e
  full join actual a on a.delivery_id = e.delivery_id and a.product_id = e.product_id
)
select * from joined where problem is not null order by delivery_id, product_id;
```

Giới hạn của R9-L: nó so với `delivery_items` (số lượng yêu cầu), nên **không** kiểm tra được lô vật lý; chỉ R9a–R9e
trên schema có bảng gán làm được việc đó (và vẫn bị giới hạn bởi dữ liệu cũ mơ hồ bên dưới).

**Giới hạn của R9 — nói thẳng:**

- **Dữ liệu lịch sử mơ hồ.** Migration `070000` điền bảng gán cho các đợt giao đã `DELIVERED` **từ chính sổ kho
  `SALE_OUT`**. Vì vậy với các đợt giao có từ trước migration, R9a là **phép so sánh vòng tròn** (cùng một nguồn): nó
  không chứng minh độc lập lô vật lý. Nó chỉ chứng minh sổ kho không bị đổi giữa backup và restore.
- **Đợt giao đang ở logistics trước migration không có sự thật về lô.** Migration chủ động **từ chối** áp dụng nếu còn
  đợt giao đã xuất kho mà chưa `DELIVERED`/`CANCELLED`, vì không có nguồn đáng tin để biết lô nào đã đi; **tuyệt đối
  không suy ra từ xem trước FEFO hôm nay**. Hệ quả cho restore: khôi phục một bản **trước** `070000` rồi áp dụng
  migration đó chỉ hợp lệ khi các đợt giao như vậy đã hoàn tất hoặc đã được đối soát lô gốc bằng quy trình có
  thẩm quyền; đó là việc của Kho/Admin, không phải bước tự động của restore.
- **Hiệu lực theo schema.** Migration `070000` tự ghi là chưa phát hành (chỉ local). Chưa có bằng chứng nào cho thấy
  nó đã chạy trên staging/production; R9-0 quyết định truy vấn nào áp dụng, không phải tài liệu này.
- Kết quả R9 **chưa được thực thi** (Docker là blocker đã biết, không có DB). Không có tiêu chí nghiệm thu nào dựa
  trên R9 được coi là đã đạt.

Đối soát nghiệp vụ (không thay bằng SQL): Admin so tổng đơn/tiền thu theo ngày với sao kê SePay/ngân hàng; Kho đếm
thực tế vài kho trọng điểm so với `inventory_summary`; nếu có chênh lệch, xử lý bằng đơn/movement điều chỉnh có lý do.

## 11. Yêu cầu bằng chứng

Một lần backup hoặc rehearsal chỉ được coi là "đã làm" khi có đủ các mục sau, lưu trong báo cáo của task hoặc
thư mục bằng chứng do Owner chỉ định (không chứa dữ liệu khách thật hay secret; che số điện thoại/địa chỉ):

| Trường                          | Nội dung                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loại & môi trường               | Backup / rehearsal; local / staging / production. **Production restore thật: chỉ khi sự cố, Owner duyệt.**                                                                                                                                                                 |
| Người thực hiện & người duyệt   | Tên vai trò (§3), ngày giờ UTC bắt đầu/kết thúc.                                                                                                                                                                                                                           |
| Nguồn & định danh backup        | Mã/ID backup hoặc PITR timestamp từ provider; hoặc tên file dump + kích thước + SHA-256.                                                                                                                                                                                   |
| Release tag & migration version | Trước và sau.                                                                                                                                                                                                                                                              |
| Lệnh/đường dẫn thao tác         | Lệnh hoặc ảnh chụp màn hình dashboard; đã loại secret.                                                                                                                                                                                                                     |
| Kết quả đối soát §10            | Từng R1–R11: baseline vs sau restore, pass/fail, khoảng chênh lệch giải thích được.                                                                                                                                                                                        |
| Thời gian đo được               | Thời lượng restore (cơ sở cho RTO) và khoảng mất dữ liệu (cơ sở cho RPO).                                                                                                                                                                                                  |
| Lỗi/cảnh báo & cách xử lý       | Toàn bộ, kể cả cái tự hết.                                                                                                                                                                                                                                                 |
| SHA-256 của tài liệu            | SHA-256 thô của `BACKUP_RESTORE.md` và kế hoạch SEC-010 đã được rà soát (tính trên byte file sau `prettier`). Dấu vân tay mã của pipeline **loại trừ docs**, nên nó KHÔNG chứng minh tài liệu còn mới; chỉ SHA-256 tài liệu mới gắn bằng chứng với đúng phiên bản runbook. |
| Giới hạn bằng chứng             | Điều gì **không** được chứng minh (ví dụ local ≠ production).                                                                                                                                                                                                              |
| Trạng thái                      | `pass` / `fail` / `partial` / `not_run` / `blocked`, kèm lý do. Không dùng "pass" khi có bước chưa chạy.                                                                                                                                                                   |

Quy tắc trung thực: báo cáo bị chặn (ví dụ Docker không chạy) phải ghi `blocked` hoặc `not_run`; không suy ra kết
quả từ CI `db reset`, vì job đó chứng minh dựng lại schema chứ không phải khôi phục dữ liệu.

## 12. Trạng thái bằng chứng hiện tại (SEC-010, lần soạn này)

| Hạng mục                                                                         | Trạng thái          | Ghi chú                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runbook, vai trò, quy trình, checklist, mẫu bằng chứng                           | Đã viết             | Tài liệu này; dựa trên file trong repo.                                                                                                                                                                                              |
| Truy vấn đối soát §10 (R1–R11, gồm R3, R6b, R9a–R9g, R9-L)                       | Viết, **chưa chạy** | Tên cột đối chiếu với migration bằng cách đọc; **NOT EXECUTED** (Docker blocker, không có DB). Không tiêu chí nghiệm thu nào dựa trên các truy vấn này được coi là đạt.                                                              |
| R3 với `begin read only` + chọn/xác minh Admin + `rollback`                      | Viết, **chưa chạy** | Cú pháp `\if`/`\gset`/`\quit` của `psql` chưa được thử.                                                                                                                                                                              |
| R9 (đợt giao ↔ lô ↔ SALE_OUT)                                                    | Viết, **chưa chạy** | R9a–R9e áp dụng khi schema đích có `delivery_item_batches` (migration `070000`); nếu chưa có, dùng R9-L. R9f là số đếm baseline. Dữ liệu cũ mơ hồ (xem §10).                                                                         |
| Điều phối mọi writer + cutover một đích ghi (§7.0–7.2)                           | Viết, **chưa chạy** | Không tạm dừng webhook/cron/UI thật; chính sách bắt giữ sự kiện nhà cung cấp phải được Owner xác nhận TRƯỚC khi tạm dừng webhook.                                                                                                    |
| Quy trình sở hữu lease DB cho rehearsal (§8.1)                                   | **BLOCKED**         | Mô tả đúng cơ chế `db-validation-lock.mjs` nhưng **không thể thực thi** tới khi có runner rehearsal đã duyệt giữ lease liên tục; đường dẫn lease thực tế chưa xác định; phục hồi lease cũ cần chứng minh mọi tiến trình con đã dừng. |
| Rehearsal local (§8)                                                             | **Chưa chạy**       | Docker là blocker đã biết và chưa có runner giữ lease đã duyệt (§8.1); không có DB để dump/restore. Không có kết quả để báo.                                                                                                         |
| Rehearsal staging (§9)                                                           | Chưa thực hiện      | Staging chưa cấu hình; việc bên ngoài repo.                                                                                                                                                                                          |
| Backup/PITR của provider                                                         | Chưa xác minh       | Không có thông tin gói/lịch/retention trong repo; việc của Owner.                                                                                                                                                                    |
| Con số RPO/RTO                                                                   | Chưa quyết định     | Cần Owner; RTO cần số đo từ rehearsal thật.                                                                                                                                                                                          |
| Người phụ trách (§3)                                                             | Chưa gán            | Owner điền.                                                                                                                                                                                                                          |
| Giả định về hành vi `session_replication_role`, `pg_restore`, `supabase db dump` | Chưa kiểm chứng     | Phải xác nhận ở rehearsal với phiên bản thật; không dựa vào trí nhớ.                                                                                                                                                                 |

Việc tiếp theo (theo thứ tự): Owner xác nhận gói/backup và gán vai trò → khởi động Docker rồi chạy §8 và nộp bằng
chứng → cấu hình staging rồi chạy §9 → chốt RPO/RTO từ số đo thật → mới có thể coi hạng mục backup của go-live là
đã có bằng chứng (chưa đủ để tuyên bố hệ thống sẵn sàng vận hành; xem gate cuối trong `CLAUDE_CONTINUE_PROMPT.md`).

# Rà soát quyền Admin và truy cập nền tảng (SEC-011)

**Trạng thái: review mã nguồn đã xong; cloud/platform CHƯA được xác minh.** Tài liệu này không phải bằng chứng rằng MFA, branch protection, backup hay quyền truy cập đang được áp dụng. Nó tách rõ điều đọc được trong repository (_code fact_) khỏi điều chỉ con người có tài khoản mới xác minh được (_cloud fact_).

Căn cứ: IMPLEMENTATION_INFRA_PLAN §18 (Production access control) và task SEC-011; PRD §3.1 (Admin HQ "Quản lý user"); TECH_DESIGN §2.2 (ma trận quyền), §41 (RLS); review `docs/reviews/2026-10-02-project-review.md` RV-14. ExecPlan: `docs/exec-plans/active/SEC-011-admin-access-review.md`.

## Cách đọc nhãn bằng chứng

| Nhãn             | Ý nghĩa                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `[CODE]`         | Đọc trực tiếp trong workspace ngày 03/10/2026 (branch `feature/DEL-012-failed-logistics`, có thay đổi chưa commit). |
| `[SNAPSHOT]`     | Số liệu cloud ghi trong tài liệu cũ, có ngày. Chỉ là bằng chứng lịch sử, không xác nhận hiện tại.                   |
| `[CLOUD-UNVERI]` | Cần con người có quyền kiểm tra trên nền tảng. Mặc định **NOT VERIFIED** cho đến khi có bản ghi ở mục 5.            |

Review này **không gọi API cloud, không đọc credential/env, không chạm DB, không đổi cấu hình** (xem giới hạn ở mục 8).

## 1. Bản đồ ranh giới tin cậy

| Lớp                  | Ai quản trị                                                     | Kiểm soát có trong repo                                                                                                 | Chưa xác minh                                                    |
| -------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Quyền trong ứng dụng | Người dùng có vai trò `ADMIN` (profile)                         | RLS, RPC kiểm tra vai trò, `is_active`, audit trigger (mục 2)                                                           | Danh sách Admin thực tế, số lượng, MFA của họ                    |
| Tạo/đổi danh tính    | Người có quyền Auth admin trên Supabase (Dashboard/API/service) | Trigger `handle_new_auth_user` tạo profile từ `app_metadata.role_code`; signup tắt trong `config.toml` (chỉ file local) | Ai có quyền đó; cài đặt Auth thật; audit của Supabase Auth       |
| Mã nguồn & CI/CD     | Chủ/quản trị repo GitHub                                        | 3 workflow, PR template; không có CODEOWNERS                                                                            | Visibility, branch protection, bypass, quyền token, environments |
| Dữ liệu & Edge       | Chủ/quản trị project Supabase                                   | Migration, function `sepay-webhook`, `verify_jwt=false` riêng function này                                              | Project staging/prod có tồn tại, thành viên, secret, backup      |
| Hosting frontend     | Quản trị Vercel                                                 | Runbook nêu biến môi trường; không có `vercel.json`                                                                     | Team members, quyền sửa env production, deployment protection    |
| Thanh toán           | Quản trị SePay + Admin app (tài khoản nhận tiền trong settings) | Xác thực webhook, đối chiếu tài khoản nhận, hàng đợi xử lý (SEPAY_SETUP)                                                | Tài khoản SePay, MFA, chế độ xác thực thật, API token            |

## 2. Code facts: quyền trong ứng dụng

### 2.1 Mô hình vai trò và kiểm tra phía server

- Sáu vai trò cố định bằng `check` trên `roles.code` (`ADMIN`, `SALE_B2B`, `STORE_STAFF`, `FRANCHISE_STAFF`, `WAREHOUSE`, `PRODUCTION`); `roles.permissions` chỉ là gợi ý UI, quyền thật do RLS/RPC. `[CODE]` `20261001171626_roles.sql`.
- `private.current_role_code()` đọc `profiles` ⨝ `roles` **mỗi lần gọi** theo `auth.uid()` và chỉ trả vai trò khi `is_active`. Người dùng không có profile, hoặc bị vô hiệu hóa, nhận `NULL`, nên mọi `is_admin()`/`has_role()` trả `false` (fail closed). Đổi vai trò hoặc vô hiệu hóa có hiệu lực ở DB ngay ở request kế tiếp, không chờ JWT hết hạn. `[CODE]` `20261001172628_rls_baseline_audit.sql` dòng 31–77.
- Hàm `private.*` không nằm trong schema được expose qua Data API (`api.schemas = ["public","graphql_public"]`); có test "permission helpers are not callable through the Data API schema". `[CODE]` `config.toml`, `tests/integration/rls-baseline.test.ts`.
- `anon` bị thu hồi quyền trên bảng/sequence/function mặc định và trên các bảng master; các RPC đã đối chiếu ở mục 2.4 đều `revoke ... from public, anon` rồi `grant` có chủ đích (chưa liệt kê toàn bộ RPC của mọi migration). `[CODE]`.

### 2.2 Cấp quyền và thu hồi

- Cấp vai trò lúc tạo user: `handle_new_auth_user` đọc `raw_app_meta_data.role_code` (chỉ API admin ghi được; `user_metadata` không bao giờ quyết định vai trò). Thiếu/sai `role_code` hoặc thiếu tên ⇒ không có profile ⇒ không có quyền. Trigger chỉ **tạo** profile còn thiếu, không bao giờ đổi profile đã có. `[CODE]` `20261001172143_profiles.sql`.
- Chuỗi audit khi tạo Admin (đọc tĩnh, chưa thực thi): trigger `on_auth_user_created` (`after insert or update of raw_app_meta_data on auth.users`) → `handle_new_auth_user` (`security definer`) `insert into public.profiles ... on conflict do nothing` → trigger `audit_profiles` (`after insert or update or delete`) → `private.audit_row_change` (`security definer`) `insert into public.audit_logs` với `after_data = to_jsonb(new)` (có `role_id`, `is_active`), `action='insert'`. Nên tạo Admin **có** dòng audit. Auth admin API ghi `app_metadata` ngay sau khi insert, nên profile có thể được tạo ở nhánh insert hoặc update; trigger audit chạy ở cả hai. `actor_user_id` là `auth.uid()`, thường NULL với Auth admin API/service role/SQL editor. Nếu user đã có profile thì `on conflict do nothing` không chèn dòng nào, nên đổi `app_metadata` sau đó không tạo audit. `[CODE]` `20261001172143_profiles.sql` dòng 53–65; `20261001172628_rls_baseline_audit.sql` dòng 127–148, 201–202.
- Hệ quả: `app_metadata.role_code` chỉ là giá trị khởi tạo, **không phải nguồn sự thật**. Nguồn sự thật là `profiles.role_id`. Khi rà soát không được dựa vào `app_metadata` để kết luận vai trò hiện tại.
- Đổi vai trò/trạng thái sau đó: chỉ Admin `UPDATE` được `profiles` (`profiles_update_admin`). Người dùng không tự sửa vai trò/trạng thái của mình; không ai `DELETE` được profile (`on delete restrict`, revoke delete). Có test cho leo thang vai trò và vô hiệu hóa người khác. `[CODE]` `rls-baseline.test.ts` dòng 149–187. Policy không giới hạn cột, nên Admin sửa được mọi cột kể cả vai trò/trạng thái của chính mình; lý do là tùy chọn (chỉ ghi khi đặt `app.audit_reason`). Chặn "Admin cuối cùng"/tự hạ quyền chưa có trong code và **không** là yêu cầu đã duyệt; đây là biện pháp vận hành đề xuất cần quyết định (AR-06). Hành vi này đọc từ SQL, chưa thực thi. **Không có UI quản lý user** (RV, "Admin user-management UI thiếu").
- Vô hiệu hóa = `profiles.is_active=false`. Giao diện chặn đăng nhập và đăng xuất người dùng bị vô hiệu hóa hoặc không có profile (`auth.service.ts`, `access.ts`), nhưng đó chỉ là UX; ràng buộc thật nằm ở DB. Mã không thu hồi phiên/refresh token của Supabase Auth và không đặt cờ ban trên `auth.users`. `[CODE]`.

### 2.3 Audit

- `audit_logs` bất biến (trigger chặn update/delete/truncate, kể cả service role), chỉ Admin `SELECT`, chỉ trigger ghi. `audit_profiles` ghi before/after khi đổi profile. `actor_user_id = auth.uid()`, nên thay đổi qua service role, SQL editor hoặc migration có `actor_user_id` **NULL**. `[CODE]`.
- Việc tạo/đổi `profiles` (kể cả khi tạo từ Auth, mục 2.2) có audit, nhưng thiếu định danh con người quản trị nền tảng khi `actor_user_id` NULL. Không có audit cho thay đổi chỉ ở `auth.users` (đổi email/mật khẩu/MFA/`app_metadata` của user đã có profile); các sự kiện này chỉ nằm ở log Supabase Auth `[CLOUD-UNVERI]`. `payment_events` chưa có trigger audit (RV-12). Chưa có màn hình Audit Log (RV). `reason` chỉ ghi khi RPC đặt `app.audit_reason`; sửa `profiles` trực tiếp không bắt buộc lý do. `[CODE]`.

### 2.4 Chức năng chỉ Admin (hoặc nhóm hẹp) qua RPC

Đã đối chiếu dòng kiểm tra quyền trong migration; bảng này không thay thế test.

| Chức năng                                                                | Điều kiện trong code                              | Nguồn                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------- |
| Nhập/import tồn đầu kỳ, điều chỉnh tồn, đối chiếu tồn                    | Admin                                             | inventory_posting, opening_stock_import, reservations |
| Ghi xuất mẫu/biếu/hỏng                                                   | Admin hoặc Warehouse                              | inventory_posting L251                                |
| Phân bổ hàng cho đơn; dùng tồn an toàn                                   | Admin/Warehouse; tồn an toàn chỉ Admin            | reservations L540–544                                 |
| Chạy giải phóng hàng giữ quá hạn                                         | Admin (job pg_cron chạy nội bộ)                   | reservations L625                                     |
| Xác nhận đơn, hủy đơn đã xác nhận, vô hiệu hóa đơn                       | Admin                                             | payments_rpcs L251/266/276                            |
| Ghi nhận/xác nhận/hỏng/hủy/hoàn thanh toán                               | Admin                                             | payments_rpcs L324                                    |
| Gán/bỏ qua giao dịch chưa khớp                                           | Admin (`assert_admin_payments`)                   | payments_rpcs L612/640                                |
| Xử lý webhook SePay                                                      | Chỉ `service_role` (thu hồi khỏi `authenticated`) | payments_rpcs L667–668                                |
| Đổi trạng thái/lịch giao                                                 | Admin hoặc Warehouse                              | deliveries_workflow L549/610                          |
| Ghi dữ liệu master (location, kênh, nguồn khách), sửa profile, xem audit | Admin (RLS); không có policy delete               | rls_baseline                                          |

Chưa đọc lại trong review này: policy của `app_settings`, `commission_rules`, `safety_stock_rules`, `customers`, `orders` (chỉ dựa trên tên migration/trigger audit).

### 2.5 Danh tính dịch vụ

- `sepay-webhook` tạo client bằng `SUPABASE_SERVICE_ROLE_KEY` do runtime Edge cung cấp (bỏ qua RLS) và **chỉ** gọi RPC `process_sepay_webhook`. `verify_jwt=false` chỉ cho function này; function tự xác thực HMAC/API key và fail closed khi thiếu secret. `[CODE]` `index.ts` dòng 103–109, `config.toml`, SEPAY_SETUP.
- Secret nhắc trong repo (chỉ tên, không giá trị): `SEPAY_WEBHOOK_HMAC_SECRET`, `SEPAY_WEBHOOK_API_KEY`, các biến giới hạn `SEPAY_WEBHOOK_*`, GitHub `SUPABASE_ACCESS_TOKEN`, `STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD`, biến `STAGING_CONFIGURED`. Mỗi chế độ xác thực SePay chỉ có **một** giá trị tại một thời điểm.
- Trình duyệt chỉ dùng `VITE_APP_ENV`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`src/lib/env.ts`). Giới hạn của `check:env` xem RV-11 (SEC-004).
- `seed.sql` tạo tài khoản kiểm thử cố định (gồm profile vai trò Admin; test đăng nhập bằng `TEST_USERS`). Integration test từ chối chạy ngoài localhost (`helpers.ts` dòng 39). Giá trị đăng nhập **không được đọc** trong review này.

### 2.6 Workflow GitHub (đọc nguyên văn 3 file)

- `ci.yml`: chạy khi `pull_request` và push `develop`/`main`; hai job `app`, `database`; dùng `actions/*@v4` theo tag; **không có khối `permissions:`**.
- `staging.yml`: chạy khi push `develop` và `workflow_dispatch`; chỉ chạy nếu `vars.STAGING_CONFIGURED == 'true'`; dùng `environment: staging`; chạy `supabase link`, `db push --dry-run`, `db push` với `SUPABASE_ACCESS_TOKEN`. **Không phụ thuộc kết quả CI cùng commit** (RV-10) và **không có `permissions:`**.
- `production.yml`: placeholder chỉ `echo`; không có secret, không deploy.
- Repo không có `CODEOWNERS`, `SECURITY.md`, `dependabot.yml`.

## 3. Cloud facts: snapshot đã có và chưa xác minh

| Nội dung                              | Giá trị trong tài liệu                                           | Nhãn                                            |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Repo `cuongnn0306/chb-tet-2027`       | `private=false` (public), trái INF-001, lúc review 02/10/2026    | `[SNAPSHOT]` RV-14, PROJECT_PROGRESS            |
| Branch `main`                         | `protected=true`; required checks/bypass/review chưa kiểm tra    | `[SNAPSHOT]`                                    |
| Branch `develop`                      | `protected=false`                                                | `[SNAPSHOT]`                                    |
| Supabase staging/prod, Vercel, SePay  | Runbook ghi "CHƯA cấu hình"; không có project ref/URL trong repo | `[SNAPSHOT]` runbook; hiện tại `[CLOUD-UNVERI]` |
| MFA, quyền thành viên, secret, backup | Không có bằng chứng nào trong repo                               | `[CLOUD-UNVERI]`                                |

Không suy ra secret đã lộ chỉ vì repo public (RV-14), và không suy ra ngược lại.

## 4. Danh sách phát hiện (checklist)

Mức độ theo thang review: **P1** cần Owner xử lý trước production; **P2** cần sửa/ghi quyết định trước go-live; **P3** cải thiện. Mọi mục đều `Mở`. "Task tiếp theo" là đề xuất: mục ghi _cần quyết định_ chưa có task ID chuẩn trong plan, Codex/Owner gán.

| ID    | Mức | Phát hiện                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | File / bằng chứng                                                                                         | Task tiếp theo                                                      |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AR-01 | P1  | Repo public theo snapshot, trái INF-001. Cần Owner xác nhận hiện tại. Trước khi đổi sang private, xác nhận gói GitHub vẫn cho branch protection trên repo private (chưa kiểm chứng) để không mất bảo vệ.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | RV-14; PROJECT_PROGRESS; `[SNAPSHOT]` 02/10/2026                                                          | INF-001 (Owner)                                                     |
| AR-02 | P1  | `develop` chưa bảo vệ (snapshot); chưa rõ required checks (`app`, `database`), bypass, enforce cho admin, chặn force-push/xóa. Đường PR → staging không có chứng minh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | RV-14; `ci.yml` tên job; `staging.yml` trigger push `develop`                                             | INF-001 (Owner), INF-008                                            |
| AR-03 | P1  | Staging `db push` chạy theo push `develop`, không chờ CI cùng commit; chỉ có biến `STAGING_CONFIGURED` và `environment: staging` (luật bảo vệ environment chưa xác minh). Token là `SUPABASE_ACCESS_TOKEN` (cần Owner xác nhận loại token, phạm vi, chủ sở hữu).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `.github/workflows/staging.yml` dòng 10–36; RV-10                                                         | INF-008 (gating), INF-009 (Owner: token, environment)               |
| AR-04 | P2  | Workflow không khai báo `permissions:`; quyền `GITHUB_TOKEN` phụ thuộc cài đặt mặc định repo/org (chưa xác minh). Action ghim theo tag `@v4`, không theo commit SHA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `ci.yml`, `staging.yml`, `production.yml`                                                                 | INF-008 (sửa workflow, cần quyết định)                              |
| AR-05 | P2  | Không có `CODEOWNERS`: migration, RLS, workflow, Edge function không có yêu cầu reviewer bắt buộc được mã hóa trong repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Glob `.github/**`: chỉ có workflows và PR template                                                        | INF-001 / INF-008 (Owner chọn reviewer)                             |
| AR-06 | P2  | Không có luồng quản lý user/Admin trong app (PRD §3.1 "Quản lý user"; RV gap). (a) Tạo Admin mới là hành động nền tảng: tạo user Auth với `app_metadata.role_code='ADMIN'` kích hoạt `handle_new_auth_user` → `INSERT` vào `profiles` → trigger `audit_profiles` ghi `audit_logs` (có `role_id`), nên việc tạo **có** được audit; điều thiếu là định danh con người quản trị nền tảng (`actor_user_id` thường NULL, xem AR-07). (b) Chính sách `profiles_update_admin` cho Admin sửa mọi cột của mọi profile, kể cả vai trò/trạng thái của chính mình; lý do là tùy chọn. Chặn "Admin cuối cùng"/tự hạ quyền là **biện pháp vận hành đề xuất cần quyết định**, không phải yêu cầu đã duyệt trong spec. Hành vi DB chưa được thực thi trong review này. | `20261001172143_profiles.sql`; `20261001172628_rls_baseline_audit.sql` dòng 187–196; PRD §3.1; RV (gap)   | _Cần quyết định_: task quản lý user (plan không có ID); SEC-001/002 |
| AR-07 | P2  | Audit cho thay đổi truy cập chưa đủ ở hai điểm: (1) thiếu định danh con người quản trị nền tảng: thay đổi `profiles` qua trigger Auth, service role, SQL editor hoặc migration thường có `actor_user_id` NULL (`auth.uid()` rỗng), nên `audit_logs` cho biết _cái gì_ đổi nhưng không cho biết _ai_ trên nền tảng; (2) thay đổi chỉ ở Auth (email, mật khẩu, MFA, `app_metadata` của user đã có profile) không tạo dòng `audit_logs` nào, vì không có trigger trên `auth.users` và trigger profile là `on conflict do nothing`. Ngoài ra: `payment_events` chưa audit (RV-12), chưa có Audit Log viewer, lý do không bắt buộc. Không test nào khẳng định dòng audit cho chuỗi tạo profile từ Auth (test audit hiện có chỉ phủ `locations`).            | `private.audit_row_change`; RV-12; RV (gap)                                                               | SEC-001, SEC-002                                                    |
| AR-08 | P2  | Thu hồi chưa đầy đủ ở tầng Auth: vô hiệu hóa chỉ đặt `is_active=false` (DB chặn ngay) nhưng không thu hồi phiên/refresh token hay ban user; `[auth.sessions]` (timebox/inactivity) đang comment trong `config.toml`; UI giữ profile đã nạp tới khi tải lại.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `profiles.sql`; `auth.service.ts`; `config.toml` dòng 272–277                                             | SEC-011 quy trình mục 7; INF-010/012 (Owner: cài đặt Auth thật)     |
| AR-09 | P2  | Không có MFA/AAL nào trong mã, migration, function hay test. `config.toml` đặt MFA TOTP/phone `enroll_enabled=false`, `verify_enabled=false` (ghi chú "Pro plan"); mật khẩu tối thiểu 6, không yêu cầu độ phức tạp. Đây là file local, **không phải bằng chứng** cloud (không workflow/runbook nào đẩy config). `PRODUCTION_DEPLOY` chỉ có mục checklist thủ công, chưa có chủ sở hữu hay bản ghi.                                                                                                                                                                                                                                                                                                                                                     | `config.toml` dòng 183–186, 297–313; grep `aal/mfa/totp` không có kết quả; `PRODUCTION_DEPLOY.md` bước 3  | INF-010/012 (Owner); _cần quyết định_ về MFA cho Admin trong app    |
| AR-10 | P2  | Danh tính dịch vụ: service-role key bỏ qua RLS và `verify_jwt=false`; phạm vi an toàn chỉ nhờ function giữ tối thiểu. Chưa có quy trình xoay/thu hồi cho HMAC secret, API key, service-role key, DB password, access token. Xoay secret SePay gây khoảng từ chối (fail closed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `sepay-webhook/index.ts`; `config.toml` cuối file; SEPAY_SETUP; mục 7 dưới đây là bản nháp                | SEC-004; Owner xác nhận quy trình                                   |
| AR-11 | P2  | Tài khoản seed cố định (có vai trò Admin) nếu seed lên staging/cloud sẽ là danh tính biết trước. Runbook cho phép "seed có kiểm soát" ở staging mà không nêu yêu cầu đổi thông tin đăng nhập; chỉ production bị cấm tường minh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `supabase/seed.sql`; `tests/integration/helpers.ts`; `STAGING_DEPLOY.md` dòng 31                          | INF-009 / UAT-001 (Owner)                                           |
| AR-12 | P3  | Test truy cập chưa phủ: có kiểm tra user inactive cho đơn, tồn kho, master data, profile; chưa thấy cho payments, deliveries, reservations RPC; chưa có test Admin tự khóa mình hoặc thay đổi vai trò lan truyền. Các test **chưa được chạy** trong attempt này.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `orders.test.ts` L360; `inventory.test.ts`; `rls-baseline.test.ts`; grep `inactive` ở payments/deliveries | SEC-003                                                             |
| AR-13 | P3  | Ma trận §2.2 chưa nói Warehouse ghi xuất mẫu/biếu/hỏng (`record_stock_exit`) hay xem lịch giao toàn hệ thống. Cần Owner xác nhận đúng ý định hay thu hẹp (không tự đổi ở đây).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `inventory_posting.sql` L251; `deliveries_workflow.sql` L676; RV "Warehouse xem logistics"                | SEC-003 (Owner xác nhận)                                            |
| AR-14 | P3  | Hàm trong schema `private` mới tạo không đều có `revoke`; an toàn dựa vào việc schema không expose qua Data API (và `anon` không có `usage`). Chỉ là phòng thủ nhiều lớp; chưa liệt kê đầy đủ.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `rls_baseline` dòng 26–28; `config.toml` `api.schemas`                                                    | SEC-003                                                             |

Xung đột tài liệu cần quyết định (không tự giải): plan §18 yêu cầu "Supabase Production: ít admin nhất có thể", trong khi mục 7.5 (khôi phục khi mất Admin cuối cùng) đề xuất nhiều hơn một đường khôi phục độc lập. Đề xuất này, cũng như chặn "Admin cuối cùng"/tự hạ quyền ở AR-06, là biện pháp vận hành chưa được duyệt trong spec. Owner quyết định, không phải quy tắc nghiệp vụ.

## 5. Checklist xác minh cloud (Owner điền; đang NOT VERIFIED)

Cách làm: người có quyền mở trang cài đặt của nền tảng, ghi kết quả vào bảng bên dưới hoặc kho lưu trữ nội bộ (ảnh chụp/export không chứa secret/PII). Không dán secret, email hay số tài khoản vào repo. Không dùng tài khoản dùng chung.

Mẫu bản ghi, mỗi dòng: `ID | Kết quả | Người xác minh | Ngày | Bằng chứng (đường dẫn nội bộ) | Trạng thái (NOT VERIFIED / VERIFIED / FAILED)`.

| ID    | Nền tảng | Mục cần xác minh                                                                                                                                | Kỳ vọng theo spec / khuyến nghị                                        | Trạng thái   |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| CV-01 | GitHub   | Visibility của repo                                                                                                                             | Private (INF-001)                                                      | NOT VERIFIED |
| CV-02 | GitHub   | Branch protection `main` và `develop`: PR bắt buộc, required checks (`app`, `database`), cấm force-push/xóa, có/không bypass, áp dụng cho admin | Không push trực tiếp `main`; PR cần CI xanh (INF-001)                  | NOT VERIFIED |
| CV-03 | GitHub   | Danh sách collaborator/team và quyền; yêu cầu 2FA                                                                                               | Chỉ người cần mới có write/admin (plan §18)                            | NOT VERIFIED |
| CV-04 | GitHub   | Actions: quyền `GITHUB_TOKEN` mặc định, phê duyệt PR từ fork, action được phép                                                                  | Quyền mặc định tối thiểu                                               | NOT VERIFIED |
| CV-05 | GitHub   | Environment `staging`: reviewer bắt buộc, giới hạn branch, danh sách secret (chỉ tên), biến `STAGING_CONFIGURED`                                | Có bảo vệ trước khi `db push`; không dùng chung giá trị với production | NOT VERIFIED |
| CV-06 | GitHub   | Deploy key, PAT, GitHub App đang có quyền vào repo (gồm tích hợp Vercel)                                                                        | Chỉ tích hợp cần thiết, quyền tối thiểu                                | NOT VERIFIED |
| CV-07 | Supabase | Danh sách thành viên organization/project và vai trò; MFA của từng tài khoản                                                                    | Ít admin nhất có thể; MFA bật (plan §18)                               | NOT VERIFIED |
| CV-08 | Supabase | Cài đặt Auth thật: signup tắt, xác nhận email, chính sách mật khẩu, MFA enroll/verify, timebox/inactivity, JWT expiry                           | Khớp ý định "chỉ Admin tạo tài khoản" (config.toml là file local)      | NOT VERIFIED |
| CV-09 | Supabase | Danh sách user Auth đối chiếu profile (mục 6, truy vấn 1–3); không có user không rõ nguồn                                                       | Mỗi Admin có chủ sở hữu và lý do tồn tại                               | NOT VERIFIED |
| CV-10 | Supabase | Ai xem được service-role key/DB password; token truy cập đã cấp (loại, chủ sở hữu, phạm vi)                                                     | Số người tối thiểu; token theo từng mục đích                           | NOT VERIFIED |
| CV-11 | Supabase | Function secrets: chỉ tên đã đặt; `sepay-webhook` là function duy nhất `--no-verify-jwt`                                                        | Khớp SEPAY_SETUP                                                       | NOT VERIFIED |
| CV-12 | Supabase | Giới hạn mạng DB, bắt buộc SSL, log Auth/Edge và thời gian lưu                                                                                  | Quyết định của Owner; ghi lại giá trị                                  | NOT VERIFIED |
| CV-13 | Vercel   | Thành viên team và vai trò; MFA/SSO; ai sửa được env production                                                                                 | Hạn chế sửa env production (plan §18)                                  | NOT VERIFIED |
| CV-14 | Vercel   | Production branch là `main`; preview/staging dùng giá trị staging; không có service-role hay secret server trong biến `VITE_*`                  | Tách môi trường (AGENTS §7)                                            | NOT VERIFIED |
| CV-15 | Vercel   | Deployment protection cho preview; token đã cấp                                                                                                 | Preview không công khai dữ liệu thật                                   | NOT VERIFIED |
| CV-16 | SePay    | Quản trị viên tài khoản; MFA; tài khoản quản trị riêng                                                                                          | Account quản trị riêng, không dùng chung (plan §18)                    | NOT VERIFIED |
| CV-17 | SePay    | Cấu hình webhook: URL staging/production tách biệt, chế độ xác thực, Test Mode và production không lẫn khóa                                     | Khớp SEPAY_SETUP; khóa khác nhau theo môi trường                       | NOT VERIFIED |
| CV-18 | SePay    | API token đã cấp; tài khoản nhận tiền khớp `app_settings` cấu hình QR                                                                           | Chỉ token cần thiết; tài khoản nhận đúng                               | NOT VERIFIED |
| CV-19 | Tất cả   | Sao lưu/khôi phục thuộc SEC-010, **không** được suy ra từ tài liệu này                                                                          | Xác minh riêng ở SEC-010                                               | NOT VERIFIED |

## 6. Truy vấn chỉ-đọc cho Owner (chưa được chạy trong task này)

Chạy bằng tài khoản Owner trên môi trường cần rà soát (SQL editor hoặc kết nối riêng), không lưu kết quả có tên/email vào repo.

```sql
-- 1) Người dùng theo vai trò và trạng thái (nguồn sự thật là profiles.role_id)
select r.code as role_code, p.is_active, p.id, p.full_name, p.created_at, p.updated_at
from public.profiles p
join public.roles r on r.id = p.role_id
order by r.code, p.is_active desc, p.full_name;

-- 2) Tài khoản Auth không có profile (không có quyền truy cập dữ liệu; cần xác định nguồn gốc)
select u.id, u.created_at, u.last_sign_in_at, u.banned_until
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 3) Lệch giữa app_metadata và profile (app_metadata chỉ là giá trị khởi tạo)
select u.id, u.raw_app_meta_data ->> 'role_code' as app_metadata_role, r.code as profile_role, p.is_active
from auth.users u
join public.profiles p on p.id = u.id
join public.roles r on r.id = p.role_id
where coalesce(u.raw_app_meta_data ->> 'role_code', '') <> r.code;

-- 4) Thay đổi profile trong 90 ngày (actor NULL = service role/SQL editor/migration)
select a.created_at, a.actor_user_id, a.action, a.entity_id,
       a.before_data ->> 'role_id' as role_before, a.after_data ->> 'role_id' as role_after,
       a.before_data ->> 'is_active' as active_before, a.after_data ->> 'is_active' as active_after
from public.audit_logs a
where a.entity_type = 'profiles' and a.created_at >= now() - interval '90 days'
order by a.created_at desc;
```

## 7. Quy trình định kỳ và khẩn cấp (bản nháp, Owner phê duyệt)

Các bước ở nền tảng chưa được xác minh trong task này: Owner ghi lại đường dẫn/thao tác chính xác theo tài liệu hiện hành của từng nền tảng sau khi thực hiện lần đầu, rồi cập nhật tài liệu này.

### 7.1 Rà soát định kỳ

- Khi nào: trước UAT, trước go-live, mỗi khi nhân sự tham gia/rời dự án, và định kỳ trong chiến dịch (Owner chọn chu kỳ).
- Làm gì: chạy truy vấn mục 6 ở staging và production; đối chiếu từng Admin với danh sách người được duyệt; điền lại mục 5; ghi người/ngày/kết quả. Mọi dòng còn `NOT VERIFIED` ở thời điểm go-live là blocker cho INF-001/SEC-011.

### 7.2 Nhân sự nghỉ hoặc mất thiết bị

1. Vô hiệu hóa profile (`is_active=false`). Có hiệu lực ngay với DB. Hiện chưa có UI (AR-06), nên cần Admin khác thao tác theo cách Owner phê duyệt và có lý do được ghi lại.
2. Thu hồi phiên/ban user ở Supabase Auth `[CLOUD-UNVERI]` vì mã không làm việc này (AR-08).
3. Gỡ khỏi GitHub, Vercel, Supabase, SePay; thu hồi token/PAT/deploy key họ từng tạo.
4. Xoay mọi secret họ từng truy cập (mục 7.4).
5. Xem `audit_logs` của người đó trong khoảng nghi ngờ (truy vấn 4 và theo `actor_user_id`).

### 7.3 Nghi tài khoản Admin bị chiếm

1. Vô hiệu hóa profile và thu hồi phiên Auth như 7.2 bước 1–2; đặt lại thông tin đăng nhập qua kênh an toàn.
2. Xem `audit_logs` (bất biến) trong khoảng nghi ngờ; chú ý thao tác tiền/tồn: xác nhận/hoàn thanh toán, gán/bỏ qua giao dịch chưa khớp, điều chỉnh tồn, vô hiệu hóa đơn.
3. Chạy đối chiếu tồn (`verify_inventory_balances`, Admin) và đối chiếu giao dịch ngân hàng với `payments`/`payment_events`.
4. Ghi sự cố, quyết định và người phê duyệt. Không xóa hay sửa giao dịch; dùng void/soft-delete kèm lý do (AGENTS §4).

### 7.4 Nghi lộ secret hoặc xoay định kỳ

- Phạm vi: `SEPAY_WEBHOOK_HMAC_SECRET`, `SEPAY_WEBHOOK_API_KEY`, service-role key, DB password, `SUPABASE_ACCESS_TOKEN`, token Vercel/SePay.
- SePay: mỗi chế độ xác thực chỉ có một giá trị, nên giữa lúc đổi ở SePay và ở function secrets request bị từ chối (fail closed). Hành vi retry của SePay khi gặp 401 **chưa được kiểm chứng**. Sau khi xoay, đối chiếu giao dịch ngân hàng với `payment_events` (giao dịch chưa khớp/cần xem xét) để chắc không thiếu khoản.
- Staging và production dùng khóa khác nhau; không bao giờ dùng lại khóa production ở staging.
- Dùng trình tự do nền tảng khuyến nghị; Owner ghi lại sau lần thực hiện đầu tiên.

### 7.5 Mất Admin cuối cùng (break-glass)

Nếu không còn Admin hoạt động, chỉ người có quyền cấp project Supabase mới sửa được profile (qua SQL). Owner cần chỉ định trước, ngoài repo, ít nhất hai người có đường khôi phục độc lập và nơi lưu thông tin khôi phục (số người là quyết định của Owner, xem xung đột ở mục 4). Thay đổi `profiles` qua đường này vẫn được audit nhưng thường có `actor_user_id` NULL (AR-07), nên cần ghi chú sự cố ngoài hệ thống để gắn với người thực hiện.

## 8. Giới hạn của review này

- Không gọi API/đọc metadata cloud, không đọc `.env`/credential, không quét secret rộng, không dùng công cụ DB. Không đổi quyền, tài khoản hay cài đặt bảo mật nào.
- Đã đọc nguyên văn: `roles.sql`, `profiles.sql`, `rls_baseline_audit.sql`, `config.toml`, 3 workflow, PR template, STAGING/PRODUCTION runbook, SEPAY_SETUP. Đọc một phần hoặc chỉ grep dòng kiểm tra quyền: `payments_rpcs`, `inventory_posting`, `reservations`, `deliveries_workflow`, `delivery_failed_logistics`, `opening_stock_import`, `sepay-webhook/index.ts`; test chỉ liệt kê tên. Chưa rà policy ở mục 2.4 cuối.
- Review không tự chạy test và không dùng DB. Docker bị chặn trong workspace nên `task:finish` ghi DB reset/pgTAP/integration là `not_run`. Phát biểu "có test" ở trên là sự tồn tại của test, không phải kết quả chạy; kết quả các check ứng dụng nằm trong báo cáo của task.
- Workspace có thay đổi chưa commit của task khác (gồm migration `20261002*`); review đọc trạng thái hiện tại của workspace.
- Hành vi DB (chuỗi trigger, policy, `on conflict`, giá trị `auth.uid()`) được suy ra từ đọc SQL và **chưa được thực thi**; Docker bị chặn nên không có lần chạy xác nhận.
- Task này chỉ tài liệu. SEC-011 chưa thể gọi là Done: cần Owner điền mục 5, xử lý AR-01…AR-03, quyết định AR-06/AR-07, và review độc lập.

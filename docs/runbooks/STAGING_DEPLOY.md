# Staging deploy

**Trạng thái: CHƯA cấu hình.** Các bước dưới là việc con người cần làm (INF-009, INF-011, INF-012); chưa có project ref/URL nào được tạo.

## Yêu cầu một lần

1. **Supabase Staging (INF-009):** tạo project riêng `chb-tet-2027-staging`. Lưu: Project Ref, URL, anon/publishable key, DB password (password manager). Service-role key chỉ để trong server secret store.
2. **GitHub (INF-001):** tạo repo private, đẩy `main` và `develop`, bật branch protection (cấm push trực tiếp `main`; PR cần CI xanh).
   ```bash
   git remote add origin <repo-url>
   git push -u origin main develop
   ```
3. **Vercel (INF-011):** kết nối repo. `main` → Production; `develop` → Preview/Staging.
4. **Biến môi trường (INF-012)** — target Preview/Staging:
   ```text
   VITE_APP_ENV=staging
   VITE_SUPABASE_URL=<staging url>
   VITE_SUPABASE_ANON_KEY=<staging anon key>
   ```
   Secret server (SePay…) tách riêng, không prefix `VITE_`, không copy secret production sang Preview.

## Đẩy migration lên staging

```bash
npx supabase login
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push --dry-run   # xem trước
npx supabase db push
```

Staging được phép seed dữ liệu test có kiểm soát; không dùng dump khách thật.

## Cổng staging

Migration apply thành công, smoke test, E2E luồng chính, RLS tests. SePay chỉ dùng Test Mode với endpoint staging (E06).

## Tự động đẩy migration lên staging (GitHub Actions)

`.github/workflows/staging.yml` đã sẵn sàng nhưng **tắt** cho tới khi bạn cấu hình. Sau khi tạo project staging:

1. Tạo GitHub environment tên `staging`; bật **Required reviewers** và giới hạn **Deployment branches** chỉ `develop`.
2. Thêm secrets (trong environment đó): `SUPABASE_ACCESS_TOKEN`, `STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD`.
3. Đặt repository variable `STAGING_CONFIGURED=true`.

Không dùng chung giá trị với production.

### Cổng CI trước khi đẩy migration (INF-008 / RV-10)

Workflow có hai job:

| Job       | Quyền                                                              | Việc làm                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate`    | `contents: read`, `actions: read`; không secret, không environment | Chạy `scripts/staging-gate.mjs`: chỉ cho qua khi commit là **đầu nhánh `develop` hiện tại** và job `app` + `database` của workflow `CI` (`ci.yml`, sự kiện push) đã **success** cho đúng commit đó      |
| `db-push` | `contents: read`, `actions: read`; environment `staging`           | Chờ `gate`, chờ reviewer duyệt environment, checkout **đúng SHA đã xác minh**, **kiểm tra lại** develop tip và lần chạy CI mới nhất, rồi `link`, `db push --dry-run`, kiểm tra lại lần nữa và `db push` |

Áp dụng cho cả hai đường:

- **Tự động (push `develop`)**: `gate` chờ CI chạy xong tối đa 45 phút (CI chạy song song với workflow này).
- **Thủ công (`workflow_dispatch`)**: không có input chọn ref/SHA; chỉ chạy được từ `develop`, CI phải đã xong, không chờ.

**Kiểm tra lại sau khi được duyệt.** Reviewer có thể duyệt environment sau nhiều giờ; lúc đó `develop` có thể đã có commit mới hoặc CI đã bị chạy lại. Vì vậy job `db-push` (chỉ bắt đầu sau khi được duyệt) chạy lại `scripts/staging-gate.mjs` với `GATE_RECHECK=true` hai lần: **trước lệnh có đặc quyền đầu tiên** (`supabase link`) và **ngay trước `supabase db push` ghi thật** (sau dry-run). Mỗi lần kiểm tra lại yêu cầu cả hai điều kiện còn nguyên so với lần xác minh đầu (`gate` xuất `sha` và `ci_run`):

- `develop` vẫn đang trỏ đúng commit đó;
- lần chạy CI mới nhất của commit đó vẫn **đúng là lần đã xác minh** (cùng run id, run number và attempt) và job `app`, `database` vẫn `success`.

Thay đổi nào cũng bị từ chối, kể cả khi lần chạy mới xanh (ví dụ ai đó bấm re-run CI trong lúc chờ duyệt): cần chạy lại staging để có xác minh mới. Lần kiểm tra lại không chờ; CI đang chạy, đang xếp hàng, thất bại, thiếu hoặc lỗi API đều là từ chối. Các bước kiểm tra lại chỉ nhận token chỉ-đọc `github.token` (quyền `actions: read` của job); token đó không có trong môi trường của `npm ci` hay các bước `supabase`, và các secret staging không có trong bước kiểm tra lại.

Từ chối (fail closed) khi: CI chưa có hoặc chưa xong sau thời hạn chờ, CI fail/cancel/skip, thiếu job `app` hoặc `database`, kết quả của SHA khác, commit đã cũ (develop đã có commit mới hơn), ref không phải `develop`, run từ fork/pull request/workflow khác, hoặc GitHub API lỗi. Commit cũ bị bỏ qua là chủ ý: lần chạy của commit mới nhất sẽ áp dụng toàn bộ migration còn thiếu.

Không có trigger `pull_request`; secrets chỉ có trong job `db-push` và chỉ ở các bước `supabase`, không có ở `npm ci`. Nếu đổi tên workflow `CI` hoặc job `app`/`database`, phải cập nhật `scripts/staging-gate.mjs` (test `tests/pipeline/staging-gate.test.mjs` sẽ báo lệch).

**Chưa kiểm chứng trên GitHub** (cần Owner, sau khi push/PR): workflow chưa từng chạy thật; chưa xác nhận Required reviewers và giới hạn nhánh của environment `staging`; `develop` hiện **chưa được bảo vệ** (RV-14/SEC-011) nên cổng này không thay thế branch protection với required checks `app` và `database`. Kiểm chứng gợi ý khi staging đã cấu hình: (1) push một commit có CI đỏ → `gate` fail, `db-push` bị skip; (2) dispatch từ nhánh khác `develop` → fail ở bước đầu; (3) push hai commit liên tiếp → commit cũ báo stale; (4) push CI xanh → `db-push` chờ duyệt rồi checkout đúng SHA; (5) để môi trường chờ duyệt, push thêm một commit lên `develop` rồi duyệt → bước kiểm tra lại fail trước `supabase link`; (6) chờ duyệt, bấm re-run CI của cùng commit rồi duyệt → kiểm tra lại fail vì attempt đã đổi. Lưu ý (5)/(6) chỉ mô phỏng được trên staging thật; local mới có test quyết định và test cấu trúc workflow.

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

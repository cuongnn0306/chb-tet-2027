# Production deploy

**Trạng thái: CHƯA cấu hình.** Không có credential/URL production nào trong repo. Production chỉ được thao tác theo checklist này.

## Yêu cầu một lần (INF-010, INF-011, INF-012)

1. Tạo Supabase project riêng `chb-tet-2027-prod`, password/secret khác staging. Không seed dữ liệu test.
2. Vercel Production target (`main`):
   ```text
   VITE_APP_ENV=production
   VITE_SUPABASE_URL=<prod url>
   VITE_SUPABASE_ANON_KEY=<prod anon key>
   ```
   Secret server (SePay HMAC, service role nếu thật sự cần) chỉ ở Vercel server env / Supabase function secrets.
3. Bật MFA trên GitHub, Vercel, Supabase, SePay; giới hạn số admin.

## Quy trình release

1. UAT staging đạt, CI xanh, Release PR `develop → main`.
2. Review migration SQL (có RLS cho bảng mới).
3. **Backup** DB và ghi release tag + migration version.
4. Dry-run:
   ```bash
   npx supabase link --project-ref <PROD_PROJECT_REF>
   npx supabase db push --dry-run
   ```
5. Được duyệt → `npx supabase db push`.
6. Deploy Vercel, chạy smoke test (xem plan §22), kiểm tra monitoring.

## Tuyệt đối không

- `supabase db reset --linked` trên production.
- Chạy `seed.sql` test trên production.
- Sửa schema production bằng Dashboard mà không có migration.
- Hard-delete giao dịch (dùng void/soft-delete + audit).

## Rollback

Frontend: promote lại deployment Vercel ổn định trước đó. Database: ưu tiên forward-fix và migration tương thích ngược; restore backup chỉ khi sự cố nghiêm trọng và có quyết định rõ ràng.

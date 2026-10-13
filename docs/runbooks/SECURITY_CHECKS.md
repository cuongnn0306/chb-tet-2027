# Security checks — env và secret scan (SEC-004)

Scanner quét toàn bộ dòng, kể cả JSON/minified và credential dài. File lớn hơn 64 MiB
bị báo chưa quét và làm CLI thất bại; không được coi output này là sạch. Cấu hình
`envPrefix` tùy chỉnh trong file Vite ts/js/mts/mjs/cts/cjs cũng làm `check:env` thất bại
cho đến khi scanner hỗ trợ prefix đó. Không thực thi config tùy ý trong scanner.

`envDir` tùy chỉnh cũng bị từ chối để không bỏ sót env nằm ngoài project root.
`package-lock.json` được quét như source khác, gồm URL registry có credential.
Quét lịch sử dùng `git log --all -m`: kiểm cả thay đổi riêng của merge commit so với
từng parent, kể cả secret chỉ được thêm khi giải quyết conflict rồi đã xóa.

Hai lệnh cục bộ/CI, không bao giờ in giá trị credential: chỉ in rule id, tên biến,
`file:dòng`, mode Vite, commit 12 ký tự và fingerprint 10 hex (SHA-256 rút gọn, dùng để
đối chiếu/allowlist).

```bash
npm run check:env       # env Vite thực sự được tải + process.env + .env.example
npm run check:secrets   # working tree + lịch sử Git LOCAL (git log --all)
npm run check:secrets -- --tree-only      # chỉ cây làm việc
npm run check:secrets -- --history-only   # chỉ lịch sử
```

CI (`.github/workflows/ci.yml`, job `app`, `fetch-depth: 0`) chạy cả hai. Clone shallow bị
cảnh báo vì lịch sử không đầy đủ.

## check:env

Vite chỉ lộ biến `VITE_*` ra trình duyệt. Với mỗi mode `development`, `production`,
`staging`, scanner nạp `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` theo thứ tự
ưu tiên của Vite (sau thắng; `process.env` thắng file), mở rộng `${VAR}`, rồi kiểm tra:

| Mã                               | Ý nghĩa                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forbidden-name`                 | Tên `VITE_*` chứa SERVICE_ROLE/SECRET/HMAC/PRIVATE/PASSWORD                                                                                                     |
| `server-key-in-browser-var`      | Giá trị là JWT có `role` ≠ anon (ví dụ service_role, giải mã payload, không kiểm chữ ký) hoặc `sb_secret_*`, kể cả dưới tên hợp lệ như `VITE_SUPABASE_ANON_KEY` |
| `not-anon-key` / `malformed-key` | `VITE_SUPABASE_ANON_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY` không phải JWT anon hợp lệ hay `sb_publishable_*`; JWT hỏng trong biến VITE khác                       |
| `user-token-in-browser-var`      | JWT có `role` = `authenticated` (token phiên người dùng, bearer credential; giải mã payload, không kiểm chữ ký) dưới bất kỳ tên `VITE_*` nào                    |
| `secret-in-browser-var`          | PEM private key, URL kèm user:password (không phải local), token nhà cung cấp                                                                                   |
| `invalid-app-env`                | `VITE_APP_ENV` ngoài `local \| staging \| production`                                                                                                           |
| `secret-in-template`             | `.env.example` chứa giá trị giống secret (chỉ được trống/placeholder)                                                                                           |
| `env-file-tracked`               | Một file env thật (không phải `.env.example`) đang bị Git theo dõi                                                                                              |

Giá trị bị file khác/`process.env` ghi đè chỉ là **cảnh báo** (`shadowed`) nhưng vẫn nên xóa.
Biến không có tiền tố `VITE_` (ví dụ `SUPABASE_SERVICE_ROLE_KEY` cho server) không bị coi là
lộ. Nếu `vite.config` đặt `envPrefix` tùy chỉnh, scanner báo lỗi vì nó chỉ hiểu `VITE_`.

Sửa: bỏ giá trị khỏi biến `VITE_*`, đặt secret ở server env (`supabase secrets set`/Vercel
server env). Nếu giá trị từng nằm trong file được commit, build hoặc deploy → **xoay khóa**.

## check:secrets

Quét từng dòng của file đang theo dõi hoặc chưa theo dõi nhưng không bị ignore (nên
`.env.local` thật không được quét ở đây; đó là việc của `check:env`), và mọi dòng từng được
thêm trong lịch sử local, kể cả secret đã bị xóa sau đó. Rule: `jwt-service-role`,
`jwt-privileged-role` (JWT có role khác anon/authenticated/service_role),
`jwt-user-session` (JWT role `authenticated`: token phiên người dùng, bearer credential),
`supabase-secret-key`,
`private-key-block`, `url-credentials` (bỏ qua localhost/127.0.0.1), `provider-token`,
`hardcoded-secret-assignment` (tên như `*_WEBHOOK_SECRET`, `*_API_KEY`… gán literal entropy
cao; `env(...)`, `${...}` và placeholder được bỏ qua). Anon/publishable key công khai không
bị coi là secret. Việc giải mã role chỉ để phân loại, không phải xác thực chữ ký; token
fixture phải được dựng lúc chạy test, không commit literal.

**Không có chú thích bỏ qua trong code.** Chỉ một hit đã review mới được cho qua bằng
`scripts/secret-scan.allowlist.json`:

```json
{
  "entries": [
    {
      "rule": "jwt-service-role",
      "fingerprint": "0123456789",
      "reason": "Đã xoay 2026-10-02, xem ticket ..."
    }
  ]
}
```

Mục thiếu `reason` làm scanner lỗi. Hit trong lịch sử: **xoay credential trước**; việc viết
lại lịch sử Git là quyết định của con người (script không bao giờ sửa Git), sau khi xoay
mới ghi fingerprint vào allowlist.

## Phạm vi đã/chưa quét (ghi nhận 2026-10-13)

- Đã quét: working tree (491 file, 1 file nhị phân bị bỏ qua) và 53 commit local của
  worktree này (`--all`): 0 phát hiện. Allowlist hiện chỉ có một fingerprint của fixture
  synthetic đã được review.
- Bỏ qua có chủ đích: mọi đường dẫn chứa thư mục `node_modules`, `dist` hoặc `coverage`
  (kể cả file bị Git theo dõi) và file nhị phân; không có file nào trong các nhóm này được
  coi là đã quét.
- Chưa quét: file env thật (ignored) của checkout gốc — cố ý không sao chép vào worktree;
  Owner chạy `npm run check:env` trực tiếp trong checkout gốc/máy deploy.
- Chưa quét: remote, fork, PR branch chưa fetch, Vercel/Supabase dashboard, artifact CI.
- Scanner là heuristic: không thay thế xoay khóa định kỳ hay secret scanning của GitHub.

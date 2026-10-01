# Local setup

Local dùng dữ liệu giả và có thể reset bất cứ lúc nào. **Không bao giờ** trỏ `.env.local` tới staging/production.

## 1. Công cụ

```bash
git --version
node --version   # >= 20
npm --version
docker --version
docker info      # phải chạy được; nếu lỗi, mở Docker Desktop và đợi nó sẵn sàng
```

## 2. Cài đặt

```bash
npm install
```

## 3. Supabase local

```bash
npx supabase start
```

Lệnh in ra API URL, anon key, Studio URL. Repo này dùng dải cổng **563xx** (API 56321, DB 56322, Studio 56323, Mailpit 56324) để không đụng các project Supabase local khác (mặc định 543xx/553xx). Tạo `.env.local` (không commit):

```env
VITE_APP_ENV=local
VITE_SUPABASE_URL=http://127.0.0.1:56321
VITE_SUPABASE_ANON_KEY=<anon key local>
```

## 4. Dựng lại DB

```bash
npx supabase db reset
```

Xóa DB local, áp dụng toàn bộ `supabase/migrations/`, rồi `supabase/seed.sql`. Nếu lệnh này lỗi thì môi trường chưa reproducible — hãy sửa trước khi làm tiếp.

## 5. Chạy app

```bash
npm run dev
```

## 6. Trước khi tạo PR

```bash
npm run lint && npm run typecheck && npm test && npm run build && npx supabase db reset
```

## Thay đổi schema

Luôn qua migration: `npx supabase migration new <tên>` → viết SQL (kèm RLS) → `npx supabase db reset` → `npm run db:types`.
Nếu sửa qua Studio local: `npx supabase db diff -f <tên>` rồi review SQL trước khi commit.

## Sự cố thường gặp

- `failed to connect to the docker API`: Docker chưa chạy.
- `port is already allocated`: cổng bị project khác chiếm. Đổi cổng trong `supabase/config.toml` (đừng dừng project của người khác).
- Docker Desktop crash khi khởi động với lỗi `listening on unix://...: remove ...: The file cannot be accessed by the system` (file socket cũ trong `%LOCALAPPDATA%\Docker
un` hoặc `%LOCALAPPDATA%\docker-secrets-engine`): thoát Docker, đổi tên thư mục chứa file socket lỗi (ví dụ `run` → `run.stale`), mở lại Docker; Docker sẽ tự tạo lại.

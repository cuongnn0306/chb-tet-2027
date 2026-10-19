# CHB Bánh Chưng Tết 2027

Ứng dụng web nội bộ thay thế Excel/Zalo cho chiến dịch bánh chưng Tết 2027 của CHB:
**Bán hàng → Đơn → Khách → Tồn kho → Chuyển kho → Sản xuất → Thanh toán → Giao hàng → Hoa hồng → Báo cáo**.

Đây là hệ thống vận hành quan trọng: ưu tiên toàn vẹn dữ liệu, truy vết và hành vi dễ đoán.

## Stack

- React + TypeScript (strict) + Vite + Tailwind CSS
- Supabase: PostgreSQL, Auth, Row Level Security, RPC, Edge Functions
- Hosting: Vercel · Thanh toán: SePay (giai đoạn E06)
- Test: Vitest (unit), integration trên Supabase local, E2E (sẽ bổ sung), test đồng thời cho tồn kho

## Yêu cầu cài đặt

Git, Node.js ≥ 20 (LTS), npm, Docker Desktop (hoặc runtime tương thích) để chạy Supabase local.

## Chạy local nhanh

```bash
npm install
npx supabase start          # in ra URL + anon key local
cp .env.example .env.local  # điền VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY từ bước trên
npx supabase db reset       # dựng lại DB từ migrations + seed
npm run dev
```

Chi tiết: [docs/runbooks/LOCAL_SETUP.md](docs/runbooks/LOCAL_SETUP.md).

## Lệnh thường dùng

| Lệnh                           | Mục đích                                   |
| ------------------------------ | ------------------------------------------ |
| `npm run dev`                  | Chạy dev server                            |
| `npm run lint`                 | ESLint                                     |
| `npm run typecheck`            | TypeScript (strict)                        |
| `npm test`                     | Unit test                                  |
| `npm run test:integration`     | Integration test (cần Supabase local)      |
| `npm run build`                | Build production                           |
| `npm run format`               | Prettier                                   |
| `npm run check:env`            | Kiểm tra không lộ secret qua `VITE_*`      |
| `npx supabase db reset`        | Dựng lại DB local                          |
| `npx supabase migration new X` | Tạo migration mới                          |
| `npm run db:types`             | Sinh lại `src/types/database.generated.ts` |

## Môi trường

`LOCAL → STAGING → PRODUCTION`, mỗi môi trường có Supabase project, Vercel target và secret riêng.
Chỉ commit `.env.example`. Secret server không bao giờ dùng tiền tố `VITE_`.
Nhánh: `feature/*` → `develop` (staging) → `main` (production).

## Tài liệu

- Sản phẩm / UIUX: [docs/product/PRD_UIUX_v1.1.md](docs/product/PRD_UIUX_v1.1.md)
- Thiết kế kỹ thuật: [docs/architecture/TECH_DESIGN_v1.0.md](docs/architecture/TECH_DESIGN_v1.0.md)
- Cấu trúc dự án: [docs/architecture/PROJECT_STRUCTURE_v1.0.md](docs/architecture/PROJECT_STRUCTURE_v1.0.md)
- Kế hoạch triển khai: [docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md](docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md)
- Quy tắc cho agent/dev: [AGENTS.md](AGENTS.md)
- Runbooks: [docs/runbooks/](docs/runbooks/)

## Bàn giao Codex / Claude

- Review ngày 02/10/2026: [code, bảo mật, tiến độ](docs/reviews/2026-10-02-project-review.md).
- Tiến độ baseline: [PROJECT_PROGRESS](docs/handoff/PROJECT_PROGRESS.md).
- Prompt tiếp tục: [CLAUDE_CONTINUE_PROMPT](docs/handoff/CLAUDE_CONTINUE_PROMPT.md).
- Quy trình mỗi task: [WORKFLOW](docs/handoff/WORKFLOW.md); trạng thái chung: [STATUS](docs/handoff/STATUS.md).

```bash
npm run task:start -- SEC-007 claude "Sửa xác thực webhook"
# Triển khai và điền tmp/SEC-007-summary.json theo docs/handoff/summary.example.json
npm run task:finish -- SEC-007 tmp/SEC-007-summary.json
```

Mỗi attempt sinh báo cáo Markdown + JSON tự ghi kết quả checks. `needs_validation`
không phải Done; `validated_local` còn cần review/mobile/staging. Xem WORKFLOW để retry và commit báo cáo.

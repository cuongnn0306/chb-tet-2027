# CHB BÁNH CHƯNG TẾT 2027
## PROJECT STRUCTURE v1.0

**Stack:** React + TypeScript + Supabase/PostgreSQL + Vercel  
**Architecture:** Feature-oriented frontend + domain rules + service layer + migration-driven backend  
**Primary agent instruction:** `/AGENTS.md`

---

# 1. CÂY THƯ MỤC ĐỀ XUẤT

```text
chb-tet-2027/
│
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── .gitignore
├── .env.example
│
├── .github/
│   ├── pull_request_template.md
│   └── workflows/
│       ├── ci.yml
│       ├── staging.yml
│       └── production.yml
│
├── docs/
│   ├── product/
│   │   └── PRD_UIUX_v1.1.md
│   ├── architecture/
│   │   ├── TECH_DESIGN_v1.0.md
│   │   └── ADR/
│   │       └── README.md
│   ├── delivery/
│   │   └── IMPLEMENTATION_INFRA_PLAN_v1.0.md
│   ├── exec-plans/
│   │   ├── active/
│   │   │   └── .gitkeep
│   │   └── completed/
│   │       └── .gitkeep
│   ├── runbooks/
│   │   ├── LOCAL_SETUP.md
│   │   ├── STAGING_DEPLOY.md
│   │   ├── PRODUCTION_DEPLOY.md
│   │   ├── DATABASE_RECOVERY.md
│   │   └── INCIDENT_RESPONSE.md
│   └── generated/
│       ├── DB_SCHEMA.md
│       └── RLS_MATRIX.md
│
├── public/
│   ├── favicon.svg
│   └── assets/
│
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   ├── routes.ts
│   │   └── auth-guard.tsx
│   ├── components/
│   │   ├── ui/
│   │   └── shared/
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── customers/
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── transfers/
│   │   ├── production/
│   │   ├── deliveries/
│   │   ├── payments/
│   │   ├── returns/
│   │   ├── commissions/
│   │   ├── reports/
│   │   ├── master-data/
│   │   ├── settings/
│   │   └── audit/
│   ├── domain/
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── payments/
│   │   ├── commissions/
│   │   ├── production/
│   │   └── deliveries/
│   ├── services/
│   ├── lib/
│   ├── hooks/
│   ├── types/
│   └── styles/
│
├── supabase/
│   ├── config.toml
│   ├── seed.sql
│   ├── migrations/
│   ├── functions/
│   └── tests/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── scripts/
│   ├── generate-db-types.sh
│   ├── check-env.ts
│   ├── import-opening-stock.ts
│   └── export-report.ts
│
└── tmp/
    └── .gitkeep
```

---

# 2. NGUYÊN TẮC TỔ CHỨC

## 2.1 `AGENTS.md`

Đặt ở root để hướng dẫn agent cho toàn repository.

Không biến `AGENTS.md` thành PRD thứ hai.

Nó chỉ chứa:

- tài liệu phải đọc,
- luật làm việc,
- invariant,
- test gates,
- security rules,
- Definition of Done.

Nếu sau này một khu vực cần rule đặc thù, có thể bổ sung `AGENTS.md` sâu hơn, ví dụ:

```text
supabase/AGENTS.md
```

nhưng chỉ khi thực sự cần.

---

# 3. `docs/` — SYSTEM OF RECORD

## `docs/product/`

Yêu cầu sản phẩm và UI/UX:

```text
PRD_UIUX_v1.1.md
```

## `docs/architecture/`

Thiết kế kỹ thuật:

```text
TECH_DESIGN_v1.0.md
ADR/
```

ADR dùng cho quyết định kiến trúc quan trọng, ví dụ:

```text
ADR-001-use-supabase.md
ADR-002-inventory-ledger-source-of-truth.md
ADR-003-payment-idempotency.md
```

## `docs/delivery/`

```text
IMPLEMENTATION_INFRA_PLAN_v1.0.md
```

## `docs/exec-plans/`

Kế hoạch thực thi từng task phức tạp.

Ví dụ:

```text
active/
  INV-004-no-negative-inventory.md
  PAY-007-sepay-webhook.md
```

Hoàn thành thì chuyển sang:

```text
completed/
```

## `docs/runbooks/`

Hướng dẫn vận hành hạ tầng.

## `docs/generated/`

Tài liệu sinh tự động, ví dụ DB schema/RLS matrix.

---

# 4. `src/app/` — APP COMPOSITION

Chỉ chứa:

- router,
- providers,
- auth guard,
- route mapping,
- root app shell.

Không chứa business logic inventory/order/payment.

---

# 5. `src/components/`

## `ui/`

Primitive có thể tái sử dụng:

- Button
- Input
- Dialog
- Table
- Badge

Không biết gì về nghiệp vụ CHB.

## `shared/`

Component dùng chung nhưng có semantics ứng dụng:

- `StatusBadge`
- `MoneyText`
- `DateText`
- `ConfirmActionDialog`

---

# 6. `src/features/`

Đây là nơi chính của UI theo nghiệp vụ.

Mỗi feature có thể chứa:

```text
api/
components/
hooks/
pages/
schemas/
types.ts
```

Không bắt buộc tạo mọi folder nếu feature chưa cần.

Ví dụ:

```text
features/orders/
  api/
    order.queries.ts
    order.mutations.ts
  components/
    OrderItemsEditor.tsx
    OrderSummary.tsx
  hooks/
    useOrder.ts
  pages/
    OrderCreatePage.tsx
    OrderDetailPage.tsx
    OrderListPage.tsx
  schemas/
    order-form.schema.ts
  types.ts
```

---

# 7. `src/domain/` — PURE BUSINESS RULES

Không gọi React.  
Không gọi Supabase trực tiếp.

Ví dụ:

```text
orders/pricing.ts
orders/state-machine.ts
inventory/fefo.ts
commissions/calculator.ts
production/forecast.ts
```

Pure functions giúp unit test ổn định.

---

# 8. `src/services/` — APPLICATION SERVICE BOUNDARY

Điều phối nghiệp vụ giữa UI và backend/RPC.

Ví dụ:

```text
OrderService
InventoryService
PaymentService
DeliveryService
```

Nếu nghiệp vụ cần atomicity, service gọi RPC/Edge Function thay vì thực hiện nhiều request client nối tiếp.

---

# 9. `src/lib/`

Tiện ích không thuộc một feature cụ thể:

- Supabase client
- env parsing
- money/date formatter
- phone normalization
- shared errors

Không biến `lib/` thành sọt rác.

---

# 10. `src/types/database.generated.ts`

Generated artifact từ database schema.

Rule:

- Không sửa tay.
- Regenerate sau migration phù hợp.
- Commit vào Git để TypeScript/CI ổn định.

---

# 11. `supabase/migrations/`

Mọi schema/RLS/RPC change đi qua migration.

Khuyến nghị migration nhỏ, theo mục đích:

```text
0001_initial_schema.sql
0002_auth_profiles_roles.sql
0003_customer_order.sql
0004_inventory.sql
0005_inventory_rpcs.sql
0006_payments.sql
...
```

Tên thực tế có thể dùng timestamp do Supabase CLI sinh.

---

# 12. `supabase/functions/`

Chỉ dùng cho trusted server functions cần thiết.

Ví dụ:

## `sepay-webhook/`

- Verify request
- Idempotency
- Match payment
- Gọi trusted DB logic

## `reservation-expiry/`

Nếu dùng Edge Function/job cho reservation cleanup.

---

# 13. TEST STRUCTURE

## Unit

Pure business logic.

## Integration

Dùng local Supabase để kiểm thử:

- RPC
- RLS
- transaction
- inventory integrity

## E2E

Kiểm thử luồng người dùng đầy đủ.

Không dùng E2E để thay thế unit/integration.

---

# 14. IMPORT BOUNDARY

Khuyến nghị:

```text
components/ui
    ↑
components/shared
    ↑
features
    ↑
app
```

Domain không import feature/app.

Lib không import feature/app.

Service có thể import domain/lib/types.

Tránh vòng import.

---

# 15. NAMING CONVENTIONS

React component:

```text
OrderSummary.tsx
```

Hook:

```text
useOrder.ts
```

Service:

```text
order.service.ts
```

Pure domain:

```text
state-machine.ts
pricing.ts
```

Test:

```text
pricing.test.ts
order-payment-delivery.spec.ts
```

Database dùng snake_case:

```text
order_items
inventory_movements
created_at
```

TypeScript dùng camelCase/PascalCase.

---

# 16. ENVIRONMENT FILES

Repository chỉ commit:

```text
.env.example
```

Local:

```text
.env.local
```

Không commit.

Không tạo production secret file trong repo.

---

# 17. FILES KHÔNG NÊN COMMIT

```text
.env
.env.local
.env.production
node_modules/
dist/
coverage/
playwright-report/
test-results/
*.log
local secrets
database dumps chứa dữ liệu thật
```

---

# 18. RECOMMENDED PATH ALIASES

```text
@/app
@/components
@/features
@/domain
@/services
@/lib
@/types
```

---

# 19. FEATURE DEPENDENCY MAP

```text
Auth/Master Data
      ↓
Customer
      ↓
Order
      ↓
Inventory ← Batch
      ↓
Reservation / Allocation
      ↓
Delivery
      ↓
Production / Transfer

Order → Payment
Order → Commission
Order → Return
All core modules → Dashboard/Reports
All sensitive modules → Audit
```

---

# 20. THỨ TỰ TẠO FOLDER KHI BẮT ĐẦU

Không cần tạo hàng trăm file rỗng ngày đầu.

Giai đoạn E00 tạo tối thiểu:

```text
AGENTS.md
docs/
src/app/
src/components/
src/features/
src/domain/
src/services/
src/lib/
src/types/
supabase/migrations/
supabase/functions/
tests/unit/
tests/integration/
tests/e2e/
scripts/
```

Sau đó mỗi task tạo folder con khi thực sự sử dụng.

---

# 21. ĐƯA CÁC FILE ĐÃ TẠO VÀO REPO

```text
CHB_BANH_CHUNG_TET_2027_PRD_UIUX_v1.1.md
→ docs/product/PRD_UIUX_v1.1.md

CHB_BANH_CHUNG_TET_2027_TECH_DESIGN_v1.0.md
→ docs/architecture/TECH_DESIGN_v1.0.md

CHB_BANH_CHUNG_TET_2027_IMPLEMENTATION_INFRA_PLAN_v1.0.md
→ docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md

AGENTS.md
→ /AGENTS.md
```

---

# 22. ROOT README NÊN CHỈ CHỨA

1. Project purpose.
2. Stack.
3. Quick local start.
4. Links tới docs.
5. Common commands.
6. Environment overview.

Ví dụ:

```text
Product spec:
docs/product/PRD_UIUX_v1.1.md

Technical design:
docs/architecture/TECH_DESIGN_v1.0.md

Implementation plan:
docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md

Agent instructions:
AGENTS.md
```

---

# 23. CÓ NÊN TẠO NHIỀU `AGENTS.md` KHÔNG?

**Chưa cần ở giai đoạn đầu.**

Root `AGENTS.md` là đủ.

Chỉ bổ sung nested `AGENTS.md` khi một subtree có quy tắc đặc thù đáng kể.

Ví dụ:

```text
supabase/AGENTS.md
```

có thể nhấn mạnh:

- migration-only changes,
- RLS requirements,
- transactional SQL,
- no destructive production reset.

Không dùng nested file chỉ để lặp lại root instructions.

---

# 24. MỤC TIÊU CỦA CẤU TRÚC NÀY

Cấu trúc phải giúp một coding agent mới vào repo nhanh chóng xác định:

- Tôi phải đọc gì?
- Business rule nằm ở đâu?
- UI của feature nằm ở đâu?
- Logic thuần nằm ở đâu?
- Gọi backend ở đâu?
- Migration nằm ở đâu?
- Test feature ở đâu?
- Task hiện tại có plan ở đâu?
- Tôi cần chạy check gì trước khi kết thúc?

Nếu agent phải tìm một rule bằng cách đọc ngẫu nhiên hàng chục file, cấu trúc đã thất bại.

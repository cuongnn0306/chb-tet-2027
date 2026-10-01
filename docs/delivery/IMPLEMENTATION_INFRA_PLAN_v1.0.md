# CHB BÁNH CHƯNG TẾT 2027
## IMPLEMENTATION PLAN + INFRASTRUCTURE SETUP — v1.0

**Căn cứ:** PRD + UI/UX v1.1 và Technical Design v1.0  
**Mục tiêu:** Chuyển specification thành backlog có thể giao trực tiếp cho Codex/Claude Code/đội dev, đồng thời chuẩn hóa Local → Staging → Production.

---

# 1. NGUYÊN TẮC TRIỂN KHAI

## 1.1 Môi trường

Dùng ba tầng:

```text
LOCAL
↓
STAGING
↓
PRODUCTION
```

**LOCAL**
- Dùng Supabase local qua CLI + Docker-compatible runtime.
- Dữ liệu giả.
- Có thể reset bất cứ lúc nào.

**STAGING**
- Supabase project riêng.
- Vercel deployment riêng.
- Dữ liệu test, không dùng dữ liệu khách thật nếu không cần.
- Test SePay Test Mode/webhook.

**PRODUCTION**
- Supabase project riêng hoàn toàn.
- Vercel Production.
- SePay Live.
- Không seed test data.
- Migration có review + backup + approval.

---

# 2. HẠ TẦNG ĐỀ XUẤT

```text
GitHub Repository
├── React + TypeScript frontend
├── Supabase migrations
├── Supabase seed
├── Edge Functions
├── tests
└── docs

Local
├── Docker-compatible runtime
├── Supabase local stack
└── Vite/React dev server

Staging
├── Vercel Preview/Staging
├── Supabase Staging
└── SePay Test Mode

Production
├── Vercel Production
├── Supabase Production
└── SePay Live Webhook
```

---

# 3. CẤU TRÚC REPOSITORY

```text
chb-tet-2027/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── auth/
│   │   ├── customers/
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── transfers/
│   │   ├── production/
│   │   ├── delivery/
│   │   ├── payments/
│   │   ├── commissions/
│   │   ├── reports/
│   │   └── settings/
│   ├── lib/
│   ├── services/
│   ├── hooks/
│   ├── types/
│   └── styles/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── functions/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── PRD.md
│   ├── TECH_DESIGN.md
│   └── RUNBOOK.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

# 4. BRANCH STRATEGY

Đơn giản nhưng an toàn:

```text
main        → Production
develop     → Staging
feature/*   → Feature development
fix/*       → Bug fix
hotfix/*    → Production urgent fix
```

Rule:

- Không code trực tiếp trên `main`.
- PR vào `develop` phải qua CI.
- Release PR `develop → main` chỉ merge sau UAT staging.
- Migration production chỉ chạy cùng release đã duyệt.

---

# 5. EPIC MAP

| Epic | Tên | Phụ thuộc |
|---|---|---|
| E00 | Project Foundation & Infra | - |
| E01 | Auth, Roles, Master Data | E00 |
| E02 | Customer | E01 |
| E03 | Order Core | E01,E02 |
| E04 | Inventory Ledger & Batch | E01 |
| E05 | Reservation, FEFO, Allocation | E03,E04 |
| E06 | Payment & SePay | E03 |
| E07 | Multi-delivery | E03,E05 |
| E08 | Transfer | E04 |
| E09 | Production Planning | E04,E05,E07 |
| E10 | Return / Exchange | E03,E04,E07 |
| E11 | Commission | E03,E06,E10 |
| E12 | Dashboard & Reports | E03-E11 |
| E13 | Audit, Security, Hardening | xuyên suốt |
| E14 | UAT, Migration, Go-live | tất cả |

---

# 6. TASK BACKLOG CHI TIẾT

# E00 — PROJECT FOUNDATION & INFRA

## INF-001 — Tạo GitHub repository

**Output**
- Repo private.
- README.
- Branch `main`, `develop`.
- Branch protection.

**Done when**
- Không push trực tiếp vào main.
- PR workflow hoạt động.

## INF-002 — Khởi tạo React + TypeScript

**Output**
- App chạy local.
- ESLint.
- TypeScript strict.
- Formatter.

**Done when**
- `npm run lint`
- `npm run typecheck`
- `npm run build`

đều pass.

## INF-003 — Cài Supabase CLI

Cài dưới project dependency để team dùng cùng workflow.

```bash
npm install supabase --save-dev
npx supabase init
```

## INF-004 — Chạy Supabase local

Yêu cầu Docker-compatible runtime chạy.

```bash
npx supabase start
```

**Done when**
- Local Postgres chạy.
- Local Studio mở được.
- Auth service chạy.

## INF-005 — Setup migration baseline

Tạo migration đầu tiên.

```bash
npx supabase migration new initial_schema
npx supabase db reset
```

## INF-006 — Setup seed

`supabase/seed.sql`

Gồm:

- Roles
- Admin test
- Locations test
- 10–12 SKU demo
- Channel/source
- Safety stock test
- Customer/order samples

Không chứa dữ liệu production.

## INF-007 — `.env.example`

Không chứa secret.

Ví dụ:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
APP_ENV=local
```

Server/Edge Function secret không dùng prefix `VITE_`.

## INF-008 — CI foundation

Mỗi PR:

```text
install
lint
typecheck
unit test
build
Supabase db reset
integration test
```

## INF-009 — Tạo Supabase Staging

Project riêng.

Không dùng chung DB production.

## INF-010 — Tạo Supabase Production

Project riêng.

Secret và password khác staging.

## INF-011 — Tạo Vercel Project

- Kết nối GitHub.
- `main` → Production.
- `develop` → staging deployment convention.

## INF-012 — Environment Variables

Tách:

- Development
- Preview/Staging
- Production

Không copy nhầm production service secret vào Preview.

---

# E01 — AUTH, ROLE, MASTER DATA

## AUTH-001 — Supabase Auth

- Login
- Logout
- Session refresh
- Inactive user block

## AUTH-002 — Profiles

- Tạo profile sau user.
- Role.
- Default location.
- Default channel/source.

## AUTH-003 — Roles & permission helper

Role codes:

```text
ADMIN
SALE_B2B
STORE_STAFF
FRANCHISE_STAFF
WAREHOUSE
PRODUCTION
```

## AUTH-004 — RLS baseline

Viết RLS từ đầu, không để cuối dự án.

## MD-001 — Locations CRUD

## MD-002 — Sales Channels CRUD

## MD-003 — Lead Sources CRUD

## MD-004 — Product CRUD

## MD-005 — Commission Rule CRUD

## MD-006 — Safety Stock CRUD

## MD-007 — App Settings CRUD

**Acceptance E01**
- Admin cấu hình toàn bộ master data.
- User thường không chỉnh được master data.
- Default profile tự fill đúng khi tạo order.

---

# E02 — CUSTOMER

## CUS-001 — Customer schema

Cá nhân + doanh nghiệp.

## CUS-002 — Customer create/edit

## CUS-003 — Phone normalization

Dùng để search/suggest, không unique.

## CUS-004 — Duplicate suggestion

Nhập SĐT → gợi ý customer cũ.

## CUS-005 — Customer history

- Số đơn
- Tổng gross
- Đơn gần nhất

## CUS-006 — Customer list/search/filter

**Acceptance**
- Không block customer trùng.
- Có thể chọn customer cũ trong create order.

---

# E03 — ORDER CORE

## ORD-001 — Orders schema

## ORD-002 — Order code generator

Ví dụ:

```text
TET000001
```

Không phụ thuộc client.

## ORD-003 — Order Items

Snapshot:

- Product
- List price
- Quantity

## ORD-004 — Pricing calculator

```text
gross
discount
net
```

## ORD-005 — Commission ceiling validation

`discount <= base commission`

## ORD-006 — Create draft order

## ORD-007 — Submit order

## ORD-008 — Order state transition service

Không để UI tự set status tùy ý.

## ORD-009 — Cancel logic

- release temp reservation
- audit

## ORD-010 — Void logic Admin

- reason required
- soft-delete semantics

## ORD-011 — Order list

## ORD-012 — Order detail

## ORD-013 — Order timeline

## ORD-014 — Print order

**Acceptance**
- Order đã Confirmed không sửa quantity.
- Muốn đổi số lượng → cancel + new order.
- Gross/discount/net luôn khớp.

---

# E04 — INVENTORY LEDGER & BATCH

## INV-001 — Batch schema

- Batch code
- NSX
- HSD

## INV-002 — Inventory movement schema

Ledger là source of truth.

## INV-003 — Balance projection/cache

## INV-004 — No-negative transaction function

Row lock/transaction.

## INV-005 — Initial stock manual entry

## INV-006 — Initial stock Excel import

## INV-007 — Inventory summary

## INV-008 — Inventory batch detail

## INV-009 — Inventory movements history

## INV-010 — Manual adjustment

Admin + reason + audit.

## INV-011 — Sample/Gift/Damage flows

**Acceptance**
- Không thao tác nào tạo tồn âm.
- Mọi thay đổi truy được movement.
- Không client nào update balance trực tiếp.

---

# E05 — RESERVATION, FEFO, ALLOCATION

## RES-001 — Temporary reservation

## RES-002 — Reservation TTL setting

## RES-003 — Auto expiry job

## RES-004 — Demand commitment

Confirmed future order được đưa vào demand nhưng chưa physical allocation.

## RES-005 — Allocation lead time

Admin configurable.

## RES-006 — FEFO engine

## RES-007 — Physical allocation

## RES-008 — Multi-batch allocation

## RES-009 — Shortage signal

## RES-010 — Suggested source location

**Acceptance**
- Reservation hết TTL tự release.
- FEFO đúng.
- Không phá safety stock ngoài rule.
- Sale không cần chọn batch.

---

# E06 — PAYMENT & SEPAY

## PAY-001 — Payment schema

## PAY-002 — Manual payment

- Cash
- Bank transfer
- COD

## PAY-003 — Deposit policy engine

Configurable.

## PAY-004 — Payment code per order

## PAY-005 — VietQR display

QR chứa:

- Account
- Amount
- Payment code

## PAY-006 — SePay Test Mode setup

Webhook test tới Staging.

## PAY-007 — Webhook endpoint

- HTTPS
- Validate authentication
- Parse payload
- Match order code
- Idempotent

## PAY-008 — Payment deduplication

Unique provider transaction reference/id.

## PAY-009 — Realtime order payment update

## PAY-010 — Refund/void payment

Admin only + audit.

**Acceptance**
- Duplicate webhook không double-credit.
- Payment đúng order.
- Order tự chuyển theo deposit condition.
- Staging test không đụng giao dịch production.

---

# E07 — MULTI-DELIVERY

## DEL-001 — Delivery schema

## DEL-002 — Delivery Items

## DEL-003 — Validate total item quantities

## DEL-004 — Delivery builder in order form

## DEL-005 — Source location selection

## DEL-006 — Delivery status state machine

## DEL-007 — Today view

## DEL-008 — Tomorrow view

## DEL-009 — 7-day view

## DEL-010 — Calendar view

## DEL-011 — Dispatch transaction

## DEL-012 — Failed delivery

## DEL-013 — Reschedule

## DEL-014 — Print delivery note

## DEL-015 — Print warehouse issue note

**Acceptance**
- Một order có nhiều delivery.
- Delivery qty không vượt order qty.
- Delivery hiển thị payment remaining và stock risk.

---

# E08 — TRANSFER

## TRF-001 — Transfer request

## TRF-002 — Recommendation engine

Priority:

1. Region
2. Enough stock
3. Preserve safety
4. FEFO
5. Fewer splits

## TRF-003 — Admin approval

## TRF-004 — Batch allocation transfer

## TRF-005 — Dispatch

## TRF-006 — In-transit state

## TRF-007 — Receive

## TRF-008 — Reject/cancel

## TRF-009 — Print transfer note

**Acceptance**
- Franchise transfer không tính revenue.
- Source/destination inventory đúng.
- Transit stock truy được.

---

# E09 — PRODUCTION PLANNING

## PRD-001 — Future committed demand aggregation

## PRD-002 — Production need calculator

```text
Committed Demand
+ Safety Target
- Available
- Scheduled Production
```

## PRD-003 — Suggested plan

## PRD-004 — Approve plan

## PRD-005 — Production run

## PRD-006 — Start run

## PRD-007 — Complete run

## PRD-008 — Create batch

## PRD-009 — Production IN inventory

## PRD-010 — Production dashboard

## PRD-011 — Shortage alerts

**Acceptance**
- Complete production creates batch + stock atomically.
- Actual qty có thể khác planned qty.
- Production dashboard phản ánh đơn tương lai.

---

# E10 — RETURN / EXCHANGE

## RET-001 — Return request

## RET-002 — Receive pending inspection

## RET-003 — Inspection

## RET-004 — Restock

## RET-005 — Damage

## RET-006 — Revenue adjustment

## RET-007 — Commission adjustment

## RET-008 — Exchange workflow

Exchange = return old + outbound new.

**Acceptance**
- Hàng hoàn không tự Available.
- Audit đủ.
- Commission giảm đúng.

---

# E11 — COMMISSION

## COM-001 — Commission rule resolution

Priority:

1. User + Product
2. User
3. Role + Product
4. Role
5. Product default

## COM-002 — Estimated commission

## COM-003 — Eligible commission

Chỉ khi:

- order completed
- paid full

## COM-004 — Discount deduction

## COM-005 — Return deduction

## COM-006 — User commission screen

## COM-007 — Admin commission screen

## COM-008 — Finalize campaign commission

## COM-009 — Export Excel

**Acceptance**
- Công thức đúng theo PRD.
- Finalized có audit.
- Adjustment không mất lịch sử.

---

# E12 — DASHBOARD & REPORTS

## RPT-001 — KPI definitions

## RPT-002 — Admin dashboard

## RPT-003 — Sales by channel

## RPT-004 — Sales by source

## RPT-005 — Sales by salesperson

## RPT-006 — Sales by location

## RPT-007 — SKU report

## RPT-008 — Customer report

## RPT-009 — Inventory turnover

## RPT-010 — Cancellation report

## RPT-011 — Production report

## RPT-012 — Excel export engine

**Acceptance**
- Filter date/location/user/channel.
- Export khớp filter.
- Gross và cash collected không bị đánh đồng.

---

# E13 — AUDIT, SECURITY, HARDENING

## SEC-001 — Audit helper

## SEC-002 — Audit destructive actions

## SEC-003 — RLS test suite

## SEC-004 — Secret scan

## SEC-005 — XSS/input sanitation review

## SEC-006 — Rate-limit sensitive endpoint

## SEC-007 — Webhook authentication verification

## SEC-008 — Webhook idempotency

## SEC-009 — Error logging

## SEC-010 — Backup/restore runbook

## SEC-011 — Admin access review

---

# E14 — UAT & GO-LIVE

## UAT-001 — Test dataset

Có:

- 10–12 SKU
- Multiple batches
- 5+ locations
- Multiple roles
- Orders multi-delivery
- Payment
- Returns

## UAT-002 — Concurrency test

Hai user mua stock cuối.

## UAT-003 — Reservation expiry test

## UAT-004 — FEFO test

## UAT-005 — Multi-delivery test

## UAT-006 — Transfer test

## UAT-007 — Production test

## UAT-008 — SePay webhook test

## UAT-009 — Duplicate webhook test

## UAT-010 — Return/commission test

## UAT-011 — Mobile usability test

## UAT-012 — Role permission test

## UAT-013 — Export reconciliation

## UAT-014 — Production smoke test

## UAT-015 — Go-live approval

---

# 7. TEST STRATEGY

## Unit Test

Business pure functions:

- Pricing
- Discount ceiling
- Commission
- Production need
- Days of stock
- State transition rules

## Integration Test

Dùng local Supabase:

- Order creation
- Inventory reservation
- Payment confirm
- Transfer
- Production complete
- Return

## E2E

Critical flows:

```text
Login
→ Create customer
→ Create order
→ Deposit
→ Allocation
→ Delivery
→ Full payment
→ Completed
→ Commission eligible
```

## Concurrency Test

Bắt buộc cho inventory.

---

# 8. SETUP LOCAL — WINDOWS / GIT BASH / POWERSHELL

# 8.1 Cài công cụ

Cần:

1. Git
2. Node.js LTS
3. Docker Desktop hoặc runtime tương thích Docker
4. VS Code/Cursor nếu dùng
5. GitHub access

Kiểm tra:

```bash
git --version
node --version
npm --version
docker --version
```

# 8.2 Clone

```bash
git clone <repo-url>
cd chb-tet-2027
```

# 8.3 Install

```bash
npm install
```

# 8.4 Supabase local

```bash
npx supabase start
```

CLI sẽ hiển thị local URL/keys.

Tạo `.env.local`:

```env
VITE_SUPABASE_URL=<local-url>
VITE_SUPABASE_ANON_KEY=<local-anon-key>
APP_ENV=local
```

Không commit `.env.local`.

# 8.5 Reset database

```bash
npx supabase db reset
```

Lệnh phải:

1. Xóa local database hiện tại.
2. Apply migrations.
3. Apply seed.

Nếu command này fail, môi trường chưa reproducible.

# 8.6 Start frontend

```bash
npm run dev
```

# 8.7 Verify

Checklist:

- Login test user.
- Master data có seed.
- Create order chạy.
- Database local thay đổi.
- Không kết nối nhầm staging/prod.

---

# 9. DATABASE MIGRATION WORKFLOW

Mỗi thay đổi DB phải có migration.

Tạo migration:

```bash
npx supabase migration new <name>
```

Sau đó:

```bash
npx supabase db reset
```

Trước PR:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx supabase db reset
```

Không sửa Production schema bằng Dashboard rồi quên migration.

Nếu buộc phải sửa qua Studio local:

```bash
npx supabase db diff -f <migration_name>
```

Review SQL trước commit.

---

# 10. STAGING SETUP

## 10.1 Supabase Staging

Tạo project:

```text
chb-tet-2027-staging
```

Lưu:

- Project Ref
- URL
- anon/publishable key
- DB password
- service-role/secret chỉ ở server secret store

## 10.2 Link local CLI với staging

```bash
npx supabase login
npx supabase link --project-ref <STAGING_PROJECT_REF>
```

Preview migration:

```bash
npx supabase db push --dry-run
```

Apply:

```bash
npx supabase db push
```

Với staging mới có thể dùng seed test có kiểm soát.

Không dùng production customer dump làm seed.

## 10.3 Vercel Staging

Kết nối GitHub repo.

Thiết lập variables cho Preview/Staging:

```text
VITE_SUPABASE_URL=<staging>
VITE_SUPABASE_ANON_KEY=<staging>
APP_ENV=staging
```

Secret server-side tách riêng.

## 10.4 Domain staging

Ví dụ:

```text
tet-staging.chbfood.vn
```

hoặc Vercel preview domain.

Không bắt buộc domain riêng giai đoạn đầu.

---

# 11. SEPAY TEST SETUP

## 11.1 Test trước Live

Sử dụng SePay Test Mode để mô phỏng webhook.

Staging endpoint ví dụ:

```text
https://<staging-domain>/api/webhooks/sepay
```

## 11.2 Payment Code

Chọn prefix riêng:

```text
TET
```

Ví dụ:

```text
TET000123
```

QR dùng amount + payment code trong nội dung chuyển khoản.

## 11.3 Webhook staging

Cấu hình:

- URL staging HTTPS.
- Event tiền vào.
- Chỉ gửi giao dịch có payment code nếu phù hợp.
- Filter prefix `TET`.
- Bật retry.

## 11.4 Authentication

Staging có thể test flow trước, nhưng production phải dùng phương thức xác thực phù hợp.

Khuyến nghị production:

**HMAC-SHA256**

Server:

1. Nhận raw payload.
2. Verify signature.
3. Reject nếu invalid.
4. Kiểm tra transaction id/reference đã tồn tại chưa.
5. Match `code` với order.
6. Insert payment.
7. Reply success.

## 11.5 Idempotency

Bắt buộc unique:

```text
provider + transaction_id/reference
```

SePay retry webhook không được cộng tiền lần hai.

---

# 12. PRODUCTION SETUP

## 12.1 Supabase Production

Tạo project riêng:

```text
chb-tet-2027-prod
```

Không clone seed test.

Cấu hình:

- Auth
- RLS
- DB
- Edge Functions
- Secrets

## 12.2 Production secrets

Không lưu trong repo.

Phân loại:

### Public client

Chỉ key được thiết kế cho browser.

### Server secret

- Supabase server/service credential nếu thực sự cần
- SePay secret/HMAC
- Admin integration secret

Chỉ lưu:

- Vercel server env
- Supabase function secrets

## 12.3 Vercel Production Variables

Production target:

```text
VITE_SUPABASE_URL=<prod>
VITE_SUPABASE_ANON_KEY=<prod>
APP_ENV=production
```

Các webhook secret không prefix `VITE_`.

## 12.4 Production database migration

Trước migration:

1. UAT staging pass.
2. Review migration.
3. Backup.
4. `db push --dry-run`.
5. Approval.
6. Apply migration.
7. Smoke test.

Không chạy:

```bash
supabase db reset --linked
```

trên production.

Không chạy seed test production.

---

# 13. RELEASE FLOW

```text
feature/*
↓ PR
develop
↓ CI
STAGING DEPLOY
↓ UAT
Release PR
main
↓
PRODUCTION DEPLOY
↓
Smoke test
```

Database:

```text
Local migration
↓
Staging db push
↓
UAT
↓
Production dry-run
↓
Backup
↓
Production db push
```

---

# 14. CI/CD GATES

# Pull Request gate

Bắt buộc pass:

- Lint
- Typecheck
- Unit
- Build
- DB reset
- Integration tests

# Staging gate

- Migration apply
- Smoke
- E2E critical flow
- RLS tests

# Production gate

- UAT sign-off
- Backup confirmed
- Migration reviewed
- Environment variables reviewed
- SePay production webhook reviewed
- Admin account verified

---

# 15. BACKUP & RECOVERY RUNBOOK

Trước release DB quan trọng:

- Tạo backup/snapshot theo khả năng platform.
- Hoặc dump theo quy trình đã duyệt.
- Ghi release tag và migration version.

Recovery cần biết:

1. Release nào đang chạy.
2. Migration cuối.
3. Backup gần nhất.
4. Có rollback app được không.
5. DB change backward compatible hay không.

Ưu tiên migration backward-compatible:

- Add column trước.
- Deploy code.
- Migrate data.
- Chỉ drop field ở release sau.

---

# 16. MONITORING

V1 tối thiểu:

## Application

- Frontend errors
- Failed API calls
- Build/deploy errors

## Database

- Function/RPC failures
- Slow query quan trọng
- Auth failures nếu bất thường

## Business alerts

- Negative inventory attempt
- Webhook invalid signature
- Duplicate payment attempt
- Failed delivery spike
- Reservation job failure

---

# 17. LOGGING RULE

Log:

- request correlation id
- user id khi phù hợp
- order id
- entity id
- error type

Không log:

- password
- secret
- full access token
- raw sensitive credential

Webhook log không lưu secret/auth header.

---

# 18. PRODUCTION ACCESS CONTROL

Tối thiểu:

- GitHub: chỉ người cần mới có write/admin.
- Vercel: hạn chế production env edit.
- Supabase Production: ít admin nhất có thể.
- SePay: account quản trị riêng.
- Không dùng chung password.
- Bật MFA ở các platform khi khả dụng.

---

# 19. DATA PREPARATION TRƯỚC GO-LIVE

## Master Data cần chuẩn bị

### Products

- SKU code
- Name
- Size
- List price
- Commission rule

### Locations

- Code
- Name
- Type
- Region
- Address

### Users

- Full name
- Role
- Location
- Default channel
- Default source

### Inventory

- Location
- SKU
- Batch
- NSX
- HSD
- Quantity

### Settings

- Reservation TTL
- Allocation lead days
- Deposit rule
- Expiry alert
- Forecast window
- Safety stock

---

# 20. INITIAL STOCK IMPORT PROCESS

1. Kho/cơ sở kiểm kê cutoff.
2. Điền template.
3. Admin validation.
4. Import staging thử.
5. Reconcile.
6. Freeze Excel source.
7. Import production.
8. Reconcile 100%.
9. Sau đó ngừng cập nhật Excel.

Template:

| Location Code | SKU | Batch | NSX | HSD | Qty |
|---|---|---|---|---|---:|

---

# 21. GO-LIVE CUTOVER

## T-3 ngày

- Freeze feature.
- Chỉ sửa blocker.
- UAT final.
- Master data final.

## T-1 ngày

- Production deploy code.
- Migration.
- Import master.
- Import opening stock.
- Verify users.
- Verify payment.
- Smoke test.

## Go-live

- Chuyển toàn bộ user sang app.
- Không tạo đơn mới qua Excel/Zalo.
- Một đầu mối support.
- Theo dõi dashboard/log.

## Sau Go-live

- Daily reconciliation:
  - Orders
  - Cash
  - Inventory
  - Deliveries
  - Production

---

# 22. SMOKE TEST PRODUCTION

Sau deploy, test bằng dữ liệu kiểm thử có kiểm soát:

1. Login Admin.
2. Login Sale.
3. Search product.
4. Create test customer.
5. Create small test order.
6. Check inventory reservation.
7. Test payment path nếu phù hợp.
8. Cancel/void test order.
9. Verify inventory restored.
10. Verify audit.
11. Verify report.
12. Verify print.

Dọn dữ liệu test theo soft-delete/void, không hard-delete transaction.

---

# 23. INCIDENT PRIORITY

## P0

- Không tạo được đơn.
- Tồn sai nghiêm trọng.
- Double payment.
- Unauthorized access.
- Production unavailable.

Xử lý ngay.

## P1

- Delivery calendar sai.
- Transfer không hoàn tất.
- Commission sai.
- Production forecast sai lớn.

## P2

- UI lỗi nhỏ.
- Export formatting.
- Filter bất tiện.

---

# 24. ROLLBACK STRATEGY

Frontend:

- Promote/redeploy previous stable Vercel deployment nếu cần.

Database:

Không dựa vào “rollback migration” tự động một cách mù quáng.

Ưu tiên:

- Forward fix.
- Backward-compatible migrations.
- Restore backup chỉ khi sự cố nghiêm trọng và có quyết định rõ.

---

# 25. DEFINITION OF READY — TRƯỚC KHI CODE FEATURE

Một task chỉ được code khi có:

1. User story.
2. Acceptance criteria.
3. Data dependency.
4. Permission rule.
5. State transition nếu có.
6. UI state.
7. Error cases.
8. Test cases chính.

---

# 26. DEFINITION OF DONE — MỖI TASK

Task chỉ Done khi:

1. Code hoàn tất.
2. Typecheck pass.
3. Lint pass.
4. Test pass.
5. Permission/RLS đúng.
6. Error state có.
7. Loading state có.
8. Audit nếu cần.
9. Không phá mobile.
10. PR review.
11. Staging verification.

---

# 27. RELEASE CHECKLIST

```text
[ ] CI green
[ ] Staging UAT green
[ ] RLS verified
[ ] Migration dry-run reviewed
[ ] Backup confirmed
[ ] Production env verified
[ ] SePay webhook verified
[ ] Admin account verified
[ ] Opening stock reconciled
[ ] Production deploy
[ ] Smoke test
[ ] Monitoring checked
```

---

# 28. TASK PRIORITY — MVP GO-LIVE

## P0 — Không thể go-live nếu thiếu

- Auth
- Roles/RLS
- Product/location/user master
- Customer
- Order
- Pricing/discount
- Inventory ledger
- Batch
- No-negative
- Reservation
- FEFO
- Payment/cọc
- Multi-delivery
- Delivery calendar
- Transfer
- Production basic
- Commission basic
- Audit
- Excel import/export
- Staging
- Production infra
- UAT

## P1 — Nên có trước cao điểm

- Advanced forecast
- Rich dashboards
- More analytics
- UX polish
- More printable forms
- Notification center

## P2 — Sau go-live nếu cần

- Advanced BI
- External shipping integration
- Marketing CRM
- Loyalty
- Multi-product business platform

---

# 29. KHUYẾN NGHỊ CHIA SPRINT

Không gắn số ngày cố định; dùng dependency và gate.

## Sprint A — Foundation

E00 + E01

## Sprint B — Sale Core

E02 + E03

## Sprint C — Inventory Core

E04 + E05

## Sprint D — Payment + Delivery

E06 + E07

## Sprint E — Transfer + Production

E08 + E09

## Sprint F — Return + Commission

E10 + E11

## Sprint G — Dashboard + Hardening

E12 + E13

## Sprint H — UAT + Go-live

E14

---

# 30. SOURCE NOTES CHO HẠ TẦNG

Hướng dẫn hạ tầng trong tài liệu bám theo tài liệu chính thức tại thời điểm lập kế hoạch:

- Supabase Local Development Workflow:  
  https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase CLI:  
  https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase Database Migrations:  
  https://supabase.com/docs/guides/local-development/database-migrations
- Supabase Seeding:  
  https://supabase.com/docs/guides/local-development/seeding-your-database
- Vercel Environment Variables:  
  https://vercel.com/docs/environment-variables/manage-across-environments
- Vercel Preview → Production Promotion:  
  https://vercel.com/docs/deployments/promote-preview-to-production
- SePay QR Payment Flow:  
  https://developer.sepay.vn/vi/sepay-webhooks/tao-qr-va-form-thanh-toan
- SePay Webhook Integration:  
  https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook
- SePay Webhook Authentication:  
  https://developer.sepay.vn/en/sepay-webhooks/xac-thuc
- SePay Test Mode:  
  https://developer.sepay.vn/vi/tien-ich-khac/test-mode/tao-webhook

---

# 31. HANDOFF CHO CODE AGENT

Prompt đầu phiên triển khai nên yêu cầu agent:

```text
Đọc theo thứ tự:
1. PRD_UIUX_v1.1.md
2. TECH_DESIGN_v1.0.md
3. IMPLEMENTATION_INFRA_PLAN_v1.0.md

Không tự thay đổi business rules.
Mỗi lần chỉ thực hiện một task ID.
Trước khi code: nêu file sẽ thay đổi.
Sau khi code: chạy lint, typecheck, test, build.
DB change bắt buộc qua migration.
Inventory/payment/order transition bắt buộc có test.
Không hard-delete transaction.
Không cho client update inventory balance trực tiếp.
```

Điều này giúp luồng vibe coding giữ đúng kiến trúc trong suốt dự án.

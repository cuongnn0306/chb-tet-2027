# Kế hoạch thứ tự tích hợp: 19/10/2026

Người lập: Claude (phiên tương tác), theo yêu cầu của chủ dự án "bắt đầu từ bước 1: lập kế hoạch thứ tự tích hợp".
**Đây là kế hoạch, chưa thực thi.** Chưa commit, push, merge, reset DB, đổi nhánh hay chạm worktree của agent khác. Mọi số liệu đo ngày 19/10/2026 bằng `git` trên repo `D:\Projects\chb-ban-hang` và các worktree dưới `C:\Users\HP\.codex\worktrees`; cách đo ở phụ lục.

## 1. Hiện trạng

- `develop` = `main` = `4de24e2`. 19 PR chồng (#1..#19) đều mở, chưa PR nào được merge. Chuỗi này **tuyến tính**: đầu của mỗi PR là tổ tiên của đầu PR kế tiếp (đã kiểm tra #1→#19). Đầu PR #19 là `2df547e`, cách `develop` 29 commit.
- Codex đã dựng nhánh tích hợp cục bộ **`codex/inf-013-local-integration`** (đầu `3b08771`, 30 commit trên `2df547e`, cách `develop` 59 commit, 526 file, +92 143 dòng). Nó gom: DEL-005 (cổng xuất kho theo đợt), RES-010, INF-002 (format CRLF), DEL-001, SEC-002, SEC-003, SEC-005, INF-008 (types race), COM-001 (checkpoint), COM-002, SEC-001, TRF-002, ORD-014, SEC-004.
- Báo cáo INF-013 (18/10): pipeline, lint, typecheck, unit, build, format, env **đạt**; `db reset`, pgTAP, integration **`not_run`** vì Docker lúc đó tắt. Nghĩa là **cây gộp này chưa từng chạy DB**. Hôm nay Docker Desktop cũng chưa chạy (đường ống engine `dockerDesktopLinuxEngine` không tồn tại), nên chưa thể chạy DB.
- Cây gốc `feature/integration-e07-e08-20261004` vẫn ở `2df547e`, có 16 file chưa commit + 83 tài liệu review chưa commit. Đa số đã có bản giống hệt trong INF-013 (xem §3).
- Không nhánh `codex/*` hay `feature/*` mới nào đã được push; GitHub không đổi từ 05/10.

## 2. Bản đồ các lane

| Nhóm                                                                       | Lane                                                                                                                                                                       | Trạng thái                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A. Đã nằm trong INF-013**                                                | DEL-005, RES-010, INF-002, DEL-001, SEC-002, SEC-003, SEC-005, INF-008 types race, COM-001, COM-002, SEC-001, TRF-002, ORD-014, SEC-004                                    | Đã commit; DB chưa chạy trên cây gộp              |
| **B. Đã commit trên nhánh riêng, chưa vào INF-013**                        | RPT-001 (+2), SEC-010 (+2), SEC-008 (+1), INF-006 (+1), INV-009 (+3), INV-007 (+3), INV-006 (+1), INF-008 orchestration (+3)                                               | Mỗi lane chỉ 2..17 file, gần như không chồng lấn  |
| **C. Chỉ tồn tại dưới dạng file chưa commit (duy nhất)**                   | PRD-002 (cây gốc), PRD-001, RET-001, RPT-012 (3 worktree `claude-*`, báo cáo 06/10: lint, typecheck, unit, build và DB đạt; `format` đỏ do CRLF)                           | **Rủi ro mất công**: không có ở bất kỳ commit nào |
| **D. Chỉ tồn tại dưới dạng file chưa commit, của Codex, nền cũ `9548886`** | `codex-cus-006` (65 file: scoping tài khoản/cache cho MD, CUS, ORD, DEL, INV, PAY), `codex-sec-008` (27 file: AUTH-002 hồ sơ mặc định, biến thể SEC-001, tài liệu SEC-010) | Cần Codex phân loại (xem §6)                      |
| **E. Snapshot cũ, đã bị thay thế**                                         | `inf008-integration` (234/242 file giống hệt `2df547e`), `parallel-coordinator`, `claude-sec-004` (193..197 file giống hệt), và các worktree `*-committed-base`            | Có thể lưu trữ rồi dọn, **chỉ khi anh đồng ý**    |

Các worktree `*-committed-base`, `del001-committed-base`, `res010-integration`, `sec-002-audit-stack`: nội dung chưa commit của chúng **giống hệt** bản trong INF-013 (kiểm tra theo blob), chỉ còn ExecPlan riêng của từng worktree.

## 3. Điểm trùng, xung đột và rủi ro đã đo

| #   | Phát hiện                                                                                                                                                                                                                                                                                                                                            | Hệ quả cho kế hoạch                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Migration và test chưa commit ở cây gốc (`…164000` DEL-001, `…165000` SEC-002, `deliveries.test.ts`) **giống hệt** bản trong INF-013. `rls_catalog.test.sql` ở INF-013 là bản **cải tiến** (đếm distinct schema/tên hàm, tránh overload che thiếu hàm).                                                                                              | Bỏ bản chưa commit ở cây gốc, giữ INF-013. Không mất gì.                                                                                  |
| 2   | 3 file spec đã sửa ở cây gốc (PRD, TECH_DESIGN, PLAN) = commit `24ea9c0` "docs: record owner-approved campaign rules" đã nằm trong INF-013.                                                                                                                                                                                                          | Cũng bỏ được, không mất gì.                                                                                                               |
| 3   | Thứ tự migration trong INF-013 sạch: với mọi hàm bị định nghĩa lại, bản **sau cùng** thuộc đúng lane đáng thắng (vd. `transfer_sources` ← RES-010, `deliveries_guard` ← DEL-001, `assert_delivery_stock` ← DEL-005, 3 hàm commission ← COM-002).                                                                                                     | Không cần đổi timestamp migration.                                                                                                        |
| 4   | PRD-001 (`…20261006044000`) chỉ thêm 1 hàm; RET-001 (`…20261006052000`) thêm 2 bảng, 5 hàm. Cả hai **không định nghĩa lại** hàm nào đã có và không `alter` bảng cũ. Chúng xếp chen giữa `…20261005165000` và `…20261011075531`, dù thêm sau cũng không ghi đè gì.                                                                                    | Có thể thêm sau INF-013 mà không viết lại migration.                                                                                      |
| 5   | `src/types/database.generated.ts`: INF-013 đã sửa (+86 dòng); PRD-001 và RET-001 mỗi bên cũng sửa file này.                                                                                                                                                                                                                                          | **Không merge tay.** Sau khi áp cả hai migration, sinh lại bằng pipeline (`task:finish --generate-types`).                                |
| 6   | `docs/handoff/tasks.json` và `STATUS.md` bị mọi lane ghi lại.                                                                                                                                                                                                                                                                                        | Dùng đúng quy tắc hợp ngữ nghĩa của INF-013 (giữ nguyên mọi bản ghi, không nâng cấp trạng thái); báo cáo là file bất biến nên không đụng. |
| 7   | `package.json`: INV-006 thêm `read-excel-file` (đọc), RPT-012 thêm `@excel.js/exceljs` (ghi), INF-008 orchestration thêm 2 script, SEC-004 đã thêm `check:secrets`. Không trùng thư viện; các dòng khác nhau nên xung đột văn bản (nếu có) là tầm thường. `package-lock.json` phải sinh lại bằng `npm install` đúng một lần ở cuối, không merge tay. | Gộp `package-lock.json` sau cùng.                                                                                                         |
| 8   | **Hai cài đặt SEC-001 cạnh tranh:** bản đã commit (`feature/SEC-001-audit-viewer`, trong INF-013) và bản chưa commit ở `codex-sec-008` (`AuditLogPage.tsx`, `audit.service.ts` khác nhau, cùng sửa `AppLayout/router/routes`).                                                                                                                       | Giữ bản trong INF-013 (đã commit, có review). Bản kia chỉ để tham khảo, cần Codex xác nhận bỏ.                                            |
| 9   | `codex-cus-006` có 5 file trùng với INF-013 (`OrderDetailPage.tsx`, `OrderPrintPage.tsx`, `PaymentReviewPage.tsx`, `package.json`, test pipeline) trên nền cũ `9548886`.                                                                                                                                                                             | Phải rebase từng lane lên đầu tích hợp, **không merge cả khối**.                                                                          |
| 10  | INF-008 orchestration thêm `.github/workflows/ai-scheduler.yml` chạy `cron` mỗi 2 giờ (chỉ lập kế hoạch và mô phỏng, quyền `contents: read`; job `recover` bị chặn bởi biến `AI_ORCHESTRATION_ENABLED`). Probe CLI ngày 12/10 báo HTTP 403 `oauth_not_allowed_for_organization`.                                                                     | Tích hợp cuối cùng, giữ tắt; không bật biến nào khi chưa có Owner.                                                                        |
| 11  | DB dùng chung: mọi worktree dùng **một** container Supabase. Lần rà soát trước, DB thiếu `…165000` vì worktree khác đã reset.                                                                                                                                                                                                                        | Chỉ `db reset` từ worktree tích hợp, qua `task:finish` với lease; không chạy song song.                                                   |
| 12  | Sau tích hợp, báo cáo riêng của từng task có băm mã nguồn của cây cũ, nên `task:verify` sẽ không khớp từng task (đã nêu ở đề xuất phương án B 05/10). Báo cáo tích hợp của chính cây cuối thì khớp, nhưng vẫn `needs_validation` vì nghiệm thu ngoài (staging, mobile, review) chưa có.                                                              | PR cuối vẫn có thể đỏ ở `task:verify`; đã được anh chấp nhận ở PR #19. Phương án B vẫn là việc riêng của Owner.                           |

## 4. Thứ tự tích hợp đề xuất

Nguyên tắc: **mỗi bước một nhánh, một cổng, một báo cáo**. Chỉ lên bước sau khi bước trước đạt. Không squash, không viết lại lịch sử có sẵn. Mỗi lần merge phải chạy `git diff --check` trước khi commit merge.

Cây làm việc tích hợp mới (đề xuất): `D:\Projects\chb-integration`, nhánh `integration/wave-2` rẽ từ `codex/inf-013-local-integration` (không động vào nhánh Codex).

### Bước 0: Tiền đề (không đổi mã)

1. **Bật Docker Desktop** và Supabase local; kiểm tra `docker ps` thấy container `supabase_db_chb-ban-hang` healthy.
2. **Chụp an toàn** mọi file chưa commit duy nhất (nhóm C, D và các ExecPlan riêng) thành ref lưu trữ `refs/archive/2026-10-19/<lane>`, dùng index tạm (`GIT_INDEX_FILE`) nên **không đụng index hay file của worktree gốc**. Không push. Đây là lưới an toàn duy nhất cho PRD-001, RET-001, RPT-012, PRD-002 và công việc của `codex-cus-006`.
3. **Thông báo Codex/điều phối** tạm dừng giao việc ghi vào `tasks.json` trong lúc tích hợp (heartbeat 20 phút). Nếu điều phối vẫn bị khóa quyền (403), việc này không cần làm.

Cổng: ref lưu trữ tồn tại và tổng số file khớp danh sách ở §2.

### Bước 1: Xác minh DB cho INF-013 nguyên trạng (cổng quan trọng nhất)

Chạy `task:start`/`task:finish` (attempt mới của INF-013, hoặc ID mới nếu anh muốn tách) **trên chính đầu `3b08771`**, có `CHB_DB_LOCK_PATH`: `db reset`, pgTAP, integration. Đây là lần đầu 14 lane chạy cùng nhau trên DB.

- Đạt: ghi số liệu thực (số assertion pgTAP, số test integration), làm đường cơ sở cho các bước sau.
- Không đạt: **dừng**, sửa trong lane gây ra (hoặc phiếu riêng), chưa thêm gì.

### Bước 2: Đợt 2a, lane chỉ tài liệu hoặc test (rủi ro thấp)

| Thứ tự | Lane                       | Chạm                                                                                          | Cổng                                                       |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2.1    | RPT-001 (KPI glossary)     | `docs/runbooks/KPI_DEFINITIONS.md`, ExecPlan                                                  | `git diff --check`, prettier                               |
| 2.2    | SEC-010 (backup/restore)   | `docs/runbooks/BACKUP_RESTORE.md`, ExecPlan (có 2 ExecPlan trùng chủ đề, giữ cả hai, ghi chú) | như trên                                                   |
| 2.3    | SEC-008 (idempotency test) | `tests/integration/webhook-idempotency.test.ts`                                               | DB: integration                                            |
| 2.4    | INF-006 (seed mẫu + pgTAP) | `supabase/seed.sql`, `supabase/tests/seed_samples.test.sql`                                   | **DB đủ bộ**: seed là dữ liệu mọi test dùng, có thể làm vỡ |

2.4 đứng riêng một bước DB vì đổi `seed.sql` có thể đụng khoá duy nhất hoặc giả định của test khác.

### Bước 3: Đợt 2b, giao diện kho (không migration)

Thứ tự INV-009 → INV-007 → INV-006. Mỗi lane sửa một trang riêng (`MovementHistoryPage`, `InventorySummaryPage`, `ImportOpeningStockPage`), 0 file trùng. INV-006 thêm `read-excel-file` nên đứng cuối. INV-007 kèm 2 ảnh bằng chứng (57 KB). Cổng: typecheck, lint, unit, build (không cần DB).

### Bước 4: Đợt 3, các lane chỉ-có-file-chưa-commit (cần commit trước)

Với mỗi lane: tạo nhánh từ `2df547e`, commit từ ref lưu trữ ở Bước 0 (giữ nguyên báo cáo ngày 06/10), rồi merge vào `integration/wave-2`.

| Thứ tự | Lane                               | Ghi chú                                                                          |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| 4.1    | PRD-002 (hàm thuần tính nhu cầu)   | Không migration, không phụ thuộc. Cần thêm một lượt DB-check nếu anh muốn đủ bộ. |
| 4.2    | RPT-012 (xuất Excel)               | Thêm `@excel.js/exceljs`; `src/lib` mới, không đụng gì                           |
| 4.3    | PRD-001 và RET-001 (cùng một cổng) | 2 migration độc lập (§3.4). Áp cả hai, **sinh lại generated types một lần**.     |

Cổng sau 4.3: `db reset`, pgTAP, integration (toàn bộ), kiểm tra `database.generated.ts` được sinh bởi pipeline, `package-lock.json` sinh bằng `npm install` đúng một lần.

### Bước 5: Đợt 4, INF-008 orchestration (cuối cùng, giữ tắt)

3 commit: workflow, `automation/*`, `scripts/orchestrator/*`. Chỉ merge khi: Owner bật quyền Claude Code cho tổ chức (403), quyết định chạy self-hosted runner hay không, và **không đặt** biến `AI_ORCHESTRATION_ENABLED`. Sau khi merge vào nhánh mặc định, `cron` chỉ chạy `plan`/`simulate` (chỉ đọc). Có thể tách thành PR riêng để Owner duyệt riêng.

### Bước 6: Phân loại không chặn tiến độ (Codex làm, có thể song song với bước 2..5)

1. `codex-cus-006` (65 file, nền `9548886`): tách theo task (MD-001..007, CUS-002/006, ORD-006/011/012, DEL-007/010/014, PAY-002, AUTH-003, và phần còn lại của INV-008); rebase từng lane lên `integration/wave-2`; **5 file trùng ở §3.9 là điểm rebase**. Bước này là khối lượng lớn nhất còn lại.
2. `codex-sec-008`: AUTH-002 hồ sơ mặc định (mới), tài liệu SEC-010 (trùng), biến thể SEC-001 (bỏ, §3.8).
3. Dọn worktree snapshot (nhóm E) **chỉ khi** đã lưu trữ và anh đồng ý. Không xoá worktree nào trong kế hoạch này.

## 5. Chiến lược GitHub (cần anh quyết định, không làm gì trước đó)

Vì chuỗi 19 PR tuyến tính và INF-013 là hậu duệ của đầu #19, có ba cách đi vào `develop`:

| Phương án                                                         | Cách làm                                                                                                                                                  | Ưu                                                                          | Nhược                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **P1** (khuyến nghị): một PR từ nhánh tích hợp cuối vào `develop` | Đẩy `integration/wave-2`, mở PR vào `develop`, đóng #1..#19 bằng bình luận trỏ về PR mới sau khi anh duyệt. Lịch sử từng commit vẫn xem được theo commit. | 1 lần CI trên cây cuối; không phụ thuộc thứ tự merge; đúng "PR vào develop" | Diff rất lớn (~500 file); mất cuộc review theo từng epic của #2..#18 (đa số chưa ai review ngoài CI)                          |
| **P2**: merge tuần tự #1→#19, rồi PR bổ sung cho các lane mới     | GitHub tự đổi nền khi PR dưới đã merge                                                                                                                    | Giữ ranh giới theo epic                                                     | 19 lần merge, mỗi lần CI; #19 đỏ ở `task:verify` (phải chấp nhận hoặc làm phương án B trước); các lane mới vẫn cần một PR nữa |
| **P3**: `develop` tua nhanh (fast-forward) lên đầu tích hợp       | Đẩy thẳng `develop`                                                                                                                                       | Nhanh nhất                                                                  | **Ghi thẳng vào `develop`**, trái quy tắc "không ghi trực tiếp develop/main"; không khuyến nghị                               |

Em khuyến nghị **P1 sau Bước 4**, rồi PR riêng cho Bước 5. Không phương án nào đụng `main`.

## 6. Điều anh cần quyết định

1. Chọn P1/P2/P3 (và có đóng #1..#19 hay giữ).
2. ID tác vụ cho các đợt tích hợp: tiếp tục INF-013 (attempt mới) hay thêm `INF-014`.. vào kế hoạch triển khai (mỗi attempt cần ID chuẩn trong `IMPLEMENTATION_INFRA_PLAN`).
3. Cho phép tạo ref lưu trữ (Bước 0.2) và nhánh/worktree tích hợp mới.
4. Ai làm Bước 6 (điều phối hiện không giao được việc cho Claude CLI vì chính sách tổ chức chặn, HTTP 403; nếu Codex không tiếp tục, em có thể lập danh sách chi tiết từng file của `codex-cus-006` để phân loại).
5. Owner bật quyền Claude Code cho tổ chức, và có cho INF-008 orchestration vào nhánh mặc định hay không.

## 7. Không thuộc phạm vi

Không merge vào `main`, không triển khai staging/production, không đổi cấu hình tài khoản, không thay đổi nghiệp vụ, không nâng trạng thái nào lên Done. Nghiệm thu ngoài (staging, mobile, SePay Test Mode, review độc lập, Owner) vẫn chưa có và không được kế hoạch này thay thế.

## Phụ lục: cách đo

- Quan hệ tổ tiên: `git merge-base --is-ancestor`; số commit: `git rev-list --count`.
- Lane nằm ngoài INF-013: nhánh có commit không thuộc `INF-013..<nhánh>`; xung đột tiềm năng: giao của `git diff --name-only <merge-base> <tip>` với tập đường dẫn INF-013 đã đổi so với `2df547e` (loại `tasks.json`, `STATUS.md`, báo cáo).
- File chưa commit: `git status --porcelain --untracked-files=all` ở từng worktree; so khớp bằng `git hash-object --path` với blob tại `2df547e` và `codex/inf-013-local-integration`; có chuẩn hoá CRLF khi so nội dung.
- Thứ tự migration: gom `create [or replace] function` theo từng tệp migration trong cây INF-013, so với hàm do PRD-001 và RET-001 định nghĩa.

## 8. Nhật ký thực thi

### Bước 0: đã thực hiện 19/10/2026 (anh duyệt)

- **0.1 Docker:** engine 29.6.2 chạy; container `supabase_db_chb-ban-hang` healthy; không có lease DB; trạng thái điều phối không đổi từ 18/10 (không có worker hoạt động). `supabase_vector` đang khởi động lại liên tục, vốn có từ trước và không ảnh hưởng DB.
- **0.2 Chụp an toàn:** tạo **19 ref** `refs/archive/2026-10-19/<lane>`, mỗi ref là một commit (cha = HEAD của worktree) chứa toàn bộ thay đổi và file chưa commit. Dùng index tạm nên **không đụng index, HEAD hay file của worktree nào** (đã so băm HEAD, index và danh sách trạng thái trước/sau: giống hệt ở cả 19 lane). Mỗi file sống đều được so băm với blob đã lưu: 0 lệch. 21 worktree sạch không cần ref (HEAD của chúng đều nằm trong một nhánh).
- Các file duy nhất đã có trong ref: PRD-001 (6), RET-001 (5), RPT-012 (3), PRD-002 và `OWNER_DECISIONS` (cây gốc), `codex-cus-006` (121 mục, gồm `query-scope.ts`), `codex-sec-008` (AUTH-002, biến thể SEC-001), `claude-coordinator.mjs` và worker (parallel-coordinator).
- Quét mẫu bí mật trên file khác với cha: chỉ 2 kết quả, đều là chuỗi giả `your-api-key-placeholder-value` trong test của bộ quét bí mật. `git fsck --connectivity-only` sạch. Không push; ref nằm ngoài `refs/heads` nên không bị đẩy kèm khi `push` thông thường.
- **0.3 Thông báo điều phối:** chưa có kênh tự động; anh báo Codex tạm dừng ghi `tasks.json` nếu điều phối chạy lại.

Khôi phục một lane: `git worktree add <thư-mục> refs/archive/2026-10-19/<lane>` hoặc `git show refs/archive/2026-10-19/<lane>:<đường-dẫn>`. Xoá ref sau khi tích hợp xong: `git update-ref -d refs/archive/2026-10-19/<lane>` (chỉ khi anh đồng ý).

### Bước 1 đến 5: đã thực hiện 19/10/2026 (anh giao toàn quyền thực thi, không push)

Bước 1 (DB cho INF-013) do Codex chạy trước em: báo cáo `INF-013-2026-10-19T04-39-22-754Z`, pgTAP 533 assertion, integration 372 test, đạt. Em dùng nó làm nền. ID tác vụ: **INF-014** (thêm vào kế hoạch triển khai, ExecPlan `docs/exec-plans/active/INF-014-local-integration-wave-2.md`). Worktree `D:\Projects\chb-integration`, nhánh **`integration/wave-2`** (đầu `0b36e5f`, 32 commit trên INF-013, 92 commit trên `develop`, +19 138 / −24 dòng so với INF-013). Chưa push, chưa mở PR.

| Đợt | Nội dung                                                                                                                                                                              | Kết quả                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Merge RPT-001, SEC-010, SEC-008, INF-006, INV-009, INV-007, INV-006 (`--no-ff`, giữ commit và báo cáo của từng lane)                                                                  | Báo cáo `INF-014-2026-10-19T05-41-05-268Z`: pipeline, lint, typecheck, unit, build, format, env, db reset, pgTAP (545), integration (375 lúc chạy thử) đạt |
| B   | Phục hồi từ `refs/archive/*`: PRD-002 (từng file), RPT-012, PRD-001, RET-001 (merge từ commit lưu trữ); `package-lock.json` sinh lại từ `package.json`; types sinh lại sau `db reset` | Báo cáo `INF-014-2026-10-19T05-56-11-001Z` (`--generate-types`): mọi check đạt, unit 582, pgTAP 545, integration 29 file                                   |
| C   | Lane INF-008 orchestration                                                                                                                                                            | **Tách sang nhánh riêng `integration/wave-2-orchestration` (`d95c68f`), chưa xác minh đủ**, xem dưới                                                       |

Registry cuối cùng: 36 bản ghi (25 lúc bắt đầu), 0 bản ghi bị đổi hoặc mất ở Đợt A và B; mọi lane giữ trạng thái `needs_validation` riêng. Xung đột chỉ nằm ở `tasks.json`, `STATUS.md` (và `package-lock.json` cho RPT-012), đều giải bằng hợp theo ID, giữ thứ tự của nhánh gốc.

**Ba lỗi liên-lane mà từng lane riêng lẻ không thấy** (đều là điểm yếu của test, không phải lỗi sản phẩm):

1. **INV-006** (`opening-stock-xlsx.test.ts`): `tsc -b` đỏ vì kiểu `Blob` của DOM không khớp kiểu mà `read-excel-file/node` yêu cầu. Chỉ lộ khi test SEC-004 (import `node:*`) kéo `@types/node` vào project có `lib: DOM`. Đã bisect đến đúng merge SEC-004 của INF-013. Sửa trong test: dùng `Blob` của `node:buffer` (commit `a9171c6`).
2. **SEC-001** (`audit-viewer.test.ts`): so thứ tự audit theo mili-giây trong khi Postgres sắp xếp theo micro-giây. Test integration RET-001 tạo hai cửa hàng cách nhau 70 µs cùng một mili-giây nên test SEC-001 đỏ 6/6 lần. Sửa so sánh theo micro-giây, không đổi `ORDER BY` (commit `b151d82`), kiểm chứng trên DB đang giữ cặp dòng gây lỗi: 17/17.
3. **INF-008 orchestration**: 1 trong 33 test (`native model wrapper ...`) cần `pwsh` (PowerShell 7), máy này chỉ có Windows PowerShell 5.1. Lane tự báo `pipeline 95/95` trên môi trường của Codex nên không tái hiện được ở đây. Vì vậy em không đưa nó vào nhánh chính: nhánh `integration/wave-2` không có lane này và có pipeline xanh. Cấu hình mặc định của lane: `enabled=false`, `allowPublish=false`, `allowMergeDevelop=false`; workflow `ai-scheduler.yml` có `cron` mỗi 2 giờ chỉ chạy `plan`/`simulate` (chỉ đọc) và job `recover` bị chặn bởi `AI_ORCHESTRATION_ENABLED`. Cần quyết định của Owner (quyền Claude Code cho tổ chức, `pwsh`, runner) trước khi dùng.

Chưa làm: Bước 6 (phân loại `codex-cus-006`, `codex-sec-008`), dọn worktree snapshot, CI trên đầu mới, review độc lập, mobile, staging, nghiệm thu Owner. Các ref `refs/archive/2026-10-19/*` được giữ nguyên.

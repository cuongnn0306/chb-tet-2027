# Quy trình báo cáo chung Codex / Claude

Ngày thiết lập: 02/10/2026. Task pipeline thuộc INF-008; không thay đổi business rules.

## Đọc đầu phiên

Đọc AGENTS.md và ba specification theo thứ tự quy định; sau đó đọc
[PROJECT_PROGRESS.md](PROJECT_PROGRESS.md), [STATUS.md](STATUS.md), báo cáo mới nhất
của task và ExecPlan liên quan. [Audit](../reviews/2026-10-02-project-review.md)
là snapshot tại HEAD 9548886, không phải tiến độ tự cập nhật mãi mãi.

`backlog.json` / PROJECT_PROGRESS là baseline kiểm kê trước pipeline.
`tasks.json`, STATUS và `reports/` là các lần thực hiện kể từ khi pipeline được tạo.
Khi hai nguồn khác nhau, kiểm tra code, báo cáo mới nhất và evidence; không tự nâng trạng thái.

## Một task mỗi lần

Ví dụ dùng được trong PowerShell, Git Bash và CI:

```bash
npm run task:start -- SEC-007 claude "Sửa SePay HMAC theo timestamp và raw body"
```

Sau đó kiểm tra dependencies, nêu phạm vi/file/test, cập nhật ExecPlan, triển khai,
và điền `tmp/SEC-007-summary.json` theo [summary.example.json](summary.example.json).
Đừng đánh acceptance là `met` nếu chưa có bằng chứng. `database` ghi `none` nếu không đổi DB.

```bash
npm run task:finish -- SEC-007 tmp/SEC-007-summary.json
npm run task:status
npm run task:verify
```

`task:finish` thực sự chạy pipeline tests, lint, typecheck, unit, build, format,
env check, **DB reset local**, pgTAP và integration. DB reset sẽ xóa dữ liệu local:
chỉ chạy trên bộ test local có thể dựng lại; giữ dữ liệu local cần thiết trước khi chạy.
Không có `--linked`, không gọi staging/production. Integration đã có guard localhost.
Nếu reset fail, pgTAP/integration được ghi `not_run` vì DB chưa xác minh.
Runner dùng Node/npm CLI trực tiếp, không ghép shell command từ task title hay summary.

Mỗi lần kết thúc tạo:

- `docs/handoff/reports/<TASK-ID>-<UTC timestamp>.md`: báo cáo cho người đọc.
- File `.json` cùng tên: exit code, command, thời gian, SHA-256 source và acceptance.
- `docs/handoff/tasks.json`: trạng thái mới nhất của mỗi task.
- `docs/handoff/STATUS.md`: bảng tiến độ sinh tự động.
- `tmp/task-logs/<run-id>/`: log đã che credential thường gặp, bị gitignore.

Không ghi secret/dữ liệu khách thật vào summary; redaction không thay thế secret scan SEC-004.
Các file có trước lúc start được ghi riêng để không quy tác giả cho agent hiện tại.
Task đang `in_progress` ngăn start task thứ hai. Sau attempt fail, có thể start lại cùng ID.
Không sửa/xóa báo cáo cũ; mỗi retry tạo một báo cáo mới. Không mở task tiếp theo khi còn blocker
liên quan đến dependency; `nextTasks` phải phản ánh điều đó.

## Ý nghĩa trạng thái

| Trạng thái         | Ý nghĩa                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `in_progress`      | Agent đang thực hiện một task                                                               |
| `needs_validation` | Có check fail/not_run hoặc acceptance unmet/not_verified; không được gọi Done               |
| `validated_local`  | Tất cả check local và acceptance khai báo đã đạt; vẫn cần review/mobile/staging theo AGENTS |

Pipeline không tự tạo trạng thái Done. Review, mobile, staging là evidence do agent/người kiểm
tra ghi rõ, không được suy ra từ lint/build. Đạt local không tự cho phép merge hoặc deploy.

## Commit và CI

Commit code cùng MD + JSON report, tasks.json, STATUS.md và ExecPlan của task.
Nếu sửa code sau finish, chạy lại start/finish để evidence khớp phiên bản.
Fingerprint chuẩn hóa CRLF/LF cho source text giữa Windows và Linux; binary giữ nguyên bytes.

PR CI chạy `task:verify <base SHA>`: PR có thay đổi ngoài `docs/` phải có report mới
`validated_local` khớp source tree hiện tại và không còn task in_progress. Check này
không yêu cầu dữ liệu lịch sử cũ đạt lại và không coi một report fail là pass.
CI vẫn chạy checks app/DB độc lập; report do agent sinh không phải chữ ký bảo mật.
Reports được upload thành artifact `shared-task-reports` để xem trong GitHub Actions.

```bash
npm run task:verify -- origin/develop
```

Không có base argument chỉ kiểm tra cấu trúc/nhất quán report, không chứng nhận source freshness.
Workflow chưa chạy trên GitHub trong phiên thiết lập này; cần commit/push/PR theo quy trình repository.

## Bàn giao khi bị chặn

Vẫn điền summary và chạy finish để lưu báo cáo `needs_validation` (lệnh trả exit 1 có chủ đích).
Ghi chính xác check không chạy, blocker, bước cần làm để retry, task liên quan và giới hạn evidence.
Không đánh dấu feature chưa kiểm chứng là hoàn tất, không tự vượt quyền staging/production.
Hai agent đọc file trong cùng repository. Vòng điều phối tự động được mô tả ở
[AUTOMATION.md](AUTOMATION.md): heartbeat Codex review report rồi gửi prompt qua
Claude CLI. Đây là session CLI riêng, không gửi vào chat Claude Desktop hiện có.
Xem [AUTOMATION_STATE.json](AUTOMATION_STATE.json) để biết blocker xác thực và task
được giao; trạng thái điều phối không thay thế trạng thái/evidence của task pipeline.

## Optional local generated database types

Use `npm run task:finish -- <TASK-ID> <summary-json-path> --generate-types` only for schema tasks needing fresh types. It generates from the LOCAL stack after a passing reset while task:finish owns CHB_DB_LOCK_PATH. Blocked/reset-failed/unknown-lifetime/no-lease generation is not_run. Invalid CLI output preserves previous bytes. Changed types trigger lint/typecheck/tests/build/format again after lease release; final fingerprints cover the new types. Default finish does not generate types.

`--generate-types` needs the project's dev dependencies: `scripts/db-types.mjs` imports `typescript` (a devDependency) at runtime to validate the CLI output. Install with `npm ci` / `npm install` without `--omit=dev` or `NODE_ENV=production`; without it the pipeline fails to load. Default `task:finish` does not load it.

A timed-out, killed or errored generator leaves the descendant lifetime uncertain, exactly like a timed-out reset/pgTAP/integration command: pgTAP and integration become `not_run` and the lease is retained (`db lease retained`, fail) until a reviewer proves every descendant stopped. The post-generation fingerprint of the types file must equal the SHA-256 of the LF-normalized bytes the pipeline installed; any other content is reported as `source stability`.

When the pipeline owns the shared lease (`CHB_DB_LOCK_PATH` set) the report carries machine-readable rows: `db lease` (`owned pid=<pid> token=<first 8 hex of sha256(token)> at <createdAt>`) and, after a normal release, `db lease release` (`released ...`). The full token is never written. A retained, foreign or unset lease produces no `released` row, and without `CHB_DB_LOCK_PATH` no ownership is claimed.

On Windows PowerShell use `npm.cmd run task:finish -- <TASK-ID> <summary-json-path> --generate-types` to preserve option forwarding. Verify the printed child command includes `--generate-types`; an npm unknown-cli-config warning indicates the option did not reach the pipeline.

# Điều phối khi Claude Code hết usage

Người dùng cho phép ngày 03/10/2026: khi Claude hết usage, Codex tiếp tục các
task độc lập; khi quota trở lại, Codex tiếp tục điều phối Claude. Đây là phần
mở rộng của AUTOMATION.md và PARALLEL_WORKFLOW.md, không thay đổi business rules,
pipeline báo cáo hoặc quyền merge/deploy.

## Khi Claude bị giới hạn

1. Xác minh lỗi quota từ kết quả CLI; lỗi auth, TLS, permission hay Docker không
   được coi là hết usage. Đọc controller state và từng dispatch thực tế.
2. Giữ nguyên task ID, workspace, code dở, session ID, attempt và write scopes
   của mọi lane Claude chưa được review/giải phóng. Task đang chờ quota vẫn
   thuộc Claude; Codex không tiếp quản, sửa hoặc đánh dấu hoàn tất task đó.
3. Ghi thời điểm reset do provider báo, timezone, thời điểm được retry có buffer
   và evidence. Không thử lại trước quota.nextEligibleAttemptAt. Nếu thiếu giờ
   reset, ghi rõ chưa biết và dùng backoff có thời điểm retry cụ thể; không đoán
   rằng quota đã trở lại.
4. Trong thời gian chờ, Codex chọn một task canonical độc lập, đủ dependency,
   theo ưu tiên specs/backlog và báo cáo mới nhất. Khác task ID chưa đủ: phải
   không cần kết quả dở của Claude, không chạm write scopes, hợp đồng service,
   schema/migration hoặc cấu hình dùng chung mà Claude đang sửa. Ghi lý do độc
   lập và danh sách file trước khi code. Không có task an toàn thì ghi blocker.

## Quyền sở hữu và workspace

- Codex làm task dự phòng trong worktree riêng, với registry/report và npm riêng;
  không dùng lại một workspace đang được Claude giữ dù process đã dừng vì quota.
  Bảo toàn baseline và mọi thay đổi chưa commit; không sao chép code dở của Claude.
- Trước task:start, ghi quotaFallback.activeTask gồm taskId, workspace,
  writeScopes, dependencyEvidence, startedAt và status trong AUTOMATION_STATE.json.
  Đọc lại state trước dispatch; nếu quyền sở hữu chưa rõ thì không ghi/dispatch.
- Một task/attempt mỗi workspace; cả Codex và Claude tuân thủ task:start/finish,
  ExecPlan và acceptance evidence. Báo cáo lịch sử bất biến, needs_validation
  không phải Done. Không sửa tay STATUS/tasks để giải phóng task của Claude.
- Tổng cộng tối đa hai worker triển khai, tính cả Codex và Claude. Codex dự phòng
  chiếm một slot; heartbeat không mở worker Codex thứ hai cho cùng task.
- DB dùng CHB_DB_LOCK_PATH chung theo PARALLEL_WORKFLOW. Chỉ task:finish sở hữu
  lease mới chạy reset/pgTAP/integration; không reset trực tiếp hoặc mượn lock.
  Giữ nguyên blocker Docker và ghi check not_run khi chưa phục hồi được.

## Khi đến thời điểm reset

1. Mỗi heartbeat kiểm tra quota trước khi nhận thêm task Codex. Đến thời điểm
   được retry, dùng runner release đã review, xác minh lifetime/process và
   resume đúng session của lane usage_limited; không dùng legacy activeDispatch
   hoặc quota.resumeSessionId cũ khi parallel mode đã có session từng lane.
2. Không coi đồng hồ qua giờ reset là xác nhận có quota. Kết quả resume thực tế
   phải không còn usage limit; nếu vẫn bị giới hạn, cập nhật backoff và Codex
   tiếp tục task độc lập. Không mua credits hoặc đổi account/model/provider.
3. Nếu Codex đang có task dự phòng, giữ quyền sở hữu task đó đến khi finish và
   review/handoff an toàn. Claude được resume một lane chỉ khi đủ slot, workspace
   và scopes không xung đột; nếu không thì chờ Codex finish. Không bỏ dở hoặc
   giao cùng task cho Claude chỉ vì quota trở lại.
4. Sau kết quả resume xác nhận quota khả dụng, chuyển quotaFallback.mode về
   coordinating. Codex tiếp tục review report/diff/evidence rồi giao Claude
   từng task đủ dependency. Chỉ giải phóng reservation khi đã review/handoff.
5. Không tự tích hợp nhánh. Chuẩn bị diff có kiểm tra baseline sau review và
   chạy pipeline mới trên source tích hợp theo quy trình hiện hành.

## Heartbeat và thông báo

Heartbeat hiện có kiểm tra mỗi 10 phút khi máy/app hoạt động. Cập nhật chính
automation đó, không tạo vòng điều phối trùng. quotaFallback là chính sách và
quyền sở hữu task Codex; executor hiện có không bị đổi chỉ vì Claude đang cooldown.
Lệnh dừng Claude rõ ràng của người dùng vẫn ưu tiên hơn resume tự động.

`waiting_quota` chỉ chặn việc gọi Claude, không chặn Codex triển khai. Khi không
có task Codex đang được giữ, heartbeat phải thực sự nhận và thực hiện task độc
lập, hoặc lưu blocker cụ thể giải thích vì sao không có task an toàn. Chỉ đọc
state rồi kết thúc vì Claude chưa đến giờ reset không đáp ứng quy trình này.
Nếu một task Codex đã có báo cáo nhưng chờ DB/review, giữ bằng chứng và scope
trong lịch sử trước khi chọn task độc lập khác; không dùng blocker của một task
để dừng mọi công việc không liên quan.

Chỉ thông báo khi chuyển task/chế độ, có kết quả review, lỗi mới hoặc cần người
dùng xử lý; giữ im lặng khi trạng thái không đổi. Nếu lần chạy bị ngắt, lưu task,
workspace và bước tiếp theo cụ thể để heartbeat sau tiếp tục đúng attempt.

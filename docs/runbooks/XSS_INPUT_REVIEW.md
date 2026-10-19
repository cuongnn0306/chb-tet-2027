# Rà soát XSS và làm sạch đầu vào (SEC-005)

Ngày soạn: 03/10/2026. Agent: claude. Loại: **chỉ tài liệu**. Không sửa source, schema, RLS, RPC; không dùng cloud,
database hay thông tin xác thực. Kế hoạch triển khai: [SEC-005-xss-input-review.md](../exec-plans/active/SEC-005-xss-input-review.md).

> **Kết luận không được hiểu quá mức.** Đây là rà soát **có lấy mẫu** trên snapshot của coordinator. Không có phần nào
> được chứng nhận "an toàn". Chỉ những file được liệt kê ở §2 mới được đọc; phần còn lại là **chưa rà soát**.
> Mọi bước tái hiện ở §5 được suy ra **từ việc đọc code**, **chưa được chạy**.

## 1. Phạm vi và giới hạn bằng chứng

| Hạng mục                                             | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mã được rà soát                                      | Worktree của coordinator tại HEAD `9548886` cộng các thay đổi chưa commit có sẵn lúc `task:start`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Thay đổi ở root checkout                             | **Không có trong snapshot này**: các thay đổi về delivery (follow-up DEL-011/DEL-012) và logging (SEC-009) nằm ở checkout gốc nên **không được rà soát**. Phải rà soát lại khi chúng được hợp nhất.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Test cục bộ                                          | Bộ **unit test đầy đủ có sẵn** của snapshot đã chạy trong `task:finish` của attempt đầu: `npm test` pass, **21 file / 174 test** (log `tmp/task-logs/SEC-005-2026-10-03T06-43-22-308Z/tests.log`). Attempt này **không thêm hay sửa test nào** và không test nào kiểm tra các phát hiện F1–F10 (không có test cho `sanitizeForFilter`, `PaymentReviewPage`, hay vô hiệu hóa công thức CSV). Lệnh vitest **tập trung riêng** (customers, opening-stock-import, payments, sepay-payload, webhook-auth) bị chế độ quyền từ chối nên **chưa chạy riêng**; không dùng đường vòng. Vì vậy "174 test pass" chỉ nói bộ test sẵn có không hỏng, **không** chứng minh XSS/đầu vào đã an toàn. |
| Tệp deliverable và phạm vi ghi                       | Deliverable thật là `docs/runbooks/XSS_INPUT_REVIEW.md` (tài liệu này) cùng ExecPlan SEC-005. Cấu hình phạm vi ghi do điều phối đặt trước lại ghi `docs/runbooks/INPUT_SECURITY_REVIEW.md`; tệp đó **chưa từng được tạo**. Hai tên không được coi là hai deliverable: phạm vi của lần sửa này là `XSS_INPUT_REVIEW.md` + ExecPlan, theo prompt sửa lỗi; điều phối cần cập nhật phạm vi đã đặt trước nếu muốn khớp tên.                                                                                                                                                                                                                                                              |
| Kiểm tra DB (reset, pgTAP, tích hợp)                 | **not_run** do `CHB_DB_VALIDATION_BLOCKER` được kế thừa; không reset, không truy cập DB trực tiếp.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Staging, di động (mobile), trình duyệt thật, in thật | **not_verified**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Pentest/DAST/scan phụ thuộc                          | Chưa thực hiện.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Phân biệt trong tài liệu này:

- **Escaping** (mã hóa khi xuất ra HTML/URL/CSV): bảo vệ trình duyệt/Excel khỏi diễn giải sai dữ liệu.
- **Business validation** (độ dài, định dạng, quy tắc nghiệp vụ): bảo vệ tính đúng đắn của dữ liệu. Quy tắc mới **không được tự
  bịa** (AGENTS.md §16); chỗ nào cần quy tắc mới thì ghi là "cần quyết định của Owner".
- **Mã hiện có** (đã đọc) khác với **module dự kiến** (chưa tồn tại trong snapshot, ví dụ xuất Excel RPT-012).

## 2. Những gì đã đọc (bằng chứng)

Quét mẫu bằng tìm kiếm trên `src/` (không tính test): `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `window.open`, `location.href`, `href=`, `srcDoc`,
`createObjectURL`, `postMessage`, `localStorage`/`sessionStorage`, `tel:`/`mailto:`, URL tuyệt đối.

Đã đọc trực tiếp:

- `src/features/orders/pages/OrderPrintPage.tsx`, `src/features/deliveries/pages/DeliveryPrintPage.tsx` (trang in).
- `src/domain/customers/validation.ts`, `src/lib/phone.ts` (kiểm tra khách hàng/điện thoại phía client).
- `src/domain/inventory/opening-stock-import.ts`, `src/features/inventory/pages/ImportOpeningStockPage.tsx` (một phần: tải mẫu CSV).
- `src/domain/payments/payments.ts` (`buildSepayQrUrl`), `src/features/payments/components/OrderPaymentPanel.tsx` (phần QR).
- `src/features/payments/pages/PaymentReviewPage.tsx` (các dòng hiển thị `payload.content`/`note`, qua tìm kiếm).
- `src/services/orders.service.ts` (tìm kiếm danh sách đơn, `sanitizeForFilter`), `src/lib/db-errors.ts`.
- `supabase/functions/sepay-webhook/index.ts`, `supabase/functions/_shared/sepay-payload.ts`.
- SQL: `20261001180816_customer_search.sql` (đọc đủ), `20261001180812_customers.sql` (bảng `customers`), phần liên quan của
  `20261001190720_opening_stock_import.sql`, `20261001200338_deliveries_schema.sql`, `20261001182157_orders_schema.sql`.
- Cấu hình: không có `vercel.json`, `public/_headers`; `index.html` và `vite.config.ts` không chứa CSP hay header bảo mật
  (tìm kiếm không ra kết quả).

**Chưa rà soát (không được coi là an toàn):** `LoginPage`, `CustomerForm`, `CustomerPicker`, `DuplicateSuggestion`,
`OrderFormPage`, `OrderLinesEditor`, `OrderTimeline`, `DeliveryFormDialog`, `DeliveryDialogs`, `StockMoveDialog`,
`BatchFormDialog`, `SettingsPage` (chỉnh JSON `sepay_config`), các trang master-data (`ResourceAdminPage`,
`LookupAdminPage`...), `HomePage`, phần lớn thân RPC (`save_draft_order`, `record_stock_exit`, `adjust_inventory`,
`process_sepay_event` ngoài đoạn đã nêu...), toàn bộ chính sách RLS, `webhook-auth.ts` (thuộc SEC-007).

## 3. Kết quả tóm tắt

| ID          | Mức                  | Loại                   | Tóm tắt                                                                                                                                                                                                     | Có tái hiện được? |
| ----------- | -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| SEC-005-F1  | Thông tin            | Escaping (kết quả tốt) | Không tìm thấy sink HTML thô trong `src/` (mẫu tìm kiếm ở §2). Dữ liệu người dùng được render dạng text node của JSX, React tự escape.                                                                      | Chưa chạy         |
| SEC-005-F2  | Trung bình           | Hardening (thiếu)      | Repo không cấu hình CSP/header bảo mật; không có lớp phòng thủ thứ hai nếu sau này có lỗi XSS.                                                                                                              | Đọc cấu hình      |
| SEC-005-F3  | Thấp                 | Riêng tư/phụ thuộc     | Ảnh QR tải từ `qr.sepay.vn`; số tài khoản, số tiền, nội dung chuyển khoản gửi cho bên thứ ba. URL được mã hóa đúng, không có injection.                                                                     | Đọc code          |
| SEC-005-F4  | Thấp                 | Business validation    | Không có giới hạn độ dài cho text tự do ở UI và (trong các bảng đã đọc) ở DB.                                                                                                                               | Chưa chạy         |
| SEC-005-F5  | Thấp                 | Business validation    | Số điện thoại chỉ được kiểm tra ở client; DB chỉ ràng buộc "không rỗng" với `recipient_phone`, không ràng buộc `customers.phone`.                                                                           | Chưa chạy         |
| SEC-005-F6  | Thấp (chưa kết luận) | Escaping/lọc đầu vào   | Tìm kiếm danh sách đơn nội suy chuỗi vào bộ lọc `.or()` của PostgREST; `sanitizeForFilter` bỏ `% , ( ) * \` nhưng để lọt `_`, `"`, `.`, `:`. **Chưa kiểm chứng** việc có chèn được điều kiện lọc hay không. | Chưa chạy         |
| SEC-005-F7  | Trung bình (dự kiến) | Escaping CSV/Excel     | Hiện chưa có xuất dữ liệu; khi RPT-012 xuất Excel/CSV, giá trị bắt đầu bằng `= + - @` sẽ thành công thức nếu không vô hiệu hóa. Dữ liệu nhập hiện không hạn chế ký tự.                                      | Đọc code          |
| SEC-005-F8  | Thấp                 | Độ bền hiển thị        | `PaymentReviewPage` hiển thị `payload.content`, `description`, `gateway`, `transferAmount` từ JSON của webhook; hiển thị dạng text (không có sink HTML) nhưng **không kiểm tra kiểu lúc chạy**.             | Chưa chạy         |
| SEC-005-F9  | Thông tin            | Điều hướng             | Không thấy open redirect trong các file đã đọc: `from` chỉ là `location.pathname` do app tự đặt.                                                                                                            | Đọc code          |
| SEC-005-F10 | Thấp                 | Biên Edge Function     | `sepay-webhook` đọc `request.text()` không giới hạn kích thước trong code; phụ thuộc giới hạn nền tảng (chưa xác minh).                                                                                     | Đọc code          |

Không có phát hiện nào mức Cao/Nghiêm trọng trong phần đã đọc. Điều này **không** có nghĩa là phần chưa đọc an toàn.

## 4. Chi tiết phát hiện

### SEC-005-F1 — Không có sink HTML thô (đã lấy mẫu)

- Bằng chứng: tìm kiếm mẫu ở §2 trả về duy nhất `URL.createObjectURL`/`link.href` trong `ImportOpeningStockPage.tsx:69-75`
  (tải file CSV mẫu **tĩnh**, nội dung là hằng `IMPORT_TEMPLATE`, không chứa dữ liệu người dùng).
- Các trang in (`OrderPrintPage`, `DeliveryPrintPage`) hiển thị tên khách, SĐT, địa chỉ, ghi chú, tên người nhận, mã lô bằng
  `{giá_trị}` trong JSX. `delivery.notes` dùng `whitespace-pre-line` (xuống dòng, không diễn giải HTML).
- Giới hạn: đây là kết quả tìm kiếm theo mẫu. Nó không chứng minh được các component chưa đọc (§2) không có sink; thư viện
  bên thứ ba không được kiểm tra.

### SEC-005-F2 — Thiếu CSP và header bảo mật (Trung bình, hardening)

- Không có `vercel.json`, `public/_headers`, và `index.html`/`vite.config.ts` không có CSP. Triển khai Vercel
  (INF-011) vẫn `external_not_verified` trong `PROJECT_PROGRESS.md`, nên cấu hình thực tế trên nền tảng **chưa xác minh**.
- Tác động: nếu một lỗi XSS xuất hiện trong tương lai, không có CSP/`frame-ancestors`/`nosniff`/`Referrer-Policy` để giảm
  thiệt hại; token phiên Supabase của trình duyệt (cơ chế lưu của thư viện, chưa kiểm tra) sẽ dễ bị đánh cắp hơn.
- Ràng buộc khi sau này thiết kế CSP (không thực hiện ở attempt này): `img-src` cần `https://qr.sepay.vn`; `connect-src`
  cần origin Supabase (REST/Realtime `wss:`); không cần `unsafe-eval`. Cần thử trên staging vì build Vite/Tailwind có thể
  chèn style nội tuyến.

### SEC-005-F3 — Ảnh QR từ bên thứ ba (Thấp)

- `buildSepayQrUrl` dùng `URLSearchParams` nên `acc`, `bank`, `amount`, `des` được percent-encode; host cố định
  `https://qr.sepay.vn/img`; `amount` ép về số nguyên không âm. Không thể chèn thêm tham số hay đổi host từ dữ liệu người dùng.
- Giá trị `bank`/`account_no` đến từ cấu hình `sepay_config` (Admin quản lý), `des` là mã đơn.
- Rủi ro còn lại là riêng tư/phụ thuộc: bên thứ ba thấy thông tin chuyển khoản và địa chỉ IP trình duyệt (code đã ghi chú). Không có secret
  trong URL. Không có `referrerpolicy` trên thẻ `<img>` (xem F2).

### SEC-005-F4 — Không giới hạn độ dài (Thấp, business validation)

- Tìm kiếm `maxLength` trong `src/` (trừ file sinh tự động) không có kết quả. Các cột `text` đã đọc (`customers.*`,
  `deliveries.notes/delivery_address`, `orders.notes`) chỉ có ràng buộc "không rỗng" ở nơi áp dụng, không có giới hạn tối đa.
- Tác động: chuỗi rất dài làm vỡ bố cục trang in/bảng, tăng kích thước payload. Không phải XSS.
- Cần **quyết định của Owner** về giới hạn hợp lý trước khi thêm ràng buộc (không tự đặt con số).

### SEC-005-F5 — SĐT chỉ kiểm tra ở client (Thấp, business validation)

- `validateCustomer` → `isPlausiblePhone` chạy ở trình duyệt. `customers.phone` không có `check`. `deliveries.recipient_phone` chỉ
  `btrim(...) <> ''`. Gọi trực tiếp PostgREST/RPC (người dùng đã xác thực có quyền tạo) có thể lưu chuỗi tùy ý.
- Hiển thị vẫn được React escape (xem F1). Chưa thấy liên kết `tel:` nào trong snapshot.
- Không có tác động XSS đã xác nhận; ảnh hưởng chủ yếu là chất lượng dữ liệu và tìm trùng (`normalize_phone`).
- Phần `DeliveryFormDialog`/RPC tạo đợt giao chưa đọc nên không khẳng định client có kiểm tra `recipient_phone` hay không.

### SEC-005-F6 — Bộ lọc `.or()` ở danh sách đơn (Thấp)

- `orders.service.ts:131` `sanitizeForFilter = text.replace(/[%,()*\\]/g, ' ')` (dùng ở dòng 220) rồi nội suy vào
  `order_code.ilike.%${text}%` và `customer_id.in.(${ids})` (ids là UUID lấy từ DB).
- **Chưa kiểm chứng, không phải kết luận.** Suy luận từ code: vì `,`, `(`, `)` bị thay bằng khoảng trắng nên có vẻ khó thêm
  điều kiện lọc mới bằng các ký tự phân tách thông thường. Điều này **chưa được thử** với bộ phân tích bộ lọc của PostgREST
  (phiên bản đang dùng, cách xử lý dấu ngoặc kép, dấu chấm, dấu hai chấm, khoảng trắng và Unicode). Tài liệu này **không** bảo đảm
  rằng bộ lọc không thể bị chèn; chỉ ghi nhận rằng chưa thấy cách chèn trong phần đã đọc.
- Còn lọt: `_` (ký tự thay thế đơn của `ILIKE`) làm kết quả khớp rộng hơn dự định (đã thấy trong code, chưa chạy); `"`, `.`, `:`
  chưa được thử.
- Không có test nào tham chiếu `sanitizeForFilter` (tìm kiếm trong `tests/` của snapshot chỉ thấy `opening-stock-import.test.ts` cho các
  mẫu đã tìm); hàm không được export. Phần `search_customers` dùng `strpos` (không dùng `LIKE`), nên không có vấn đề wildcard ở đó
  (đã đọc SQL).

### SEC-005-F7 — Công thức CSV/Excel (dự kiến)

- Snapshot **không có** chức năng xuất dữ liệu: chỉ tải mẫu CSV tĩnh và phân tích CSV khi nhập. Xuất Excel là RPT-012 (chưa bắt đầu).
- Dữ liệu nhập: `parseOpeningStockText` chỉ yêu cầu mã địa điểm/SKU/mã lô không rỗng rồi **`toUpperCase()`** (dòng 140-142 của
  `opening-stock-import.ts`); `import_opening_stock` dùng `upper(btrim(...))` và (trong phần đã đọc) chỉ có regex cho ngày và số
  lượng. Vì mã bị **viết hoa**, một mã lô như `=HYPERLINK("http://example.invalid","x")` nếu được chấp nhận sẽ được lưu là
  `=HYPERLINK("HTTP://EXAMPLE.INVALID","X")`, không phải nguyên văn. Việc viết hoa **không** vô hiệu hóa công thức (tiền tố `=`, `+`,
  `-`, `@` vẫn còn). Đây là suy luận từ code, chưa chạy.
- Khi viết dữ liệu mẫu CSV có dấu phẩy hoặc dấu ngoặc kép, phải **trích dẫn đúng chuẩn**: bao cả ô bằng dấu ngoặc kép và nhân đôi
  dấu ngoặc kép bên trong. `splitLine` hỗ trợ cách này ("a, b" là một ô, `""` là một dấu `"`; dấu phân cách là phẩy, chấm phẩy hoặc tab).
  Ví dụ một dòng CSV đúng cấu trúc 6 cột của mẫu nhập (`IMPORT_HEADER`: Location Code, SKU, Batch, NSX, HSD, Qty; xem
  `IMPORT_TEMPLATE`), với mã lô là công thức giả đã trích dẫn đúng:

  ```csv
  Location Code,SKU,Batch,NSX,HSD,Qty
  HN-BEP,TT-1200,"=HYPERLINK(""http://example.invalid"",""x"")",01/01/2027,01/03/2027,100
  ```

  Nếu không trích dẫn, dấu phẩy trong công thức làm lệch số cột và dòng bị báo lỗi ("Cần đủ 6 cột") thay vì đi tới bước kiểm tra
  mã lô; khi đó ví dụ không minh họa được điều cần quan sát. Các ví dụ công thức không chứa dấu phẩy (`+1+1`, `-2+3`, `@SUM(1+1)`) không
  cần trích dẫn nhưng vẫn nên đặt trong cùng một dòng 6 cột để thử đúng đường đi của parser.

- Yêu cầu cho RPT-012 (không phải quy tắc nghiệp vụ mới, là biện pháp escaping): khi ghi ô văn bản bắt đầu bằng `=`, `+`, `-`,
  `@`, tab hoặc CR, phải vô hiệu hóa (ví dụ thêm tiền tố `'`) và ghi ô là kiểu chuỗi; áp dụng cho mọi cột text (tên khách,
  ghi chú, mã lô, nội dung chuyển khoản). Cột tiền/số lượng giữ kiểu số. Cần test đơn vị cho hàm này khi RPT-012 bắt đầu.

### SEC-005-F8 — Nội dung chuyển khoản hiển thị (Thấp)

- `PaymentReviewPage.tsx` hiển thị trong JSX text: `event.payload.transferAmount` (dòng 72 và 209, qua `MoneyText`),
  `event.payload.gateway` (dòng 73), `event.payload.content ?? event.payload.description` (dòng 85) và `event.note` (dòng 87): không có
  sink HTML. Nội dung `content`/`description` do **người chuyển tiền** viết (không tin cậy) và đi qua webhook đã xác thực.
- `payload` là `jsonb`. Kiểu TypeScript khai báo ở `payments.service.ts:47-55` (`transferAmount?: number`, `gateway?: string`,
  `content?: string`...) chỉ là khai báo biên dịch; **không có kiểm tra JSON lúc chạy** trước khi render. Suy luận từ code (chưa chạy trên
  trình duyệt): nếu `gateway`, `content` hoặc `description` là đối tượng, React có thể báo lỗi khi render và làm hỏng màn hình xem xét
  (mảng chuỗi vẫn hiển thị được); nếu `transferAmount` không phải số thì `formatVnd` (dùng `Intl.NumberFormat`) có thể hiển thị giá trị
  không có nghĩa (ví dụ `NaN ₫`) và hộp thoại "Gán vào đơn" cũng dùng giá trị đó. Hậu quả tối đa theo code là hiển thị sai hoặc lỗi trang;
  không thấy đường thực thi script.
- Các giá trị này chỉ vào `payload` sau khi webhook được xác thực (SEC-007), nhưng nội dung do bên chuyển tiền quyết định, và các sự
  kiện bị đưa vào hàng đợi xem xét vì payload sai kiểu (PAY-007, nằm ở root checkout, **không** có trong snapshot này) làm các giá trị sai
  kiểu dễ xuất hiện hơn. Mức Thấp; cần type-guard khi hiển thị (xem §6) và một lần kiểm chứng trên trình duyệt với payload giả.

### SEC-005-F9 — Điều hướng

- `auth-guard.tsx:16` đặt `state={{ from: location.pathname }}`; `LoginPage.tsx:13` đọc `location.state.from`. Không dùng tham số
  truy vấn của URL, không có `window.open`/`location.href` đến địa chỉ do người dùng cấp trong phần đã quét.

### SEC-005-F10 — Biên Edge Function

- `index.ts` kiểm tra phương thức, xác thực (SEC-007), parse JSON, kiểm tra id số an toàn rồi gọi RPC `process_sepay_webhook`
  với `p_payload` là tham số (không nối chuỗi SQL). Log chỉ ghi lý do/mã lỗi, không ghi header/payload.
- `request.text()` đọc toàn bộ thân trước khi xác thực; giới hạn kích thước thân phụ thuộc nền tảng Supabase (chưa xác minh).
  Thuộc SEC-006 (giới hạn tần suất) và SEC-009 (log); ghi chú ở đây để không bị bỏ sót.

## 5. Tái hiện bằng chuỗi giả (synthetic) — suy ra từ code, **chưa chạy**

Chỉ dùng dữ liệu giả, trong môi trường local/staging do Owner chỉ định, **không** dùng dữ liệu thật hay production. Việc chạy
cần DB (đang bị chặn) và trình duyệt nên để lần thực hiện sau.

| Mã  | Chuỗi giả                                                                                                                                             | Nhập ở đâu                                                             | Kết quả mong đợi theo code                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `<img src=x onerror=alert('SEC005')>`                                                                                                                 | Tên khách, ghi chú đơn, ghi chú giao hàng, địa chỉ                     | Hiện nguyên văn như chữ trên trang chi tiết và trang in; không có hộp thoại `alert`.                                                                                                                                                                                                                                                                                                     |
| S2  | `"><script>alert('SEC005')</script>`                                                                                                                  | Cùng các trường trên; nội dung chuyển khoản (kiểm thử webhook ở local) | Hiện nguyên văn; không thực thi script.                                                                                                                                                                                                                                                                                                                                                  |
| S3  | `javascript:alert('SEC005')`                                                                                                                          | Địa chỉ, ghi chú                                                       | Chỉ là text; không có liên kết `href`/`tel:` nào được tạo từ trường này trong snapshot.                                                                                                                                                                                                                                                                                                  |
| S4  | CSV 6 cột (§4 F7) với mã lô `"=HYPERLINK(""http://example.invalid"",""x"")"`, và mã lô `+1+1`, `-2+3`, `@SUM(1+1)`                                    | Mã lô trong nhập tồn đầu kỳ, **chỉ ở chế độ `dry_run`**                | `dry_run` (mặc định của `import_opening_stock`) kiểm tra toàn bộ và trả về mọi lỗi **mà không thay đổi dữ liệu**, nên không có gì cần dọn. Theo code: parser chấp nhận dòng đủ 6 cột và **viết hoa** mã lô (`=HYPERLINK("HTTP://EXAMPLE.INVALID","X")`); tiền tố công thức vẫn còn. **Không** chạy `p_dry_run=false` với các chuỗi này. Khi có xuất Excel (RPT-012) phải bị vô hiệu hóa. |
| S5  | `a_b%,c)"d.e:f`                                                                                                                                       | Ô tìm kiếm danh sách đơn                                               | Dấu `% , ) *` bị thay bằng khoảng trắng; `_` hoạt động như ký tự đại diện; ghi lại có lỗi 4xx từ PostgREST hay không và kết quả có rộng bất thường không. Đây là phép thử để **tạo bằng chứng**; chưa có kết luận về việc chèn bộ lọc.                                                                                                                                                   |
| S6  | Chuỗi 1.000.000 ký tự `A`                                                                                                                             | Ghi chú đơn/giao hàng                                                  | Không có giới hạn; quan sát độ trễ và bố cục trang in (cần quyết định giới hạn của Owner).                                                                                                                                                                                                                                                                                               |
| S7  | `<b>x</b>` làm `content`; `{"a":1}` làm `content`, `description` và `gateway`; `"abc"` và `{}` làm `transferAmount` của một sự kiện SePay giả (local) | Webhook local với khóa kiểm thử, rồi mở màn hình xem xét               | `<b>` hiện nguyên văn; với giá trị đối tượng hoặc sai kiểu, ghi lại xem trang xem xét và hộp thoại "Gán vào đơn" có lỗi hay hiển thị `NaN ₫` không (F8). Lưu ý: ở root checkout, logic PAY-007 đưa các payload sai kiểu vào hàng đợi xem xét; snapshot này có thể xử lý khác, ghi rõ commit đã thử.                                                                                      |

Mỗi lần chạy phải ghi: phiên bản commit, môi trường, người chạy, ảnh chụp/kết quả, và **ID các bản ghi fixture đã tạo cùng cách đã vô hiệu hóa chúng**.

### Dọn dữ liệu giả: không xóa cứng

Bản ghi nghiệp vụ (đơn hàng, đợt giao, thanh toán, sổ kho, audit) **không bao giờ bị xóa cứng**: AGENTS.md §4 và §16 yêu cầu chỉ hủy hoặc
vô hiệu hóa kèm lý do và Audit Log. Do đó không dùng `DELETE`, `TRUNCATE` hay sửa tay bảng để "dọn" dữ liệu thử. Thay vào đó:

1. **Ưu tiên cơ sở dữ liệu dùng một lần**: chạy S1–S3, S5–S7 trên local stack có thể dựng lại hoàn toàn từ migration + seed, rồi bỏ cả
   dữ liệu đó bằng cách dựng lại (`supabase db reset --local`). Chỉ tiến trình đang sở hữu khóa DB dùng chung (quy trình `task:finish`)
   mới được reset; không reset trực tiếp hay trên môi trường dùng chung.
2. Nếu phải chạy trên staging hoặc DB không dựng lại được: chỉ dùng **fixture cô lập** (khách, đơn, lô, địa chỉ có tiền tố cố định như
   `SEC005-`, tài khoản thử riêng) và sau khi chạy **vô hiệu hóa bằng nghiệp vụ có sẵn kèm lý do**, ví dụ hủy hoặc vô hiệu hóa đơn
   (Admin, có lý do), hủy đợt giao chưa xuất kho, lưu trữ khách hàng, đặt lô sang `INACTIVE`. Audit Log giữ lại vết; không xóa vết đó.
   Tồn kho phát sinh chỉ được đưa về bằng điều chỉnh có lý do (Admin), không bằng cách sửa số dư.
3. Không gửi chuỗi giả tới webhook staging thật, SePay Test Mode của Owner hay dùng dữ liệu khách thật.
4. S4 chỉ dùng `dry_run`, nên không tạo dữ liệu. Không chạy ghi thật (`p_dry_run=false`) với chuỗi công thức.
5. Nếu không có cách vô hiệu hóa nào cho một loại bản ghi, **dừng và hỏi Owner**; không chọn xóa cứng.

## 6. Theo dõi tiếp (canonical)

| Việc                                                                                                                                                                            | Task canonical                                         | Điều kiện/chặn                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Chạy §5 trên local/staging; mở rộng rà soát sang các file "chưa rà soát"; kiểm tra lại sau khi các thay đổi delivery/logging của root được hợp nhất                             | **SEC-005** (attempt tiếp theo)                        | DB local hết bị chặn; trình duyệt/mobile; thay đổi root hiện diện trong snapshot. |
| Export + unit test cho `sanitizeForFilter` hoặc chuyển tìm kiếm đơn sang RPC (F6); type-guard khi hiển thị `payload.content`, `description`, `gateway` và `transferAmount` (F8) | **SEC-005** (attempt có sửa code, cần phê duyệt riêng) | Attempt này là chỉ tài liệu.                                                      |
| CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy` (F2, F3)                                                                                                                   | **INF-011** (cấu hình Vercel)                          | Owner xác minh tài khoản/dự án; thử trên staging (INF-009).                       |
| Vô hiệu hóa công thức CSV/Excel + test (F7)                                                                                                                                     | **RPT-012**                                            | Yêu cầu nghiệm thu bổ sung cho RPT-012 khi task bắt đầu.                          |
| Giới hạn độ dài và định dạng SĐT phía DB (F4, F5)                                                                                                                               | **Quyết định của Owner** → task E01/E02 liên quan      | Cần quy tắc được duyệt trước; không tự đặt con số.                                |
| Giới hạn kích thước thân webhook, log lỗi (F10)                                                                                                                                 | **SEC-006**, **SEC-009**                               | Theo kế hoạch của hai task này.                                                   |

## 7. Danh sách kiểm tra khi thêm màn hình/field mới (hướng dẫn, không phải quy tắc nghiệp vụ mới)

1. Hiển thị dữ liệu người dùng bằng JSX text; không dùng `dangerouslySetInnerHTML`. Nếu bắt buộc phải dùng, cần quyết định
   thiết kế và một thư viện làm sạch được duyệt.
2. Không tạo `href`/`src` từ dữ liệu người dùng; nếu cần, chỉ cho phép lược đồ `https:`/`tel:` qua một hàm dùng chung có test.
3. Mọi xuất CSV/Excel phải đi qua một hàm vô hiệu hóa công thức dùng chung (F7).
4. Giá trị nội suy vào bộ lọc PostgREST phải qua một hàm dùng chung có test; ưu tiên RPC có tham số.
5. Kiểm tra phía client chỉ là trải nghiệm người dùng; ràng buộc thật phải ở DB/RPC (AGENTS.md §6).
6. Không ghi dữ liệu khách thật vào log, báo cáo hay chuỗi tái hiện.

## 8. Trạng thái nghiệm thu

| Tiêu chí                                                       | Trạng thái                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Rà soát mẫu các đường render, biểu mẫu, URL, in, CSV, biên RPC | Đã thực hiện có giới hạn (§2); **không** toàn diện                         |
| Có phát hiện, mức độ, file, bước tái hiện và task theo dõi     | Có (§3–§6); tái hiện **chưa chạy**                                         |
| Bộ unit test đầy đủ có sẵn (`npm test` trong pipeline)         | pass: 21 file / 174 test (không có test cho F1–F10)                        |
| Test tập trung riêng cho các phát hiện                         | **not_run** (lệnh bị từ chối bởi chế độ quyền); chưa có test nào được thêm |
| Kiểm tra DB                                                    | **not_run** (`CHB_DB_VALIDATION_BLOCKER`)                                  |
| Staging / mobile / trình duyệt thật / in thật                  | **not_verified**                                                           |
| Sửa lỗi                                                        | Ngoài phạm vi attempt này                                                  |

SEC-005 **không** được gọi là Done.

## 9. Hiệu đính sau review độc lập (03/10/2026)

Chỉ sửa tài liệu; không sửa source, schema, RPC hay RLS. Báo cáo của attempt đầu giữ nguyên.

| Finding của review                                                         | Đã sửa ở đâu                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tên tệp deliverable khác phạm vi đã đặt trước (`INPUT_SECURITY_REVIEW.md`) | §1 (hàng "Tệp deliverable và phạm vi ghi"): deliverable là `XSS_INPUT_REVIEW.md`; tệp kia chưa từng được tạo           |
| Dọn dữ liệu giả ngầm hiểu là xóa cứng                                      | §5 "Dọn dữ liệu giả: không xóa cứng": DB dùng một lần hoặc fixture cô lập + vô hiệu hóa kèm lý do và Audit Log         |
| "Test not_run" mâu thuẫn với pipeline đã chạy 21 file / 174 test           | §1 và §8: phân biệt bộ unit test đầy đủ (pass) với lệnh tập trung bị từ chối (not_run); không test nào kiểm tra F1–F10 |
| `dry_run` được mô tả mơ hồ                                                 | §5 S4 và §4 F7: `dry_run` không lưu gì; không chạy ghi thật với chuỗi công thức                                        |
| Parser viết hoa mã                                                         | §4 F7 và §5 S4: mã lô lưu dạng viết hoa, tiền tố công thức vẫn còn                                                     |
| Ví dụ CSV chứa dấu phẩy chưa trích dẫn đúng                                | §4 F7: ví dụ 6 cột, ô được bao bằng dấu ngoặc kép và nhân đôi dấu ngoặc kép bên trong                                  |
| F8 chỉ nói `content`                                                       | §3, §4 F8, §5 S7, §6: gồm `gateway`, `transferAmount`, `description`; kiểu chỉ khai báo lúc biên dịch                  |
| F6 nói quá về việc không thể chèn bộ lọc                                   | §3 và §4 F6: ghi là suy luận, **chưa kiểm chứng** với PostgREST; không bảo đảm không thể chèn                          |
| Tái hiện trên trình duyệt chưa chạy                                        | Không đổi: S1–S7 vẫn **chưa chạy**; không có kết luận "không XSS" nào được đưa ra                                      |

Vẫn chưa có: chạy S1–S7 trên trình duyệt thật, rà soát các file ở mục "Chưa rà soát" (§2), rà soát lại sau khi thay đổi delivery/logging/PAY-007 ở
root được hợp nhất, staging, mobile, review bên ngoài.

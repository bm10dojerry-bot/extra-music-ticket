# AI Sale Extra 2.0 · Thử nghiệm Messenger chữ

Nhánh `feature/messenger-voice-20261125` tiếp tục kịch bản và quy tắc bàn giao của PR #41. Tính năng mặc định tắt và chỉ có thể bật cho Page thử và PSID được khai báo ngoài môi trường Vercel production.

## Luồng đã nối trên nhánh thử nghiệm

1. Webhook xác thực chữ ký Meta, Page, chiều gửi và mã tin nhắn. Nó lưu tin cùng giới thiệu quảng cáo hợp lệ vào hộp thư hỗ trợ. Tin gửi lại cùng MID được xử lý một lần.
2. Worker lấy quyền xử lý theo cuộc hội thoại, đọc các lượt khách và nhân viên đã lưu, rồi chọn câu phù hợp với ý định. Những lựa chọn ghế cụ thể dùng bảng giá hiện hành, sơ đồ theo góc nhìn khán giả, ghế giữ hoặc đã bán và ghế khóa. Giá và tồn kho không xác minh được thì ứng xử an toàn. Ưu đãi cần chương trình đã có trong checkout, show và thời hạn được xác nhận. Giữ chỗ và quy trình thanh toán đi qua trang đặt vé hiện tại.
3. Nhân viên có thể nhận hoặc trả lời từ hộp thư Sale. PostgreSQL kiểm tra quyền và giữ quyền gửi ngay trước khi gọi Meta. Yêu cầu gặp người thật đưa cuộc hội thoại vào hàng chờ cho tới khi có phản hồi nhân viên đã xác nhận. Nút trả quyền cho AI áp dụng sau khi yêu cầu đã được xử lý.
4. Mỗi hoạt động nhân viên cập nhật mốc chờ. PostgreSQL chỉ mở lại quyền AI khi đủ 180 giây. Worker chỉ soạn nếu còn tin khách cần xử lý trong cửa sổ Messenger. Trạng thái được tính khi có sự kiện mới hoặc khi worker quét hàng chờ. Chạy lịch thử với tần suất phù hợp để độ trễ thực tế gần mốc 180 giây.
5. Tin AI và tin gửi từ hộp thư Sale có metadata riêng, gắn với App và lần gửi trong cơ sở dữ liệu. Meta gửi echo hợp lệ thì có thể đối chiếu khi phản hồi HTTP bị mất. Trường hợp gửi chưa rõ kết quả giữ để đối soát, tránh gửi lại tự động. Hiệu ứng ba chấm dùng `typing_on` và `typing_off` của Meta trong lần xử lý được phép.

## Thiết lập môi trường thử

- Dùng Supabase thử riêng, dữ liệu vé mẫu, Meta App/Page thử và tài khoản có quyền tester. Áp migration mới trên cơ sở dữ liệu thử. Xác minh webhook `messages`, `message_echoes` và sự kiện referral theo cấu hình App. Chỉ dùng nguồn echo nhân viên đã kiểm chứng.
- Bật `META_MESSENGER_AI_MODE=test` ngoài production. Điền `META_MESSENGER_AI_TEST_PAGE_ID`, `META_MESSENGER_AI_TEST_PSIDS` và `META_MESSENGER_AI_APP_ID`. Danh sách PSID phân tách bằng dấu phẩy. Thiết lập các cấu hình Messenger hiện có và một `META_MESSENGER_AI_WORKER_SECRET` riêng cho môi trường thử qua kho bí mật.
- Cấu hình ánh xạ quảng cáo/show khi có bằng `MESSENGER_SALE_REFERRAL_SHOWS_JSON`. Giá trị là object với khóa mã quảng cáo hoặc referral và giá trị slug show. `MESSENGER_SALE_PROMOTIONS_JSON` chỉ dùng cho chương trình được chủ dự án xác nhận. Mỗi phần tử có `showId`, `program`, `startsAt`, `expiresAt`, với mốc UTC và chương trình `couple5`, `buy5`, `buy10` hoặc `buy20`.
- Gọi `POST /api/cron/messenger-sale` với `Authorization: Bearer <worker-secret>` bằng scheduler của môi trường thử. Có thể chạy `node scripts/run-messenger-sale-worker.mjs` trên một tiến trình riêng với `META_MESSENGER_AI_WORKER_URL` và `META_MESSENGER_AI_WORKER_SECRET`. Tiến trình quét lại sau mỗi phản hồi một giây. Mốc đủ 180 giây do PostgreSQL quyết định. Thời gian gửi thực tế còn phụ thuộc lượt quét và độ trễ Meta.
- Ưu tiên webhook thử trên domain riêng được phép nhận callback. Preview Vercel hiện có SSO. Xác nhận cách Meta tiếp cận URL thử trước khi đăng ký callback.

## Điều kiện nghiệm thu

- Dùng hai tài khoản được phép để xác minh tên Facebook, dấu ba chấm, referral quảng cáo, tin chữ và echo. Gửi thử hai tin khách đồng thời, nhận chat từ Sale, trả lời lại trước 180 giây và gửi thêm ở mốc đủ 180 giây. Thử một yêu cầu gặp người thật và kiểm tra AI chỉ hoạt động lại theo trạng thái bàn giao.
- Việc bảo đảm thứ tự gửi giữa AI và nhân viên áp dụng qua hộp thư Sale dùng chung khóa. Meta Business Suite gửi ngoài giao dịch của ứng dụng. Echo đến sau chỉ có thể chặn lần gửi kế tiếp, nên cần xác minh tín hiệu bàn giao và quyền gửi độc quyền trước khi cho phép nguồn đó cùng hoạt động.
- Worker production có nguồn riêng ngoài nhánh GitHub này. Vercel xác nhận các thành phần worker, hàng đợi, lịch chạy, xử lý nhân viên và callback SePay. Kết nối Vercel chỉ trả phần đầu nội dung mỗi tệp. Cần checkout riêng của đúng bản build và migration liên quan để tích hợp, giữ nguyên xác nhận thanh toán, phát vé và hiệu ứng hiện hành. Bản thử hướng khách tới trạng thái đơn trên trang đặt vé khi chưa có liên kết đơn hàng với danh tính Messenger.
- Tài liệu Meta ghi nhận token từng hiện trong ảnh Graph API Explorer. Cần chủ dự án thu hồi và cấp lại token qua Meta, xác nhận đúng App/Page, quyền gửi, nguồn credential runtime đang dùng và tài khoản thử. Lưu token mới trong kho bí mật. Nếu cần dừng thử, bỏ chế độ `test`, dừng scheduler và kiểm tra các lượt gửi chưa rõ trước khi chuyển cuộc hội thoại về luồng nhân viên.
- Chỉ mở Voice sau khi luồng chữ và bàn giao qua được kiểm thử Messenger được phép. Preview của nhánh chỉ phục vụ rà soát. Việc bật Messenger trên Page thật, merge và production cần được phê duyệt riêng.

## Kiểm thử cục bộ

- Kiểm tra TypeScript bằng `npm exec tsc -- --noEmit --incremental false` và build bằng `npm run build`.
- Chạy các bài tích hợp giả lập với `node --test tests/messenger-sale-runtime.test.cjs tests/messenger-staff-route.test.cjs tests/messenger-sale-data.test.cjs`. Các bài này mô phỏng Meta và PostgREST, gồm chữ ký webhook, echo, giữ quyền trước khi gửi, trạng thái gửi chưa rõ và lỗi nguồn tồn kho.
- Chạy `node --test tests/messenger-ai-ownership.postgres.test.cjs` với module `pg` và `EXTRA_MESSENGER_TEST_DATABASE_URL` trỏ tới PostgreSQL cục bộ. Bài kiểm thử tạo và xóa cơ sở dữ liệu tạm, dùng nhiều kết nối để kiểm tra các giao dịch đồng thời, khởi động lại worker, mốc 179/180 giây và yêu cầu gặp người thật.

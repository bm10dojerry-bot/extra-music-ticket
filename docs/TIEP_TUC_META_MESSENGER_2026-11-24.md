# Điểm dừng kết nối Facebook Messenger – tiếp tục ngày 24/11/2026

## Dự án
- Website: https://iextra.net
- Sale: https://sale.iextra.net/sale
- Admin chat: https://admin.iextra.net/admin?section=support-chats
- GitHub: bm10dojerry-bot/extra-music-ticket
- Fanpage đã kết nối trong giao diện Meta: **1 EXTRA**, Page ID **1223940670813189**
- Ứng dụng Meta tên **Extra Music Messenger**. **Cần đối chiếu chính xác App ID**: ảnh OAuth từng hiển thị `2447629075989535`, còn ảnh trang Basic từng hiển thị `2344172276378913`. Có thể là hai ứng dụng cùng tên. KHÔNG tự giả định chúng khớp.

## Những việc đã làm
- Tạo ứng dụng Messenger API trong Meta for Developers, kết nối Page 1 EXTRA.
- Trang **Cài đặt API Messenger** ghi nhận Page đã đăng ký webhook event **messages**.
- Vercel Production đã lưu đủ 4 tên biến `META_MESSENGER_PAGE_ID`, `META_MESSENGER_PAGE_ACCESS_TOKEN`, `META_MESSENGER_APP_SECRET`, `META_MESSENGER_VERIFY_TOKEN`. **Tuyệt đối không lưu giá trị bí mật ở đây.**
- Vercel Production đã READY, endpoint `https://iextra.net/api/meta/messenger/webhook` hoạt động ở mức nhận request/cấu hình. Không có xác nhận tin nhắn thật đã đến.
- Trang chính sách riêng tư: https://iextra.net/chinh-sach-quyen-rieng-tu
- Trang hướng dẫn xóa dữ liệu: https://iextra.net/xoa-du-lieu
- Đã chuẩn bị logo/icon ứng dụng để đăng Meta. Phải đảm bảo kích thước file thật 512×512 hoặc 1024×1024 (không dùng bản 1254×1254 bị Meta từ chối).
- Đã mở quy trình **Meta App Review** cho quyền `pages_messaging`, `pages_manage_metadata`, `pages_show_list` và các quyền Meta tự đưa vào. Màn hình xét duyệt yêu cầu giải trình, video minh chứng và thử API 0/1. **Chưa gửi xét duyệt thành công.**
- Khách thử bên ngoài (Nguyễn Thu Trang) đã nhắn Fanpage, nhưng hộp thư Sale không nhận. SQL trước đó: 0 cuộc chat `channel='messenger'`. Chưa kết luận nguyên nhân; app chưa có Advanced Access cho người ngoài có thể là một nguyên nhân.
- Đã thêm log chẩn đoán webhook (không log nội dung hoặc token).

## Điểm dừng – Graph API Explorer
- Đã mở **Meta Graph API Explorer** trong app Extra Music Messenger.
- Màn hình chọn **'Người dùng hoặc Trang'** vẫn ở **'Mã người dùng'**.
- Dòng đường dẫn có vẻ nhập thừa chữ `GET` trước path, nên trả `Unknown path components`.
- Bước kế tiếp: Chọn đúng app, đổi từ **Mã người dùng** sang **Mã Trang / 1 EXTRA** (nếu Meta hiển thị). Sau đó giữ phương thức GET và nhập **chỉ** đường dẫn:
  `/1223940670813189/subscribed_apps`
- Sau đó nhấn Gửi và kiểm tra kết quả, quyền `pages_manage_metadata`, trạng thái 1/1 trong phần Testing. Không khẳng định lệnh đã thành công trước khi thấy phản hồi.

## Bảo mật rất quan trọng – làm trước khi tiếp tục thử API
- **Một ảnh Graph API Explorer đã làm lộ Access Token!** Cần thu hồi/tạo lại token đã lộ, sau đó cập nhật `META_MESSENGER_PAGE_ACCESS_TOKEN` trong Vercel Production nếu là mã Trang, và Redeploy để nạp mã mới. Nếu là user token thì thu hồi/đổi token tương ứng.
- Khi gửi ảnh màn hình, **che toàn bộ token, App Secret, Verify Token**.
- Xác minh App Secret trong Vercel phải thuộc **chính ứng dụng** đang thiết lập Messenger + webhook (đối chiếu App ID trên Meta; KHÔNG hỏi người dùng gửi giá trị bí mật).

## Các bước tiếp theo sau đó
1. Kiểm tra GET `/{page-id}/subscribed_apps`, ghi lại kết quả (không tiết lộ token).
2. Thử bằng tài khoản có vai trò thử nghiệm hợp lệ; kiểm tra runtime logs webhook và database, xác minh lệnh Meta gửi thực sự đến.
3. Chuẩn bị App Review cho `pages_messaging` phục vụ **mọi khách hàng** (Advanced Access/App Review). Người ngoài không cần làm Tester sau khi quyền được cấp, nhưng lúc thử nghiệm có giới hạn.
4. Điền chính sách quyền riêng tư, thông tin xóa dữ liệu, biểu tượng đúng kích thước, hạng mục ứng dụng, nội dung giải trình và video minh chứng trung thực; không giả lập cuộc chat chưa hoạt động.
5. Khi Meta chấp thuận, thử khách hàng bình thường -> Fanpage -> Sale iextra.net -> Messenger phản hồi.

## Nhắc lại
- Người dùng muốn **tạm dừng và tiếp tục ngày 24/11/2026**, không cần làm tiếp vào hôm nay.
- Giữ nguyên website/đơn đặt chỗ, không đụng các giao dịch hoặc chiến dịch quảng cáo.

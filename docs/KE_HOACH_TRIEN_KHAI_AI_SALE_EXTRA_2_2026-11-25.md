# Kế hoạch triển khai AI Sale Extra 2.0 — 25/11/2026

**Phạm vi ưu tiên** là tư vấn bằng chữ trước, Voice Messenger sau. Gọi điện qua VinaPhone nằm ngoài phạm vi. Xem cấu hình, giới hạn và tiêu chí nghiệm thu của nhánh thử tại [hướng dẫn thử Messenger chữ](AI_SALE_EXTRA_2_MESSENGER_PILOT.md).

| STT | Giai đoạn | Việc cần làm | Tiêu chí nghiệm thu | Trạng thái |
|---|---|---|---|---|
| 1 | Rà soát | Xác định runtime AI thực tế, webhook Messenger, luồng Sale hiện hữu, Meta App/Page ID, quyền và dữ liệu hội thoại | Sơ đồ luồng rõ ràng, xác nhận nguồn phát sinh phản hồi AI và nhân viên | Đã đọc đủ PR #41, truy vết deployment Vercel. Cần đúng checkout và migration của worker production riêng |
| 2 | Bảo mật | Thu hồi token Meta từng lộ; cấp lại qua quyền hợp lệ, cập nhật biến môi trường và kiểm tra webhook chữ ký | Token cũ vô hiệu, webhook xác thực, không lộ bí mật trong log | Đã kiểm thử chữ ký giả lập. Chờ xác nhận thu hồi và quyền Meta |
| 3 | Kịch bản chữ | Chào theo tên và giờ địa phương; công khai có AI một lần; nhận show từ quảng cáo; hỏi góc nhìn trái/phải/chính diện; giao lưu dự kiến 20–30 phút; khuyến mãi thật; ngân sách; giá/ghế trống | 12 tình huống kiểm thử đúng, không đoán giới tính, không bịa ưu đãi/ghế | Đã tích hợp trên nhánh thử, chờ nghiệm thu Messenger |
| 4 | Ngữ cảnh | Lưu show, số vé, ngân sách, góc nhìn, lịch sử và trạng thái chào/AI disclosure | Khách đổi ý vẫn được nhớ, không hỏi lặp | Đã tích hợp và kiểm thử cục bộ. Trạng thái đơn cần nguồn xác thực gắn với khách |
| 5 | AI-first | Bỏ tự động phân toàn bộ Messenger cho Sale; AI mặc định phụ trách, nhân viên chỉ can thiệp chủ động | Tin khách đến được AI xử lý mà không chuyển Sale mặc định | Đã nối webhook và hộp thư Sale cho Page thử, cờ mặc định tắt |
| 6 | Handoff 3 phút | Xác định tín hiệu nhân viên trả lời, tạm dừng AI; reset thời gian khi nhân viên tiếp tục; AI trở lại sau 180 giây im lặng; chặn gửi trùng bằng trạng thái bền vững và kiểm tra nguyên tử | Kiểm thử mốc 179/180 giây, đồng thời, khách yêu cầu người thật; không có hai phản hồi | Đã tích hợp và đạt 11 kiểm thử PostgreSQL. Chờ nghiệm thu echo và quyền gửi độc quyền trên Meta |
| 7 | Giá & đặt vé | Đọc giá và ghế còn trống từ nguồn hiện hành; giữ nguyên quy trình giữ ghế/thanh toán, xác nhận tiền từ hệ thống | Không báo ghế đã bán; không xác nhận thanh toán bằng ảnh | Đã nối bảng giá, tồn kho và luồng đặt vé. Bản thử chưa liên kết được trạng thái đơn với danh tính Messenger |
| 8 | Kiểm thử chữ | Thử bằng tài khoản Meta được phép, kiểm tra quyền App Review/Advanced Access, log an toàn và tình huống thực tế | Messenger nhận/trả lời chữ đúng, không làm hỏng luồng hiện tại | Chưa xong |
| 9 | Voice nhận | Nhận audio attachment an toàn, giới hạn dung lượng, chuyển tiếng Việt thành chữ và nhập ngữ cảnh | Nhận đúng voice mẫu, hỏi lại phần không rõ, không lưu URL âm thanh vào log | Mã phát hiện attachment nền đã tạo |
| 10 | Voice gửi | Hỏi đồng ý, tạo audio tiếng Việt, gửi attachment qua Meta, fallback sang chữ | Khách đồng ý mới gửi, Meta trả message_id và khách thực nhận | Mã gửi audio nền đã tạo, chưa thử |
| 11 | Phát hành | Review mã, test, rollout giới hạn, theo dõi lỗi và phương án rollback | Không lỗi đặt vé, thanh toán, hiệu ứng đang nhập; có đường khôi phục | Chưa xong |

## Quy tắc nội dung
- Câu huấn luyện là **kho mẫu linh hoạt**, không phải chuỗi cứng phải đọc theo thứ tự trong mọi cuộc chat. Chọn câu phù hợp ý định và ngữ cảnh khách, không nhồi tất cả vào một lượt.
- Nếu khách hỏi thẳng giá hoặc ghế thì trả lời trực tiếp bằng dữ liệu thực, không bắt đi qua đủ các bước giới thiệu.
- Trái/phải theo hướng khán giả nhìn lên sân khấu. Không nhấn mạnh khoảng cách trừ khi khách hỏi.
- Giao lưu 20–30 phút là dự kiến; không hứa ca sĩ đến từng ghế.
- Chỉ báo khuyến mãi đang có hiệu lực và điều kiện thực tế.
- Nếu khách muốn nhân viên thật, ưu tiên yêu cầu đó, không tự động cướp lại cuộc chat khi vẫn đang chờ nhân viên.
- Chỉ gửi Voice khi khách đồng ý và transport đã kiểm chứng.
- Giữ nguyên hệ thống đang chạy; mọi thay đổi ở nhánh thử nghiệm trước khi được kiểm thử và duyệt phát hành.

## Thứ tự công việc tiếp theo
1. Xác minh luồng AI thực tế và Meta Messenger, không đoán rằng webhook hiện tại là toàn bộ hệ thống.
2. Tích hợp kịch bản chữ + bộ nhớ khách + AI-first/3 phút bằng trạng thái bền vững.
3. Chạy kiểm thử chữ đầu cuối, kiểm tra không trùng nhân viên.
4. Sau đó mới hoàn thiện Voice hai chiều, kiểm thử và phát hành.

**Báo cáo:** mỗi giai đoạn ghi rõ đã làm/chưa làm, mã commit/PR, bằng chứng kiểm thử, rủi ro và yêu cầu hỗ trợ. Không công bố hoạt động production khi chưa xác minh.

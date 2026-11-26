# EXTRA OS Admin staging

Ứng dụng Railway độc lập, dùng PostgreSQL riêng. Theo dõi công việc show và nhân sự từ giao diện hiện có. ONE CLICK 24H lưu lệnh Director, kết quả phụ thuộc, lần thử, phản hồi và phiên bản kiến thức Sale. Worker chạy trong admin-web. Các nhiệm vụ đang thực thi có thời hạn giữ chỗ và có thể được nhận lại sau khi dịch vụ khởi động lại.

## Kiểm tra

```sh
npm ci
npm run build
DIRECTOR_TEST_DATABASE_URL=postgresql://... npm test
```

Dùng cơ sở dữ liệu riêng để chạy kiểm thử tích hợp. Trên Railway staging/admin-web, lệnh `npm run test:staging-integration` được dùng làm bước tiền triển khai. Lệnh từ chối chạy ngoài đúng môi trường staging, sử dụng schema `test_...` riêng và dọn schema đó sau mỗi bài kiểm thử. Không trỏ `DIRECTOR_TEST_DATABASE_URL` vào cơ sở dữ liệu Music Production. Các bài này tạo và dọn schema kiểm thử, sử dụng fixture cho dịch vụ bên ngoài. Hàng đợi, kiểm thử và các báo cáo diễn tập không kích hoạt thanh toán hay tạo chiến dịch quảng cáo.

## Biến môi trường

| Dịch vụ | Biến |
| --- | --- |
| Admin và PostgreSQL staging | `ADMIN_BOOTSTRAP_PASSWORD` tối thiểu 24 ký tự, `DATABASE_URL` tham chiếu private đến PostgreSQL Railway riêng |
| Sale V 2.3 sandbox | `EXTRA_OS_SALE_LINK_TOKEN` thống nhất giữa hai dịch vụ, `EXTRA_OS_SALE_LINK_URL` là URL private hiện có. Trong sandbox đặt `EXTRA_OS_SALE_LINK_MODE=staging` và cấp `AI_GATEWAY_API_KEY` cho diễn tập tư vấn. |
| Director / Research / Planner / Content | `EXTRA_OS_OPENAI_API_KEY` với quyền Responses và Web Search, tùy chọn `EXTRA_OS_OPENAI_MODEL` |
| Creative | `EXTRA24H_IMAGE_API_KEY`, tùy chọn `EXTRA24H_IMAGE_MODEL`. Preview PNG chỉ mở được từ admin. |
| Drive | `EXTRA24H_DRIVE_FOLDER_ID`, `EXTRA_OS_DRIVE_CLIENT_ID`, `EXTRA_OS_DRIVE_CLIENT_SECRET`, `EXTRA_OS_DRIVE_REFRESH_TOKEN`. Cấp OAuth cho tài khoản có quyền thêm tệp trong thư mục riêng. Ảnh diễn tập chưa có quyền xuất bản. |
| Messenger 24H | `EXTRA24H_MESSENGER_APP_SECRET`, `EXTRA24H_MESSENGER_VERIFY_TOKEN`, `EXTRA24H_CRM_HASH_KEY`. Callback `/api/24h/messenger/webhook` kiểm tra chữ ký, chỉ nhận tin inbound Page 1413936608477545, lưu phân loại và mã băm để chống trùng. |
| Sapo Web đối soát | `EXTRA24H_SAPO_SHOP` và `EXTRA24H_SAPO_ORDERS_READ_TOKEN` đọc đơn của đúng cửa hàng. Đơn Sapo phải có thẻ `24h-<UUID chiến dịch không dấu gạch>` và trùng đúng biến thể giá đã xác minh trên website. |
| Meta Page tiền kiểm | `EXTRA24H_META_PAGE_TOKEN` và `EXTRA24H_META_GRAPH_VERSION` để xác minh token trỏ tới Page 24h EXTRA. |
| Meta Ads tiền kiểm | `EXTRA24H_META_GRAPH_VERSION` và `EXTRA24H_META_ADS_TOKEN` có quyền đọc tài khoản Lào Cai. Tiền kiểm chỉ đọc tiền tệ, trạng thái và ngân sách tối thiểu. |

Website đọc danh mục, giá và tồn kho từ Sapo Web nếu đã cấu hình ở Render. Luồng nội bộ chờ các kết nối xuất bản Sapo, đặt đơn thật, phản hồi Messenger, đăng bài Facebook và vận hành quảng cáo. Phần tài chính giữ nguyên nguồn và thời điểm tính. Ô doanh thu hoặc lợi nhuận vẫn trống khi chưa có số đối soát.

Khi cấp quyền còn thiếu, mở nhiệm vụ bị chặn và chọn **Yêu cầu làm lại**. Director tự đồng bộ các nhiệm vụ phụ thuộc và cập nhật báo cáo. Nếu một bài diễn tập Sale bị Director trả lại, hệ thống tạo phiên kiến thức mới và chỉ áp dụng sau khi nghiệm thu. Có thể khôi phục phiên đã qua kiểm tra trong mục kiến thức của chiến dịch.

## Kiểm thử 24H bằng dữ liệu mẫu

Trong **ONE CLICK 24H**, bấm **Chạy dữ liệu mẫu** để kiểm tra hàng đợi của 11 Agent, đọc danh mục mẫu ở Render, chạy bộ quy tắc mẫu của Sale V 2.3 và lấy mã biên nhận `DEMO-`. Lượt này dùng nội dung và số liệu thử nghiệm. Chi tiêu và lãi/lỗ mô phỏng nằm trong báo cáo mẫu riêng. Bạn có thể mở bảng **AI Director** hoặc tải báo cáo JSON sau khi lượt chạy kết thúc.

Railway `staging/admin-web` tự tạo hoặc tiếp tục một lượt kiểm thử mẫu khi triển khai phiên bản này, dựa trên mã yêu cầu cố định để tránh tạo trùng khi khởi động lại. Nhật ký `24H sample progress` chỉ ghi số lượng nhiệm vụ theo trạng thái và cờ có biên nhận mẫu; không ghi dữ liệu liên hệ.

Trong **Show và công việc**, người quản trị chọn người phụ trách trên nhiệm vụ có sẵn. Trang **Quản lý truy cập nhân sự** cấp mã dùng một lần cho cổng `/staff`. Nhân sự xem việc được giao, bắt đầu và gửi báo cáo. Admin có thể duyệt hoặc chuyển về **Đang làm** để yêu cầu cập nhật. Cổng này dùng cơ sở dữ liệu EXTRA OS staging.

### Đối soát nội bộ

Mở một chiến dịch ngoài chế độ mẫu trong **ONE CLICK 24H → Đối soát nội bộ 24H**. Ghi số lũy kế theo mã chứng từ hoặc bảng tổng hợp. Ô trống là chưa có số liệu và 0 là khoản đã được xác định bằng 0. Lãi/lỗ hiện khi đủ doanh thu, giảm giá, hoàn trả và các chi phí. Mỗi lần lưu tạo một phiên bản. Báo cáo JSON giữ mục `manualFinance` riêng với số đọc từ Sapo.

### Hàng đợi CRM 24H

**AI Director → Mở hàng đợi CRM 24H** hiển thị các hội thoại được ghi nhận qua webhook 24H để quản trị phân công, ghi chú và thay đổi trạng thái. Cổng nhân sự chỉ hiển thị hội thoại được giao. Hội thoại đã xử lý trở về hàng chờ khi có tín hiệu mua hàng hoặc hỗ trợ mới. Sự kiện yêu cầu ngừng liên hệ giữ hội thoại trong mục **Ngừng liên hệ**, kể cả khi có tin đến sau. Cổng xử lý nội bộ dùng mã băm của hội thoại.

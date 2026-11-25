# Vận hành EXTRA OS

Mở `/admin/ai-marketing` từ Admin. Super Admin tạo show, cấp quyền theo từng show và xem ngân sách, nhật ký, công việc cần xử lý. Tạo tài khoản ở **Nhân viên & phân quyền**, sau đó vào **EXTRA OS → Nhân sự** để giao vị trí. Vai trò **Nhân sự EXTRA OS** dùng cho người chỉ cần cổng nhiệm vụ. Nhân viên dùng luồng đăng nhập hiện tại. Khi bàn giao vị trí, hệ thống giữ báo cáo và tên tác giả; tài khoản cũ mất quyền đọc và ghi nhiệm vụ của vị trí qua EXTRA OS. Thu hồi riêng mọi quyền Drive cấp trực tiếp ngoài EXTRA OS nếu có.

## Môi trường kiểm thử

1. Tạo cơ sở dữ liệu Supabase riêng cho preview. Đặt `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` và `EXTRA_OS_PREVIEW_DATABASE_URL` của nhánh về cơ sở dữ liệu đó.
2. Chạy các migration hiện có theo thứ tự tên tệp, gồm hai migration `extra_os_*`. Database đã chạy các migration cũ chỉ cần áp dụng hai migration EXTRA OS sau khi kiểm tra bảng và quyền hiện tại.
3. Dùng dữ liệu thử. Cấp khóa đăng nhập Admin, tài khoản nhân sự và khóa cron dành riêng cho preview. Các hành động Facebook và quảng cáo bị tắt trên Vercel Preview. Khi thử Drive, dùng thư mục riêng và đặt `EXTRA_OS_PREVIEW_DRIVE_ROOT_ID` bằng ID thư mục kiểm thử.
4. Chạy `npm ci`, `npm run build`, `node --test tests/extra-os-domain.test.cjs` và `psql -f tests/extra-os-workspace.pg.sql` trên cơ sở dữ liệu dùng một lần. Bài SQL dùng giao dịch rollback.

## Bộ thực thi 24/7

Tạo hai mục Supabase Vault `extra_os_scheduler_origin` và `extra_os_scheduler_secret`. Origin là HTTPS tới cổng bán vé của môi trường. Secret là khóa `EXTRA_OS_CRON_SECRET` của Vercel. Chạy `supabase/extra-os-schedule.sql` trong cơ sở dữ liệu tương ứng để gọi worker mỗi hai phút. Với Vercel Preview có SSO, chỉ chạy lập lịch khi endpoint kiểm thử có đường truy cập xác thực phù hợp. Nút ONE CLICK tự chạy một lượt đầu, còn cron xử lý việc định kỳ và khôi phục các lượt bị ngắt. Xem `cron.job_run_details`, phản hồi `net._http_response` và **AI Director → Nhật ký hoạt động** để đối chiếu.

Hàng đợi giữ thời hạn theo từng lượt chạy, tránh giao trùng và thử lại có giãn cách. **Cấu hình** hỗ trợ tạm dừng từng AI hoặc toàn bộ hệ thống. Khi tạm dừng, quảng cáo và đóng bán có lượt xử lý an toàn riêng để dừng tiêu tiền và giữ đúng giờ bán.

## Tích hợp

| Hệ thống | Cấu hình và quyền cần cấp |
| --- | --- |
| OpenAI | API key project dùng riêng cho EXTRA OS và quyền gọi model Responses có Web Search. Đặt giới hạn chi phí của project theo ngân sách công ty. |
| Google Drive | Đăng ký OAuth của tài khoản chuyên dùng được cấp truy cập thư mục kho dữ liệu. Cấp quyền đọc tư liệu và tạo tệp trong các thư mục `04 – AI Marketing` và `06 – TikTok`. Dùng `EXTRA_OS_DRIVE_*` để cấu hình. Hệ thống đối chiếu cây thư mục, lưu ID và phiên bản, rồi cấp liên kết tải thông qua quyền bộ phận. |
| Meta Page | Page access token có quyền đăng bài `pages_manage_posts` và quyền đọc trang theo yêu cầu ứng dụng. |
| Meta Ads | Token `ads_management` và `ads_read`, quyền trên ad account dùng VND, Page, Pixel/Dataset và danh sách mã thành phố Meta. Ghi nhận cấu hình phụ phí phù hợp và kiểm tra sự kiện SePay/CAPI trong tài khoản quảng cáo. |
| TikTok | Nhân sự vận hành bằng nhiệm vụ có video và tư liệu. Có thể gửi liên kết video trong báo cáo nhiệm vụ. |
| SePay và Sale | Dùng cơ chế giữ chỗ, thanh toán, phát hành QR và đối soát đang có. Lịch show chỉ mở bán sau khi sức chứa khớp sơ đồ và SePay đã được cấu hình. |

Cấu hình bí mật trong Supabase Vault hoặc Environment Variables của Vercel. Cấp đúng môi trường cho từng khóa. Khi thử kết nối nhà cung cấp, kiểm tra nhật ký từng việc và chạy lại các mục báo thiếu quyền sau khi đã cấp quyền.

## Doanh thu và ngân sách

Giá gợi ý của các hạng dựa trên giá khởi điểm và số ghế thực tế theo hạng. Mục tiêu gồm chi phí, ngân sách quảng cáo và lợi nhuận. Dashboard ghi riêng doanh thu tối đa, kịch bản bán 70%, và doanh thu đã xác minh. Khoản chi thực tế được đọc từ sổ chi phí show. Nếu sổ chi phí chưa có dữ liệu, lợi nhuận thực tế chờ đối soát.

Meta Ads giữ ngân sách trước khi gọi API, dùng ngân sách trọn đời cho mỗi nhóm, và tách thử nghiệm khỏi phần mở rộng. AI chỉ mở rộng khi có vé đã thanh toán gắn với chiến dịch theo dữ liệu đồng ý theo dõi. **Đã chi** dùng số liệu Ads Insights hoặc hóa đơn đã ghi nhận. **Đang cam kết** giữ phần chưa được đối soát. Finance ghi hóa đơn cuối kỳ sau khi Meta xác nhận dừng. Kiểm tra khoản thuế và phụ phí của tài khoản trước khi bật `EXTRA_OS_MARKETING_LIVE`. Giữ riêng các chiến dịch EXTRA OS do worker quản lý để ngân sách Meta khớp với sổ chi.

Nếu Meta chưa xác nhận một thao tác tạo, worker giữ mã thao tác trong `extra_os_effects` để tránh tạo trùng. Đối chiếu tên chiến dịch và thời điểm theo nhật ký tài khoản Meta trước khi khôi phục. Nhóm có trạng thái kích hoạt chưa xác định được dừng ở lượt giám sát tiếp theo khi thông tin kết nối còn hoạt động.

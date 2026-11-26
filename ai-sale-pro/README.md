# AI Sale Extra 2.4 Pro

Bản tích hợp để nghiệm thu trên nhánh `feature/ai-sale-2.4-pro`. Cổng phát hành phụ thuộc vào xác minh tuyến Zalo OA nội bộ, staging độc lập và phê duyệt của chủ hệ thống.

## Nguồn triển khai đã đối chiếu

| Bản | Commit nguồn | Deployment Vercel |
| --- | --- | --- |
| Bản vá đang phục vụ `iextra.net`, `admin.iextra.net` và `sale.iextra.net` khi rà soát | `5310411797e97fc890ad1973d3b6e21057a6dfba` | `dpl_FPxGEFPLMAcRvqUX42dj6r9v3CxM` |
| 2.3 có nhắc khách sau 3 và 60 phút | `8bba56af6b3dd401250c1d150579c4c5433d5606` | `dpl_77e3PqQ3rM8PtSfBCx9qr7eQ4xbj` |

Hai SHA khớp metadata Git của Vercel. Nhánh thử nghiệm bắt đầu từ `c4c3ecd3ae9ca5f014142abbfb2b630e610b60a4`. Nội dung AI Sale trong các deployment này nằm trên các nhánh khác. Gói tích hợp dựng từ hai SHA đã xác minh, chạy các bước tạo nguồn của bản gốc và áp dụng các bản vá theo từng cấu hình. Cách này giữ lịch sử nhánh thử nghiệm và cho phép duyệt riêng phần bổ sung.

Bộ quét cũ là `runAiSalesFollowup` trong `lib/ai-sales-followup.ts`. `/api/cron/ai-sales` được gọi mỗi phút, chạy worker AI, nhắc D-1, kiểm tra khách chờ nhân viên và quét nhắc 3/60 phút. Các lượt nhắc 3/60 có khóa truy vấn, sổ gửi và đối chiếu người mua trong Supabase. Cổng Messenger ký webhook rồi dùng RPC `extra_support_ingest_messenger` để chống lặp. Worker còn được gọi sau webhook, Admin và sự kiện thanh toán.

Nguồn Zalo đã thấy là OAuth OA và ZBS gửi vé trong `lib/zalo-zbs.ts`. Thông báo chốt đơn hiện tại đi qua Resend trong `lib/ai-sales-notifications.ts`. Danh mục cấu hình triển khai chưa cho thấy tuyến Zalo nội bộ có định danh riêng cho Trang và chủ hệ thống. Tiến trình tạo thông báo nội bộ ghi vào hàng đợi và giữ trạng thái chờ gửi cho đến khi có bộ gửi đã xác minh.

## Tệp bàn giao

| Tệp | Thay đổi |
| --- | --- |
| `lib/ai-sale-pro/policy.ts`, `operator.ts` | Nhận diện lý do bàn giao và xác thực cú pháp lệnh nội bộ |
| `lib/ai-sale-pro/database.ts`, `dispatch.ts` | Gọi RPC qua kết nối Supabase hiện có, kiểm tra khóa và phiên bản ở thời điểm gửi, ghi biên nhận |
| `lib/ai-sale-pro/seats.ts` | Đối chiếu mã ghế, kiểm tra tồn, tạo PNG từ bố cục đúng show và chuẩn bị tệp đính kèm trực tiếp |
| `lib/ai-sale-pro/reporting.ts` | Soạn thông báo Trang và báo cáo riêng theo đối tượng, đồng hồ có thể giả lập, bộ gửi nội bộ có thể thay bằng mock |
| `supabase/migrations/20261126195256_ai_sale_pro_handoffs_and_reports.sql` | Các bảng, index, RPC, quyền dịch vụ và trigger bổ sung cho khóa, sổ gửi, audit và báo cáo |
| `ai-sale-pro/integration/shared.patch` | Tích hợp các điểm gửi Messenger, sổ 3/60, nhắc ngắn, D-1, timeout, tin riêng từ bình luận, cron báo cáo, Admin và Sale |
| `ai-sale-pro/integration/pro.patch`, `rollback-2.3.patch` | Các thay đổi theo SHA nền, gồm đính kèm và phân loại của Pro cùng cơ chế khóa dùng chung cho 2.3 |
| `ai-sale-pro/prepare.mjs`, `deny-external.cjs`, `test.mjs` | Dựng hai bản từ snapshot và chạy kiểm thử cục bộ cô lập |
| `ai-sale-pro/tests/legacy-schema.sql`, `integration.test.cjs` | DDL dùng riêng cho fixture, dữ liệu mô phỏng, kiểm thử hồi quy và ca đồng thời |

## Quy tắc vận hành

- Khóa lưu trong Supabase và tồn tại qua thay đổi phiên bản. DB chỉ cho một bản lấy quyền gửi theo cờ chọn phiên bản. Mỗi hội thoại có một lượt gửi đang xử lý. Tiến trình kiểm tra lại ngay trước khi gọi Messenger. Yêu cầu đã tới nhà cung cấp có thể hoàn tất trong lúc khóa được ghi. Hệ thống giữ dấu vết và chặn lượt mới. Khi mất biên nhận, tiến trình ghi trạng thái chưa xác định và chuyển xử lý.
- Trang hoặc Sale được cấp quyền dùng tài khoản nhân viên riêng và mục **Bàn giao AI Sale** trong hộp thư. Admin có thể xem lý do, thời điểm, lượt gửi và người đã dùng lệnh. Khi phản hồi **Đã xử lý xong**, hệ thống đối chiếu show và đơn có liên hệ đã xác minh. Nhắc 3/60 giữ điều kiện đủ và sổ chống trùng cũ. Đã thanh toán thì dừng lời mời mua. Chưa xác định thanh toán thì giữ khóa.
- Ảnh PNG dùng dữ liệu `managed_shows`, số ghế theo hàng, ghế bị khóa, vé đã xác minh và đơn giữ ghế. Bản Pro dùng ảnh đính kèm từ byte PNG. Kiểm tra tồn trước khi giữ dùng cùng dữ liệu. RPC đặt ghế hiện có tiếp tục thực thi kiểm tra xung đột trong giao dịch.
- Báo cáo Trang lấy hàng chờ gồm bàn giao, lỗi và hội thoại mở chưa chốt hoặc chưa xác định trạng thái. Mỗi mục có tên, trạng thái, lý do, thời điểm và liên kết vào hộp thư Admin. Tài khoản người nhận cần có quyền mở liên kết nội bộ.
- Báo cáo chủ hệ thống dùng khoảng nửa mở theo giờ Việt Nam. Tại 00:00, giờ vừa kết thúc được tổng hợp vào ngày trước. Mẫu số gồm chat Messenger có tin khách hoặc có đơn AI Sale thanh toán trong kỳ. Chốt là số chat duy nhất có đơn thanh toán trong kỳ. Đơn liên kết duy nhất đóng góp số tiền SePay đã đối soát. Thiếu biên nhận được ghi là chưa đủ xác nhận. Lỗi và bàn giao đang chờ tính tại thời điểm chốt kỳ.
- Tin nhắn riêng phát sinh từ bình luận cần liên hệ Messenger đã xác minh khi bật Pro. Các lượt chưa nối được danh tính cần nhân viên xử lý. Đây là điểm cần chủ hệ thống duyệt cùng phạm vi ảnh hưởng đến luồng bình luận tự động.

## Kiểm thử cục bộ

Yêu cầu Node.js 24, Git và Docker. Dùng bản clone chứa hai commit nguồn. Lệnh dựng in đường dẫn `AI_SALE_CHECKOUT` của mỗi bản.

```sh
npm ci
node ai-sale-pro/prepare.mjs pro ./work/ai-sale --build
node ai-sale-pro/prepare.mjs rollback ./work/ai-sale --build
node ai-sale-pro/test.mjs /duong-dan-ban-pro /duong-dan-ban-rollback
```

Trình kiểm thử tạo PostgreSQL riêng bằng container `--network none`, kiểm tra tên DB và nhãn cô lập rồi nạp DDL và dữ liệu mô phỏng. Messenger và Zalo dùng mock. Lịch báo cáo dùng đồng hồ giả lập. Có thể đặt `EXTRA_SALE_TEST_PNG` trỏ vào một tệp mới trong thư mục làm việc để lưu ảnh PNG mẫu. Dùng tài khoản và bí mật thử nghiệm riêng khi có staging đã xác minh.

## Kết quả kiểm thử

| Lượt kiểm tra | Đạt | Trượt | Bỏ qua |
| --- | ---: | ---: | ---: |
| Tích hợp PostgreSQL cô lập, Messenger và Zalo giả lập | 18 | 0 | 0 |
| Kiểm thử có sẵn trong build Pro | 106 | 0 | 1 |
| Kiểm thử có sẵn trong build rollback 2.3 | 106 | 0 | 1 |
| Hồi quy cây mã trên nhánh thử nghiệm | 172 | 0 | 0 |

`next build` và `tsc --noEmit` đạt trên bản tích hợp Pro và bản rollback. Các bộ kiểm thử kế thừa trong hai build có phần trùng nhau. Mỗi build bỏ qua smoke test Google Places/Routes cần môi trường Preview riêng.

Bài kiểm thử tạo PNG cho CCC, Lào Cai và Moana, đối chiếu mọi nhãn ghế, thử upload byte ảnh, kiểm tra webhook được ký và gửi đồng thời hai bản giống nhau. PostgreSQL kiểm tra một người giữ được ghế khi hai yêu cầu tranh cùng vị trí. Các ca còn lại kiểm tra lỗi Meta và Supabase, quyền nhân viên, lỗi Zalo mock, nguồn tiền SePay, mốc 00:00, khóa chung và hai mốc nhắc 3/60 phút sau rollback. Có thể tái tạo từ lệnh ở trên. [Mã kiểm thử](tests/integration.test.cjs)

Chưa có lượt chạy của bốn hạng mục nghiệm thu mạng là Messenger sandbox, Zalo OA sandbox, Supabase hosted riêng và staging đầu cuối. Tài nguyên `extra-messenger-test` hiện thuộc pilot trước với cấu hình và schema riêng. Chưa có một bộ cấu hình staging Pro độc lập đã xác minh cho DB, hàng đợi, lưu trữ và webhook.

## Trước khi phát hành

1. Xác minh tuyến Zalo OA nội bộ, hai người nhận và quyền truy cập hộp thư của Trang. Gắn bộ gửi hiện hữu vào hàng đợi nội bộ và kiểm tra biên nhận trên sandbox chuyên dụng.
2. Chuẩn bị staging có xác thực, DB, hàng đợi, webhook, lưu trữ và danh tính riêng. Xác minh quota cho phép dùng tài nguyên hiện có. Preview của nhánh Git đang dựng cây nguồn của nhánh, còn bản tích hợp được dựng bằng `prepare.mjs`.
3. Chủ hệ thống duyệt cách gắn đơn vào chat, cách xử lý người mua, quy tắc nhắc khách và luồng tin riêng từ bình luận. Kiểm tra độ trễ gửi ảnh và kích thước báo cáo với dữ liệu thử đủ lớn.
4. Sau khi được duyệt mới lên lịch migration. Xác minh phiên bản schema, công việc đang gửi, trạng thái bàn giao và quyền `service_role`. Lưu bản phê duyệt migration và xác định webhook/cron duy nhất. Kiểm thử rollback đã bảo toàn khóa trên chính staging.
5. Duyệt riêng việc bật Pro và gửi tin qua các kênh thật. Đối chiếu phiên bản hiện chạy ngay trước khi chuyển.

## Rollback về 2.3

Dùng bản `rollback` dựng từ `8bba56a` cùng các chốt khóa đã kiểm thử. Trước khi chuyển, tạm dừng nhận lượt mới và đối chiếu các lượt gửi đang xử lý. Chọn chế độ 2.3 trong `extra_sale_pro_config`, đặt `AI_SALE_2_4_PRO_ENABLED=false` và chuyển webhook/cron sang bản rollback đã kiểm thử. Giữ migration và toàn bộ khóa, audit, sổ gửi và thông báo đang chờ. Chạy lại kiểm tra khách đã trả tiền, khách đủ điều kiện nhắc và hội thoại bị khóa trước khi mở lượt mới.

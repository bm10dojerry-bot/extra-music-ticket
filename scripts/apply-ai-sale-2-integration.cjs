"use strict";
const fs=require("node:fs");
const assert=require("node:assert/strict");
const file="lib/ai-sales-consultation.ts";
let s=fs.readFileSync(file,"utf8");
const marker="export const consultationPolicy = [";
assert.equal(s.split(marker).length,2,"Expected exact production consultation policy marker");
const addition=["Khi khách nói muốn ngồi sát sân khấu, ưu tiên tư vấn các ghế CÒN TRỐNG gần sân khấu trong phạm vi ngân sách/hạng vé, dựa theo dữ liệu sơ đồ/ghế thực tế của đúng show. Phân biệt khoảng cách đến sân khấu với hướng nhìn trái/phải/chính diện. Không tự suy đoán hàng ghế hay khoảng cách.","Khi khách hỏi góc nhìn: giải thích trái/phải theo góc nhìn của KHÁN GIẢ nhìn lên sân khấu, và chính diện khi có dữ liệu chính xác. Nếu thiếu bản đồ/hướng chính xác, nói chưa xác định thay vì đoán; có thể hỏi khách ưu tiên gần sân khấu hay nhìn chính diện.","Trạng thái ghế phải lấy từ dữ liệu tồn ghế đúng show ở thời điểm trả lời. Ghế xám, bị khóa, đang giữ, đã bán hoặc không khả dụng tuyệt đối KHÔNG tư vấn là có thể đặt. Giải thích rõ ghế bị khóa/màu xám không đặt được; đề xuất ghế trống thay thế, không được tự tạo mã ghế.","Không tự giữ chỗ/chốt đơn khi khách chỉ tham khảo. Chỉ giữ đúng ghế theo quy trình sau khi khách đồng ý; dùng hàm hiện tại để kiểm tra tình trạng và mức giá theo show, không sáng tác giá hay khuyến mãi.","Khách đã thanh toán: tuyệt đối chỉ xác nhận khi có trạng thái thanh toán VERIFIED từ hệ thống. Hỗ trợ tra mã đơn, email vé QR, tình trạng phát hành và vị trí đã chốt; không yêu cầu chuyển khoản lại nếu đã paid. Khi chưa xác thực, hướng dẫn kiểm tra, không tự kết luận.","Tiếp tục hỗ trợ sau bán: nếu khách hỏi số tài khoản ngân hàng sau khi đã báo trả tiền thì phải kiểm tra đơn trước; khi đã thanh toán đủ thì trả lời KHÔNG CẦN thanh toán thêm, ưu tiên hướng dẫn vé và check-in. Không bịa thông tin chuyển khoản.","Chào khách một lần bằng tên Facebook phù hợp nếu có, chúc theo giờ địa phương; không suy đoán giới tính và không hỏi lại show đã xác định từ quảng cáo hoặc lịch sử trò chuyện. Luôn nhớ show, số vé, hạng, ngân sách, nhu cầu hàng gần sân khấu.","Không cam kết đã gửi hai ảnh sơ đồ qua Facebook nếu chưa có xác nhận hệ thống gửi thành công. Không chủ động hứa gọi điện/voice; phiên bản phát hành hiện chỉ cải tiến hội thoại văn bản Messenger."];
for(const rule of addition){assert(!s.includes(rule),"Patch must not be applied twice");}
s=s.replace(marker,()=>marker+"\n"+addition.map(rule=>"  "+JSON.stringify(rule)+",").join("\n"));
fs.writeFileSync(file,s);
const worker=fs.readFileSync("lib/ai-sales.ts","utf8");
assert(worker.includes("consultationPolicy"),"Production Messenger AI worker not wired to consultation policy");
assert(worker.includes("getAiSeatOptions"),"Missing production seat availability tool");
assert(worker.includes("getAiOrderStatus"),"Missing production order status tool");
assert(worker.includes("deliverTickets"),"Missing production ticket delivery");
console.log("[extra-ai-sale-2] production consultation rules injected, checkout / payments untouched, rule count:",addition.length);

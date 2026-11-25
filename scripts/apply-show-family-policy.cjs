const fs = require("node:fs");
const assert = require("node:assert/strict");
function patch(path, pairs) {
  let source = fs.readFileSync(path,"utf8");
  for (const [before,after] of pairs) {
    assert.equal(source.split(before).length,2,"Unexpected integration point: "+before);
    source=source.replace(before,()=>after);
  }
  fs.writeFileSync(path,source);
}
patch("lib/ai-sales-checkout.ts",[
  ['import "server-only";','import "server-only";\nimport {artistPhotoNotice,validChildSeats} from "./show-family-policy";'],
  ["seats:string[];giftSeats?:string[]","seats:string[];childSeats?:string[];giftSeats?:string[]"],
  ["seats:string[];giftSeats:string[]","seats:string[];childSeats?:string[];giftSeats:string[]"],
  ["  const giftSeats=input.giftSeats", "  const childSeats=input.childSeats===undefined?[]:input.childSeats;\n  if(!validChildSeats(childSeats,input.seats))invalid();\n  const giftSeats=input.giftSeats"],
  ["seats:input.seats,giftSeats","seats:input.seats,childSeats,giftSeats"],
  ['    quote.giftSeats.length?', '    quote.childSeats?.length?"Ghế vé trẻ em (70%): "+quote.childSeats.join(", "):"",\n    quote.giftSeats.length?'],
  ['return {code,url,message,emailStatus};','return {code,url,message:message+"\\n"+artistPhotoNotice,emailStatus};']
]);
patch("lib/ai-sales.ts",[
  ['import "server-only";','import "server-only";\nimport {artistPhotoNotice,childFareNotice} from "./show-family-policy";'],
  ['const instructions=`','const instructions=`Áp dụng quy định poster trong consultationPolicy cho 7 show ghi rõ. Chỉ với các show khác áp dụng quy định vé trẻ em hiện có: ${childFareNotice} Nếu chưa rõ tuổi vào ngày diễn hoặc bé có ngồi riêng, hỏi trước khi lập báo giá. Chỉ thêm ghế riêng của trẻ đủ điều kiện vào childSeats. Tra đúng show và giá hạng tương ứng khi khách hỏi giá tiền. Không tính ghế cho bé ngồi cùng. Khi khách hỏi chụp ảnh: ${artistPhotoNotice} Không xác nhận đã đăng ký thay ban tổ chức. Khách báo đã chuyển khoản: tra order_status của đúng khách trước khi trả lời.\\n'],
  ['giftSeats:z.array','childSeats:z.array(z.string().regex(/^[A-O][0-9]{2}$/)).max(20).optional(),giftSeats:z.array'],
  ['  const advice = !confirmationProblem', '  const normalized=latest.body.normalize("NFD").replace(/\\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase();\n  const familyTopic=/\\b(uu dai|khuyen mai|cap doi|qua tang|qua luu niem|vong tay|vong deo tay|gay phat sang|tre em|tre nho|em be|con nho|be|tuoi|chup anh|chup hinh|da chuyen|da thanh toan)\\b/.test(normalized);\n  const advice = !familyTopic && !confirmationProblem'],
  ['  const advice = !familyTopic', `  const reportsTransfer=/\\b(?:da (?:chuyen (?:khoan|tien)|thanh toan)|(?:chuyen (?:khoan|tien)|thanh toan)(?: xong)? roi)\\b/.test(normalized) && !/\\b(neu|gia su|chua|khong)\\b/.test(normalized);
  if(reportsTransfer){
    const stated=latest.body.toUpperCase().match(/\\bEX[0-9A-F]{16}\\b/)?.[0];
    const found=stated?await getAiOrderStatus(chat.id,stated):currentOrder;
    const ticket=found?.status==="paid"?await getAiPaidTicketDelivery(chat.id,found.code,extraPaymentAddress(history)):null;
    const status=found?.status==="paid"?"Em vừa đối chiếu, hệ thống đã xác nhận thanh toán của mình.":found?.status==="pending"?"Em vừa kiểm tra đơn của mình. Hệ thống đang chờ xác nhận tiền về. Mình giữ lại biên lai và chưa cần chuyển thêm nhé.":found?"Em đã đối chiếu đơn nhưng chưa có xác nhận thanh toán. Mình giữ biên lai để ban tổ chức kiểm tra nhé.":"Mình gửi giúp em mã đơn EXTRA để em đối chiếu đúng giao dịch nhé.";
    await guard(job);
    await sendAiSalesMessage(job,chat,ticket&&found?{purpose:"ticket",body:ticket.message,orderCode:found.code}:{purpose:"reply",body:status});
    return;
  }
  const advice = !familyTopic`],
  ['const quickReply=(!action','const quickReply=(!familyTopic&&!action']
]);

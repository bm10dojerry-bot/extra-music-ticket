import {z} from 'zod';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const day=z.iso.date();
const row=z.strictObject({
  day,showId:z.string().regex(/^[a-z0-9_-]{1,100}$/i),
  inquiryChats:count,engagedChats:count,quotedChats:count,checkoutChats:count,paidChats:count,
  repeatedContactChats:count,paidRepromptChats:count
}).refine(r=>r.inquiryChats>=r.engagedChats&&r.engagedChats>=r.quotedChats&&r.quotedChats>=r.checkoutChats&&
  r.checkoutChats>=r.paidChats&&r.repeatedContactChats<=r.inquiryChats&&r.paidRepromptChats<=r.inquiryChats);
export const musicAuditInput=z.strictObject({day,rows:z.array(row).min(1).max(25)})
  .refine(input=>input.rows.every(r=>r.day===input.day)&&new Set(input.rows.map(r=>r.showId)).size===input.rows.length);

export function reviewMusicAudit(input:z.infer<typeof musicAuditInput>){
  const reviews=input.rows.map(r=>{
    const findings:string[]=[];
    const unanswered=r.inquiryChats-r.engagedChats;
    const unquoted=r.engagedChats-r.quotedChats;
    const noOrder=r.quotedChats-r.checkoutChats;
    const unpaid=r.checkoutChats-r.paidChats;
    if(unanswered)findings.push(unanswered+' hội thoại chưa thấy phản hồi trong ngày. Rà thời gian nhận và người phụ trách.');
    if(unquoted)findings.push(unquoted+' hội thoại đã phản hồi nhưng chưa có báo giá ghi nhận. Kiểm tra khách hỏi thông tin hay cần chọn ghế.');
    if(noOrder)findings.push(noOrder+' hội thoại đã báo giá, chưa nối được đơn giữ ghế trong ngày. Kiểm tra xác nhận ghế và thông tin đặt vé.');
    if(unpaid)findings.push(unpaid+' hội thoại đã tạo đơn nhưng chưa nối được thanh toán cùng ngày. Kiểm tra hết hạn, chuyển khoản và đối soát trước khi nhắc khách.');
    if(r.repeatedContactChats)findings.push(r.repeatedContactChats+' hội thoại có dấu hiệu hỏi email hoặc điện thoại nhiều lần. Rà lời khách: giữ ghế và thông tin đã hợp lệ, chỉ hỏi đúng trường thiếu hoặc sai định dạng.');
    if(r.paidRepromptChats)findings.push(r.paidRepromptChats+' hội thoại ghi nhận AI gửi yêu cầu thanh toán sau khi chính đơn đó đã trả tiền. Kiểm tra trạng thái đơn trước khi gửi và chuyển sang hỗ trợ nhận vé.');
    if(!findings.length)findings.push('Trong nhóm hội thoại đo được chưa thấy khâu rơi hoặc dấu hiệu cần rà.');
    return {showId:r.showId,findings};
  });
  return {source:'music_conversation_audit',day:input.day,reviews};
}

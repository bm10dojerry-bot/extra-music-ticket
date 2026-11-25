import {askedOffer,normalizePosterTiers,posterAdvice,tierName} from "./poster-offers";
import type {AiSalesShow} from "./ai-sales-checkout";
import {artistInteractionExplanation, seatViewQuestion} from "./extra-sale-text-script";
import {customerRequestsHuman, deriveMessengerSaleMemory} from "./messenger-sale-memory";
import {norm, sensitiveQuestion, wantsVenue, wantsSchedule} from "./ai-sales-timeout-policy";

type Message = {sender:string; body:string; staff_name?:string|null};
type Tier = keyof AiSalesShow["prices"];
const tiers: Tier[] = ["A","B","C","D"];
export const consultationPolicy = [
  posterAdvice,
  "Khi khách chỉ cảm ơn, đáp một câu ấm áp. Khi khách lo ngại, ghi nhận đúng điều họ vừa nói và hỏi tối đa một điều còn thiếu. Khi khách nói để bàn với gia đình, cho khách thời gian quyết định. Xưng em; chỉ dùng anh/chị khi cách tự xưng đã rõ.",
  "Ban tổ chức có điểm bán nước trong khu diễn và khách có thể gọi nước tại quầy. Vé đêm Đình Dũng 28/11 không kèm nước; với đêm khác chỉ nêu quyền lợi đã xác nhận. Chỉ dùng số bài dự kiến đã công bố của đúng show và địa chỉ chính thức từ danh mục. Không hứa mang nước tới ghế, số bài biểu diễn thực tế hoặc lối xe lăn khi chưa xác nhận.",
  "Tư vấn đúng show đang mở bán. Nếu khách đến từ quảng cáo hoặc bình luận có show đã đối chiếu, nhắc đúng tên show trong câu mở đầu. Nếu khách hỏi cụ thể, trả lời ngay.",
  "Khách hỏi giá một hạng thì báo riêng hạng đó theo giá hiện hành của show. Chỉ đưa cả bảng khi khách hỏi chung hoặc yêu cầu tất cả. Khách chỉ tham khảo thì dừng sau khi trả lời.",
  "Nhớ show, số người, hạng, ngân sách và hướng nhìn. Khi khách muốn chọn ghế mà chưa biết hướng, hỏi: "+seatViewQuestion,
  "Khi khách lo ngồi xa hoặc hỏi giao lưu, giải thích: "+artistInteractionExplanation,
  "Khi khách đang cân nhắc hai vé, đề nghị kiểm tra hai ghế phù hợp ngân sách và góc nhìn. Dùng dữ liệu ghế còn trống theo show trước khi gợi ý vị trí. Chỉ giữ ghế sau khi khách đồng ý báo giá.",
  "Chỉ nêu ưu đãi đã xác minh cho đúng show và điều kiện số vé. Không chọn hộ hạng hay suy ra hướng nhìn từ chữ hàng ghế.",
].join("\n");

export function salesPreferences(messages:readonly Message[], shows:AiSalesShow[], referral?:string|null) {
  return deriveMessengerSaleMemory({
    messages:messages.map(m=>({sender:m.sender==="customer"?"customer":m.staff_name==="EXTRA AI"?"ai":"staff",body:m.body})),
    shows, referral:referral?{ref:referral}:undefined
  });
}

export function askedTiers(question:string):Tier[] {
  const text=question.normalize("NFC").toLowerCase().replace(/hàng\s+(?:ghế\s+)?[a-d]\b/gu,"dãy ghế");
  const normalized=norm(normalizePosterTiers(text).replace(/[,/;&+]/g," và "));
  const groups=[...normalized.matchAll(/\b(?:hang(?: ve)?|khu(?: vuc)?|zone|loai ve)\s+([a-d](?:\s+(?:va|hay|hoac|voi)\s+[a-d])*)\b/g)];
  return [...new Set(groups.flatMap(m=>m[1].split(/\s+(?:va|hay|hoac|voi)\s+/).map(z=>z.toUpperCase() as Tier)))];
}

export function tierPriceQuestion(text:string) {
  return askedTiers(text).length>0 && /\b(?:gia|bao nhieu|het nhieu|may tien)\b/.test(norm(text));
}

export function priceLines(show:AiSalesShow,text:string, previousTier?:Tier) {
  const all=/\b(?:tat ca|toan bo|ca bon|ca 4|tung hang|cac hang|bang gia day du)\b/.test(norm(text));
  const explicit=askedTiers(text);
  const requested=all?tiers:explicit.length?explicit:previousTier?[previousTier]:tiers;
  return requested.map(tier=>{
    const price=show.prices[tier];
    return Number.isSafeInteger(price) && price!==null && price>0
      ? tierName(show.id,tier)+": "+price.toLocaleString("vi-VN")+"đ/vé."
      : "Em chưa xác minh được giá hạng "+tier+" của suất này ạ.";
  }).join("\n");
}

export async function directTierReply(messages:readonly Message[], referral:string|null|undefined, loadShows:()=>Promise<AiSalesShow[]>) {
  const question=messages.at(-1)?.body??"";
  if(askedOffer(question) || !tierPriceQuestion(question) || sensitiveQuestion(question) || customerRequestsHuman(question))return null;
  const text=norm(question);
  if(/\b(?:dat|giu|mua|con ghe|con ve|so do|goi|giao luu|uu dai|khuyen mai|giam|thanh toan|khong nhan|hoan|cho ngoi|loi di|vi tri|vi sao|tai sao|so sanh|khac nhau|bao gom|kem|goc|tam nhin|ngan sach|tong|bao nhieu ve|xa|gan|gia tre em|tre nho)\b/.test(text))return null;
  const shows=await loadShows();
  const memory=salesPreferences(messages,shows,referral);
  const show=shows.find(s=>s.id===memory.showId);
  if(!show || memory.humanRequested)return null;
  const lines=["Dạ, đêm nhạc "+show.artist+" ngày "+show.date.slice(8,10)+"/"+show.date.slice(5,7)+".",priceLines(show,question)];
  if(wantsVenue(question))lines.push("Địa điểm: "+show.venueName+" – "+show.venueAddress+".");
  if(wantsSchedule(question))lines.push("Giờ diễn: "+show.time.slice(0,5)+".");
  return lines.join("\n");
}

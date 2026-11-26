import "server-only";
import {customerRequestsHuman} from "./messenger-sale-memory";
import {getAiSeatSnapshot} from "./ai-sales-checkout";
import {tierName} from "./poster-offers";
export const HANDOFF_REPLY="Dạ, anh/chị vui lòng đợi ít phút, bộ phận Sale hoặc chăm sóc khách hàng sẽ trực tiếp hỗ trợ mình ạ.";
const norm=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function asksForStaff(body:string){
 const s=norm(body);
 if(/\b(?:khong|ko|k) (?:can|muon|xin) (?:gap |lien he |noi chuyen voi )?(?:ban quan ly|quan ly|cskh|cham soc khach hang|hotline)\b/.test(s))return false;
 return customerRequestsHuman(body)||/\b(?:gap|lien he|noi chuyen voi|chuyen cho|chuyen den|goi|xin so|cho xin|cho minh xin|cho anh xin|cho chi xin)\s+(?:(?:bo phan|ben|phong|so|nguoi) )?(?:cskh|cham soc khach hang|ban quan ly|quan ly|hotline|admin)\b/.test(s)||/^(?:cskh|cham soc khach hang|ban quan ly|hotline)(?: (?:oi|a|em|giup minh|ho tro))?$/.test(s);
}
export function unableToAnswer(body:string){
 const s=norm(body);
 return /\b(?:em|ben em|he thong) (?:chua|khong|tam chua|hien chua) (?:the )?(?:hieu|doc (?:duoc |ro )?(?:noi dung|anh|tin nhan)|biet cach tra loi|co du (?:du lieu|thong tin)|kiem tra duoc|tai duoc|xac minh duoc)\b/.test(s)
 || /\b(?:ngoai tham quyen|ngoai pham vi ho tro|can nguoi phu trach kiem tra|can nho bo phan phu trach kiem tra|chua hoan tat lap don)\b/.test(s);
}
export function seatCodes(body:string){
 const out:string[]=[];
 for(const m of body.toUpperCase().matchAll(/(?:^|[^A-Z0-9])([A-O])([0-9]{1,2})(?![A-Z0-9])/g)){
  const n=Number(m[2]);if(n>=1&&n<=80)out.push(m[1]+String(n).padStart(2,"0"));
 }
 return [...new Set(out)].slice(0,20);
}
export function simpleSeatQuestion(body:string){
 const s=norm(body);
 return seatCodes(body).length>0&&s.length<150&&!/@|(?:0[0-9]{8,10})/.test(body)&&!/\b(?:dat|chot|mua|giu|thanh toan|chuyen khoan|ten|email|dien thoai|tang)\b/.test(s)&&(/\b(?:ghe|cho|vi tri|hang|con|trong|gia|bao nhieu|o dau)\b/.test(s)||/^(?:[a-o][0-9]{1,2}\s*)+$/.test(s));
}
export async function exactSeatDetails(showId:string,ids:readonly string[]){
 const fresh=await getAiSeatSnapshot(showId);
 const rows=ids.map(id=>{
  const seat=fresh.seats.find(s=>s.id===id);
  if(!seat)return {id,status:"not_found" as const};
  const price=fresh.show.prices[seat.zone as "A"|"B"|"C"|"D"];
  return {id,status:fresh.taken.has(id)||price===null?"unavailable" as const:"available" as const,row:seat.row,number:seat.number,tier:tierName(showId,seat.zone),price};
 });
 return {show:fresh.show,rows,checkedAt:new Date().toISOString()};
}
export function formatExactSeats(data:Awaited<ReturnType<typeof exactSeatDetails>>){
 const lines=data.rows.map(s=>s.status==="not_found"?s.id+": không có trong sơ đồ show này.":s.id+" · hàng "+s.row+", ghế "+s.number+" · "+s.tier+" · "+(s.status==="available"?"đang trống":"không khả dụng")+(typeof s.price==="number"?" · "+s.price.toLocaleString("vi-VN")+"đ":""));
 return "Đêm "+data.show.artist+" tại "+data.show.venueName+":\n"+lines.join("\n")+"\nĐây là tình trạng lúc kiểm tra, chưa giữ ghế.";
}

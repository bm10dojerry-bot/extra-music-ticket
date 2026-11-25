type Turn = {sender:string;body:string;staff_name?:string|null};
const words=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export const clarifyBookingPage="Mình muốn tự chọn ghế cho đêm nhạc của nghệ sĩ nào ạ?";
export const chatFirstPolicy="Tư vấn ngay trong Messenger. Khách hỏi giá, góc nhìn, ghế gần ca sĩ hay ghế trống thì trả lời bằng giá và vị trí đã kiểm tra của đúng show. Nhớ số người và khoảng giá đã có; chọn một câu hỏi tiếp theo phù hợp hoặc dừng nếu đã đủ. Khách muốn mua qua chat thì tiếp tục đặt ngay trong chat. Chỉ đưa đường dẫn chọn ghế khi khách chủ động xin link hoặc nói muốn tự chọn trên web. Máy chủ gắn đúng đường dẫn khi cần. Tin tư vấn bình thường có thể dùng một emoji phù hợp; giao dịch, hỗ trợ sự cố, khiếu nại cần giọng rõ ràng và điềm tĩnh.";

const unrelated=/\b(?:chuyen khoan|thanh toan|bien lai|hoa don|ma qr|ve dien tu|check in|checkin|hoan tien|khieu nai|hotline|google maps|zalo|lien he|trang ca nhan|chi duong|ban do duong di|facebook|fanpage|video|livestream)\b/;
const negative=/\b(?:dung|thoi|khoi|khong|ko|k|chua|chang) (?:can |muon |phai )?(?:(?:gui|dua|nhan|xem|mo|vao|chon|xin|bam|tu) ){0,3}(?:them |lai )?(?:cai )?(?:link|lien ket|duong dan|web|trang web|tu chon)\b/;
export function wantsBookingPage(body:string,history:readonly Turn[]=[]){
  const s=words(body);
  if(!s||negative.test(s)||unrelated.test(s))return false;
  if(/\b(?:co (?:bat buoc|can|phai)|bat buoc|phai)\b.{0,24}\b(?:bam link|vao web|tu chon ghe)\b/.test(s) || /\btu chon ghe\b.{0,25}\bhay\b/.test(s))return false;
  const mentionsExisting=/\b(?:co|nhan|xem|gui|mo)\b.{0,24}\b(?:link|duong dan)\b.{0,18}\b(?:roi|truoc do|lien tuc|qua nhieu|nhieu (?:qua|lan))\b/.test(s);
  if((mentionsExisting && !/\b(?:gui|xin|cho) (?:giup )?lai\b/.test(s)) ||
    /\b(?:sao|tai sao)\b.{0,20}\b(?:gui|dua)\b.{0,16}\blink\b/.test(s))return false;
  if(/\b(?:gui|cho|xin|dua|can|muon|lay|co|tim|mo)\b.{0,40}\b(?:link|lien ket|duong dan|trang web|website|web)\b/.test(s) ||
    /^(?:link|duong dan|lien ket|trang web|website|web)(?: (?:dat|mua|chon|ve|ghe|so do|dau|nhe|voi|a|show|o dau))*$/.test(s) ||
    /\b(?:tu (?:chon (?:ghe|cho|vi tri)|dat ve)|(?:chon ghe|dat ve|mua ve) (?:tren|qua) (?:web|website|trang web))\b/.test(s)) {
    return !/\b(?:link|duong dan|web)\b.{0,18}\b(?:loi|hong|khong (?:vao|mo|xem)|ko (?:vao|mo))\b/.test(s) && !/\b(?:khong|ko|k|dung) (?:muon |can )?tu (?:chon|dat)\b/.test(s);
  }
  // A short show name/date can complete our immediately preceding clarification.
  const prior=history.at(-2);
  return Boolean(prior?.sender==="staff" && prior.body.includes(clarifyBookingPage) && s.length<=90 && !/\b(?:gia|gan|xa|bao nhieu|khong|thoi|huy|chua|cam on)\b/.test(s));
}
export function requestsImageAndPage(body:string){
  const s=words(body);
  return wantsBookingPage(body) && /\b(?:anh|hinh) (?:cua )?so do\b/.test(s) && !/\b(?:khong|ko|k|dung|khoi) (?:can |gui |muon |xem )*(?:anh|hinh)\b/.test(s) && /\b(?:va|ca|kem|lan|voi|cung)\b/.test(s);
}
export function alsoNeedsAdvice(body:string){
  const s=words(body);
  return requestsImageAndPage(body) || /\b(?:bao nhieu|gia|ngan sach|re|gan|xa|chinh dien|goc nhin|con (?:ghe|cho)|lich dien|may gio|chup anh|tre em|tuoi|so sanh|tu van|ngoi dau)\b/.test(s);
}
export function catalogSeatPage(show?:{id:string;url:string}){
  return show && /^[a-z0-9][a-z0-9-]{1,99}$/.test(show.id) && show.url==="https://iextra.net/show/"+show.id ? show.url : undefined;
}
// Only remove public seat/show pages, including a bare homepage used as a booking link.
// Do not match the support page, addresses, payment QR or private e-ticket paths.
const seatURL=/(?<![\w@./-])(?:https?:\/\/)?(?:www\.)?iextra\.net(?:\/(?:show\/[a-z\d-]+|api\/public\/seat-map\/(?:ccc|laocai))\/?|\/?(?=$|[\s),.!?]))(?:[#?][^\s<>()[\]]*)?(?![\w/-])/gi;
function removeSeatPages(body:string) {
  return body.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g,(all,label:string,url:string)=>url.replace(seatURL,"")!==url?label+" "+url:all)
    .split("\n").map(line=>{
      const removed=line.replace(seatURL,"\u0001");
      if(removed===line)return line;
      const clauses=removed.split(/(?<=[.!?])\s+(?=[\p{L}])/u);
      return clauses.map(clause=>{
        if(!clause.includes("\u0001"))return clause;
        // Keep verified prices, seats and directions even when sharing a line with a booking CTA.
        return clause.replace(/(?:[,;–—]\s*|^|\s+(?:và|rồi)\s+)(?:(?:anh(?:\/chị)?|chị|bạn|mình|em)\s+)?(?:có thể\s+)?(?:vào|bấm|truy cập|xem|tham khảo|chọn ghế|tự chọn ghế|đặt vé|gửi|gởi|mở|đây là link|link|đường dẫn|trang chọn ghế|sơ đồ)\s*(?:(?:cho|mình|anh|chị|các|ghế|đang|còn|trống|sơ|đồ|và|tình|trạng|hiện|tại|chỗ|chọn|vé|đặt|ở|theo|qua|link|đây|này|chi|tiết|để|trên|trang|web|của|show)\s*)*[:：]?\s*\u0001(?:\s*(?:nhé|nha|ạ))*[.!:]?/giu,"")
          .replace(/\s*(?:(?:tại|ở|qua|xem|link|đường dẫn)\s*[:：]?\s*)?\u0001/g,"").trim();
      }).filter(part=>part && !/^(?:nhé|nha|ạ)?[\s.:!–—-]*$/iu.test(part)).join(" ");
    }).filter(line=>line.trim()).join("\n").trim();
}
const emojiMark=/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const graphemes=new Intl.Segmenter("vi",{granularity:"grapheme"});
export function quietSalesTurn(text:string){
  return /\b(?:gia|tien|ngan sach|thanh toan|chuyen khoan|giao dich|mat ve|loi|het han|khieu nai|buc minh|that vong|khong hai long|chua nhan|khong nhan|khong quet|khong vao duoc|tra soat|dat nham|doi ve|huy ve|tam ung|dat coc|hoan|mua nham|luc nao cung loi|mat ma|thieu ve)\b/.test(words(text)) || /\d[\d., ]*\s*(?:đ|vnd|k|nghìn|ngàn|triệu)(?![\p{L}\p{N}])/iu.test(text);
}
export function friendlyAcknowledgement(body:string){
  const s=words(body);
  if(quietSalesTurn(s)||body.includes("?"))return null;
  if(/^((?:da |vang |ok |oke |cam on |thanks? |thank you )*)(?:(?:cam on|cam on nhieu|thanks?|thank you)(?: (?:em|anh|chi|extra|shop|ban|minh|nhieu|lam|nha|nhe|a|da|rat))*)(?: [a-f0-9]{10})?$/.test(s))return {heart:true,body:"Em rất vui vì giúp được mình ạ."};
  if(/^(?:(?:da|oi|vang|hay qua|vui qua) )?(?:minh|anh|chi|hai vo chong|ca nha)(?: da| se)? (?:sap xep|thu xep|xin nghi|di) duoc(?: lich| roi| de di| di xem| hom do| nhe| a| show| ca nha)*$/.test(s))return {heart:true,body:"Vui quá, vậy là mình sắp xếp đi nghe nhạc được rồi ạ!"};
  if(/^(?:(?:da|de) )?(?:anh|chi|minh|em) (?:ban|hoi|trao doi)(?: lai)? (?:voi )?(?:vo|chong|gia dinh|ban)(?: da| truoc| nhe| nha| a| roi bao lai)*$/.test(s))return {heart:false,body:"Dạ, mình cứ trao đổi thêm nhé. Khi mình cần xem lại chỗ ngồi, em hỗ trợ tiếp ạ."};
  return null;
}
function iconFor(text:string){
  if(/\b(chup anh|chup hinh|dang ky chup)\b/.test(text))return "📸";
  if(/\b(dia chi|dia diem|duong di|o dau)\b/.test(text))return "📍";
  if(/\b(ngay nao|may gio|lich dien|gio dien)\b/.test(text))return "🗓️";
  if(/\b(ghe|cho ngoi|goc nhin|san khau|so do)\b/.test(text))return "💺";
  if(/\b(gia|ve|ngan sach)\b/.test(text))return "🎟️";
  return "🎵";
}
export function styleSalesReply(body:string,customer:string,history:readonly Turn[]=[],page?:string) {
  const s=words(customer);
  const quiet=quietSalesTurn(customer)||quietSalesTurn(body)||Boolean(friendlyAcknowledgement(customer))||unrelated.test(s)||/\b(?:loi|that vong|buc minh|khong hai long|nhan vien|nguoi that|doi ve|huy ve|dung nhan|khong mua|(?:dung|khong) (?:can |them |dung |gui )*(?:icon|emoji))\b/.test(s) || /\b(?:chua xac nhan|doi soat|khieu nai|tam chua|chua gui duoc|chua kiem tra duoc)\b/.test(words(body));
  let text=removeSeatPages(body),hasIcon=false;
  text=Array.from(graphemes.segment(text),({segment})=>{
    if(!emojiMark.test(segment))return segment;
    if(quiet||hasIcon)return segment.includes("\u20e3")?segment[0]:"";
    hasIcon=true;return segment;
  }).join("").replace(/[ \t]{2,}/g," ").trim();
  if(!text)text=page?"Mình có thể tự chọn ghế của show tại đây nhé.":"Mình muốn ưu tiên ghế gần ca sĩ hay một khoảng giá cụ thể ạ?";
  const icon=iconFor(s);
  const previous=history.slice(0,-1).filter(m=>m.sender==="staff").at(-1)?.body;
  if(!quiet&&!hasIcon&&!previous?.includes(icon)&&text.length<1100)text=icon+" "+text;
  return page?text+"\n"+page:text;
}

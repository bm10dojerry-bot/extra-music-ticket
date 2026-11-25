export type WaitingMessage={id:number;sender:string;body:string;staff_name?:string|null};
export const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^a-z0-9 ]+/g," ").trim().replace(/\s+/g," ");
export function isPing(text:string){return /^(?:(?:alo|a lo|hello|hi|em oi|shop oi|ad oi|admin oi|co ai khong|co ai o day khong|tra loi anh voi|tra loi chi voi|tra loi em voi|tra loi voi|sao chua tra loi)(?: (?:a|em|shop|ad|voi|nhe|nha|oi))*)$/.test(norm(text));}
export function selectWaitingQuestion(history:readonly WaitingMessage[],first:number,latest:number):string|null{
 const pending=history.filter(m=>m.sender==="customer"&&m.id>=first&&m.id<=latest).sort((a,b)=>a.id-b.id);
 if(!pending.length||pending[pending.length-1].id!==latest)return null;
 const last=pending[pending.length-1].body;
 if(ack(last))return last;
 const relevant=pending.filter(m=>!isPing(m.body)&&norm(m.body)!=="");
 return relevant.length?relevant.slice(-4).map(m=>m.body).join("\n").slice(0,1800):last;
}
export function sensitiveQuestion(text:string){
 return /(?:thanh toan|chuyen khoan|doi soat|hoan tien|tra tien|xac nhan tien|nhan tien|ma qr|khieu nai|huy don|doi ve|doi ghe|ma don|ma ve|khong nhan duoc ve|da mua ve)/.test(norm(text))||text.includes("[Khách gửi ảnh");
}
export function wantsPrices(text:string){return /(?:gia ve|gia bao nhieu|bao nhieu tien|bao nhieu mot ve|xin gia|gia tien|ve bao nhieu)/.test(norm(text));}
export function wantsSchedule(text:string){return /(?:may gio|gio dien|gio nao|lich dien|ngay nao|khi nao|thu may|thoi gian|hom nao|bat dau)/.test(norm(text));}
export function wantsVenue(text:string){return /(?:o dau|dia chi|dia diem|san khau o|to chuc o|dien o|duong den)/.test(norm(text));}
export function explicitStop(text:string){return /(?:khong mua nua|khong di nua|khong can nua|khong muon mua|khong muon nhan|dung nhan|dung gui|thoi khong|khong can tu van|ngung nhan|huy dang ky nhan tin)/.test(norm(text));}
export function ack(text:string){return /^(?:ok|okay|vang|da|cam on|thanks|thank you)(?: |$)/.test(norm(text))&&!/[?]/.test(text)&&!/(?:gia|so do|bao nhieu|may gio|o dau|con ghe|con ve|dat ve|mua ve|thanh toan)/.test(norm(text));}
export function sanitize(text:string){return text.replace(/https?:\/\/\S+/g,"[link]").replace(/\bEX[0-9A-F]{16}\b/gi,"[mã đơn]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,"[email]").replace(/(?:\+?84|0)?(?:[\s.-]*\d){8,}/g,"[số riêng]").slice(0,1000);}

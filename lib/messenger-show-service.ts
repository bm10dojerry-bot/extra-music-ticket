import "server-only";
import {staffDb} from "./staff-auth";
import {listAiSalesShows} from "./ai-sales-checkout";
import {salesPreferences,priceLines} from "./ai-sales-consultation";
import {customerRequestsHuman} from "./messenger-sale-memory";
import {norm,sensitiveQuestion,explicitStop} from "./ai-sales-timeout-policy";
import {askedOffer,hasPoster} from "./poster-offers";
import {venues} from "./venues";
type Turn={sender:string;body:string;staff_name?:string|null};
const clarify="Mình đang hỏi đêm của ca sĩ nào hoặc ngày diễn nào ạ?";
const water=/\b(?:nuoc(?: uong| suoi| ngot)?|do uong|thuc uong)\b/;
const included=/\b(?:kem|mien phi|bao gom|tang|bao nuoc|ve co nuoc|ve co do uong|voucher|combo)\b/;
const route=/\b(?:chi duong|duong di|duong den|duong toi|google map[s]?|ban do duong|dinh vi|map chi duong|vi tri to chuc|dia chi|location)\b/;
const tracks=/\b(?:setlist|set list|(?:hat|dien) (?:may|bao nhieu|nhung|cac) (?:ca khuc|bai)|(?:bao nhieu|may) (?:bai|ca khuc)(?: hat)?|danh sach (?:bai|ca khuc)|(?:hat|co) (?:bai|ca khuc) (?:gi|nao))\b/;
const access=/\b(?:xe lan|han che di lai|kho di lai|kho di bo|tranh (?:bac|cau thang)|loi (?:khong bac|xe lan))\b/;
function topics(q:string){
 const s=norm(q);
 return {water:water.test(s)&&!(/\b(?:nuoc ngoai|nuoc mat|nuoc hoa|nuoc nha|ca nuoc|trong nuoc|dat nuoc)\b/.test(s)),
  route:route.test(s)||(/\bmap\b/.test(s)&&!/\b(?:ghe|cho ngoi|seat)\b/.test(s)),
  tracks:tracks.test(s),access:access.test(s)};
}
const hasTopic=(t:ReturnType<typeof topics>)=>Object.values(t).some(Boolean);
export async function showServiceReply(body:string,history:readonly Turn[],known?:string|null){
 if(sensitiveQuestion(body)||customerRequestsHuman(body)||explicitStop(body)||/\b(?:ve (?:bi )?loi|khieu nai|ma ve (?:hong|loi)|chua nhan duoc ve|khong quet duoc)\b/.test(norm(body))||/\b(?:giu ghe|chot ve|chot don|xac nhan dat|doi don)\b/.test(norm(body)))return null;
 const lastStaff=history.slice(0,-1).findLast(m=>m.sender==="staff");
 let q=body,t=topics(q);
 const asksAgain=lastStaff?.body.includes(clarify);
 if(!hasTopic(t)&&asksAgain){
   const prior=history.slice(0,-1).findLast(m=>m.sender==="customer");
   if(prior&&body.length<85){q=prior.body+" "+body;t=topics(q);}
 }
 if(!hasTopic(t))return null;
 const s=norm(q),notes:string[]=[];
 const asksIncluded=t.water&&included.test(s);
 const asksPrice=/\b(?:gia ve|gia (?:hang |ve )?vip|ve bao nhieu|bang gia ve)\b/.test(s);
 const listSongs=/\b(?:danh sach|bai (?:gi|nao)|nhung bai|ca khuc nao|setlist|set list)\b/.test(s);
 if(t.water && !asksIncluded && !asksPrice && !t.route && !t.tracks && !t.access && !/ghe|cho ngoi|so do|dat ve|mang|giao|gia nuoc|dat truoc/.test(s))return {body:"Ban tổ chức có điểm bán nước ngay trong khu diễn, mình có thể gọi nước tại đó ạ.",continueSales:false};
 const shows=await listAiSalesShows();
 const memory=salesPreferences(history,shows,known);
 const show=memory.showSelectionUnresolved?undefined:shows.find(x=>x.id===memory.showId);
 const explicitVenue=/\bccc\b/.test(s)?"ccc":/\b(?:san khau lao cai|cam duong|phu thinh)\b/.test(s)?"laocai":undefined;
 const routeVenue=venues.find(v=>v.id===(show?.venueId||explicitVenue));
 const needsShow=asksIncluded||t.tracks||(t.route&&!routeVenue)||asksPrice;
 const stopSales=/(?:chi tham khao|xem truoc|chua muon dat)/.test(s);
 if(t.water){
   if(/\bmang\b/.test(s))notes.push("Em chưa có xác nhận về việc mang đồ uống từ ngoài vào.");
   if(/\bgia (?:chai |ly |coc )?nuoc\b/.test(s))notes.push("Em chưa có bảng giá đồ uống tại quầy.");
   if(/\b(?:tai ghe|den ghe|tan ghe|dat truoc)\b/.test(s))notes.push("Em chưa có xác nhận về dịch vụ đặt trước hoặc giao nước tận ghế.");
   if(asksIncluded && /\b(?:voucher|combo)\b/.test(s))notes.push("Quyền lợi nước uống tùy loại voucher. Mình gửi em tên hoặc ảnh voucher để em kiểm tra nhé.");
   else if(asksIncluded && show)notes.push(show.id==="dinh-dung-2811"?"Vé đêm Đình Dũng không kèm nước uống ạ.":"Em chưa có xác nhận vé đêm "+show.artist+" có bao gồm nước uống.");
   notes.push("Ban tổ chức có điểm bán nước ngay trong khu diễn, mình có thể gọi nước tại đó ạ.");
 }
 if(t.route && routeVenue){
   const venue=routeVenue;
   if(venue){const destination=venue.name+", "+venue.address;
     const url="https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination);
     notes.push((show?"Đêm "+show.artist+" diễn tại ":"Địa điểm là ")+destination+".\nGoogle Maps chỉ đường cho mình ở đây "+url);}
 }
 if(t.tracks && show){
   const rows=await staffDb("show_landing_content?show_id=eq."+encodeURIComponent(show.id)+"&select=setlist&limit=1",{signal:AbortSignal.timeout(1800)}).catch(()=>[]) as {setlist:string|null}[];
   const items=(rows[0]?.setlist??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
   if(!items.length)notes.push("Đêm "+show.artist+" hiện chưa công bố danh sách bài hát, nên em chưa thể báo số bài chính xác ạ.");
   else{
     notes.push("Theo danh sách dự kiến, đêm "+show.artist+" có "+items.length+" bài. Chương trình thực tế có thể điều chỉnh ạ.");
     if(listSongs){const entries=items.map((line,i)=>(i+1)+". "+line.replace(/^\d+[.)\s-]+/,"")).filter(line=>!/(?:https?:\/\/|www\.|[\u0000-\u001f])/.test(line));
       const list=entries.join("\n");if(list.length<=780)notes.push(list);else notes.push("Một số bài trong danh sách dự kiến gồm\n"+entries.slice(0,4).join("\n"));}
   }
 }
 if(t.access)notes.push("Em cần xác nhận lối vào và số bậc tại địa điểm trước khi tư vấn chỗ phù hợp. "+(/xe lan/.test(s)?"Mình cần lối đi bằng xe lăn đến tận ghế hay có thể di chuyển một đoạn ngắn ạ?":"Mình cần tránh bậc thang hay ưu tiên ghế sát lối đi ạ?"));
 if(asksPrice && show)notes.push(priceLines(show,q));
 if(askedOffer(q) && show && hasPoster(show.id) && !t.access)notes.push(askedOffer(q)!);
 if(!show && needsShow && !t.access && !/\b(?:voucher|combo)\b/.test(s))notes.push(clarify);
 // Seat selection and booking still use the normal worker; append the verified FAQ to that reply.
 const needsSeats=/\b(?:ghe dep|cho (?:nao )?(?:ngoi )?dep|chon ghe|so do ghe|con ghe|ghe trong|chinh dien|gan san khau|link dat ve)\b/.test(s) && !t.access;
 if(!notes.length)return null;
 return {body:notes.join("\n"),continueSales:needsSeats&&!stopSales};
}

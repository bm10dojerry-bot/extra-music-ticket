import "server-only";
import {listAiSalesShows} from "./ai-sales-checkout";
import {priceLines,salesPreferences} from "./ai-sales-consultation";
import {norm,sensitiveQuestion} from "./ai-sales-timeout-policy";
import {customerRequestsHuman, type MessengerSaleMemory} from "./messenger-sale-memory";
import {readMessengerImage} from "./ai-sales-inbound-image";
import {recentShowSignal,rememberImageShow,matchShowEvidence} from "./messenger-show-signals";

const marker="[Khách gửi ảnh; chưa đọc nội dung ảnh.]";
type Message={id:number;sender:string;body:string;staff_name?:string|null;external_message_id?:string|null;created_at?:string};
type Recognition={showId?:string|null;since?:string;caption?:string;reply?:string;reading?:Awaited<ReturnType<typeof readMessengerImage>>};
export async function recognizeInquiry(messages:readonly Message[],page:string,psid:string):Promise<Recognition>{
 const customer=messages.filter(m=>m.sender==="customer"),latest=customer.at(-1);
 if(!latest?.created_at)return {};
 const stamp=Date.parse(latest.created_at),isImage=latest.body.startsWith(marker);
 const previous=messages[messages.indexOf(latest)-1];
 const adjacent=previous?.sender==="customer" && previous.body.startsWith(marker) && Math.abs(stamp-Date.parse(previous.created_at||""))<90000?previous:undefined;
 const image=isImage?latest:adjacent;
 const signal=await recentShowSignal(page,psid,latest.created_at).catch(()=>null);
 const result:Recognition=signal?{showId:signal.show_id,since:signal.occurred_at}:{};
 if(!signal && !image)return result;
 const question=isImage?latest.body.slice(marker.length).trim():latest.body;
 const shows=await listAiSalesShows();
 const textMatch=matchShowEvidence(question,shows);
 if(image?.external_message_id && process.env.EXTRA_AI_SALE_INBOUND_IMAGE!=="0"){
  const reading=await readMessengerImage(image.external_message_id,psid,page);
  if(isImage)result.reading=reading;
  if(reading?.kind==="poster"||reading?.kind==="seat_map"){
   const visible=matchShowEvidence(reading.showText??"",shows);
   if(!reading.multipleShows && visible.id){
    await rememberImageShow(image.external_message_id,psid,page,visible.id).catch(()=>{});
    result.showId=visible.id;result.since=image.created_at;
   }else if(reading.multipleShows||visible.ambiguous){
    result.showId=null;result.since=image.created_at;
    if(!textMatch.id&&!textMatch.ambiguous && !sensitiveQuestion(question))result.reply="Em thấy ảnh có thông tin của nhiều suất hoặc tên và ngày chưa khớp. Mình muốn xem đêm của ca sĩ nào hoặc ngày nào ạ?";
   }
   if(isImage && !result.reply && (textMatch.id||result.showId) && (question || (visible.id&&!reading.multipleShows)))result.caption=question;
  }else if(isImage)return result; // Receipt and uncertain images stay with the original guarded flow.
 }
 if(textMatch.ambiguous){delete result.reply;return result;}
 const scoped=messages.filter(m=>!result.since || Date.parse(m.created_at??"")>=Date.parse(result.since)-1000);
 // Read the customer's own caption separately from any text extracted from an image.
 const memory:MessengerSaleMemory=salesPreferences(scoped.map(m=>m.id===latest.id?{...m,body:question}:m),shows,result.showId);
 const show=shows.find(s=>s.id===(textMatch.id||(!memory.showSelectionUnresolved&&memory.showId)));
 if(!show||result.reply||sensitiveQuestion(question)||customerRequestsHuman(question))return result;
 result.showId=show.id;
 const simple=/^(?:(?:da |em oi |cho (?:minh|anh|chi|em) (?:hoi|xin) |xin |cho xin )*)(?:gia(?: ve)?(?: (?:show|dem nhac|chuong trinh))?(?: (?:la )?bao nhieu(?: tien)?| the nao)?|ve(?: gia)? bao nhieu(?: tien)?)(?: (?:a|em|voi|nhe|nhi))*$/.test(norm(question));
 const name=show.artist+" ngày "+show.date.slice(8,10)+"/"+show.date.slice(5,7);
 if(simple)result.reply="Dạ, vé đêm "+name+" có các hạng sau ạ.\n"+priceLines(show,question);
 if(isImage && result.caption==="" && !result.reply)result.reply="Dạ, đây là "+(result.reading?.kind==="seat_map"?"sơ đồ ghế của đêm ":"poster đêm ")+name+" tại "+show.venueName+". Mình muốn xem giá vé hay chọn chỗ ngồi ạ?";
 return result;
}

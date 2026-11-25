import "server-only";
import {staffDb} from "./staff-auth";
import {isPing,norm} from "./ai-sales-timeout-policy";

type Turn={sender:string;body:string;external_message_id?:string|null};
const attachment="[Khách gửi ảnh; chưa đọc nội dung ảnh.]";
const request=/\b(?:bao nhieu|may (?:gio|bai|ve)|o dau|khi nao|the nao|nhu the nao|loai nao|hang nao|con (?:cho|ghe|ve)|gia ve|xin (?:gia|link|map|so do)|cho (?:minh|anh|chi|em) (?:hoi|xin|xem)|gui (?:cho )?(?:minh|anh|chi|em)|(?:co|duoc)\b.*\b(?:khong|ko|k)|(?:khong|ko|dc k)(?: a| em| nhi)?$)\b/;

// Match the exact question used by the worker, within the supplied customer turn(s).
// In particular a ping, a staff reply or merged questions must not supply a different mid.
export function questionMessageId(turns:readonly Turn[],question:string):string|undefined{
  const text=question.replace(attachment,"").trim();
  if(!text||isPing(text)||(!/[?？]/u.test(text)&&!request.test(norm(text))))return;
  const match=turns.findLast(row=>row.sender==="customer"&&row.body.replace(attachment,"").trim()===text);
  const mid=match?.external_message_id;
  return mid&&mid.length<=512&&!/\s/.test(mid)?mid:undefined;
}
export async function allowedQuestionReply(page:string,psid:string,mid:string|undefined){
  if(!mid)return;
  try{
    const settings=await staffDb("extra_messenger_ai_settings?page_id=eq."+encodeURIComponent(page)+"&select=question_quotes_enabled,question_quotes_test_psid&limit=1",
      {signal:AbortSignal.timeout(1200)}) as {question_quotes_enabled:boolean;question_quotes_test_psid:string|null}[];
    if(settings[0]?.question_quotes_enabled||settings[0]?.question_quotes_test_psid===psid)return mid;
  }catch{} // Optional presentation feature; the answer can still be delivered.
}

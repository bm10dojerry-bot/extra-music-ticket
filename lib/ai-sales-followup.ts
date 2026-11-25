import "server-only";
import {staffDb} from "./staff-auth";
import {getMessengerConfig,sendMessengerPageMessage} from "./facebook-messenger";
type Due={chat_id:string;customer_message_id:number;anchor_reply_id:number;stage:10|30};
type Claim={outcome:string;id?:string;claim_token?:string;psid?:string;stage?:10|30};
type Verified={outcome:string;psid?:string};
const rpc=async<T>(name:string,body:Record<string,unknown>):Promise<T>=>staffDb("rpc/extra_messenger_ai_followup_"+name,{method:"POST",body:JSON.stringify(body),signal:AbortSignal.timeout(5000)}) as Promise<T>;
export async function runAiSalesFollowup():Promise<{enabled:boolean;sent:number;result?:string}>{
 let enabled=false;
 try{
  const config=getMessengerConfig();
  if(!config)return {enabled:false,sent:0};
  const control=await staffDb("extra_messenger_ai_followup_control?singleton=eq.true&select=enabled&limit=1",{signal:AbortSignal.timeout(5000)}) as {enabled:boolean}[];
  if(control?.[0]?.enabled!==true)return {enabled:false,sent:0};
  enabled=true;
  const rows=await rpc<Due[]>("due",{p_page_id:config.pageId,p_chat_id:null});
  const item=rows?.[0];
  if(!item||![10,30].includes(item.stage))return {enabled,sent:0,result:"none_due"};
  const dayReminder=await staffDb("extra_messenger_day_before?chat_id=eq."+encodeURIComponent(item.chat_id)+"&claimed_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&select=chat_id&limit=1") as unknown[];
  if(dayReminder.length)return {enabled,sent:0,result:"day_before_already_contacted"};
  const claim=await rpc<Claim>("claim",{p_page_id:config.pageId,p_chat_id:item.chat_id,p_customer_message_id:item.customer_message_id,p_anchor_reply_id:item.anchor_reply_id,p_stage:item.stage});
  if(claim.outcome!=="send"||!claim.id||!claim.claim_token||!claim.psid||claim.stage!==item.stage)return {enabled,sent:0,result:claim.outcome};
  const body=item.stage===10?"Dạ, mình còn cần em hỗ trợ chọn vé hoặc kiểm tra vị trí ghế phù hợp không ạ?":"🎟️ Dạ, em xin phép hỏi thêm: mình đang phân vân về giá vé, vị trí ngồi hay lịch diễn ạ? Em có thể kiểm tra lại thông tin để mình dễ lựa chọn hơn.";
  const finish=(result:string,mid:string|null)=>rpc<{outcome:string}>("finish",{p_id:claim.id,p_claim_token:claim.claim_token,p_result:result,p_body:body,p_external_message_id:mid});
  let checked:Verified;
  try{checked=await rpc<Verified>("verify",{p_id:claim.id,p_claim_token:claim.claim_token,p_page_id:config.pageId});}
  catch{await finish("skipped",null).catch(()=>{});return {enabled,sent:0,result:"recheck_unavailable"};}
  if(checked.outcome!=="ok"||checked.psid!==claim.psid){await finish("skipped",null);return {enabled,sent:0,result:"stale"};}
  let messageId:string;
  try{const sent=await sendMessengerPageMessage(claim.psid,body);messageId=sent.messageId;}
  catch{await finish("uncertain",null).catch(()=>{});return {enabled,sent:0,result:"delivery_uncertain"};}
  if(!messageId||messageId.length<4||messageId.length>200){await finish("uncertain",null).catch(()=>{});return {enabled,sent:0,result:"receipt_invalid"};}
  const finished=await finish("sent",messageId);
  return {enabled,sent:finished.outcome==="sent"?1:0,result:finished.outcome};
 }catch{console.warn("[ai-sales-followup] unavailable; no automatic resend");return {enabled,sent:0,result:"unavailable"};}
}

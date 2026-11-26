import "server-only";
import {staffDb} from "./staff-auth";
import {getMessengerConfig,sendMessengerPageMessage} from "./facebook-messenger";
type Due={chat_id:string;customer_message_id:number;anchor_reply_id:number;stage:3|60};
type Claim={outcome:string;id?:string;claim_token?:string;psid?:string;stage?:3|60};
type Verified={outcome:string;psid?:string;show_id?:string;artist?:string;days_remaining?:number};
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
  if(!item||![3,60].includes(item.stage))return {enabled,sent:0,result:"none_due"};
  const dayReminder=await staffDb("extra_messenger_day_before?chat_id=eq."+encodeURIComponent(item.chat_id)+"&claimed_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&select=chat_id&limit=1") as unknown[];
  if(dayReminder.length)return {enabled,sent:0,result:"day_before_already_contacted"};
  const claim=await rpc<Claim>("claim",{p_page_id:config.pageId,p_chat_id:item.chat_id,p_customer_message_id:item.customer_message_id,p_anchor_reply_id:item.anchor_reply_id,p_stage:item.stage});
  if(claim.outcome!=="send"||!claim.id||!claim.claim_token||!claim.psid||claim.stage!==item.stage)return {enabled,sent:0,result:claim.outcome};
  let body="Dạ, anh/chị còn cần bên em tư vấn thêm về vé hoặc vị trí ngồi không ạ?";
  const finish=(result:string,mid:string|null)=>rpc<{outcome:string}>("finish",{p_id:claim.id,p_claim_token:claim.claim_token,p_result:result,p_body:body,p_external_message_id:mid});
  let checked:Verified;
  try{checked=await rpc<Verified>("verify",{p_id:claim.id,p_claim_token:claim.claim_token,p_page_id:config.pageId});}
  catch{await finish("skipped",null).catch(()=>{});return {enabled,sent:0,result:"recheck_unavailable"};}
  if(checked.outcome!=="ok"||checked.psid!==claim.psid){await finish("skipped",null);return {enabled,sent:0,result:"stale"};}
  if(item.stage===60){
   const {show_id,artist,days_remaining}=checked;
   if(typeof show_id!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(show_id)||typeof artist!=="string"||!artist.trim()||artist.length>150||typeof days_remaining!=="number"||!Number.isInteger(days_remaining)||days_remaining<0){
    await finish("skipped",null);return {enabled,sent:0,result:"show_unavailable"};
   }
   const when=days_remaining===0?"Hôm nay":("Chỉ còn "+days_remaining+" ngày nữa");
   body="Anh/chị ơi, "+when.toLowerCase()+" là show "+artist.trim()+" diễn ra rồi, mình có đặt chỗ không ạ? Báo ngay bên em để chọn những vị trí đẹp còn trống nhé!\nhttps://iextra.net/show/"+encodeURIComponent(show_id);
  }
  let messageId:string;
  try{const sent=await sendMessengerPageMessage(claim.psid,body);messageId=sent.messageId;}
  catch{await finish("uncertain",null).catch(()=>{});return {enabled,sent:0,result:"delivery_uncertain"};}
  if(!messageId||messageId.length<4||messageId.length>200){await finish("uncertain",null).catch(()=>{});return {enabled,sent:0,result:"receipt_invalid"};}
  const finished=await finish("sent",messageId);
  return {enabled,sent:finished.outcome==="sent"?1:0,result:finished.outcome};
 }catch{console.warn("[ai-sales-followup] unavailable; no automatic resend");return {enabled,sent:0,result:"unavailable"};}
}

import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb,type Staff} from "../../../../lib/staff-auth";
import {getMessengerConfig,MessengerSendError,messengerOutboundMetadata,sendMessengerPageMessage} from "../../../../lib/facebook-messenger";
import {HUMAN_IDLE_MS} from "../../../../lib/messenger-ai-ownership";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Chat={id:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:string;created_at:string;updated_at:string;last_customer_at:string|null;last_staff_at:string|null;assigned_staff_id:string|null;assigned_at:string|null;channel:"website"|"messenger";messenger_ai_managed?:boolean;messenger_last_human_at?:string|null;messenger_human_requested?:boolean;messenger_last_ai_at?:string|null};
type Sale={id:string;display_name:string};
type Result={outcome:string;staff_id?:string;status?:string;max?:number;token?:string};
const reply=(payload:Record<string,unknown>,status=200)=>NextResponse.json(payload,{status,headers:{"Cache-Control":"no-store"}});
const validId=(id:string)=>/^[a-f0-9-]{36}$/i.test(id);
const requestIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const allowedOrigin=(req:NextRequest)=>{try{const origin=req.headers.get("origin");return !!origin&&new URL(origin).host===req.headers.get("host")}catch{return false}};
const access=()=>requireRole(["admin","sale","show_manager"]);
const manager=(actor:Staff)=>actor.role!=="sale";
const dbActor=(actor:Staff)=>actor.id==="owner"?null:actor.id;
const fields="id,show_id,customer_name,customer_phone,status,created_at,updated_at,last_customer_at,last_staff_at,assigned_staff_id,assigned_at,channel";
const ownershipFields=",messenger_ai_managed,messenger_last_human_at,messenger_human_requested,messenger_last_ai_at";
const inboxOrder="&order=updated_at.desc&limit=250";
const waiting=(c:Chat)=>c.status==="open"&&!c.assigned_staff_id&&(!c.messenger_ai_managed||c.messenger_human_requested);
const needReply=(c:Chat,now:number)=>{
 if(c.status!=="open"||!c.last_customer_at)return false;
 if(c.messenger_human_requested)return true;
 if(c.messenger_ai_managed&&(!c.messenger_last_human_at||Date.parse(c.messenger_last_human_at)+HUMAN_IDLE_MS<=now))return false;
 return Date.parse(c.last_customer_at)>Math.max(Date.parse(c.last_staff_at||"")||0,Date.parse(c.messenger_last_ai_at||"")||0);
};
const outcomeError=(outcome:string)=>outcome==="forbidden"?403:outcome==="not_found"?404:outcome==="invalid"||outcome==="invalid_target"||outcome==="invalid_body"||outcome==="invalid_name"?400:409;
const publicResult=(r:Result)=>r.outcome==="assigned"||r.outcome==="already_assigned"||r.outcome==="updated"||r.outcome==="sent"||r.outcome==="released"||r.outcome==="taken_over";
async function readChats(query:string,prefix=""):Promise<Chat[]>{
 const path="extra_support_chats?"+prefix+"select=";
 try{return await staffDb(path+fields+ownershipFields+query) as Chat[];}
 catch(error){
  // The legacy inbox also runs in environments that have not applied the Messenger migration.
  if(!(error instanceof Error)||!/^Database 400 \{"code":"42703"/.test(error.message))throw error;
  return await staffDb(path+fields+query) as Chat[];
 }
}
async function oneChat(id:string):Promise<Chat|null>{
 const rows=await readChats("&limit=1","id=eq."+encodeURIComponent(id)+"&");
 return rows[0]||null;
}
async function readMessages(chat:Chat){
 const order=chat.messenger_ai_managed?"desc":"asc";
 const messages=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(chat.id)+"&select=id,sender,body,staff_name,created_at&order=id."+order+"&limit=160") as unknown[];
 return chat.messenger_ai_managed?messages.reverse():messages;
}
async function dbRpc<T>(name:string,params:Record<string,unknown>):Promise<T>{
 return await staffDb("rpc/"+name,{method:"POST",body:JSON.stringify(params)}) as T;
}
export async function GET(req:NextRequest){
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const id=req.nextUrl.searchParams.get("chatId")||"";
 try{
  if(id){
   if(!validId(id))return reply({error:"Mã cuộc trò chuyện không hợp lệ"},400);
   const chat=await oneChat(id);
   if(!chat)return reply({error:"Không tìm thấy khách hàng"},404);
   if(!manager(actor)&&chat.assigned_staff_id!==actor.id)return reply({error:"Khách chưa được phân cho bạn. Hãy nhận khách từ hàng chờ."},403);
   return reply({chat,messages:await readMessages(chat)});
  }
  let chats=await readChats(inboxOrder);
  if(chats.some(waiting)){
   try{await dbRpc("extra_support_dispatch_queue",{p_limit:64});chats=await readChats(inboxOrder);}catch{console.warn("[support-chat] Queue dispatch unavailable")}
  }
  const staff=await staffDb("staff_accounts?role=eq.sale&active=eq.true&select=id,display_name&order=display_name.asc&limit=120") as Sale[];
  const work=Object.fromEntries(staff.map(s=>[s.id,chats.filter(c=>c.status==="open"&&c.assigned_staff_id===s.id).length]));
  const visible=manager(actor)?chats:chats.filter(c=>c.assigned_staff_id===actor.id||c.status==="open"&&!c.assigned_staff_id);
  const now=Date.now();
  return reply({
   chats:visible,
   staff:staff.map(s=>({...s,openCount:work[s.id]||0})),
   actorId:actor.id,
   isManager:manager(actor),
   maxPerSale:8,
   myOpenCount:chats.filter(c=>c.status==="open"&&c.assigned_staff_id===actor.id).length,
   waitingCount:chats.filter(waiting).length,
   needReplyCount:visible.filter(c=>needReply(c,now)).length,
   messengerConfigured:Boolean(getMessengerConfig())
  });
 }catch{console.warn("[support-chat] Staff read failed");return reply({error:"Chưa tải được tin nhắn hỗ trợ"},503)}
}
const pendingDeliveryNotice="Chưa xác nhận được trạng thái gửi. Hãy kiểm tra Messenger trước khi gửi lại tin này.";
const rejectedDelivery=()=>reply({error:"Facebook đã từ chối gửi. Hãy kiểm tra quyền Fanpage và thời hạn trả lời trên Messenger.",outcome:"rejected"},502);
async function managedReplyResponse(chat:Chat,notice?:string){
 let messages:unknown[]|undefined;
 try{messages=await readMessages(chat);}catch{console.warn("[support-chat] Messenger conversation refresh pending");}
 return reply({ok:true,messages,notice},notice?202:200);
}
async function sendManagedReply(chat:Chat,actor:Staff,psid:string,body:string,requestId:string,seenMessageId:number){
 const claim=await dbRpc<Result>("extra_messenger_ai_begin_staff_send",{
  p_chat_id:chat.id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_body:body,p_staff_name:actor.display_name.slice(0,100),
  p_request_id:requestId,p_seen_message_id:seenMessageId
 });
 if(claim.outcome==="sent")return managedReplyResponse(chat);
 if(claim.outcome==="unknown")return managedReplyResponse(chat,pendingDeliveryNotice);
 if(claim.outcome==="rejected")return rejectedDelivery();
 if(claim.outcome!=="ready"||!claim.token){
  const errors:Record<string,string>={
   busy:"Đang xử lý một tin nhắn. Hãy chờ hộp thư cập nhật rồi thử lại.",
   conversation_changed:"AI vừa trả lời khách. Hãy đọc tin mới trước khi gửi.",
  };
  const error=errors[claim.outcome]||"Chưa thể tiếp nhận phản hồi của nhân viên.";
  return reply({error,outcome:claim.outcome},outcomeError(claim.outcome));
 }
 let mid:string|null=null;
 let delivery:"sent"|"unknown"|"rejected"="unknown";
 try{
  const result=await sendMessengerPageMessage(psid,body,messengerOutboundMetadata("staff",claim.token));
  mid=result.messageId;
  delivery="sent";
 }catch(error){
  // A missing response can follow an accepted send. A signed Meta echo can settle it later.
  if(error instanceof MessengerSendError&&!error.deliveryUncertain)delivery="rejected";
  else console.warn("[support-chat] Messenger staff delivery unconfirmed");
 }
 let settled=false;
 try{
  const result=await dbRpc<Result>("extra_messenger_ai_finish_staff_send",{
   p_chat_id:chat.id,p_token:claim.token,p_status:delivery,p_meta_mid:mid
  });
  settled=result.outcome==="sent";
 }catch{console.warn("[support-chat] Messenger staff delivery recording pending");}
 if(settled)return managedReplyResponse(chat);
 if(delivery==="rejected")return rejectedDelivery();
 return managedReplyResponse(chat,mid?"Messenger đã nhận tin. Hộp thư đang cập nhật trạng thái gửi.":pendingDeliveryNotice);
}
export async function POST(req:NextRequest){
 if(!allowedOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ"},403);
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 if(Number(req.headers.get("content-length")||0)>12000)return reply({error:"Tin nhắn quá dài"},413);
 const input=await req.json().catch(()=>null);
 const id=String(input?.chatId||""),body=typeof input?.message==="string"?input.message.trim():"";
 if(!validId(id)||body.length<2||body.length>1200)return reply({error:"Nội dung trả lời không hợp lệ"},400);
 try{
  // Messenger chats originate in Meta. Confirm channel and assignment before sending outbound.
  const chat=await oneChat(id);
  if(!chat)return reply({error:"Không tìm thấy cuộc trò chuyện"},404);
  if(chat.status!=="open")return reply({error:"Cuộc trò chuyện đã đóng"},409);
  if(!manager(actor)&&chat.assigned_staff_id!==actor.id)return reply({error:"Khách được giao cho nhân viên khác"},403);
  if(chat.channel==="messenger"){
   const configs=getMessengerConfig();
   if(!configs)return reply({error:"Messenger API chưa được kết nối với Fanpage. Chưa gửi tin."},503);
   const rec=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=messenger_page_id,messenger_psid&limit=1") as {messenger_page_id:string|null;messenger_psid:string|null}[];
   const dest=rec[0];
   if(!dest?.messenger_psid||dest.messenger_page_id!==configs.pageId)return reply({error:"Cuộc chat không thuộc Fanpage được cấp quyền"},409);
   if(chat.messenger_ai_managed){
    const requestId:unknown=input?.requestId;
    if(typeof requestId!=="string"||!requestIdPattern.test(requestId))return reply({error:"Mã yêu cầu gửi không hợp lệ. Hãy tải lại hộp thư."},400);
    const seenMessageId:unknown=input?.seenMessageId;
    if(typeof seenMessageId!=="number"||!Number.isSafeInteger(seenMessageId)||seenMessageId<0)return reply({error:"Mã tin nhắn không hợp lệ. Hãy tải lại hộp thư."},400);
    return await sendManagedReply(chat,actor,dest.messenger_psid,body,requestId,seenMessageId);
   }
   // Do not store a staff reply as sent when Meta rejects the outbound message.
   await sendMessengerPageMessage(dest.messenger_psid,body);
  }
  const result=await dbRpc<Result>("extra_support_staff_reply",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_body:body,p_staff_name:actor.display_name.slice(0,100)});
  if(result.outcome!=="sent")return reply({error:result.outcome==="forbidden"?"Khách đã được giao cho nhân viên khác.":result.outcome==="closed"?"Cuộc trò chuyện đã đóng.":"Không gửi được phản hồi",outcome:result.outcome},outcomeError(result.outcome));
  return reply({ok:true,messages:await readMessages(chat)});
 }catch{console.warn("[support-chat] Staff send failed");return reply({error:"Không gửi được phản hồi"},503)}
}
export async function PATCH(req:NextRequest){
 if(!allowedOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ"},403);
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const input=await req.json().catch(()=>null);
 const action=String(input?.action||""),id=String(input?.chatId||""),status=String(input?.status||"");
 if(action==="dispatch"){
  try{const result=await dbRpc<{assigned:number}>("extra_support_dispatch_queue",{p_limit:64});return reply({ok:true,assigned:result.assigned});}
  catch{return reply({error:"Chưa phân công được hàng chờ"},503)}
 }
 if(!validId(id))return reply({error:"Mã cuộc trò chuyện không hợp lệ"},400);
 try{
  let result:Result;
  if(action==="takeover"||action==="release-ai"){
   result=await dbRpc<Result>(action==="takeover"?"extra_messenger_ai_takeover":"extra_messenger_ai_release_human",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor)});
  }else if(["claim","transfer","auto"].includes(action)){
   const target=String(input?.targetStaffId||"");
   if(action==="transfer"&&target&&!validId(target))return reply({error:"Nhân viên nhận chuyển không hợp lệ"},400);
   result=await dbRpc<Result>("extra_support_staff_route",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_mode:action,p_target:action==="transfer"&&target?target:null});
  }else if(["open","closed"].includes(status)){
   result=await dbRpc<Result>("extra_support_staff_status",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_status:status});
  }else return reply({error:"Yêu cầu không hợp lệ"},400);
  if(!publicResult(result)){
   const errors:Record<string,string>={
    full:"Nhân viên đã đủ 8 khách hoặc chưa có người trống. Khách vẫn được giữ trong hàng chờ.",
    no_capacity:"Nhân viên đã đủ 8 khách hoặc chưa có người trống. Khách vẫn được giữ trong hàng chờ.",
    forbidden:"Bạn không được thao tác trên cuộc trò chuyện này.",
    busy:"Đang xử lý một tin nhắn. Hãy chờ hộp thư cập nhật rồi thử lại.",
    human_requested:"Khách đang chờ nhân viên phản hồi.",
   };
   return reply({error:errors[result.outcome]||"Không cập nhật được",outcome:result.outcome},outcomeError(result.outcome));
  }
  return reply({ok:true,outcome:result.outcome,chat:await oneChat(id)});
 }catch{console.warn("[support-chat] Staff action failed");return reply({error:"Không cập nhật được cuộc trò chuyện"},503)}
}

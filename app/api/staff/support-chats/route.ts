import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb,type Staff} from "../../../../lib/staff-auth";
import {getMessengerConfig,sendMessengerPageMessage} from "../../../../lib/facebook-messenger";
import {getAiSalesSettings,type AiSettings} from "../../../../lib/ai-sales";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Chat={id:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:string;created_at:string;updated_at:string;last_customer_at:string|null;last_staff_at:string|null;assigned_staff_id:string|null;assigned_at:string|null;channel:"website"|"messenger";messenger_page_id?:string|null;messenger_psid?:string|null;ai_mode?:string;ai_started_at?:string|null;aiManaged?:boolean};
type Sale={id:string;display_name:string};
type Result={outcome:string;staff_id?:string;status?:string;max?:number};
const reply=(payload:Record<string,unknown>,status=200)=>NextResponse.json(payload,{status,headers:{"Cache-Control":"no-store"}});
const validId=(id:string)=>/^[a-f0-9-]{36}$/i.test(id);
const allowedOrigin=(req:NextRequest)=>{try{const origin=req.headers.get("origin");return !!origin&&new URL(origin).host===req.headers.get("host")}catch{return false}};
const access=()=>requireRole(["admin","sale","show_manager"]);
const manager=(actor:Staff)=>actor.role!=="sale";
const dbActor=(actor:Staff)=>actor.id==="owner"?null:actor.id;
const fields="id,show_id,customer_name,customer_phone,status,created_at,updated_at,last_customer_at,last_staff_at,assigned_staff_id,assigned_at,channel,ai_mode,ai_started_at,messenger_page_id";
const chatsPath="extra_support_chats?select="+fields+"&order=updated_at.desc&limit=250";
const needReply=(c:Chat)=>c.status==="open"&&!!c.last_customer_at&&(!c.last_staff_at||new Date(c.last_customer_at).getTime()>new Date(c.last_staff_at).getTime());
const outcomeError=(outcome:string)=>outcome==="forbidden"?403:outcome==="not_found"?404:outcome==="invalid"||outcome==="invalid_target"||outcome==="invalid_body"||outcome==="invalid_name"?400:409;
const publicResult=(r:Result)=>r.outcome==="assigned"||r.outcome==="already_assigned"||r.outcome==="updated"||r.outcome==="sent"||r.outcome==="released";
const withAi=(chat:Chat,settings:AiSettings|null):Chat=>({...chat,aiManaged:Boolean(settings?.enabled&&chat.channel==="messenger"&&chat.messenger_page_id===settings.page_id&&chat.ai_mode==="auto"&&chat.ai_started_at)});
async function oneChat(id:string):Promise<Chat|null>{
 const rows=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select="+fields+"&limit=1") as Chat[];
 return rows[0]||null;
}
async function dbRpc<T>(name:string,params:Record<string,unknown>):Promise<T>{
 return await staffDb("rpc/"+name,{method:"POST",body:JSON.stringify(params)}) as T;
}
export async function GET(req:NextRequest){
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const id=req.nextUrl.searchParams.get("chatId")||"";
 try{
  const aiSettings=await getAiSalesSettings();
  if(id){
   if(!validId(id))return reply({error:"Mã cuộc trò chuyện không hợp lệ"},400);
   const chat=await oneChat(id);
   if(!chat)return reply({error:"Không tìm thấy khách hàng"},404);
   if(!manager(actor)&&chat.assigned_staff_id!==actor.id)return reply({error:"Khách chưa được phân cho bạn. Hãy nhận khách từ hàng chờ."},403);
   const messages=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&select=id,sender,body,staff_name,created_at&order=id.asc&limit=160");
   return reply({chat:withAi(chat,aiSettings),messages});
  }
  let chats=(await staffDb(chatsPath) as Chat[]).map(c=>withAi(c,aiSettings));
  if(chats.some(c=>c.status==="open"&&!c.assigned_staff_id&&!c.aiManaged)){
   try{await dbRpc("extra_support_dispatch_queue",{p_limit:64});chats=(await staffDb(chatsPath) as Chat[]).map(c=>withAi(c,aiSettings));}catch{console.warn("[support-chat] Queue dispatch unavailable")}
  }
  const staff=await staffDb("staff_accounts?role=eq.sale&active=eq.true&select=id,display_name&order=display_name.asc&limit=120") as Sale[];
  const work=Object.fromEntries(staff.map(s=>[s.id,chats.filter(c=>c.status==="open"&&c.assigned_staff_id===s.id).length]));
  const visible=manager(actor)?chats:chats.filter(c=>!c.aiManaged&&(c.assigned_staff_id===actor.id||c.status==="open"&&!c.assigned_staff_id));
  return reply({
   chats:visible,
   staff:staff.map(s=>({...s,openCount:work[s.id]||0})),
   actorId:actor.id,
   isManager:manager(actor),
   maxPerSale:8,
   myOpenCount:chats.filter(c=>c.status==="open"&&c.assigned_staff_id===actor.id).length,
   waitingCount:chats.filter(c=>c.status==="open"&&!c.assigned_staff_id&&!c.aiManaged).length,
   needReplyCount:visible.filter(c=>!c.aiManaged&&needReply(c)).length,
   aiEnabled:Boolean(aiSettings?.enabled),
   messengerConfigured:Boolean(getMessengerConfig())
  });
 }catch(e){console.warn("[support-chat] Staff read failed",e instanceof Error?e.message:"unknown");return reply({error:"Chưa tải được tin nhắn hỗ trợ"},503)}
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
  if(withAi(chat,await getAiSalesSettings()).aiManaged)return reply({error:"AI đang phụ trách cuộc trò chuyện. Admin có thể tiếp quản tại mục AI bán vé."},409);
  const sending=await staffDb("extra_messenger_ai_outbox?chat_id=eq."+id+"&state=eq.sending&send_started_at=gt."+encodeURIComponent(new Date(Date.now()-30000).toISOString())+"&select=id&limit=1") as {id:string}[];
  if(sending.length)return reply({error:"AI đang hoàn tất một phản hồi. Vui lòng thử lại sau ít giây."},409);
  if(chat.status!=="open")return reply({error:"Cuộc trò chuyện đã đóng"},409);
  if(!manager(actor)&&chat.assigned_staff_id!==actor.id)return reply({error:"Khách được giao cho nhân viên khác"},403);
  if(chat.channel==="messenger"){
   const configs=getMessengerConfig();
   if(!configs)return reply({error:"Messenger API chưa được kết nối với Fanpage. Chưa gửi tin."},503);
   const rec=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=messenger_page_id,messenger_psid&limit=1") as {messenger_page_id:string|null;messenger_psid:string|null}[];
   const dest=rec[0];
   if(!dest?.messenger_psid||dest.messenger_page_id!==configs.pageId)return reply({error:"Cuộc chat không thuộc Fanpage được cấp quyền"},409);
   // Do not store a staff reply as sent when Meta rejects the outbound message.
   await sendMessengerPageMessage(dest.messenger_psid,body);
  }
  const result=await dbRpc<Result>("extra_support_staff_reply",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_body:body,p_staff_name:actor.display_name.slice(0,100)});
  if(result.outcome!=="sent")return reply({error:result.outcome==="forbidden"?"Khách đã được giao cho nhân viên khác.":result.outcome==="closed"?"Cuộc trò chuyện đã đóng.":"Không gửi được phản hồi",outcome:result.outcome},outcomeError(result.outcome));
  const messages=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&select=id,sender,body,staff_name,created_at&order=id.asc&limit=160");
  return reply({ok:true,messages});
 }catch(e){console.warn("[support-chat] Staff send failed",e instanceof Error?e.message:"unknown");return reply({error:"Không gửi được phản hồi"},503)}
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
  if(["claim","transfer","auto"].includes(action)){
   const current=await oneChat(id);
   if(current&&withAi(current,await getAiSalesSettings()).aiManaged)return reply({error:"AI đang phụ trách; hãy tiếp quản tại mục AI bán vé trước khi phân công."},409);
   const target=String(input?.targetStaffId||"");
   if(action==="transfer"&&target&&!validId(target))return reply({error:"Nhân viên nhận chuyển không hợp lệ"},400);
   result=await dbRpc<Result>("extra_support_staff_route",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_mode:action,p_target:action==="transfer"&&target?target:null});
  }else if(["open","closed"].includes(status)){
   result=await dbRpc<Result>("extra_support_staff_status",{p_chat_id:id,p_actor_id:dbActor(actor),p_is_manager:manager(actor),p_status:status});
  }else return reply({error:"Yêu cầu không hợp lệ"},400);
  if(!publicResult(result))return reply({error:result.outcome==="full"||result.outcome==="no_capacity"?"Nhân viên đã đủ 8 khách hoặc chưa có người trống. Khách vẫn được giữ trong hàng chờ.":result.outcome==="forbidden"?"Bạn không được thao tác trên cuộc trò chuyện này.":result.outcome==="already_assigned"?"Khách đã được phân cho nhân viên khác.":"Không cập nhật được",outcome:result.outcome},outcomeError(result.outcome));
  return reply({ok:true,outcome:result.outcome,chat:await oneChat(id)});
 }catch(e){console.warn("[support-chat] Staff action failed",e instanceof Error?e.message:"unknown");return reply({error:"Không cập nhật được cuộc trò chuyện"},503)}
}

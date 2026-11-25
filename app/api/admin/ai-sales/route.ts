import {after,NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getMessengerConfig,getMessengerGraphConfig} from "../../../../lib/facebook-messenger";
import {getFacebookOAuthConfig} from "../../../../lib/facebook-page-connection";
import {verifySaleSubscriptions} from "../../../../lib/facebook-page-oauth";
import {aiRpc,aiSalesConfigurationReady,getAiSalesSettings,probeAiSalesModel,runAiSalesQueue} from "../../../../lib/ai-sales";
import {AI_SALES_MODEL,AI_SALES_MODEL_LABEL} from "../../../../lib/ai-sales-policy";
import {sendAiSalesOwnerNotifications} from "../../../../lib/ai-sales-notifications";
import type {AiSalesAdminResponse,AiSalesConversation,AiSalesStatus} from "../../../../lib/ai-sales-admin-types";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const allowedOrigin=(req:NextRequest)=>{try{const origin=req.headers.get("origin");return Boolean(origin&&new URL(origin).host===req.headers.get("host"))}catch{return false}};
type Chat={id:string;customer_name:string;ai_mode:string};
type Active={chat_id:string;status:AiSalesStatus;summary:string|null;reason:string|null;current_order_code:string|null;updated_at:string;extra_support_chats:Chat};
type Outcome={id:string;chat_id:string;result:"successful"|"unsuccessful";summary:string|null;reason:string|null;order_code:string|null;created_at:string;extra_support_chats:Chat};
type Order={id:string;code:string;show_id:string;buyer_name:string;amount_vnd:number;seats:string[];status:string};
async function orderMetadata(codes:string[]):Promise<Order[]>{
 const result:Order[]=[];
 for(let offset=0;offset<codes.length;offset+=70){
  const part=codes.slice(offset,offset+70).filter(code=>/^EX[0-9A-F]{16}$/.test(code));
  if(part.length)result.push(...await staffDb("extra_payment_orders?code=in.("+part.join(",")+")&select=id,code,show_id,buyer_name,amount_vnd,seats,status&limit=70") as Order[]);
 }
 return result;
}
export async function GET(){
 if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được xem quản lý AI bán vé."},403);
 try{
  const settings=await getAiSalesSettings();
  if(!settings)return reply({enabled:false,ready:false,modelLabel:AI_SALES_MODEL_LABEL,readinessMessage:"Chưa khởi tạo cấu hình AI cho Fanpage.",updatedAt:new Date().toISOString(),totals:{successful:0,unsuccessful:0,inProgress:0,revenue:0},conversations:[]} satisfies AiSalesAdminResponse);
  const page=encodeURIComponent(settings.page_id),relation="extra_support_chats!inner(id,customer_name,ai_mode)",scope="&extra_support_chats.messenger_page_id=eq."+page;
  const [active,outcomes,totals,shows]=await Promise.all([
   staffDb("extra_messenger_ai_state?select=chat_id,status,summary,reason,current_order_code,updated_at,"+relation+scope+"&status=in.(in_progress,awaiting_payment,needs_attention)&order=updated_at.desc&limit=250") as Promise<Active[]>,
   staffDb("extra_messenger_ai_outcomes?select=id,chat_id,result,summary,reason,order_code,created_at,"+relation+scope+"&result=in.(successful,unsuccessful)&order=created_at.desc&limit=250") as Promise<Outcome[]>,
   aiRpc<AiSalesAdminResponse["totals"]>("totals",{p_page_id:settings.page_id}),
   staffDb("managed_shows?select=id,artist,title&limit=500") as Promise<{id:string;artist:string;title:string}[]>,
  ]);
  const codes=[...new Set([...active.map(row=>row.current_order_code),...outcomes.map(row=>row.order_code)].filter((code):code is string=>Boolean(code)))];
  const orderMap=new Map((await orderMetadata(codes)).map(order=>[order.code,order])),showMap=new Map(shows.map(show=>[show.id,show.artist||show.title]));
  function row(chat:Chat,status:AiSalesStatus,updatedAt:string,code:string|null,summary:string|null,reason:string|null,recordId:string):AiSalesConversation{
   const order=code?orderMap.get(code):null;
   return {id:chat.id,recordId,customerName:order?.buyer_name||chat.customer_name||"Khách Messenger",status,mode:chat.ai_mode==="manual"?"manual":"ai",summary,reason,updatedAt,orderCode:code,orderId:order?.id||null,showName:order?showMap.get(order.show_id)||order.show_id:null,amount:order?.amount_vnd||null,ticketCount:order?.seats.length||null};
  }
  const conversations=[
   ...outcomes.map(item=>row(item.extra_support_chats,item.result,item.created_at,item.order_code,item.summary,item.reason,item.id)),
   ...active.map(item=>row(item.extra_support_chats,item.status,item.updated_at,item.current_order_code,item.summary,item.reason,"active:"+item.chat_id)),
  ].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const configured=aiSalesConfigurationReady(),ready=configured&&!!settings.provider_checked_at&&!settings.provider_error;
  const notificationEmail=(process.env.REPORT_TO_EMAIL||"").trim();
  return reply({enabled:settings.enabled,ready,modelLabel:AI_SALES_MODEL_LABEL,readinessMessage:!configured?"Cấu hình AI, Messenger, thanh toán hoặc email chưa đầy đủ.":settings.provider_error||(!settings.provider_checked_at?"Đang chờ kiểm tra kết nối AI thực tế.":null),updatedAt:new Date().toISOString(),totals,conversations,notificationEmailConfigured:Boolean(process.env.RESEND_API_KEY&&process.env.REPORT_FROM_EMAIL&&notificationEmail),notificationEmail:notificationEmail||null,limited:active.length===250||outcomes.length===250} satisfies AiSalesAdminResponse);
 }catch{console.warn("[ai-sales] Admin read unavailable");return reply({error:"Chưa tải được trạng thái AI bán vé. Vui lòng thử lại."},503);}
}
export async function PATCH(req:NextRequest){
 if(!allowedOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ."},403);
 if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được điều khiển AI bán vé."},403);
 if(Number(req.headers.get("content-length")||0)>3000)return reply({error:"Yêu cầu quá dài."},413);
 const input=await req.json().catch(()=>null);
 try{
  const pageId=getMessengerConfig()?.pageId;if(!pageId)return reply({error:"Messenger chưa sẵn sàng."},503);
  if(input?.action==="connect_ad_referrals"){
   const config=getFacebookOAuthConfig(),messenger=await getMessengerGraphConfig();
   if(!config||!messenger||config.pageId!==messenger.pageId)return reply({error:"Chưa xác minh được kết nối của fanpage 1 EXTRA."},503);
   try{
    const subscription=await verifySaleSubscriptions(config,messenger.pageToken,Date.now()+30000);
    return reply({ok:true,...subscription});
   }catch{return reply({error:"Meta chưa xác nhận kết nối nguồn quảng cáo cho ứng dụng và fanpage."},503);}
  }
  if(input?.action==="set_enabled"&&typeof input.enabled==="boolean"){
   if(input.enabled){const probe=await probeAiSalesModel();if(!probe.ready)return reply({error:probe.message||"AI chưa sẵn sàng; chưa bật trả lời tự động."},503);}
   const result=await aiRpc("configure",{p_page_id:pageId,p_enabled:input.enabled,p_model:AI_SALES_MODEL});
   if(!["configured","updated"].includes(result.outcome))return reply({error:"Chưa cập nhật được cấu hình AI."},409);
  }else if(input?.action==="set_mode"&&typeof input.chatId==="string"&&/^[a-f0-9-]{36}$/i.test(input.chatId)&&["ai","manual"].includes(input.mode)){
   if(input.mode==="ai"){
    const settings=await getAiSalesSettings();
    if(!settings?.enabled||!settings.provider_checked_at||settings.provider_error||!aiSalesConfigurationReady())return reply({error:"Cần bật AI và kiểm tra kết nối thành công trước khi giao lại cuộc trò chuyện."},409);
   }
   const chats=await staffDb("extra_support_chats?id=eq."+input.chatId+"&channel=eq.messenger&messenger_page_id=eq."+pageId+"&select=id&limit=1") as {id:string}[];
   if(!chats.length)return reply({error:"Không tìm thấy cuộc trò chuyện thuộc Fanpage đang kết nối."},404);
   const result=await aiRpc("set_mode",{p_chat_id:input.chatId,p_mode:input.mode==="ai"?"auto":"manual"});
   if(!["updated","configured"].includes(result.outcome))return reply({error:"Chưa thay đổi được người phụ trách cuộc trò chuyện."},409);
  }else return reply({error:"Yêu cầu không hợp lệ."},400);
  after(async()=>{try{await runAiSalesQueue({maxJobs:3});await sendAiSalesOwnerNotifications()}catch{console.warn("[ai-sales] Admin follow-up deferred")}});
  return reply({ok:true});
 }catch{console.warn("[ai-sales] Admin change unavailable");return reply({error:"Chưa cập nhật được AI bán vé. Vui lòng thử lại."},503);}
}

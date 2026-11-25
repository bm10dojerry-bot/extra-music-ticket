import "server-only";
import {staffDb} from "./staff-auth";

type Notification={id:string;outcome_id:string;lease_token:string;attempts:number};
type Outcome={id:string;chat_id:string;result:"successful"|"unsuccessful"|"needs_attention";order_code:string|null;reason:string|null;summary:string|null;delivery_channel:"messenger"|"email"|null;created_at:string};
type Order={code:string;show_id:string;status:string;buyer_name:string;amount_vnd:number;seats:string[];paid_at:string|null;expires_at:string;email_status:string;email_sent_at:string|null};
type Envelope={outcome:Outcome;customerName:string;order:Order|null;show:string;deliveryConfirmed:boolean;deliveryChannel:"messenger"|"email"|null;superseded:boolean};
type FinishResult="sent"|"retry"|"failed"|"uncertain";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^EX[0-9A-F]{16}$/;
const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));

// Outcomes may contain conversational text. Never forward customer ticket
// capabilities, tokens or arbitrary links in an owner notification.
function safeText(value:unknown,limit=600){
  return String(value??"").replace(/https?:\/\/[^\s<>"']+/gi,"[liên kết]")
    .replace(/\b(?:access_token|qr_secret|token)\s*[:=]\s*[^\s"'<>]+/gi,"[thông tin riêng tư]")
    .replace(/\b[a-f0-9]{48,}\b/gi,"[thông tin riêng tư]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").trim().slice(0,limit);
}
function vietnamTime(value:string|null){
  const time=value?Date.parse(value):NaN;
  return Number.isFinite(time)?new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(time)):"Chưa ghi nhận";
}
function emailConfig(){
  const key=process.env.RESEND_API_KEY,from=process.env.REPORT_FROM_EMAIL?.trim(),to=process.env.REPORT_TO_EMAIL?.trim();
  // Use the existing owner report recipient exactly; never derive it from chat/model data.
  if(!key||!from||!to||/[\r\n]/.test(from+to)||!/@/.test(from)||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to))return null;
  return {key,from,to};
}
async function finish(notification:Notification,result:FinishResult,externalId:string|null=null,error:string|null=null):Promise<boolean>{
  try{
    const response=await staffDb("rpc/extra_messenger_ai_finish_notification",{method:"POST",body:JSON.stringify({p_notification_id:notification.id,p_lease_token:notification.lease_token,p_result:result,p_external_id:externalId,p_error:error})}) as {outcome?:string};
    return result==="sent"?response?.outcome==="sent"||response?.outcome==="already_sent":["queued","failed","uncertain"].includes(response?.outcome||"");
  }catch{return false;}
}
async function envelope(notification:Notification):Promise<Envelope>{
  const outcomes=await staffDb("extra_messenger_ai_outcomes?id=eq."+notification.outcome_id+"&select=id,chat_id,result,order_code,reason,summary,delivery_channel,created_at&limit=1") as Outcome[];
  const outcome=outcomes[0];
  if(!outcome||outcome.id!==notification.outcome_id||!UUID.test(outcome.chat_id)||!["successful","unsuccessful","needs_attention"].includes(outcome.result))throw Error("OUTCOME_UNAVAILABLE");
  const chats=await staffDb("extra_support_chats?id=eq."+outcome.chat_id+"&channel=eq.messenger&select=id,customer_name&limit=1") as {id:string;customer_name:string}[];
  if(chats[0]?.id!==outcome.chat_id)throw Error("CHAT_UNAVAILABLE");
  let order:Order|null=null,show="Chưa chọn show",deliveryConfirmed=false,deliveryChannel:Envelope["deliveryChannel"]=null,superseded=false;
  if(outcome.order_code){
    if(!CODE.test(outcome.order_code))throw Error("ORDER_UNAVAILABLE");
    const links=await staffDb("extra_messenger_ai_orders?chat_id=eq."+outcome.chat_id+"&order_code=eq."+outcome.order_code+"&select=chat_id,order_code&limit=1") as {chat_id:string;order_code:string}[];
    if(!links.some(link=>link.chat_id===outcome.chat_id&&link.order_code===outcome.order_code))throw Error("ORDER_UNAVAILABLE");
    const orders=await staffDb("extra_payment_orders?code=eq."+outcome.order_code+"&select=code,show_id,status,buyer_name,amount_vnd,seats,paid_at,expires_at,email_status,email_sent_at&limit=1") as Order[];
    order=orders[0]?.code===outcome.order_code?orders[0]:null;
    if(!order)throw Error("ORDER_UNAVAILABLE");
    const shows=await staffDb("managed_shows?id=eq."+encodeURIComponent(order.show_id)+"&select=artist,title,show_date,show_time&limit=1") as {artist:string;title:string;show_date:string;show_time:string}[];
    const currentShow=shows[0];
    show=currentShow?[currentShow.artist||currentShow.title,currentShow.show_date?.split("-").reverse().join("/"),currentShow.show_time?.slice(0,5)].filter(Boolean).join(" · "):order.show_id;
    if(order.status==="paid"&&order.paid_at){
      const ready=await staffDb("rpc/extra_messenger_ai_paid_delivery_ready",{method:"POST",body:JSON.stringify({p_chat_id:outcome.chat_id,p_order_code:order.code})});
      if(ready===true){
        const receipts=await staffDb("extra_messenger_ai_outbox?chat_id=eq."+outcome.chat_id+"&order_code=eq."+order.code+"&purpose=eq.ticket&state=eq.sent&external_message_id=not.is.null&select=id,sent_at&limit=1") as {id:string;sent_at:string|null}[];
        if(receipts.some(receipt=>UUID.test(receipt.id)&&Number.isFinite(Date.parse(receipt.sent_at||"")))){deliveryConfirmed=true;deliveryChannel="messenger";}
        else if(order.email_status==="sent"&&Number.isFinite(Date.parse(order.email_sent_at||""))){deliveryConfirmed=true;deliveryChannel="email";}
      }
      if(outcome.result!=="successful"){
        const completed=await staffDb("extra_messenger_ai_outcomes?chat_id=eq."+outcome.chat_id+"&order_code=eq."+order.code+"&result=eq.successful&select=id&limit=1") as {id:string}[];
        superseded=completed.some(item=>UUID.test(item.id));
      }
    }
  }
  return {outcome,customerName:order?.buyer_name||chats[0].customer_name,order,show,deliveryConfirmed,deliveryChannel,superseded};
}
function renderEmail(data:Envelope){
  const {outcome,order}=data,paid=order?.status==="paid"&&Boolean(order.paid_at);
  const success=outcome.result==="successful"&&paid&&data.deliveryConfirmed;
  const needsAttention=outcome.result==="needs_attention"||outcome.result==="successful"&&!success||outcome.result==="unsuccessful"&&paid;
  const heading=success?"Chốt đơn thành công":needsAttention?"Chưa hoàn tất xử lý":"Chưa chốt được đơn";
  const status=success?"AI đã chốt đơn, hệ thống xác nhận thanh toán và vé đã được gửi qua "+(data.deliveryChannel==="messenger"?"Messenger.":"email."):
    paid?(data.deliveryConfirmed?"Đã xác nhận thanh toán và ghi nhận gửi vé. Cần xem lại phần xử lý hội thoại.":"Đã xác nhận nhận tiền. Việc giao vé chưa có xác nhận hoàn tất; cần kiểm tra bước giao vé."):
    needsAttention?"AI cần xử lý tiếp trường hợp này. Trạng thái thanh toán được giữ nguyên theo dữ liệu đối soát.":"AI chưa chốt được đơn trong lượt tư vấn này.";
  const payment=paid?"Đã nhận tiền · "+vietnamTime(order!.paid_at):order?.status==="review"?"Đang cần đối chiếu thanh toán":order?.status==="expired"||order?.status==="pending"&&Date.parse(order.expires_at)<=Date.now()?"Hết hạn giữ ghế, chưa xác nhận thanh toán":order?"Chưa xác nhận thanh toán":"Chưa tạo đơn thanh toán";
  const amount=order&&Number.isSafeInteger(order.amount_vnd)&&order.amount_vnd>=0?new Intl.NumberFormat("vi-VN").format(order.amount_vnd)+"đ":"Chưa có";
  const details:Array<[string,string]>=[
    ["Khách hàng",safeText(data.customerName,120)],["Mã đơn",order?.code||"Chưa tạo đơn"],
    ["Show",safeText(data.show,300)],["Ghế",order?.seats?.map(seat=>safeText(seat,30)).join(", ")||"Chưa giữ ghế"],
    ["Giá trị đơn",amount],["Thanh toán",payment],["Thời điểm ghi nhận",vietnamTime(outcome.created_at)],
  ];
  // The authoritative payment/delivery facts above take precedence over an
  // earlier conversational summary, which may be stale or model-generated.
  const reason=paid&&outcome.result==="unsuccessful"?"Đơn đã ghi nhận thanh toán sau lượt xử lý trước; đang kiểm tra việc hoàn tất giao vé.":safeText(outcome.reason);
  const conversationUrl="https://admin.iextra.net/admin?section=support-chats&chatId="+outcome.chat_id;
  const orderUrl=order?"https://admin.iextra.net/admin?section=tickets&orderCode="+order.code:null;
  const text=["+1 EXTRA MUSIC SHOW — "+heading,status,...details.map(([label,value])=>label+": "+value),reason?"Lý do: "+reason:"","Mở cuộc trò chuyện: "+conversationUrl,orderUrl?"Xem đơn trong Admin: "+orderUrl:""].filter(Boolean).join("\n");
  const html='<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#202027;line-height:1.6"><p style="font-weight:bold;color:#bb233a">+1 EXTRA MUSIC SHOW · AI BÁN VÉ</p><h2>'+escapeHtml(heading)+'</h2><p>'+escapeHtml(status)+'</p><table style="border-collapse:collapse;width:100%">'+details.map(([label,value])=>'<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;vertical-align:top">'+escapeHtml(label)+'</th><td style="padding:8px;border-bottom:1px solid #ddd">'+escapeHtml(value)+'</td></tr>').join("")+'</table>'+(reason?'<p><b>Lý do:</b> '+escapeHtml(reason)+'</p>':"")+'<p><a href="'+escapeHtml(conversationUrl)+'">Mở cuộc trò chuyện</a>'+(orderUrl?' · <a href="'+escapeHtml(orderUrl)+'">Xem đơn trong Admin</a>':"")+'</p></div>';
  return {subject:"Extra Music | AI "+heading+(order?" #"+order.code:""),text,html};
}

/** Sends only owner outcome reports. A network timeout/5xx/malformed success is
 * ambiguous and is persisted as uncertain, never automatically sent again. */
export async function sendAiSalesOwnerNotifications():Promise<{sent:number;pending:number}>{
  const config=emailConfig();if(!config)return {sent:0,pending:0};
  let claimed:{notifications:Notification[]};
  try{claimed=await staffDb("rpc/extra_messenger_ai_claim_notifications",{method:"POST",body:JSON.stringify({p_limit:5})}) as typeof claimed;}
  catch{throw Error("AI owner notification queue unavailable");}
  if(!Array.isArray(claimed?.notifications))throw Error("AI owner notification queue returned invalid data");
  let sent=0,pending=0;
  const visited=new Set<string>();
  for(const notification of claimed.notifications){
    if(!notification||![notification.id,notification.outcome_id,notification.lease_token].every(value=>typeof value==="string"&&UUID.test(value))){pending++;continue;}
    if(visited.has(notification.id))continue;visited.add(notification.id);
    let content:ReturnType<typeof renderEmail>;
    try{
      const data=await envelope(notification);
      if(data.superseded){await finish(notification,"failed",null,"OUTCOME_SUPERSEDED_BY_PAID_DELIVERY");continue;}
      content=renderEmail(data);
    }catch{await finish(notification,"retry",null,"OUTCOME_METADATA_UNAVAILABLE");pending++;continue;}
    let response:Response;
    try{
      response=await fetch("https://api.resend.com/emails",{method:"POST",redirect:"error",headers:{Authorization:"Bearer "+config.key,"Content-Type":"application/json","Idempotency-Key":"extra-ai-outcome:"+notification.outcome_id},body:JSON.stringify({from:config.from,to:[config.to],...content}),signal:AbortSignal.timeout(10000)});
    }catch{await finish(notification,"uncertain",null,"EMAIL_SEND_OUTCOME_UNCONFIRMED");pending++;continue;}
    if(response.ok){
      let receipt:unknown;try{receipt=await response.json();}catch{receipt=null;}
      const id=receipt&&typeof receipt==="object"&&"id" in receipt?receipt.id:null;
      if(typeof id!=="string"||!/^[A-Za-z0-9_-]{8,200}$/.test(id)){
        await finish(notification,"uncertain",null,"EMAIL_RECEIPT_UNCONFIRMED");pending++;continue;
      }
      if(await finish(notification,"sent",id)){sent++;}else{pending++;}
      continue;
    }
    // Only an explicit rate-limit rejection is retried. 409 can refer to a
    // prior accepted idempotent send; 408/5xx can also follow an accepted send.
    if(response.status===429)await finish(notification,"retry",null,"EMAIL_RATE_LIMITED");
    else if([400,401,403,404,405,422].includes(response.status))await finish(notification,"failed",null,"EMAIL_REJECTED_HTTP_"+response.status);
    else await finish(notification,"uncertain",null,"EMAIL_OUTCOME_UNCONFIRMED_HTTP_"+response.status);
    pending++;
  }
  return {sent,pending};
}

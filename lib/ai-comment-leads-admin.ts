import "server-only";
import type {AiSettings} from "./ai-sales";
import type {AiCommentLead,AiCommentLeadStatus,AiCommentLeadsAdminResponse} from "./ai-comment-leads-admin-types";

const PAGE_ID="1223940670813189";
type Row=Record<string,unknown>;
export type CommentMasterStatus={settings:AiSettings|null;configured:boolean};
const row=(value:unknown):Row=>value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown,limit=1200)=>typeof value==="string"?value.slice(0,limit):"";
const count=(value:unknown):number|null=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function timestamp(value:unknown,now:number):string|null{
  if(typeof value!=="string")return null;
  const time=Date.parse(value);
  return Number.isFinite(time)&&time<=now+60_000?new Date(time).toISOString():null;
}
export function safeCommentAdminReason(value:unknown,fallback=""):string{
  const message=text(value);
  // Reasons are server-generated fixed copy. Fail closed if a future provider
  // integration accidentally stores credential-bearing diagnostics instead.
  return !message||/\b(?:access_token|appsecret_proof|client_secret|api[_ -]?key|authorization|bearer|recipient_psid|send_token|lease_token)\b|[?&]token=/i.test(message)?fallback:message;
}
function sourceLinks(item:Row):{postUrl:string|null;commentUrl:string|null}{
  const postId=text(item.post_id,180),commentId=text(item.comment_id,250);
  if(item.page_id!==PAGE_ID||!new RegExp("^"+PAGE_ID+"_[0-9]{5,80}$").test(postId))return {postUrl:null,commentUrl:null};
  const postUrl="https://www.facebook.com/"+PAGE_ID+"/posts/"+postId.slice(PAGE_ID.length+1);
  const commentUrl=/^[0-9]{5,80}(_[0-9]{5,80}){0,2}$/.test(commentId)?postUrl+"?comment_id="+commentId.split("_").at(-1):null;
  return {postUrl,commentUrl};
}
const statusMap:Record<string,AiCommentLeadStatus>={pending:"pending",processing:"pending",ready:"eligible",sending:"sending",sent:"sent",review:"needs_review",skipped:"skipped",expired:"skipped",failed:"failed",uncertain:"uncertain"};

/** Whitelist the Admin projection; never spread raw settings or provider records. */
export function commentLeadsAdminView(contract:unknown,master:CommentMasterStatus,now=Date.now()):AiCommentLeadsAdminResponse{
  const source=row(contract),settings=row(source.settings),totals=row(source.totals);
  const belongsToPage=settings.page_id===PAGE_ID;
  const enabled=belongsToPage&&settings.enabled===true;
  const publicAccessReady=belongsToPage&&settings.public_access_ready===true;
  const checked=timestamp(settings.permissions_checked_at,now),fresh=Boolean(checked&&now-Date.parse(checked)<=86_400_000);
  const masterReady=master.configured&&master.settings?.page_id===PAGE_ID&&master.settings.enabled===true&&Boolean(timestamp(master.settings.provider_checked_at,now))&&master.settings.provider_error===null;
  const pageConnectionReady=Boolean(belongsToPage&&settings.permissions_ready===true&&settings.page_access_ready===true&&settings.private_messaging_ready===true&&settings.feed_subscribed===true&&fresh);
  const ready=Boolean(publicAccessReady&&pageConnectionReady&&masterReady);
  let readinessMessage:string|null=null;
  if(!ready){
    if(!belongsToPage)readinessMessage="Chưa khởi tạo tư vấn bình luận cho Page 1 EXTRA.";
    else if(!master.configured)readinessMessage="Cấu hình AI bán vé, Messenger, thanh toán hoặc email chưa đầy đủ.";
    else if(!master.settings||master.settings.page_id!==PAGE_ID)readinessMessage="Chưa khởi tạo AI bán vé cho Page 1 EXTRA.";
    else if(!master.settings.enabled)readinessMessage="Cần bật AI bán vé để tiếp tục tư vấn khi khách phản hồi trong Messenger.";
    else if(!timestamp(master.settings.provider_checked_at,now)||master.settings.provider_error!==null)readinessMessage="AI bán vé đang chờ kiểm tra kết nối thành công trước khi tự tư vấn từ bình luận.";
    else if(settings.page_access_ready!==true)readinessMessage=safeCommentAdminReason(settings.readiness_reason,"Chưa xác minh quyền đọc bài viết và bình luận của Page 1 EXTRA.");
    else if(settings.private_messaging_ready!==true)readinessMessage=safeCommentAdminReason(settings.readiness_reason,"Chưa xác minh quyền gửi lời tư vấn riêng từ bình luận của Page.");
    else if(settings.feed_subscribed!==true)readinessMessage="Chưa kết nối nhận bình luận mới từ Facebook. Quét bổ sung chỉ kiểm tra một số bài gần đây, chưa thay thế việc nhận đầy đủ bình luận mới.";
    else if(!fresh)readinessMessage="Quyền Facebook chưa được kiểm tra hợp lệ trong 24 giờ qua. Cần kiểm tra kết nối trước khi gửi lời tư vấn mới.";
    else if(!publicAccessReady)readinessMessage="Chưa xác minh đầy đủ quyền tự tư vấn cho khách hàng thực tế trên Facebook. Kết nối quyền Page không tự xác nhận điều kiện này.";
    else readinessMessage=safeCommentAdminReason(settings.readiness_reason,"Chưa xác minh đầy đủ kết nối bình luận và tư vấn riêng của Page.");
  }
  const rawLeads=Array.isArray(source.leads)?source.leads:[];
  const leads:AiCommentLead[]=rawLeads.slice(0,200).map(row).filter(item=>belongsToPage&&item.page_id===PAGE_ID&&uuid(item.id)).map(item=>{
    const sentAt=item.state==="sent"?timestamp(item.sent_at,now):null;
    const responseAt=timestamp(item.responded_at,now);
    const repliedAt=sentAt&&responseAt&&Date.parse(responseAt)>=Date.parse(sentAt)&&uuid(item.chat_id)?responseAt:null;
    const snapshot=row(item.show_snapshot);
    return {
      id:item.id as string,customerName:text(item.author_name,120)||"Khách Facebook",commentText:text(item.body,5000),
      postTitle:text(item.post_text,350)||null,showName:text(item.artist,180)||text(snapshot.artist,180)||text(snapshot.title,180)||null,
      status:repliedAt?"replied":statusMap[text(item.state,40)]||"needs_review",
      reason:safeCommentAdminReason(item.reason,text(item.reason)?"Cần kiểm tra trạng thái xử lý.":"")||null,replyPreview:text(item.reply_body,1000)||null,
      commentedAt:timestamp(item.comment_created_at,now)||"",updatedAt:timestamp(item.updated_at,now)||"",sentAt,repliedAt,
      ...sourceLinks(item),chatId:repliedAt?item.chat_id as string:null,
    };
  });
  const review=count(totals.review),uncertain=count(totals.uncertain);
  const hourly=count(settings.max_hourly),daily=count(settings.max_daily);
  return {
    enabled,ready,pageConnectionReady,publicAccessReady,readinessMessage,updatedAt:timestamp(source.updated_at,now)||new Date(now).toISOString(),
    pausePending:!enabled&&(source.in_flight===true||leads.some(lead=>lead.status==="sending")),
    lastScanAt:timestamp(settings.last_scan_at,now),lastWorkerAt:timestamp(settings.last_worker_at,now),
    ...(hourly&&daily?{limits:{hourly,daily,contactCooldownDays:7}}:{}),
    totals:{eligible:belongsToPage?count(totals.ticket_intents):null,sent:belongsToPage?count(totals.sent):null,replied:belongsToPage?count(totals.replied):null,needsReview:belongsToPage&&review!==null&&uncertain!==null?review+uncertain:null,failed:belongsToPage?count(totals.failed):null},
    leads,limited:source.limited===true||rawLeads.length>200,
  };
}

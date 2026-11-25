import "server-only";
import {staffDb} from "./staff-auth";
import type {TikTokCommentAdminResponse,TikTokCommentRow,TikTokCommentStatus} from "./tiktok-comment-admin-types";

const ACCOUNT_ID="_000sd66QHaR1gzOHpaX-DUk0eApRTRifAHL";
type Row=Record<string,unknown>;
const record=(value:unknown):Row=>value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown,max=1000)=>typeof value==="string"?value.slice(0,max):"";
const count=(value:unknown):number|null=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const username=(value:unknown):string|null=>typeof value==="string"&&/^[a-z\d_][a-z\d_.]{1,23}$/i.test(value)&&!value.endsWith(".")?value:null;
function timestamp(value:unknown,now:number):string|null{
  if(typeof value!=="string")return null;
  const time=Date.parse(value);
  return Number.isFinite(time)&&time<=now+60000?new Date(time).toISOString():null;
}
export function safeTikTokAdminReason(value:unknown,fallback=""):string{
  const message=text(value,1000);
  return !message||/\b(?:access[_ -]?token|client_secret|api[_ -]?key|authorization|bearer|lease_token|send_token|scan_token|service_role|recipient_psid)\b|[?&](?:token|key|secret)=/i.test(message)?fallback:message;
}
const states:Record<string,TikTokCommentStatus>={pending:"pending",processing:"pending",ready:"ready",sending:"sending",sent:"uncertain",skipped:"skipped",review:"needs_review",failed:"failed",uncertain:"uncertain"};

/** Deliberately limited to Admin reads and the enabled toggle, not worker/send RPCs. */
export async function tikTokCommentAdminRpc(name:"read_contract"|"configure",params:Record<string,unknown>={}):Promise<unknown>{
  if(!["read_contract","configure"].includes(name))throw Error("Unknown TikTok admin operation");
  return staffDb("rpc/extra_tiktok_comment_"+name,{method:"POST",body:JSON.stringify(params)});
}

/** Never spread raw connection settings, leases, author identities or provider receipts. */
export function tikTokCommentAdminView(contract:unknown,now=Date.now()):TikTokCommentAdminResponse{
  const source=record(contract),settings=record(source.settings),totals=record(source.totals);
  if(settings.account_id!==ACCOUNT_ID||typeof settings.enabled!=="boolean"||!source.totals||typeof source.totals!=="object"||Array.isArray(source.totals)||!Array.isArray(source.jobs)||!timestamp(source.updated_at,now))throw Error("TikTok comment settings unavailable");
  const handle=username(settings.username),connected=settings.connection_ready===true;
  const permissionsCheckedAt=timestamp(settings.permissions_checked_at,now);
  const fresh=Boolean(permissionsCheckedAt&&now-Date.parse(permissionsCheckedAt)<=86400000);
  const automationId=text(settings.automation_id,250);
  const pollIntervalMinutes=count(settings.poll_interval_minutes);
  const scheduleReady=settings.schedule_ready===true&&Boolean(automationId.trim())&&automationId!=="manual:root"&&!/[\s\u0000-\u001f]/.test(automationId)&&pollIntervalMinutes!==null&&pollIntervalMinutes>=60&&pollIntervalMinutes%60===0;
  const lastReplyAt=timestamp(settings.last_reply_at,now);
  const replyVerified=settings.reply_ready===true&&Boolean(lastReplyAt);
  const canEnable=connected&&Boolean(handle)&&settings.read_ready===true&&settings.reply_scope_ready===true&&scheduleReady;
  const ready=canEnable&&fresh;
  let readinessMessage:string|null=null;
  if(!connected)readinessMessage="Chưa xác minh kết nối tài khoản TikTok.";
  else if(!handle)readinessMessage="Cần xác minh tên người dùng của kênh TikTok trước khi tự trả lời bình luận.";
  else if(settings.read_ready!==true)readinessMessage=safeTikTokAdminReason(settings.readiness_reason,"Chưa xác minh quyền đọc bình luận trên video của kênh.");
  else if(settings.reply_scope_ready!==true)readinessMessage=safeTikTokAdminReason(settings.readiness_reason,"Chưa xác minh quyền trả lời bình luận công khai của kênh.");
  else if(!fresh)readinessMessage="Quyền TikTok chưa được kiểm tra hợp lệ trong 24 giờ qua. Chờ xác minh lại trước lượt trả lời mới.";
  else if(!scheduleReady)readinessMessage="Kênh đã kết nối. Chưa xác minh lịch tự động kiểm tra và trả lời bình luận.";
  else if(!replyVerified)readinessMessage="Đã có lịch tự động. Chưa ghi nhận lần trả lời công khai thành công đầu tiên.";
  // Provider-plan/cache limitations remain visible even after a schedule exists.
  const sourceReason=safeTikTokAdminReason(settings.readiness_reason);
  if(sourceReason&&sourceReason!==readinessMessage)readinessMessage=[readinessMessage,sourceReason].filter(Boolean).join(" ");
  const sourceFreshnessWarning=settings.refresh_plan_blocked===true?safeTikTokAdminReason(settings.freshness_reason,"Nguồn dữ liệu có thể cập nhật chậm. Gói hiện tại chưa hỗ trợ làm mới theo yêu cầu; chỉ trả lời khi dữ liệu gốc còn đủ mới."):null;

  const rawJobs=Array.isArray(source.jobs)?source.jobs:[];
  const comments:TikTokCommentRow[]=rawJobs.slice(0,100).map(record).filter(job=>job.account_id===ACCOUNT_ID&&uuid(job.id)).map(job=>{
    const sentAt=timestamp(job.sent_at,now),receipt=text(job.provider_reply_id,200);
    const confirmed=job.state==="sent"&&Boolean(sentAt)&&/^[a-z\d_-]{5,200}$/i.test(receipt);
    const videoId=text(job.video_id,100);
    return {
      id:job.id as string,customerName:text(job.comment_username,120)||"Khách TikTok",commentText:text(job.comment_text,5000),videoCaption:text(job.video_caption,600)||null,
      status:confirmed?"replied":states[text(job.state,40)]||"needs_review",
      reason:safeTikTokAdminReason(job.reason,text(job.reason)?"Cần kiểm tra kết quả xử lý bình luận.":"")||null,
      replyPreview:text(job.reply_body,1200)||null,
      videoUrl:handle&&/^[0-9]{5,30}$/.test(videoId)?"https://www.tiktok.com/@"+handle+"/video/"+videoId:null,
      firstSeenAt:timestamp(job.first_seen_at,now),updatedAt:timestamp(job.updated_at,now),repliedAt:confirmed?sentAt:null,
    };
  });
  const enabled=settings.enabled===true;
  return {
    account:{name:text(settings.account_name,120)||"Kênh TikTok",username:handle,profileUrl:handle?"https://www.tiktok.com/@"+handle:null,connected},
    enabled,canEnable,ready,scheduleReady,pollIntervalMinutes,replyVerified,pausePending:!enabled&&(source.in_flight===true||comments.some(comment=>comment.status==="sending")),readinessMessage,sourceFreshnessWarning,sourceCoverageLimited:settings.last_scan_limited===true,
    updatedAt:timestamp(source.updated_at,now)||new Date(now).toISOString(),permissionsCheckedAt,
    lastScanAt:timestamp(settings.last_scan_at,now),lastWorkerAt:timestamp(settings.last_worker_at,now),lastSuccessAt:timestamp(settings.last_success_at,now),lastReplyAt,
    lastError:safeTikTokAdminReason(settings.last_error,text(settings.last_error)?"Lượt xử lý gần nhất gặp lỗi; cần kiểm tra kết nối và tác vụ.":"")||null,
    reportDays:30,totals:{processed:count(totals.processed),replied:count(totals.sent),needsReview:count(totals.review),uncertain:count(totals.uncertain),failed:count(totals.failed)},
    comments,limited:source.limited===true||rawJobs.length>100,
  };
}

export async function readTikTokCommentAdmin():Promise<TikTokCommentAdminResponse>{
  return tikTokCommentAdminView(await tikTokCommentAdminRpc("read_contract"));
}

"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {TikTokCommentAdminResponse,TikTokCommentRow,TikTokCommentStatus} from "../../lib/tiktok-comment-admin-types";
import styles from "./tiktok-comment-panel.module.css";

type Filter="all"|"waiting"|"replied"|"attention"|"skipped";
const numbers=new Intl.NumberFormat("vi-VN");
const count=(value:number|null|undefined)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?numbers.format(value):"—";
const time=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"Chưa ghi nhận";
const statusNames:Record<TikTokCommentStatus,string>={pending:"Đang phân loại",ready:"Chờ trả lời",sending:"Đang gửi phản hồi",replied:"Đã trả lời công khai",skipped:"Đã bỏ qua",needs_review:"Cần kiểm tra",failed:"Trả lời chưa thành công",uncertain:"Chưa rõ kết quả gửi"};
const attention=(comment:TikTokCommentRow)=>["needs_review","failed","uncertain"].includes(comment.status);
function sourceUrl(value:string|null|undefined,video=false):string|null{
  if(!value)return null;
  try{
    const url=new URL(value),pattern=video?/^\/@[a-z\d_][a-z\d_.]{1,23}\/video\/[0-9]{5,30}$/i:/^\/@[a-z\d_][a-z\d_.]{1,23}$/i;
    return url.protocol==="https:"&&url.hostname==="www.tiktok.com"&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&pattern.test(url.pathname)?url.href:null;
  }catch{return null;}
}
const receivedReply=(comment:TikTokCommentRow)=>comment.status==="replied"&&Boolean(comment.repliedAt&&Number.isFinite(Date.parse(comment.repliedAt)));

export default function TikTokCommentPanel(){
  const [data,setData]=useState<TikTokCommentAdminResponse|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(""),[notice,setNotice]=useState("");
  const [expanded,setExpanded]=useState(false),[filter,setFilter]=useState<Filter>("all"),[visible,setVisible]=useState(5);
  const mounted=useRef(true),requestId=useRef(0),mutationPending=useRef(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const current=++requestId.current;
    try{
      const response=await fetch("/api/admin/tiktok-comment-sales",{cache:"no-store",signal});
      const result=await response.json().catch(()=>null) as TikTokCommentAdminResponse&{error?:string}|null;
      if(!response.ok||!result)throw Error(result?.error||"Chưa tải được trạng thái bình luận TikTok.");
      if(typeof result.enabled!=="boolean"||typeof result.canEnable!=="boolean"||typeof result.ready!=="boolean"||typeof result.scheduleReady!=="boolean"||typeof result.replyVerified!=="boolean"||typeof result.account?.connected!=="boolean"||!result.totals||!Array.isArray(result.comments))throw Error("Báo cáo TikTok chưa đầy đủ. Chưa thể xác nhận tác vụ đang hoạt động.");
      if(mounted.current&&!signal?.aborted&&current===requestId.current){setData(result);setError("");}
    }catch(cause){if(mounted.current&&!signal?.aborted&&current===requestId.current)setError(cause instanceof Error?cause.message:"Chưa tải được trạng thái TikTok.");}
    finally{if(mounted.current&&!signal?.aborted&&current===requestId.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();let polling=false;
    const poll=async()=>{if(polling||mutationPending.current)return;polling=true;try{await refresh(controller.signal);}finally{polling=false;}};
    void poll();const timer=setInterval(()=>{if(document.visibilityState==="visible")void poll();},30000);
    return()=>{mounted.current=false;controller.abort();clearInterval(timer);};
  },[refresh]);
  async function change(enabled:boolean){
    if(mutationPending.current)return;
    mutationPending.current=true;requestId.current++;setBusy(true);setActionError("");setNotice("");
    try{
      const response=await fetch("/api/admin/tiktok-comment-sales",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set_enabled",enabled})});
      const result=await response.json().catch(()=>null) as {ok?:boolean;error?:string;pausePending?:boolean}|null;
      if(!response.ok||result?.ok!==true)throw Error(result?.error||"Chưa lưu được chế độ trả lời bình luận TikTok.");
      if(mounted.current){
        setNotice(enabled?"Đã lưu yêu cầu bật trả lời bình luận. Trạng thái mới được cập nhật bên dưới.":result.pausePending?"Đã nhận yêu cầu tạm dừng. Phản hồi đã bắt đầu gửi cần chờ TikTok xác nhận.":"Đã tạm dừng nhận lượt trả lời bình luận mới.");
        await refresh();
      }
    }catch(cause){if(mounted.current)setActionError(cause instanceof Error?cause.message:"Chưa cập nhật được chế độ TikTok.");}
    finally{mutationPending.current=false;if(mounted.current)setBusy(false);}
  }
  const comments=useMemo(()=>(data?.comments||[]).filter(comment=>filter==="all"||filter==="waiting"&&["pending","ready","sending"].includes(comment.status)||filter==="attention"&&attention(comment)||comment.status===filter),[data,filter]);
  const active=Boolean(!error&&data?.enabled&&data.ready&&data.account.connected&&data.scheduleReady&&data.replyVerified&&!data.pausePending&&!data.lastError);
  const stateLabel=!data?loading?"Đang kiểm tra TikTok":"Chưa tải trạng thái TikTok":error?"Chưa xác minh trạng thái mới nhất":data.pausePending?"Đang hoàn tất tạm dừng":!data.enabled?"Đã tạm dừng":!data.account.connected?"Chờ kết nối kênh":!data.scheduleReady?"Đã kết nối · chờ lịch tự động":!data.ready?"Chờ kiểm tra quyền TikTok":data.lastError?"Lượt xử lý gần nhất cần kiểm tra":!data.replyVerified?"Đã lên lịch · chờ lượt trả lời đầu tiên":"Đang tự trả lời bình luận";
  const profile=sourceUrl(data?.account.profileUrl);
  const metrics=[{label:"Đã xử lý",value:data?.totals.processed},{label:"Đã trả lời công khai",value:data?.totals.replied},{label:"Cần kiểm tra",value:data?.totals.needsReview},{label:"Chưa rõ kết quả gửi",value:data?.totals.uncertain},{label:"Trả lời chưa thành công",value:data?.totals.failed}];

  return <section className={styles.panel} aria-label="Tư vấn bình luận TikTok" aria-busy={loading}>
    <div className={styles.header}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>TIKTOK · BÌNH LUẬN CÔNG KHAI</span>
        <h2>Tư vấn vé trên TikTok</h2>
        <p>Theo dõi và trả lời các câu hỏi về vé trên video của kênh.</p>
        <span className={active?styles.active:styles.waiting}><i aria-hidden="true"/>{stateLabel}</span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={data?.enabled?styles.secondary:styles.primary} disabled={!data||busy||Boolean(data.pausePending&&!data.enabled)||Boolean(!data.enabled&&(!data.canEnable||error))} onClick={()=>data&&void change(!data.enabled)}>{busy?"Đang cập nhật…":data?.enabled?"Tạm dừng trả lời TikTok":"Bật trả lời TikTok"}</button>
        <button type="button" className={styles.quiet} disabled={loading||busy} onClick={()=>{setLoading(true);void refresh();}}>Cập nhật TikTok</button>
      </div>
    </div>
    <div className={styles.connection}>
      <div><span>Kênh TikTok</span><strong>{data?.account.name||"Chưa tải thông tin kênh"}</strong>{data?.account.username?<small>{profile?<a href={profile} target="_blank" rel="noopener noreferrer">@{data.account.username}</a>:"@"+data.account.username}</small>:null}<small>{data?data.account.connected?"Đã xác minh kết nối":"Chưa xác minh kết nối":"Chưa có trạng thái kết nối"}</small></div>
      <div><span>Lịch tự động</span><strong>{data?data.scheduleReady?"Đã xác minh lịch":"Chưa xác minh lịch":"Chưa có trạng thái lịch"}</strong><small>{data?.scheduleReady?"Kiểm tra bình luận "+(data.pollIntervalMinutes===60?"mỗi giờ":data.pollIntervalMinutes?"mỗi "+count(data.pollIntervalMinutes)+" phút":"theo lịch đã xác minh")+". Tạm dừng sẽ chặn lượt trả lời mới.":"Chờ xác minh lịch kiểm tra mỗi giờ; yêu cầu bật chưa tạo lịch."}</small></div>
      <div><span>Phản hồi đầu tiên</span><strong>{data?.replyVerified?"Đã có xác nhận TikTok":"Chưa ghi nhận thành công"}</strong><small>{data?.lastReplyAt?time(data.lastReplyAt):"Chỉ tính khi TikTok xác nhận phản hồi công khai."}</small></div>
    </div>
    {data?.readinessMessage?<p className={styles.warning} role="status">{data.readinessMessage}</p>:null}
    {data?.sourceFreshnessWarning?<p className={styles.warning} role="status"><strong>Nguồn dữ liệu có thể cập nhật chậm.</strong> {data.sourceFreshnessWarning}</p>:null}
    {data?.sourceCoverageLimited?<p className={styles.warning} role="status">Lần quét gần nhất chưa đọc đủ bình luận từ nguồn. Các trường hợp chưa đủ dữ liệu sẽ chờ kiểm tra trước khi trả lời.</p>:null}
    {data?.pausePending?<p className={styles.warning} role="status">Đã ngừng nhận lượt gửi mới. Phản hồi đang gửi vẫn cần chờ xác nhận kết quả.</p>:null}
    {data?.lastError?<p className={styles.warning} role="status">{data.lastError}</p>:null}
    {error?<div className={styles.error} role="alert"><p>{error}</p>{data?<small>Dữ liệu cũ được cập nhật lúc {time(data.updatedAt)}. Chưa xác minh được trạng thái hiện tại.</small>:null}</div>:null}
    {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    <p className={styles.period}>{data?.reportDays?"Bình luận đã ghi nhận trong "+count(data.reportDays)+" ngày gần nhất":"Bình luận đã được ghi nhận"}</p>
    <div className={styles.metrics}>{metrics.map(metric=><div key={metric.label}><span>{metric.label}</span><strong>{count(metric.value)}</strong></div>)}</div>
    <div className={styles.summary}>
      <p>Mỗi bình luận phù hợp được xử lý một lần. Kết quả gửi chưa rõ sẽ chờ kiểm tra để tránh trả lời trùng.</p>
      <button type="button" className={styles.secondary} aria-expanded={expanded} aria-controls="extra-tiktok-comments" onClick={()=>setExpanded(value=>!value)}>{expanded?"Thu gọn bình luận TikTok":"Xem bình luận TikTok"}<span aria-hidden="true">{expanded?"−":"+"}</span></button>
    </div>
    {expanded?<div id="extra-tiktok-comments" className={styles.details}>
      <label className={styles.filter}><span>Trạng thái TikTok</span><select value={filter} onChange={event=>{setFilter(event.target.value as Filter);setVisible(5);}}><option value="all">Tất cả bình luận</option><option value="waiting">Chờ xử lý</option><option value="replied">Đã trả lời công khai</option><option value="attention">Cần kiểm tra</option><option value="skipped">Đã bỏ qua</option></select></label>
      {data?.limited?<p className={styles.limitNote}>Đang hiển thị các bình luận gần nhất; số tổng hợp có thể bao gồm bình luận cũ hơn danh sách.</p>:null}
      {!comments.length?<div className={styles.empty}>{!data?"Danh sách sẽ xuất hiện khi tải được báo cáo TikTok.":filter!=="all"?"Chưa có bình luận phù hợp bộ lọc.":"Chưa có bình luận được ghi nhận trong tác vụ tự động."}</div>:<div>{comments.slice(0,visible).map(comment=>{
        const video=sourceUrl(comment.videoUrl,true),confirmed=receivedReply(comment);
        const label=comment.status==="replied"&&!confirmed?"Chờ xác minh phản hồi":statusNames[comment.status]||"Cần kiểm tra";
        return <article key={comment.id} className={styles.comment}>
          <div className={styles.commentHeader}><h3>{comment.customerName}</h3><span className={confirmed?styles.replied:attention(comment)?styles.attention:styles.pending}>{label}</span></div>
          {comment.videoCaption?<p className={styles.caption}>{comment.videoCaption}</p>:null}
          <blockquote>{comment.commentText||"Bình luận chưa có nội dung văn bản."}</blockquote>
          {comment.replyPreview?<div className={styles.reply}><strong>{confirmed?"Nội dung đã trả lời công khai":"Nội dung phản hồi dự kiến"}</strong><p>{comment.replyPreview}</p></div>:null}
          {comment.reason?<p className={styles.reason}>{comment.reason}</p>:null}
          <div className={styles.commentFooter}><div><span>Ghi nhận: {time(comment.firstSeenAt)}</span>{confirmed?<span>Đã trả lời: {time(comment.repliedAt)}</span>:null}</div>{video?<a href={video} target="_blank" rel="noopener noreferrer">Xem video và bình luận ↗</a>:null}</div>
        </article>;
      })}</div>}
      {comments.length>visible?<button type="button" className={styles.loadMore} onClick={()=>setVisible(value=>value+5)}>Xem thêm bình luận</button>:null}
    </div>:null}
    <div className={styles.footer}><span>Quét gần nhất: {time(data?.lastScanAt)}</span><span>Lượt xử lý gần nhất: {time(data?.lastWorkerAt)}</span></div>
    <p className={styles.dmNote}><strong>Tin nhắn trực tiếp TikTok chưa kết nối.</strong> Cần quyền Business Messaging riêng để tiếp nhận và trả lời tin nhắn.</p>
  </section>;
}

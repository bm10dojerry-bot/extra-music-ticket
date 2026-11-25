"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {AiCommentLead,AiCommentLeadStatus,AiCommentLeadsAdminAction,AiCommentLeadsAdminResponse} from "../../lib/ai-comment-leads-admin-types";
import styles from "./ai-comment-leads-panel.module.css";

type LeadFilter="all"|"waiting"|"sent"|"replied"|"attention"|"skipped";
const numbers=new Intl.NumberFormat("vi-VN");
const formatCount=(value:number|null|undefined)=>typeof value==="number"&&Number.isFinite(value)&&value>=0?numbers.format(value):"—";
const time=(value:string|null|undefined)=>{
  if(!value)return "Chưa có thời gian";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Chưa có thời gian":date.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
};
const searchable=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/gi,"d").toLocaleLowerCase("vi");
const names:Record<AiCommentLeadStatus,string>={pending:"Đang phân loại",eligible:"Chờ nhắn tư vấn",sending:"Đang gửi",sent:"Đã gửi lời tư vấn",replied:"Khách đã phản hồi",needs_review:"Cần kiểm tra",skipped:"Đã bỏ qua",failed:"Gửi chưa thành công",uncertain:"Chưa rõ kết quả gửi"};
const needsAttention=(lead:AiCommentLead)=>["needs_review","failed","uncertain"].includes(lead.status);
const hasReplyEvidence=(lead:AiCommentLead)=>lead.status==="replied"&&typeof lead.repliedAt==="string"&&Number.isFinite(Date.parse(lead.repliedAt));
function facebookUrl(value:string|null|undefined):string|null{
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&["facebook.com","www.facebook.com","m.facebook.com"].includes(url.hostname)?url.href:null;}catch{return null;}
}
function conversationUrl(lead:AiCommentLead):string|null{
  // A delivery receipt alone is not evidence that a customer has responded.
  return hasReplyEvidence(lead)&&lead.chatId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(lead.chatId)?"/admin?section=support-chats&chatId="+encodeURIComponent(lead.chatId):null;
}
const connectionResults:Record<string,{message:string;error:boolean}>={
  connected:{message:"Đã quay lại từ bước kết nối Facebook. Quyền Page và trạng thái tự tư vấn được kiểm tra riêng bên dưới.",error:false},
  cancelled:{message:"Bước kết nối Facebook đã được hủy. Anh/chị có thể bắt đầu lại khi sẵn sàng.",error:false},
  admin_required:{message:"Cần đăng nhập tài khoản Admin để hoàn tất kết nối Facebook.",error:true},
  invalid_state:{message:"Phiên kết nối Facebook đã hết hạn hoặc không còn hợp lệ. Hãy bắt đầu lại từ nút kết nối.",error:true},
  not_configured:{message:"Luồng kết nối Facebook chưa được cấu hình đầy đủ. Cần kiểm tra cấu hình ứng dụng.",error:true},
  scope_missing:{message:"Facebook chưa cấp đủ các quyền cần thiết cho Page 1 EXTRA. Hãy kết nối lại và chọn đủ quyền được yêu cầu.",error:true},
  page_missing:{message:"Tài khoản vừa chọn chưa cấp quyền cho Page 1 EXTRA. Hãy kết nối bằng tài khoản có quyền quản lý Page.",error:true},
  token_invalid:{message:"Chưa xác minh được kết nối với đúng ứng dụng và Page EXTRA. Vui lòng kết nối lại.",error:true},
  page_access_failed:{message:"Chưa xác minh quyền đọc bài viết và bình luận của Page. Vui lòng kết nối lại và chọn đủ quyền.",error:true},
  subscription_failed:{message:"Chưa hoàn tất xác minh đăng ký nhận bình luận mới của Page. Vui lòng thử lại và kiểm tra trạng thái kết nối.",error:true},
  connection_changed:{message:"Kết nối đã thay đổi ở một phiên khác. Hãy cập nhật trạng thái trước khi thử lại.",error:true},
  oauth_failed:{message:"Chưa hoàn tất kết nối Facebook. Vui lòng thử lại.",error:true},
  unavailable:{message:"Chưa cập nhật được kết nối Facebook. Vui lòng thử lại sau.",error:true},
};
function authorizationUrl(value:unknown):string|null{
  if(typeof value!=="string"||value.length>8000)return null;
  try{
    const url=new URL(value),params=url.searchParams;
    return url.protocol==="https:"&&url.hostname==="www.facebook.com"&&!url.port&&!url.username&&!url.password&&!url.hash&&/^\/v\d{1,3}\.\d{1,2}\/dialog\/oauth$/.test(url.pathname)
      &&params.getAll("client_id").length===1&&params.get("client_id")==="2447629075989535"
      &&params.getAll("response_type").length===1&&params.get("response_type")==="code"
      &&params.getAll("redirect_uri").length===1&&params.get("redirect_uri")==="https://admin.iextra.net/api/admin/facebook/oauth/callback"
      &&params.getAll("state").length===1&&Boolean(params.get("state"))?url.href:null;
  }catch{return null;}
}

export default function AiCommentLeadsPanel(){
  const [data,setData]=useState<AiCommentLeadsAdminResponse|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(""),[notice,setNotice]=useState("");
  const [connecting,setConnecting]=useState(false),[connectionResult,setConnectionResult]=useState<{message:string;error:boolean}|null>(null);
  const [expanded,setExpanded]=useState(false),[filter,setFilter]=useState<LeadFilter>("all"),[query,setQuery]=useState("");
  const [visibleCount,setVisibleCount]=useState(5);
  const mounted=useRef(true),requestId=useRef(0),mutationPending=useRef(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const current=++requestId.current;
    try{
      const response=await fetch("/api/admin/ai-comment-leads",{cache:"no-store",signal});
      const result=await response.json().catch(()=>null) as AiCommentLeadsAdminResponse&{error?:string}|null;
      if(!response.ok||!result)throw Error(result?.error||"Chưa tải được khách hỏi vé từ bình luận.");
      if(typeof result.enabled!=="boolean"||typeof result.ready!=="boolean"||!result.totals||!Array.isArray(result.leads))throw Error("Báo cáo bình luận chưa đầy đủ. Vui lòng thử lại.");
      if(mounted.current&&!signal?.aborted&&current===requestId.current){setData(result);setError("");}
    }catch(cause){
      if(mounted.current&&!signal?.aborted&&current===requestId.current)setError(cause instanceof Error?cause.message:"Chưa kết nối được báo cáo bình luận.");
    }finally{
      if(mounted.current&&!signal?.aborted&&current===requestId.current)setLoading(false);
    }
  },[]);
  useEffect(()=>{
    mounted.current=true;
    const controller=new AbortController();let polling=false;
    const poll=async()=>{
      if(polling||mutationPending.current)return;
      polling=true;
      try{await refresh(controller.signal);}finally{polling=false;}
    };
    void poll();
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void poll();},30000);
    return()=>{mounted.current=false;controller.abort();clearInterval(timer);};
  },[refresh]);
  useEffect(()=>{
    if(typeof window==="undefined")return;
    try{
      const url=new URL(window.location.href),codes=url.searchParams.getAll("facebook_connection");
      if(!codes.length)return;
      const code=codes.length===1?codes[0]:"";
      setConnectionResult(Object.hasOwn(connectionResults,code)?connectionResults[code]:{message:"Chưa xác minh được kết quả kết nối Facebook. Hãy kiểm tra trạng thái bên dưới.",error:true});
      // Result URLs are informational only; never promote readiness from a query.
      url.searchParams.delete("facebook_connection");
      window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
    }catch{/* A missing browser history API must not affect the permission checks. */}
  },[]);
  async function connectFacebook(){
    if(mutationPending.current)return;
    mutationPending.current=true;setConnecting(true);setActionError("");setNotice("");setConnectionResult(null);
    let failure="Chưa bắt đầu được kết nối Facebook. Vui lòng thử lại.";
    try{
      const response=await fetch("/api/admin/facebook/oauth/start",{method:"POST",credentials:"same-origin",cache:"no-store"});
      const result=await response.json().catch(()=>null) as {ok?:boolean;authorizationUrl?:unknown;error?:string}|null;
      if(!response.ok||result?.ok!==true){if(typeof result?.error==="string"&&result.error.length<=1000)failure=result.error;throw Error("OAuth start rejected");}
      const target=authorizationUrl(result.authorizationUrl);
      if(!target){failure="Liên kết kết nối Facebook chưa hợp lệ. Vui lòng thử lại.";throw Error("Invalid authorization destination");}
      if(!mounted.current)return;
      window.location.assign(target);
    }catch{
      if(mounted.current)setActionError(failure);
    }finally{mutationPending.current=false;if(mounted.current)setConnecting(false);}
  }
  async function change(action:AiCommentLeadsAdminAction){
    if(mutationPending.current)return;
    mutationPending.current=true;requestId.current++;setBusy(true);setActionError("");setNotice("");
    try{
      const response=await fetch("/api/admin/ai-comment-leads",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)});
      const result=await response.json().catch(()=>null) as {ok?:boolean;error?:string;pausePending?:boolean}|null;
      if(!response.ok||result?.ok!==true)throw Error(result?.error||"Chưa thay đổi được chế độ tư vấn bình luận.");
      if(mounted.current){
        setNotice(action.action==="check_connection"?"Đã kiểm tra kết nối Facebook. Trạng thái hiện tại được cập nhật bên dưới.":action.enabled?"Đã lưu yêu cầu bật tư vấn khách hỏi vé. Trạng thái kết nối được cập nhật bên dưới.":result.pausePending?"Đã ghi nhận yêu cầu tạm dừng. Tin nhắn đang gửi cần chờ xác nhận kết quả.":"Đã tạm dừng gửi lời tư vấn mới từ bình luận.");
        await refresh();
      }
    }catch(cause){if(mounted.current)setActionError(cause instanceof Error?cause.message:"Chưa thay đổi được chế độ tư vấn bình luận.");}
    finally{mutationPending.current=false;if(mounted.current)setBusy(false);}
  }
  const filtered=useMemo(()=>{
    const term=searchable(query.trim());
    return (data?.leads||[]).filter(lead=>{
      const matches=filter==="all"||filter==="waiting"&&["pending","eligible","sending"].includes(lead.status)||filter==="attention"&&needsAttention(lead)||lead.status===filter;
      return matches&&(!term||searchable([lead.customerName,lead.commentText,lead.postTitle,lead.showName].filter(Boolean).join(" ")).includes(term));
    });
  },[data,filter,query]);
  const publicAccessUnverified=Boolean(data&&data.publicAccessReady!==true);
  const pageConnectionUnverified=Boolean(data&&data.pageConnectionReady!==true);
  const controlsBusy=busy||connecting;
  const active=Boolean(!error&&data?.enabled&&data?.ready&&!pageConnectionUnverified&&!publicAccessUnverified&&!data?.pausePending);
  const stateLabel=!data?"Đang kiểm tra":error?"Chưa xác minh trạng thái mới nhất":data.pausePending?"Đang hoàn tất tạm dừng":!data.enabled?"Đã tạm dừng":pageConnectionUnverified?"Chờ xác minh quyền kết nối Page":publicAccessUnverified?"Chưa xác minh quyền tư vấn khách":!data.ready?"Chờ kiểm tra AI bán vé":"Đang tự tư vấn";
  const metrics=[{label:"Bình luận hỏi vé",value:data?.totals.eligible},{label:"Đã gửi tin nhắn",value:data?.totals.sent},{label:"Khách đã phản hồi",value:data?.totals.replied},{label:"Cần kiểm tra",value:data?.totals.needsReview},{label:"Gửi chưa thành công",value:data?.totals.failed}];

  return <section className={styles.panel} aria-label="Khách hỏi vé từ bình luận" aria-busy={loading}>
    <div className={styles.header}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>BÌNH LUẬN → TƯ VẤN VÉ</span>
        <h2>Khách hỏi vé từ bình luận</h2>
        <p>Nhận diện câu hỏi về vé trên Page và gửi lời tư vấn riêng. Khi khách phản hồi, AI tiếp tục hỗ trợ chọn ghế và đặt vé trong Messenger.</p>
        <span className={active?styles.active:styles.waiting}><i aria-hidden="true"/>{stateLabel}</span>
        {data?<p className={styles.connectionStatus}><span>Quyền kết nối Page: <strong>{data.pageConnectionReady?"Đã xác minh":"Chưa xác minh đầy đủ"}</strong></span><span>Tư vấn khách hàng thực tế: <strong>{data.publicAccessReady?"Đã xác minh điều kiện":"Chưa xác minh điều kiện"}</strong></span></p>:null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={data?.pageConnectionReady?styles.secondary:styles.primary} disabled={controlsBusy} onClick={()=>void connectFacebook()}>{connecting?"Đang chuyển sang Facebook…":"Kết nối quyền bình luận Facebook"}</button>
        <button type="button" className={data?.enabled?styles.secondary:styles.primary} disabled={!data||controlsBusy||Boolean(data.pausePending&&!data.enabled)} onClick={()=>data&&void change({action:"set_enabled",enabled:!data.enabled})}>{busy?"Đang cập nhật…":data?.enabled?"Tạm dừng tư vấn bình luận":"Bật tư vấn bình luận"}</button>
        {data&&(!data.ready||publicAccessUnverified||pageConnectionUnverified)?<button type="button" className={styles.quiet} disabled={controlsBusy} onClick={()=>void change({action:"check_connection"})}>Kiểm tra kết nối</button>:null}
        <button type="button" className={styles.quiet} disabled={loading||controlsBusy} onClick={()=>{setLoading(true);void refresh();}}>Cập nhật bình luận</button>
      </div>
    </div>
    {connectionResult?<p className={connectionResult.error?styles.warning:styles.notice} role="status">{connectionResult.message}</p>:null}
    {data&&(!data.ready||publicAccessUnverified||pageConnectionUnverified)?<p className={styles.warning} role="status">{data.readinessMessage||(pageConnectionUnverified?"Chưa xác minh đầy đủ quyền đọc bình luận, nhắn tư vấn riêng và nhận bình luận mới của Page.":publicAccessUnverified?"Chưa xác minh đầy đủ quyền tự tư vấn cho khách hàng thực tế trên Facebook.":"Kết nối AI bán vé chưa sẵn sàng.")}{publicAccessUnverified&&data.enabled?" Yêu cầu bật đã được lưu; tính năng chưa hoạt động với khách hàng thực tế.":""}</p>:null}
    {data?.pausePending?<p className={styles.warning} role="status">Đã ngừng nhận lượt gửi mới. Một số tin nhắn đã bắt đầu gửi đang chờ Facebook xác nhận.</p>:null}
    {error?<div className={styles.error} role="alert"><p>{error}</p>{data?<small>Số liệu đang hiển thị được cập nhật lúc {time(data.updatedAt)}.</small>:null}<button type="button" className={styles.secondary} disabled={loading} onClick={()=>{setLoading(true);void refresh();}}>Thử tải lại bình luận</button></div>:null}
    {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    <p className={styles.period}>Bình luận đã ghi nhận trong 30 ngày gần nhất</p>
    <div className={styles.metrics}>{metrics.map(metric=><div key={metric.label}><span>{metric.label}</span><strong>{formatCount(metric.value)}</strong></div>)}</div>
    <div className={styles.summaryBar}>
      <p>Mỗi bình luận phù hợp chỉ nhận một lời tư vấn mở đầu. Khách chưa phản hồi sẽ không bị nhắn đuổi tự động.</p>
      <button type="button" className={styles.secondary} aria-expanded={expanded} aria-controls="extra-comment-leads-list" onClick={()=>setExpanded(value=>!value)}>{expanded?"Thu gọn danh sách":"Xem khách hỏi vé"}<span aria-hidden="true">{expanded?"−":"+"}</span></button>
    </div>
    {expanded?<div id="extra-comment-leads-list" className={styles.details}>
      <div className={styles.filters}>
        <label><span>Trạng thái bình luận</span><select value={filter} onChange={event=>{setFilter(event.target.value as LeadFilter);setVisibleCount(5);}}><option value="all">Tất cả trạng thái</option><option value="waiting">Chờ xử lý</option><option value="sent">Đã gửi lời tư vấn</option><option value="replied">Khách đã phản hồi</option><option value="attention">Cần kiểm tra</option><option value="skipped">Đã bỏ qua</option></select></label>
        <label className={styles.search}><span>Tìm khách, show hoặc bình luận</span><input type="search" value={query} placeholder="Tên khách, nghệ sĩ, nội dung hỏi vé…" onChange={event=>{setQuery(event.target.value);setVisibleCount(5);}}/></label>
      </div>
      {data?.limited?<p className={styles.limitNote}>Đang hiển thị các bình luận gần nhất. Số tổng hợp có thể bao gồm cả những khách không còn trong danh sách này.</p>:null}
      {!data?<div className={styles.empty}>{loading?"Đang tải khách hỏi vé…":"Danh sách sẽ hiển thị khi kết nối được báo cáo bình luận."}</div>:!filtered.length?<div className={styles.empty}><strong>{query||filter!=="all"?"Chưa có bình luận phù hợp bộ lọc.":"Chưa có khách hỏi vé được ghi nhận."}</strong><p>{query||filter!=="all"?"Thử một từ khóa hoặc trạng thái khác.":"Bình luận đủ điều kiện sẽ xuất hiện sau khi kết nối Facebook sẵn sàng."}</p></div>:<div className={styles.list}>{filtered.slice(0,visibleCount).map(lead=>{
        const postLink=facebookUrl(lead.postUrl),commentLink=facebookUrl(lead.commentUrl),chatLink=conversationUrl(lead);
        const verifiedReply=hasReplyEvidence(lead);
        const label=lead.status==="replied"&&!verifiedReply?"Chờ xác minh phản hồi":names[lead.status]||"Cần kiểm tra";
        const statusClass=verifiedReply?styles.replied:lead.status==="sent"?styles.sent:needsAttention(lead)?styles.attention:styles.pending;
        return <article key={lead.id} className={styles.lead}>
          <div className={styles.leadHeading}><h3>{lead.customerName||"Khách Facebook"}</h3><span className={statusClass}>{label}</span></div>
          {(lead.showName||lead.postTitle)?<p className={styles.postTitle}>{[lead.showName,lead.postTitle].filter(Boolean).join(" · ")}</p>:null}
          <blockquote>{lead.commentText||"Bình luận không có nội dung văn bản."}</blockquote>
          {lead.replyPreview?<div className={styles.reply}><span>{lead.sentAt?"Lời tư vấn đã gửi":"Lời tư vấn dự kiến"}</span><p>{lead.replyPreview}</p></div>:null}
          {lead.reason?<p className={styles.reason}>{lead.reason}</p>:null}
          <div className={styles.leadFooter}>
            <div className={styles.times}><span>Bình luận {time(lead.commentedAt)}</span>{lead.sentAt?<span>Đã gửi {time(lead.sentAt)}</span>:null}{verifiedReply?<span>Khách phản hồi {time(lead.repliedAt)}</span>:null}</div>
            <div className={styles.links}>{commentLink?<a href={commentLink} target="_blank" rel="noopener noreferrer">Xem bình luận</a>:postLink?<a href={postLink} target="_blank" rel="noopener noreferrer">Xem bài viết</a>:null}{chatLink?<a href={chatLink}>Xem hội thoại</a>:null}</div>
          </div>
        </article>;
      })}</div>}
      {filtered.length>visibleCount?<button type="button" className={styles.loadMore} onClick={()=>setVisibleCount(count=>count+5)}>Xem thêm khách · {numbers.format(visibleCount)}/{numbers.format(filtered.length)}</button>:null}
      {data?<p className={styles.updated}>Cập nhật {time(data.updatedAt)} · giờ Việt Nam.{data.lastScanAt?" Lần kiểm tra bình luận gần nhất: "+time(data.lastScanAt)+".":""} “Đã gửi” chưa có nghĩa là khách đã đọc hoặc đã mua vé.</p>:null}
    </div>:null}
  </section>;
}

"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {AiSalesAdminAction,AiSalesAdminResponse,AiSalesConversation,AiSalesStatus} from "../../lib/ai-sales-admin-types";
import AiCommentLeadsPanel from "./ai-comment-leads-panel";
import TikTokCommentPanel from "./tiktok-comment-panel";
import styles from "./ai-sales-dashboard.module.css";

type Filter = "results" | "successful" | "unsuccessful" | "processing";
const numberFormat = new Intl.NumberFormat("vi-VN");
const money = (amount:number)=>numberFormat.format(amount)+" đ";
const displayTime = (value:string)=>{
  const date = new Date(value);
  return Number.isNaN(date.getTime())?"Chưa có thời gian cập nhật":date.toLocaleString("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"
  });
};
const searchText = (value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").toLocaleLowerCase("vi");
const statusNames:Record<AiSalesStatus,string> = {
  successful:"Chốt thành công",unsuccessful:"Chưa chốt được",in_progress:"Đang tư vấn",
  awaiting_payment:"Chờ thanh toán",needs_attention:"Cần kiểm tra"
};
const isResult = (conversation:AiSalesConversation)=>conversation.status==="successful"||conversation.status==="unsuccessful";

function ResultIcon({success}:{success:boolean}){
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {success?<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>:<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></>}
  </svg>;
}

export default function AiSalesDashboard(){
  const [data,setData] = useState<AiSalesAdminResponse|null>(null);
  const [loading,setLoading] = useState(true),[error,setError] = useState("");
  const [actionError,setActionError] = useState(""),[notice,setNotice] = useState("");
  const [busy,setBusy] = useState("");
  const [filter,setFilter] = useState<Filter>("results"),[query,setQuery] = useState("");
  const [visibleCount,setVisibleCount] = useState(30);
  const mounted = useRef(true),requestId = useRef(0),mutationPending = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async(signal?:AbortSignal)=>{
    const currentRequest = ++requestId.current;
    try{
      const response = await fetch("/api/admin/ai-sales",{cache:"no-store",signal});
      const result = await response.json().catch(()=>null) as AiSalesAdminResponse&{error?:string}|null;
      if(!response.ok||!result)throw Error(result?.error||"Chưa tải được kết quả AI bán vé. Vui lòng thử lại.");
      if(!result.totals||!Array.isArray(result.conversations))throw Error("Dữ liệu AI bán vé chưa đầy đủ. Vui lòng thử lại.");
      if(mounted.current&&!signal?.aborted&&currentRequest===requestId.current){setData(result);setError("");}
    }catch(cause){
      if(mounted.current&&!signal?.aborted&&currentRequest===requestId.current)setError(cause instanceof Error?cause.message:"Không kết nối được báo cáo AI bán vé.");
    }finally{
      if(mounted.current&&!signal?.aborted&&currentRequest===requestId.current)setLoading(false);
    }
  },[]);

  useEffect(()=>{
    mounted.current=true;
    const controller = new AbortController();
    let polling = false;
    const poll = async()=>{
      if(polling||mutationPending.current)return;
      polling=true;
      try{await refresh(controller.signal);}finally{polling=false;}
    };
    void poll();
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void poll();},20000);
    return()=>{mounted.current=false;controller.abort();clearInterval(timer);};
  },[refresh]);

  async function change(action:AiSalesAdminAction){
    if(mutationPending.current)return;
    mutationPending.current=true;
    setBusy(action.action==="set_enabled"?"global":action.chatId);setActionError("");setNotice("");
    // Invalidate an older poll so it cannot overwrite the state after this change.
    requestId.current++;
    try{
      const response=await fetch("/api/admin/ai-sales",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)});
      const result=await response.json().catch(()=>null) as {error?:string}|null;
      if(!response.ok)throw Error(result?.error||"Chưa cập nhật được chế độ AI. Vui lòng thử lại.");
      if(mounted.current){
        setNotice(action.action==="set_enabled"?(action.enabled?"Đã bật AI tiếp nhận khách từ Fanpage.":"Đã tạm dừng AI trả lời tự động."):(action.mode==="manual"?"Đã chuyển cuộc trò chuyện sang tư vấn thủ công.":"Đã giao lại cuộc trò chuyện cho AI."));
        await refresh();
      }
    }catch(cause){
      if(mounted.current)setActionError(cause instanceof Error?cause.message:"Không cập nhật được chế độ AI.");
    }finally{
      mutationPending.current=false;
      if(mounted.current)setBusy("");
    }
  }

  const filtered = useMemo(()=>{
    const term=searchText(query.trim());
    return (data?.conversations||[]).filter(conversation=>{
      const matches=filter==="results"?isResult(conversation):filter==="processing"?!isResult(conversation):conversation.status===filter;
      return matches&&(!term||searchText([conversation.customerName,conversation.showName,conversation.orderCode,conversation.summary,conversation.reason].filter(Boolean).join(" ")).includes(term));
    });
  },[data,filter,query]);
  const attentionCount=data?.conversations.filter(conversation=>conversation.status==="needs_attention").length||0;
  const active=Boolean(data?.enabled&&data?.ready);
  const stateLabel=!data?"Đang kiểm tra":!data.ready?"Chưa sẵn sàng":data.enabled?"AI đang hoạt động":"AI đang tạm dừng";
  const tabs:ReadonlyArray<{value:Filter;label:string;count:number|null}>=[
    {value:"results",label:"Kết quả chốt đơn",count:data?data.totals.successful+data.totals.unsuccessful:null},
    {value:"successful",label:"Thành công",count:data?.totals.successful??null},
    {value:"unsuccessful",label:"Chưa chốt được",count:data?.totals.unsuccessful??null},
    {value:"processing",label:"Đang xử lý",count:data?.totals.inProgress??null}
  ];

  return <section className={styles.page} aria-label="AI bán vé" aria-busy={loading}>
    <div className={styles.cards}>
      <div className={styles.successCard}><span className={styles.cardLabel}><ResultIcon success/>Chốt thành công</span><strong>{data?numberFormat.format(data.totals.successful):"—"}</strong><small>Đã thanh toán và giao vé</small></div>
      <div className={styles.failureCard}><span className={styles.cardLabel}><ResultIcon success={false}/>Chưa chốt được</span><strong>{data?numberFormat.format(data.totals.unsuccessful):"—"}</strong><small>Có kết quả và nguyên nhân</small></div>
      <div className={styles.card}><span className={styles.cardLabel}>Doanh thu đã chốt</span><strong>{data?money(data.totals.revenue):"—"}</strong><small>Từ các đơn AI chốt thành công</small></div>
      <div className={styles.card}><span className={styles.cardLabel}>Đang xử lý</span><strong>{data?numberFormat.format(data.totals.inProgress):"—"}</strong><small>Tư vấn, chờ thanh toán hoặc giao vé</small></div>
    </div>

    <div ref={resultsRef} className={styles.results}>
      <div className={styles.resultsHeading}><div><h2>Kết quả AI bán vé</h2><p>Khách đang tư vấn hoặc chờ thanh toán được theo dõi riêng.</p></div><span className={styles.updated}>{data?"Cập nhật "+displayTime(data.updatedAt)+" · giờ Việt Nam":loading?"Đang tải dữ liệu…":"Chưa có dữ liệu"}</span></div>
      <div className={styles.filters}>
        <div className={styles.tabs} aria-label="Lọc trạng thái chốt đơn">{tabs.map(tab=><button type="button" key={tab.value} aria-pressed={filter===tab.value} className={filter===tab.value?styles.tabActive:styles.tab} onClick={()=>{setFilter(tab.value);setVisibleCount(30);}}>{tab.label}{tab.count!==null?<span>{numberFormat.format(tab.count)}</span>:null}</button>)}</div>
        <label className={styles.search}><span>Tìm khách, show hoặc mã đơn</span><input type="search" value={query} placeholder="Tên khách, nghệ sĩ, mã đơn…" onChange={event=>{setQuery(event.target.value);setVisibleCount(30);}}/></label>
      </div>
      {data?.limited?<p className={styles.limitNote} role="status">Danh sách hiển thị các kết quả và cuộc trò chuyện gần nhất. Dùng hộp thư để tra cứu các cuộc trò chuyện cũ hơn.</p>:null}
      {!data?<div className={styles.empty}>{loading?"Đang tải kết quả chốt đơn…":"Báo cáo sẽ hiển thị khi tải được dữ liệu."}</div>:filtered.length===0?<div className={styles.empty}><strong>{query?"Không tìm thấy kết quả phù hợp.":filter==="processing"?"Chưa có cuộc trò chuyện đang xử lý.":"Chưa có kết quả trong mục này."}</strong><p>{query?"Thử tên khách, mã đơn hoặc nghệ sĩ khác.":filter==="processing"?"Khách mới sẽ xuất hiện khi AI tiếp nhận tin nhắn Fanpage.":"Kết quả sẽ xuất hiện khi cuộc tư vấn có kết luận. Khách đang được tư vấn nằm trong mục Đang xử lý."}</p></div>:<div className={styles.list}>
        {filtered.slice(0,visibleCount).map(conversation=><article key={conversation.recordId||conversation.id} className={styles.conversation}>
          <div className={styles.conversationMain}>
            <div className={styles.conversationHeading}><h3>{conversation.customerName||"Khách Facebook"}</h3><span className={styles[conversation.status]}>{statusNames[conversation.status]}</span></div>
            <p className={styles.showName}>{conversation.showName||"Tư vấn chọn show"}</p>
            {(conversation.reason||conversation.summary)?<p className={styles.summary}>{conversation.reason||conversation.summary}</p>:null}
            <div className={styles.metadata}><span>{displayTime(conversation.updatedAt)}</span><span>{conversation.mode==="ai"?(active?"AI Extra phụ trách":"AI đang tạm dừng"):"Đang tư vấn thủ công"}</span></div>
          </div>
          <div className={styles.orderInfo}>
            {conversation.orderCode?<code>{conversation.orderCode}</code>:<span className={styles.noOrder}>Chưa có đơn vé</span>}
            {typeof conversation.amount==="number"?<strong>{money(conversation.amount)}</strong>:null}
            {typeof conversation.ticketCount==="number"?<span>{numberFormat.format(conversation.ticketCount)} vé</span>:null}
          </div>
          <div className={styles.rowActions}>
            <a className={styles.secondary} href={"/admin?section=support-chats&chatId="+encodeURIComponent(conversation.id)}>Xem hội thoại</a>
            {conversation.orderCode&&conversation.status==="successful"?<a className={styles.quiet} href={"/admin?section=tickets&orderCode="+encodeURIComponent(conversation.orderCode)}>Tra cứu đơn</a>:null}
            {!isResult(conversation)?<button type="button" className={styles.quiet} disabled={Boolean(busy)||conversation.mode==="manual"&&!active} onClick={()=>void change({action:"set_mode",chatId:conversation.id,mode:conversation.mode==="ai"?"manual":"ai"})}>{busy===conversation.id?"Đang chuyển…":conversation.mode==="ai"?"Tiếp quản thủ công":"Giao lại cho AI"}</button>:null}
          </div>
        </article>)}
      </div>}
      {filtered.length>visibleCount?<button type="button" className={styles.loadMore} onClick={()=>setVisibleCount(count=>count+30)}>Xem thêm kết quả · {numberFormat.format(visibleCount)}/{numberFormat.format(filtered.length)}</button>:null}
    </div>

    <div className={styles.controlPanel}>
      <div className={styles.controlIntro}>
        <span className={styles.eyebrow}>FANPAGE · EXTRA</span>
        <div className={styles.state}><span className={active?styles.activeIndicator:styles.pausedIndicator} aria-hidden="true"/><h2>{stateLabel}</h2></div>
        <p>AI tư vấn, hỗ trợ chọn ghế, theo dõi thanh toán và gửi vé cho khách. Kết quả từng cuộc trò chuyện được tổng hợp tại đây.</p>
        {data?.modelLabel?<span className={styles.model}>{data.modelLabel}</span>:null}
      </div>
      <div className={styles.controlActions}>
        <button type="button" className={data?.enabled?styles.secondary:styles.primary} disabled={!data||Boolean(busy)||(!data.ready&&!data.enabled)} onClick={()=>data&&void change({action:"set_enabled",enabled:!data.enabled})}>
          {busy==="global"?"Đang cập nhật…":data?.enabled?"Tạm dừng AI":"Bật AI bán vé"}
        </button>
        <button type="button" className={styles.quiet} disabled={loading||Boolean(busy)} onClick={()=>{setLoading(true);void refresh();}}>Cập nhật</button>
      </div>
    </div>

    {data&&!data.ready?<div className={styles.warning} role="status"><strong>AI chưa thể tự tiếp nhận khách.</strong><p>{data.readinessMessage||"Kết nối AI chưa sẵn sàng. Các tin nhắn đã nhận vẫn được lưu trong hộp thư."}</p></div>:null}
    {error?<div className={styles.error} role="alert"><strong>Chưa cập nhật được báo cáo.</strong><p>{error}</p>{data?<p>Các số liệu đang hiển thị là lần cập nhật gần nhất lúc {displayTime(data.updatedAt)}.</p>:null}<button type="button" className={styles.secondary} onClick={()=>{setLoading(true);void refresh();}} disabled={loading}>Thử lại</button></div>:null}
    {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}

    <AiCommentLeadsPanel/>

    <TikTokCommentPanel/>

    {attentionCount>0?<div className={styles.attention} role="status"><div><strong>{numberFormat.format(attentionCount)} cuộc trò chuyện cần kiểm tra</strong><span>Xem nguyên nhân trong danh sách đang xử lý.</span></div><button type="button" className={styles.secondary} onClick={()=>{setFilter("processing");setQuery("");setVisibleCount(30);resultsRef.current?.scrollIntoView({block:"start"});}}>Xem chi tiết</button></div>:null}

    <footer className={styles.footer}><span>{data?.notificationEmailConfigured?"Thông báo kết quả đã được kết nối"+(data.notificationEmail?" · "+data.notificationEmail:"")+".":data?.notificationEmailConfigured===false?"Thông báo email chưa được kết nối. Kết quả chốt đơn vẫn được cập nhật tại đây.":"Kết quả chốt đơn được cập nhật tự động khi mở trang."}</span><a href="/admin?section=support-chats">Mở hộp thư khách hàng</a></footer>
  </section>;
}

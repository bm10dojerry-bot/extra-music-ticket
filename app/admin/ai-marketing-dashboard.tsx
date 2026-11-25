"use client";

import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import type {AiMarketingAdminAction,AiMarketingAdminResponse,MarketingAllocation,MarketingAllocationStatus,MarketingPost,MarketingPostStatus} from "../../lib/ai-marketing-admin-types";
import styles from "./ai-marketing-dashboard.module.css";

type Tab="overview"|"posts"|"budget";
type ConfigForm={accountId:string;slots:[string,string];dailyCapVnd:string};
const numberFormat=new Intl.NumberFormat("vi-VN");
const numeric=(value:number|null|undefined)=>typeof value==="number"&&Number.isFinite(value)?numberFormat.format(value):"—";
const money=(value:number|null|undefined)=>typeof value==="number"&&Number.isFinite(value)?numberFormat.format(value)+" đ":"—";
const time=(value:string|null|undefined)=>{
  if(!value)return "Chưa có dữ liệu";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Chưa có thời gian":date.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
};
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split("-").reverse().join("/"):value;
const postNames:Record<MarketingPostStatus,string>={draft:"Bản nháp",scheduled:"Đã xếp lịch",publishing:"Đang gửi đăng",published:"Đã đăng",blocked:"Chờ xử lý",failed:"Đăng thất bại",uncertain:"Cần đối chiếu",cancelled:"Đã huỷ"};
const adNames:Record<MarketingAllocationStatus,string>={reserved:"Đã giữ ngân sách",pending:"Chờ triển khai",active:"Đang bật trên Meta",paused:"Đã tạm dừng",completed:"Đã kết thúc",uncertain:"Cần đối chiếu",blocked:"Chờ xử lý",failed:"Không triển khai được",released:"Đã giải phóng"};
const objectiveName=(value:"messages"|"sales")=>value==="messages"?"Tương tác · Tin nhắn":"Chuyển đổi · Mua vé";
const safeUrl=(value:string|null|undefined,hosts?:string[])=>{
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==="https:"&&(!hosts||hosts.some(host=>url.hostname===host||url.hostname.endsWith("."+host)))?url.href:null;}catch{return null;}
};
const configFrom=(data:AiMarketingAdminResponse):ConfigForm=>({accountId:data.settings.accountId||"",slots:[...data.settings.slots],dailyCapVnd:String(data.settings.dailyCapVnd)});

function ClockIcon(){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>;}
function StatusPill({value,label}:{value:string;label:string}){return <span className={styles.status} data-state={value}>{label}</span>;}

function PostCard({post}:{post:MarketingPost}){
  const image=safeUrl(post.imageUrl),facebook=safeUrl(post.permalink,["facebook.com","fb.com"]),website=safeUrl(post.landingUrl,["iextra.net"]);
  return <article className={styles.postCard}>
    <div className={styles.postTop}>
      <div className={styles.postImage}>{image?<img src={image} alt={"Poster "+post.showName} loading="lazy"/>:<span>Chưa có ảnh</span>}</div>
      <div className={styles.postIntro}>
        <span className={styles.kicker}>BÀI {post.slot} · {day(post.businessDate)}</span>
        <h3>{post.showName}</h3>
        <div className={styles.badges}><StatusPill value={post.status} label={postNames[post.status]||post.status}/><span className={styles.objective}>{objectiveName(post.objective)}</span></div>
        <p className={styles.metadata}>{post.publishedAt?"Đã đăng "+time(post.publishedAt):"Lịch đăng "+time(post.scheduledAt)} · giờ Việt Nam</p>
        {post.reason?<p className={styles.reason}>{post.reason}</p>:null}
      </div>
    </div>
    <details className={styles.caption} open={post.status==="draft"||post.status==="blocked"}>
      <summary>Nội dung bài viết</summary>
      <p>{post.caption||"Đang chờ tạo nội dung từ thông tin show trên website."}</p>
    </details>
    <div className={styles.postLinks}>
      {facebook?<a className={styles.secondary} href={facebook} target="_blank" rel="noopener noreferrer">Xem bài trên Facebook ↗</a>:null}
      {website?<a className={styles.quiet} href={website} target="_blank" rel="noopener noreferrer">Mở trang show ↗</a>:null}
      {post.facebookPostId?<span className={styles.providerId}>ID bài: {post.facebookPostId}</span>:null}
    </div>
  </article>;
}

function AllocationCard({item}:{item:MarketingAllocation}){
  return <article className={styles.allocation}>
    <div className={styles.rowHeading}><div><span className={styles.kicker}>{day(item.businessDate)} · {objectiveName(item.objective)}</span><h3>{item.showName}</h3></div><StatusPill value={item.status} label={adNames[item.status]||item.status}/></div>
    <dl className={styles.metrics}>
      <div><dt>Hạn mức đã giữ</dt><dd>{money(item.budgetVnd)}</dd></div>
      <div><dt>Đã chi trên Meta</dt><dd>{money(item.spendVnd)}</dd></div>
      <div><dt>Hội thoại bắt đầu</dt><dd>{numeric(item.messages)}</dd></div>
      <div><dt>Đơn do Meta ghi nhận</dt><dd>{numeric(item.platformPurchases)}</dd></div>
      <div><dt>Đơn đã thanh toán</dt><dd>{numeric(item.attributedPaidOrders)}</dd></div>
      <div><dt>Doanh thu đối chiếu</dt><dd>{money(item.attributedPaidRevenueVnd)}</dd></div>
    </dl>
    <div className={styles.allocationFooter}>
      <p className={item.freshness==="fresh"?styles.metadata:styles.stale}>{item.metricsAsOf?"Dữ liệu Meta: "+time(item.metricsAsOf):"Chưa lấy được số liệu từ Meta."}{item.freshness==="stale"?" · Dữ liệu cũ, chưa đủ điều kiện tăng ngân sách.":""}</p>
      {item.adId?<a className={styles.textLink} href={"https://www.facebook.com/adsmanager/manage/ads?selected_ad_ids="+encodeURIComponent(item.adId)} target="_blank" rel="noopener noreferrer">Xem quảng cáo ↗</a>:null}
    </div>
    {item.reason?<p className={styles.reason}>{item.reason}</p>:null}
  </article>;
}

export default function AiMarketingDashboard(){
  const [data,setData]=useState<AiMarketingAdminResponse|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [actionError,setActionError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
  const [tab,setTab]=useState<Tab>("overview"),[postFilter,setPostFilter]=useState("all"),[budgetFilter,setBudgetFilter]=useState("today");
  const [form,setForm]=useState<ConfigForm|null>(null);
  const mounted=useRef(true),requestId=useRef(0),mutationPending=useRef(false),formDirty=useRef(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const current=++requestId.current;
    try{
      const response=await fetch("/api/admin/ai-marketing",{cache:"no-store",signal});
      const result=await response.json().catch(()=>null) as AiMarketingAdminResponse&{error?:string}|null;
      if(!response.ok||!result)throw Error(result?.error||"Chưa tải được lịch đăng bài và ngân sách.");
      if(!result.settings||!result.totals||!Array.isArray(result.posts)||!Array.isArray(result.allocations)||!Array.isArray(result.shows))throw Error("Báo cáo chưa có đủ dữ liệu. Vui lòng thử lại.");
      if(mounted.current&&!signal?.aborted&&current===requestId.current){setData(result);setError("");if(!formDirty.current)setForm(configFrom(result));}
    }catch(cause){if(mounted.current&&!signal?.aborted&&current===requestId.current)setError(cause instanceof Error?cause.message:"Không kết nối được báo cáo.");}
    finally{if(mounted.current&&!signal?.aborted&&current===requestId.current)setLoading(false);}
  },[]);

  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();let polling=false;
    const poll=async()=>{if(polling||mutationPending.current)return;polling=true;try{await refresh(controller.signal);}finally{polling=false;}};
    void poll();const timer=setInterval(()=>{if(document.visibilityState==="visible")void poll();},30000);
    return()=>{mounted.current=false;controller.abort();clearInterval(timer);};
  },[refresh]);

  async function change(action:AiMarketingAdminAction){
    if(mutationPending.current)return;
    mutationPending.current=true;requestId.current++;setBusy(action.action);setActionError("");setNotice("");
    try{
      const response=await fetch("/api/admin/ai-marketing",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)});
      const result=await response.json().catch(()=>null) as {error?:string;message?:string}|null;
      if(!response.ok)throw Error(result?.error||"Chưa lưu được yêu cầu. Vui lòng thử lại.");
      if(mounted.current){
        if(action.action==="configure")formDirty.current=false;
        setNotice(result?.message||(action.action==="configure"?"Đã lưu lựa chọn. Quyền đăng bài và chạy Ads sẽ được kiểm tra trước khi hoạt động.":action.enabled?"Đã ghi nhận yêu cầu bật. Hệ thống chỉ chạy khi các kết nối đã sẵn sàng.":"Đã ghi nhận yêu cầu tạm dừng. Quảng cáo được xác nhận dừng sẽ cập nhật trong báo cáo."));
        await refresh();
      }
    }catch(cause){if(mounted.current)setActionError(cause instanceof Error?cause.message:"Không cập nhật được cấu hình.");}
    finally{mutationPending.current=false;if(mounted.current)setBusy("");}
  }
  function updateForm(next:Partial<ConfigForm>){formDirty.current=true;setForm(current=>current?{...current,...next}:current);}
  function saveConfig(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!form||!data)return;
    const cap=Number(form.dailyCapVnd),maximum=Math.min(1000000,data.settings.maxAuthorizedDailyCapVnd);
    if(!form.slots.every(value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value))||form.slots[0]===form.slots[1]){setActionError("Chọn hai giờ đăng hợp lệ và khác nhau.");return;}
    if(!Number.isSafeInteger(cap)||cap<2*data.settings.initialBudgetVnd||cap>maximum){setActionError("Trần ngày phải từ "+money(2*data.settings.initialBudgetVnd)+" đến "+money(maximum)+".");return;}
    void change({action:"configure",accountId:form.accountId||null,slots:form.slots,dailyCapVnd:cap});
  }

  const posts=useMemo(()=>(data?.posts||[]).filter(post=>postFilter==="all"||post.status===postFilter),[data,postFilter]);
  const allocations=useMemo(()=>(data?.allocations||[]).filter(item=>budgetFilter==="all"||item.businessDate===data?.totals.businessDate),[data,budgetFilter]);
  const settings=data?.settings;
  const active=Boolean(settings?.enabled&&settings.automationStatus==="active"&&settings.publishingReady&&settings.advertisingReady);
  const stateLabel=!settings?"Đang kiểm tra kết nối":settings.pausePending?"Đang chờ xác nhận tạm dừng":!settings.enabled?"Luồng AI đang tạm dừng":settings.automationStatus==="needs_attention"?"Có việc cần xử lý":active?"Lịch đăng và Ads đang hoạt động":"Đang chờ hoàn tất kết nối";
  const capProgress=data&&data.settings.dailyCapVnd>0?Math.min(100,Math.max(0,data.totals.allocatedVnd/data.settings.dailyCapVnd*100)):0;

  return <section className={styles.page} aria-label="AI đăng bài và quảng cáo" aria-busy={loading}>
    <div className={styles.hero}>
      <div className={styles.heroCopy}><span className={styles.eyebrow}>EXTRA · AI MARKETING</span><div className={styles.state}><span className={active?styles.activeDot:styles.pendingDot} aria-hidden="true"/><h2>{stateLabel}</h2></div><p>Hai bài mỗi ngày, ưu tiên hai show gần ngày diễn nhất. Nội dung và hình ảnh lấy từ website, kết quả đăng bài và ngân sách theo dõi tại đây.</p><span className={styles.scope}>Chỉ luồng AI này · {settings?.pageName||"Fanpage EXTRA"}</span></div>
      <div className={styles.heroActions}><button type="button" className={settings?.enabled?styles.secondary:styles.primary} disabled={!data||Boolean(busy)} onClick={()=>settings&&void change({action:"set_enabled",enabled:!settings.enabled})}>{busy==="set_enabled"?"Đang ghi nhận…":settings?.enabled?"Yêu cầu tạm dừng":"Yêu cầu bật AI"}</button><button type="button" className={styles.quiet} disabled={loading||Boolean(busy)} onClick={()=>{setLoading(true);void refresh();}}>Cập nhật báo cáo</button></div>
    </div>

    {error?<div className={styles.error} role="alert"><strong>Chưa cập nhật được báo cáo.</strong><p>{error}</p>{data?<p>Đang hiển thị lần tải gần nhất lúc {time(data.updatedAt)}.</p>:null}<button type="button" className={styles.secondary} disabled={loading} onClick={()=>{setLoading(true);void refresh();}}>Thử lại</button></div>:null}
    {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    {settings&&(!settings.publishingReady||!settings.advertisingReady||settings.readinessReasons.length>0)?<div className={styles.connection} role="status"><div className={styles.connectionHeading}><strong>Cần hoàn tất để tự động hoạt động</strong><div className={styles.badges}><StatusPill value={settings.publishingReady?"published":"blocked"} label={settings.publishingReady?"Page: đã xác minh":"Page: chờ kết nối"}/><StatusPill value={settings.advertisingReady?"published":"blocked"} label={settings.advertisingReady?"Ads: đã xác minh":"Ads: chờ xác minh"}/></div></div>{settings.readinessReasons.length?<ul>{settings.readinessReasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>:<p>Hệ thống chưa có đủ quyền đăng bài hoặc chạy quảng cáo cho tài khoản đã chọn.</p>}</div>:null}

    <div className={styles.summaryCards}>
      <div className={styles.summaryCard}><span>Bài đã đăng hôm nay</span><strong>{data?data.totals.publishedToday+" / 2":"—"}</strong><small>{data?numeric(data.totals.scheduledToday)+" bài có lịch trong ngày":"Chờ lấy lịch đăng"}</small></div>
      <div className={styles.summaryCard}><span>Meta đã ghi nhận chi</span><strong>{money(data?.totals.spendVnd)}</strong><small>{data?.totals.metricsAsOf?"Số liệu lúc "+time(data.totals.metricsAsOf):"Chưa có số liệu chi tiêu"}</small></div>
      <div className={styles.summaryCard}><span>Ngân sách đã giữ hôm nay</span><strong>{money(data?.totals.allocatedVnd)}</strong><small>Trần chung {money(settings?.dailyCapVnd)} / ngày</small><div className={styles.budgetBar} role="meter" aria-label="Ngân sách đã giữ so với trần ngày" aria-valuemin={0} aria-valuemax={settings?.dailyCapVnd||1000000} aria-valuenow={data?.totals.allocatedVnd||0}><span style={{width:capProgress+"%"}}/></div></div>
      <div className={styles.summaryCard}><span>Doanh thu đã đối chiếu</span><strong>{money(data?.totals.attributedPaidRevenueVnd)}</strong><small>{data?.totals.attributedPaidOrders==null?"Chưa xác định đơn từ các bài này":numeric(data.totals.attributedPaidOrders)+" đơn thanh toán gắn với bài viết"}</small></div>
    </div>

    <div className={styles.sectionTabs} aria-label="Nội dung báo cáo AI Marketing">{([{id:"overview",label:"Tổng quan & cài đặt"},{id:"posts",label:"Lịch & bài viết"},{id:"budget",label:"Ngân sách & nhật ký"}] as const).map(item=><button type="button" key={item.id} aria-pressed={tab===item.id} className={tab===item.id?styles.tabActive:styles.tab} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>

    {!data?<div className={styles.empty} role="status">{loading?"Đang tải lịch đăng bài và báo cáo ngân sách…":"Báo cáo sẽ hiển thị sau khi kết nối được dữ liệu."}</div>:tab==="overview"?<div className={styles.overview}>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Hai show đang được ưu tiên</h2><p>Tự chuyển sang show tiếp theo khi show hiện tại bắt đầu hoặc ngừng mở bán.</p></div><span className={styles.smallLabel}>Theo lịch trên website</span></div>
        {data.shows.length?<div className={styles.showGrid}>{data.shows.slice(0,2).map((show,index)=><article className={styles.showCard} key={show.id}><div className={styles.showPoster}>{safeUrl(show.posterUrl)?<img src={safeUrl(show.posterUrl)||""} alt={"Poster "+show.artist} loading="lazy"/>:<span>Chưa có poster</span>}<span className={styles.showRank}>{index+1}</span></div><div className={styles.showCopy}><span className={styles.kicker}>{time(show.startsAt)}</span><h3>{show.artist}</h3><p>{show.title}</p><span>{show.venueName}</span>{safeUrl(show.url,["iextra.net"])?<a className={styles.textLink} href={safeUrl(show.url,["iextra.net"])||""} target="_blank" rel="noopener noreferrer">Xem thông tin show ↗</a>:null}</div></article>)}</div>:<div className={styles.empty}>Chưa có show sắp diễn đang mở bán phù hợp.</div>}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Lịch mỗi ngày</h2><p>Giờ Việt Nam · hai khung giờ khởi đầu để theo dõi hiệu quả.</p></div></div><div className={styles.schedule}>{data.settings.slots.map((slot,index)=><div className={styles.slot} key={index}><ClockIcon/><div><strong>{slot}</strong><span>Bài {index+1} · Show ưu tiên {index+1}</span></div><span className={styles.slotIndex}>0{index+1}</span></div>)}</div><p className={styles.help}>{data.settings.objectivePlan==="rotate_messages_sales"?"Mỗi ngày: một bài thử Tin nhắn, một bài thử Mua vé. Hai show đổi mục tiêu vào ngày tiếp theo, mỗi bài có ngân sách riêng.":"Các bài ưu tiên mở hội thoại Messenger để tư vấn và chốt vé."}</p><button type="button" className={styles.quiet} onClick={()=>setTab("posts")}>Xem lịch và nội dung bài →</button></section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Quy tắc ngân sách</h2><p>Chi trong phạm vi đã giao, có lý do cho mỗi thay đổi.</p></div></div><ol className={styles.rules}><li><span>01</span><div><strong>{money(data.settings.initialBudgetVnd)} / bài / ngày</strong><p>Mức thử ban đầu. Không cộng thêm ngân sách ngoài hạn mức của luồng này.</p></div></li><li><span>02</span><div><strong>Tăng tối đa {money(data.settings.scaleBudgetVnd)} / bài</strong><p>Chỉ tăng khi dữ liệu mới, có ít nhất 2 đơn thanh toán được đối chiếu, doanh thu gấp ít nhất 4 lần chi phí và đã chi từ 50.000 đ.</p></div></li><li><span>03</span><div><strong>Trần tổng {money(data.settings.dailyCapVnd)} / ngày</strong><p>Tính cả bài mới và bài đang chạy tốt. Dừng khi show bắt đầu; bài chưa hiệu quả kết thúc lượt thử rồi đánh giá lại hôm sau.</p></div></li></ol></section>
      </div>

      <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Tài khoản & lịch đăng</h2><p>Lưu tài khoản không đồng nghĩa đã có quyền đăng bài hoặc chạy Ads. Cần kết nối Facebook Pages trong Windsor.ai và chọn đúng Page EXTRA.</p></div></div>{form?<form onSubmit={saveConfig} className={styles.settingsForm}><div className={styles.formGrid}><label className={styles.accountField}>Tài khoản quảng cáo<select value={form.accountId} onChange={event=>updateForm({accountId:event.target.value})} disabled={Boolean(busy)}><option value="">Chọn tài khoản để chạy luồng này</option>{data.accounts.map(account=><option value={account.id} key={account.id}>{account.name} · {account.id}</option>)}</select></label><label>Trần tổng mỗi ngày (đ)<input type="number" inputMode="numeric" min={2*data.settings.initialBudgetVnd} max={Math.min(1000000,data.settings.maxAuthorizedDailyCapVnd)} step="1000" required value={form.dailyCapVnd} disabled={Boolean(busy)} onChange={event=>updateForm({dailyCapVnd:event.target.value})}/></label></div><div className={styles.formFooter}><p>Lịch hiện tại: {data.settings.slots.join(" và ")} hằng ngày, giờ Việt Nam. Giới hạn tối đa 1.000.000 đ/ngày. Muốn đổi giờ, cần cập nhật cả lịch tự động.</p><button type="submit" className={styles.primary} disabled={Boolean(busy)}>{busy==="configure"?"Đang lưu…":"Lưu cài đặt"}</button></div></form>:null}</section>
    </div>:tab==="posts"?<section className={styles.panel}><div className={styles.panelHeading}><div><h2>Lịch đăng & nội dung</h2><p>Mỗi bài có ảnh, nội dung, giờ đăng và kết quả xác nhận từ Facebook.</p></div><label className={styles.filter}>Trạng thái<select value={postFilter} onChange={event=>setPostFilter(event.target.value)}><option value="all">Tất cả bài viết</option><option value="draft">Bản nháp</option><option value="scheduled">Đã xếp lịch</option><option value="published">Đã đăng</option><option value="blocked">Chờ xử lý</option><option value="uncertain">Cần đối chiếu</option><option value="failed">Đăng thất bại</option></select></label></div>{posts.length?<div className={styles.postList}>{posts.map(post=><PostCard key={post.id} post={post}/>)}</div>:<div className={styles.empty}><strong>Chưa có bài trong mục này.</strong><p>Bài được tạo khi có show phù hợp; bài đã đăng chỉ được ghi nhận sau khi Facebook xác nhận.</p></div>}</section>:<div className={styles.overview}>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Chi tiêu theo bài quảng cáo</h2><p>Ngân sách giữ trước khác với tiền Meta đã chi. “—” là chưa có dữ liệu, không phải số 0.</p></div><label className={styles.filter}>Khoảng hiển thị<select value={budgetFilter} onChange={event=>setBudgetFilter(event.target.value)}><option value="today">Hôm nay · {day(data.totals.businessDate)}</option><option value="all">Tất cả ngày được tải</option></select></label></div><p className={styles.metricNote}>Đơn Meta ghi nhận và đơn thanh toán đối chiếu là hai nguồn riêng. Chỉ đơn đã thanh toán gắn đúng bài được dùng để tính doanh thu đối chiếu.</p>{allocations.length?<div className={styles.allocationList}>{allocations.map(item=><AllocationCard key={item.id} item={item}/>)}</div>:<div className={styles.empty}><strong>Chưa có ngân sách quảng cáo trong kỳ này.</strong><p>Hạn mức sẽ xuất hiện khi hệ thống đủ quyền và tạo lượt chạy cho bài.</p></div>}</section>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Nhật ký tự động</h2><p>Lý do đăng bài, tăng ngân sách, tạm dừng hoặc cần xử lý.</p></div></div>{data.audit.length?<ol className={styles.audit}>{data.audit.map(event=><li key={event.id} data-state={event.status}><span className={styles.auditDot} aria-hidden="true"/><div><div className={styles.auditHeading}><strong>{event.title}</strong><time dateTime={event.createdAt}>{time(event.createdAt)}</time></div><p>{event.detail}</p></div></li>)}</ol>:<div className={styles.empty}>Chưa có hoạt động để hiển thị.</div>}</section>
    </div>}

    <footer className={styles.footer}><span>{data?"Báo cáo tải lúc "+time(data.updatedAt)+" · giờ Việt Nam":"Chờ kết nối báo cáo"}{data?.limited?" · Đang hiển thị các bản ghi gần nhất.":""}</span><span>{settings?.lastWorkerAt?"Lần xử lý gần nhất: "+time(settings.lastWorkerAt):"Chưa ghi nhận lượt tự động chạy."}</span></footer>
  </section>;
}

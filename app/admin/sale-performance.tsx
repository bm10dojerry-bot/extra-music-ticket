"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import type {SalePerformanceFilters,SalePerformanceResponse,SalePerformanceShow,SalePerformanceCommissionIssue} from "../../lib/sale-performance";
import styles from "./sale-performance.module.css";

const numberFormat=new Intl.NumberFormat("vi-VN");
const money=(value:number)=>numberFormat.format(value)+" đ";
const percent=(value:number)=>numberFormat.format(Math.round(value*10000)/100)+"%";
const vietnamToday=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Ho_Chi_Minh"}).format(new Date());
const displayDate=(value:string)=>value?value.split("-").reverse().join("/"):"";
const displayTime=(value:string)=>new Date(value).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit",year:"numeric"});
const searchText=(value:string)=>value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d");
type Preset="today"|"week"|"month"|"all";
type Sort="revenue"|"tickets"|"commission"|"name";

function dateRange(preset:Preset):Pick<SalePerformanceFilters,"from"|"to">{
 const today=vietnamToday();
 if(preset==="all")return {from:"",to:""};
 if(preset==="month")return {from:today.slice(0,7)+"-01",to:today};
 if(preset==="week"){
  const date=new Date(today+"T12:00:00Z");date.setUTCDate(date.getUTCDate()-6);
  return {from:date.toISOString().slice(0,10),to:today};
 }
 return {from:today,to:today};
}

function CommissionIssues({issues}:{issues:SalePerformanceCommissionIssue[]}){
 const [visible,setVisible]=useState(20);
 if(!issues.length)return null;
 return <details className={styles.issueDisclosure}><summary>Các trường hợp cần đối soát ({numberFormat.format(issues.length)})</summary><ul>{issues.slice(0,visible).map((issue,index)=><li key={issue.orderCode+"-"+index}><code>{issue.orderCode}</code><span>{issue.message}</span></li>)}</ul>{issues.length>visible?<button type="button" className={styles.secondary} onClick={()=>setVisible(value=>value+20)}>Xem thêm · {numberFormat.format(visible)}/{numberFormat.format(issues.length)}</button>:null}</details>;
}

export default function SalePerformance(){
 const [filters,setFilters]=useState<SalePerformanceFilters>(()=>({...dateRange("today"),show:""}));
 const [draft,setDraft]=useState<SalePerformanceFilters>(filters);
 const [data,setData]=useState<SalePerformanceResponse|null>(null);
 const [shows,setShows]=useState<SalePerformanceShow[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [validation,setValidation]=useState("");
 const [refresh,setRefresh]=useState(0);
 const [search,setSearch]=useState(""),[sort,setSort]=useState<Sort>("revenue");
 const [selectedId,setSelectedId]=useState("");
 const [orderPage,setOrderPage]=useState(0);
 const detailHeading=useRef<HTMLHeadingElement>(null);

 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError("");setData(null);
  const params=new URLSearchParams();
  if(filters.from)params.set("from",filters.from);
  if(filters.to)params.set("to",filters.to);
  if(filters.show)params.set("show",filters.show);
  async function load(){
   try{
    const response=await fetch("/api/admin/sale-performance?"+params.toString(),{cache:"no-store",signal:controller.signal});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Không tải được thống kê Sale.");
    if(!controller.signal.aborted){setData(result);setShows(result.shows);}
   }catch(cause){
    if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Không kết nối được báo cáo. Vui lòng thử lại.");
   }finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void load();
  return()=>controller.abort();
 },[filters.from,filters.to,filters.show,refresh]);

 useEffect(()=>{
  if(selectedId)detailHeading.current?.focus();
 },[selectedId]);

 function apply(next:SalePerformanceFilters){
  if(next.from&&next.to&&next.from>next.to){setValidation("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");return;}
  setValidation("");setSelectedId("");setOrderPage(0);setFilters({...next});setRefresh(value=>value+1);
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();apply(draft);}
 function choosePreset(preset:Preset){const next={...draft,...dateRange(preset)};setDraft(next);apply(next);}
 const visibleSales=(data?.sales||[]).filter(sale=>searchText(sale.name+" "+sale.username).includes(searchText(search.trim()))).sort((a,b)=>{
  const difference=sort==="revenue"?b.revenue-a.revenue:sort==="tickets"?b.paidTickets-a.paidTickets:sort==="commission"?b.commission-a.commission:0;
  return difference||a.name.localeCompare(b.name,"vi")||a.username.localeCompare(b.username,"vi");
 });
 const selected=data?.sales.find(sale=>sale.id===selectedId);
 const selectedOrders=selected?.orders.slice(orderPage*20,(orderPage+1)*20)||[];
 const period=filters.from&&filters.to?filters.from===filters.to?displayDate(filters.from):displayDate(filters.from)+" – "+displayDate(filters.to):filters.from?"Từ "+displayDate(filters.from):filters.to?"Đến "+displayDate(filters.to):"Toàn bộ thời gian";
 const showName=shows.find(show=>show.id===filters.show)?.artist||"Tất cả show";
 const totals=data?.totals;
 const cards=[
  {label:"Sale có doanh số",value:totals?`${totals.salesWithRevenue} / ${totals.sales}`:"—",note:totals?`${totals.activeSales} tài khoản đang hoạt động`:"Tất cả tài khoản Sale",accent:"neutral"},
  {label:"Vé đã bán",value:totals?numberFormat.format(totals.paidTickets):"—",note:totals?`${totals.paidOrders} đơn đã thanh toán`:"Chỉ tính vé có thanh toán",accent:"neutral"},
  {label:"Doanh số Sale",value:totals?money(totals.revenue):"—",note:"Số tiền thực thu từ đơn gắn Sale",accent:"revenue"},
  {label:data&&!data.commissionComplete?"Hoa hồng đã tính được":"Hoa hồng tạm tính",value:totals?money(totals.commission):"—",note:data&&!data.commissionComplete?`${totals?.commissionPendingOrders||0} đơn cần đối soát hoa hồng`:"Lũy tiến riêng cho từng Sale và show",accent:"commission"}
 ];

 return <section className={styles.page} aria-label="Thống kê hiệu suất Sale" aria-busy={loading}>
  <div className={styles.intro}>
   <div><p className={styles.eyebrow}>KINH DOANH & NHÂN SỰ</p><p className={styles.description}>Theo dõi kết quả bán vé và hoa hồng lũy tiến của từng Sale trong từng show.</p></div>
   <button type="button" className={styles.secondary} disabled={loading} onClick={()=>{setSelectedId("");setOrderPage(0);setRefresh(value=>value+1);}}>{loading?"Đang cập nhật…":"↻ Cập nhật"}</button>
  </div>

  <form className={styles.filters} onSubmit={submit}>
   <div className={styles.presets} aria-label="Chọn nhanh khoảng thời gian">
    {([["today","Hôm nay"],["week","7 ngày qua"],["month","Tháng này"],["all","Tất cả"]] as const).map(([key,label])=>{
     const range=dateRange(key),active=filters.from===range.from&&filters.to===range.to;
     return <button type="button" key={key} aria-pressed={active} className={active?styles.presetActive:styles.preset} onClick={()=>choosePreset(key)}>{label}</button>;
    })}
    <span className={styles.timezone}>Theo giờ Việt Nam</span>
   </div>
   <div className={styles.filterFields}>
    <label>Từ ngày<input type="date" value={draft.from} max={draft.to||undefined} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/></label>
    <label>Đến ngày<input type="date" value={draft.to} min={draft.from||undefined} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></label>
    <label className={styles.showFilter}>Chương trình<select value={draft.show} onChange={event=>setDraft(value=>({...value,show:event.target.value}))}><option value="">Tất cả show</option>{shows.map(show=><option key={show.id} value={show.id}>{show.artist} · {displayDate(show.date)}</option>)}</select></label>
    <button type="submit" className={styles.primary} disabled={loading}>Áp dụng</button>
   </div>
   {validation?<p role="alert" className={styles.validation}>{validation}</p>:null}
  </form>

  <div className={styles.period}><span>{period}<span aria-hidden="true"> · </span>{showName}</span><span>{data?"Cập nhật "+displayTime(data.updatedAt):loading?"Đang tải dữ liệu…":"Chưa có dữ liệu"}</span></div>
  {error?<div role="alert" className={styles.error}><strong>Chưa tải được thống kê.</strong> {error}<button type="button" className={styles.secondary} onClick={()=>setRefresh(value=>value+1)}>Thử lại</button></div>:null}
  {data?.limited?<p role="alert" className={styles.warning}>Khoảng thời gian có quá nhiều dữ liệu. Vui lòng thu hẹp bộ lọc để xem đầy đủ thống kê.</p>:null}
  {data&&!data.commissionComplete?<p role="alert" className={styles.warning}><strong>Hoa hồng chưa đầy đủ.</strong> {numberFormat.format(data.totals.commissionPendingOrders)} đơn cần đối soát. Số tiền hiển thị chỉ gồm phần đã tính được; xem chi tiết theo show và các trường hợp cần đối soát bên dưới.</p>:null}

  <div className={styles.metrics}>{cards.map(card=><article key={card.label} className={`${styles.metric} ${card.accent==="commission"?styles.commissionCard:card.accent==="revenue"?styles.revenueCard:""}`}><span>{card.label}</span><strong>{loading?"…":card.value}</strong><small>{card.note}</small></article>)}</div>

  <section className={styles.panel} aria-labelledby="sale-ranking-title">
   <div className={styles.panelHeader}>
    <div><h2 id="sale-ranking-title">Kết quả theo Sale</h2><p>{data?`${data.sales.length} tài khoản · Bao gồm Sale chưa phát sinh doanh số`:"Số liệu từ các đơn đã xác nhận thanh toán"}</p></div>
    <div className={styles.tableControls}>
     <label className={styles.searchLabel}><span className={styles.srOnly}>Tìm Sale</span><input type="search" placeholder="Tìm tên hoặc tài khoản Sale…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
     <label><span className={styles.srOnly}>Sắp xếp Sale</span><select aria-label="Sắp xếp Sale" value={sort} onChange={event=>setSort(event.target.value as Sort)}><option value="revenue">Doanh số cao nhất</option><option value="tickets">Vé bán nhiều nhất</option><option value="commission">Hoa hồng cao nhất</option><option value="name">Tên Sale A–Z</option></select></label>
    </div>
   </div>
   <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Bảng kết quả bán vé của nhân viên">
    <table className={styles.table}>
     <thead><tr><th scope="col">Sale</th><th scope="col" className={styles.numeric}>Đơn đã trả</th><th scope="col" className={styles.numeric}>Vé bán</th><th scope="col" className={styles.numeric}>Doanh số</th><th scope="col">Tỷ trọng doanh số</th><th scope="col" className={styles.numeric}>Hoa hồng tạm tính</th><th scope="col"><span className={styles.srOnly}>Chi tiết</span></th></tr></thead>
     <tbody>
      {loading?<tr><td colSpan={7} className={styles.empty}>Đang tải kết quả bán vé…</td></tr>:error?<tr><td colSpan={7} className={styles.empty}>Thử tải lại để xem kết quả.</td></tr>:visibleSales.length===0?<tr><td colSpan={7} className={styles.empty}>{search?"Không tìm thấy Sale phù hợp.":"Chưa có tài khoản Sale trong hệ thống."}</td></tr>:visibleSales.map((sale,index)=>{
       const share=totals&&totals.revenue>0?sale.revenue/totals.revenue:0;
       return <tr key={sale.id} className={selectedId===sale.id?styles.selectedRow:undefined}>
        <th scope="row"><div className={styles.saleIdentity}><span className={styles.rank}>{index+1}</span><div><strong>{sale.name}</strong><small>@{sale.username}</small>{!sale.active?<span className={styles.inactive}>Đã ngừng hoạt động</span>:null}</div></div></th>
        <td className={styles.numeric}>{numberFormat.format(sale.paidOrders)}</td>
        <td className={styles.numeric}><strong>{numberFormat.format(sale.paidTickets)}</strong>{sale.complimentaryTickets>0?<small className={styles.freeSeats}>+{sale.complimentaryTickets} vé mời</small>:null}</td>
        <td className={styles.numeric}><strong>{money(sale.revenue)}</strong></td>
        <td><div className={styles.share}><div className={styles.shareTrack} aria-hidden="true"><span style={{width:Math.min(100,share*100)+"%"}}/></div><span>{percent(share)}</span></div></td>
        <td className={`${styles.numeric} ${styles.commissionValue}`}>{money(sale.commission)}{!sale.commissionComplete?<small className={styles.pendingCommission}>Chưa đầy đủ</small>:null}</td>
        <td><button type="button" className={styles.detailButton} aria-expanded={selectedId===sale.id} aria-controls="sale-order-details" onClick={()=>{setSelectedId(value=>value===sale.id?"":sale.id);setOrderPage(0);}}>{selectedId===sale.id?"Đóng":"Xem chi tiết"}<span className={styles.srOnly}> của {sale.name} ({sale.username})</span></button></td>
       </tr>;
      })}
     </tbody>
    </table>
   </div>
   <div className={styles.tableFooter}><span>{data?`Hiển thị ${visibleSales.length} / ${data.sales.length} Sale`:"—"}</span><span>Vé mời được thống kê riêng, không nâng bậc hoa hồng.</span></div>
  </section>

  {selected?<section id="sale-order-details" className={styles.panel} aria-labelledby="sale-detail-heading">
   <div className={styles.panelHeader}><div><h2 id="sale-detail-heading" tabIndex={-1} ref={detailHeading}>Chi tiết của {selected.name}</h2><p>@{selected.username} · {numberFormat.format(selected.paidTickets)} vé bán · {money(selected.revenue)} doanh số · {money(selected.commission)} hoa hồng{selected.commissionComplete?" tạm tính":" đã tính được"}</p></div><button type="button" className={styles.secondary} onClick={()=>setSelectedId("")}>Đóng chi tiết</button></div>
   <div className={styles.showBreakdown}>
    <h3>Hoa hồng theo từng show</h3><p>Bậc vé được xác định theo toàn bộ lịch sử của Sale trong show. Bộ lọc ngày chỉ chọn giao dịch để xem, không bắt đầu lại bậc vé.</p>
    {selected.shows.length?selected.shows.map(show=><details className={styles.showDetail} key={show.showId}>
     <summary><span className={styles.showIdentity}><strong>{show.showName}</strong><small>{show.showDate?displayDate(show.showDate)+" · ":""}{show.showId||"Chưa xác định show"}</small></span><span><small>Vé trong kỳ</small><strong>{numberFormat.format(show.paidTickets)}</strong></span><span><small>Doanh số trong kỳ</small><strong>{money(show.revenue)}</strong></span><span className={styles.showCommission}><small>{show.commissionComplete?"Hoa hồng tạm tính":"Hoa hồng đã tính được"}</small><strong>{money(show.commission)}</strong></span><span className={styles.expandMark} aria-hidden="true">⌄</span></summary>
     <div className={styles.showDetailBody}>
      <p className={styles.lifetimeNote}>{show.lifetimeComplete?"Tích lũy toàn bộ thời gian":"Tích lũy theo dữ liệu hiện có"}: <strong>{numberFormat.format(show.lifetimePaidTickets)} vé trả tiền</strong> của Sale trong show này.{show.complimentaryTickets>0?` Trong kỳ có ${numberFormat.format(show.complimentaryTickets)} vé mời được thống kê riêng.`:""}</p>
      {!show.lifetimeComplete?<p className={styles.pendingNote}>Lịch sử toàn show còn giao dịch cần đối soát. Số vé tích lũy này chỉ gồm những vé đã xác định được.</p>:null}
      {!show.commissionComplete?<p className={styles.pendingNote}>Số tiền trên chưa bao gồm toàn bộ hoa hồng của show trong kỳ này.</p>:null}
      {show.policy?<p className={styles.policyNote}><strong>{show.policy.source==="show"?"Bảng bậc riêng của show":"Mẫu khởi tạo cho show"}:</strong> {show.policy.tiers.map((tier,index)=>`${index===0?1:show.policy!.tiers[index-1].maxTickets+1}–${tier.maxTickets} vé: ${numberFormat.format(tier.rate)}%`).join(" · ")}</p>:<p className={styles.pendingNote}>Chưa xác định được bảng bậc áp dụng cho show.</p>}
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={"Hoa hồng từng bậc của "+show.showName}><table className={`${styles.table} ${styles.bandTable}`}><thead><tr><th scope="col">Bậc vé trong show</th><th scope="col" className={styles.numeric}>Tỷ lệ bậc</th><th scope="col" className={styles.numeric}>Vé trong kỳ</th><th scope="col" className={styles.numeric}>Doanh thu trong bậc</th><th scope="col" className={styles.numeric}>Hoa hồng bậc</th></tr></thead><tbody>{show.bands.length?show.bands.map((band,index)=><tr key={band.fromTicket+"-"+band.toTicket+"-"+index}><th scope="row">Vé {band.fromTicket}–{band.toTicket}</th><td className={styles.numeric}>{numberFormat.format(band.rate)}%</td><td className={styles.numeric}>{numberFormat.format(band.tickets)}</td><td className={styles.numeric}>{money(band.revenue)}</td><td className={`${styles.numeric} ${styles.commissionValue}`}>{money(band.commission)}</td></tr>):<tr><td colSpan={5} className={styles.empty}>{show.commissionComplete?"Chưa có vé trả tiền phát sinh hoa hồng trong kỳ.":"Chưa đủ dữ liệu để phân bổ hoa hồng vào các bậc."}</td></tr>}</tbody></table></div>
      <CommissionIssues issues={show.commissionIssues}/>
     </div>
    </details>):<p className={styles.detailEmpty}>Sale chưa có giao dịch theo bộ lọc đang chọn.</p>}
   </div>
   <div className={styles.ordersHeading}><h3>Đơn đã thanh toán</h3><p>Thứ tự vé được tính riêng cho Sale trong từng show.</p></div>
   <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={"Đơn hàng của "+selected.name}>
    <table className={`${styles.table} ${styles.ordersTable}`}><thead><tr><th scope="col">Mã đơn</th><th scope="col">Show</th><th scope="col">Ghế</th><th scope="col">Thứ tự vé</th><th scope="col">Thanh toán lúc</th><th scope="col" className={styles.numeric}>Số tiền</th><th scope="col" className={styles.numeric}>Hoa hồng đơn</th></tr></thead><tbody>{selectedOrders.length?selectedOrders.map(order=><tr key={order.code}><th scope="row"><code>{order.code}</code>{order.isComplimentary?<small className={styles.freeSeats}>Vé mời / miễn phí</small>:order.complimentaryTickets>0?<small className={styles.freeSeats}>Có {numberFormat.format(order.complimentaryTickets)} vé mời</small>:null}</th><td>{order.showName}</td><td className={styles.seats}>{order.seats.join(", ")||"—"}</td><td>{order.isComplimentary?"—":order.firstTicket!==null&&order.lastTicket!==null?order.firstTicket===order.lastTicket?numberFormat.format(order.firstTicket):`${numberFormat.format(order.firstTicket)}–${numberFormat.format(order.lastTicket)}`:<span className={styles.pendingCommission}>Chờ xác định</span>}</td><td>{displayTime(order.paidAt)}</td><td className={styles.numeric}>{money(order.amount)}</td><td className={`${styles.numeric} ${styles.commissionValue}`}>{money(order.commission)}{order.commissionIssue?<small className={styles.pendingCommission} title={order.commissionIssue}>Cần đối soát</small>:null}</td></tr>):<tr><td colSpan={7} className={styles.empty}>Sale chưa có đơn đã thanh toán trong khoảng thời gian này.</td></tr>}</tbody></table>
   </div>
   {selected.orders.length>20?<div className={styles.pagination}><button type="button" className={styles.secondary} disabled={orderPage===0} onClick={()=>setOrderPage(value=>value-1)}>← Trước</button><span>Trang {orderPage+1} / {Math.ceil(selected.orders.length/20)}</span><button type="button" className={styles.secondary} disabled={(orderPage+1)*20>=selected.orders.length} onClick={()=>setOrderPage(value=>value+1)}>Sau →</button></div>:null}
  </section>:null}

  {data?<div className={styles.notes}>
   <p><strong>Cách tính:</strong> Hoa hồng được cộng lũy tiến theo từng vé trả tiền, riêng cho mỗi Sale trong mỗi show. Các bậc dùng cấu hình của show đó. Khi lọc ngày, thứ tự vé vẫn giữ theo lịch sử thanh toán; tiền hoa hồng chỉ cộng từ những giao dịch trong khoảng đang xem.</p>
   <p>Vé mời không tăng bậc. Vé vượt ngưỡng cuối hoặc thiếu dữ liệu được đánh dấu cần đối soát. Tổng hoa hồng mỗi đơn được làm tròn đến đồng rồi phân bổ vào các bậc. Thay đổi cấu hình show sẽ tính lại báo cáo của cả các đơn trước đây; đây là số liệu tạm tính, chưa phải khoản đã chi.</p>
   <CommissionIssues key={data.updatedAt} issues={data.commissionIssues}/>
   {data.unassigned.orders>0?<p className={styles.unassigned}>{data.unassigned.orders} đơn đã thanh toán chưa xác định được Sale ({data.unassigned.tickets} vé, {money(data.unassigned.revenue)}), chưa cộng vào doanh số nhân viên ở trên.</p>:null}
  </div>:null}
 </section>;
}

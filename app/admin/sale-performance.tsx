"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import type {SalePerformanceFilters,SalePerformanceResponse,SalePerformanceShow} from "../../lib/sale-performance";
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
  {label:"Hoa hồng tạm tính",value:totals?money(totals.commission):"—",note:"Theo bậc thưởng của từng Sale",accent:"commission"}
 ];

 return <section className={styles.page} aria-label="Thống kê hiệu suất Sale" aria-busy={loading}>
  <div className={styles.intro}>
   <div><p className={styles.eyebrow}>KINH DOANH & NHÂN SỰ</p><p className={styles.description}>Theo dõi kết quả bán vé và hoa hồng của từng nhân viên.</p></div>
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
     <thead><tr><th scope="col">Sale</th><th scope="col" className={styles.numeric}>Đơn đã trả</th><th scope="col" className={styles.numeric}>Vé bán</th><th scope="col" className={styles.numeric}>Doanh số</th><th scope="col">Tỷ trọng doanh số</th><th scope="col" className={styles.numeric}>Mức thưởng</th><th scope="col" className={styles.numeric}>Hoa hồng tạm tính</th><th scope="col"><span className={styles.srOnly}>Chi tiết</span></th></tr></thead>
     <tbody>
      {loading?<tr><td colSpan={8} className={styles.empty}>Đang tải kết quả bán vé…</td></tr>:error?<tr><td colSpan={8} className={styles.empty}>Thử tải lại để xem kết quả.</td></tr>:visibleSales.length===0?<tr><td colSpan={8} className={styles.empty}>{search?"Không tìm thấy Sale phù hợp.":"Chưa có tài khoản Sale trong hệ thống."}</td></tr>:visibleSales.map((sale,index)=>{
       const share=totals&&totals.revenue>0?sale.revenue/totals.revenue:0;
       return <tr key={sale.id} className={selectedId===sale.id?styles.selectedRow:undefined}>
        <th scope="row"><div className={styles.saleIdentity}><span className={styles.rank}>{index+1}</span><div><strong>{sale.name}</strong><small>@{sale.username}</small>{!sale.active?<span className={styles.inactive}>Đã ngừng hoạt động</span>:null}</div></div></th>
        <td className={styles.numeric}>{numberFormat.format(sale.paidOrders)}</td>
        <td className={styles.numeric}><strong>{numberFormat.format(sale.paidTickets)}</strong>{sale.complimentaryTickets>0?<small className={styles.freeSeats}>+{sale.complimentaryTickets} vé mời</small>:null}</td>
        <td className={styles.numeric}><strong>{money(sale.revenue)}</strong></td>
        <td><div className={styles.share}><div className={styles.shareTrack} aria-hidden="true"><span style={{width:Math.min(100,share*100)+"%"}}/></div><span>{percent(share)}</span></div></td>
        <td className={styles.numeric}>{percent(sale.commissionRate)}</td>
        <td className={`${styles.numeric} ${styles.commissionValue}`}>{money(sale.commission)}</td>
        <td><button type="button" className={styles.detailButton} aria-expanded={selectedId===sale.id} aria-controls="sale-order-details" onClick={()=>{setSelectedId(value=>value===sale.id?"":sale.id);setOrderPage(0);}}>{selectedId===sale.id?"Đóng":"Xem đơn"}<span className={styles.srOnly}> của {sale.name} ({sale.username})</span></button></td>
       </tr>;
      })}
     </tbody>
    </table>
   </div>
   <div className={styles.tableFooter}><span>{data?`Hiển thị ${visibleSales.length} / ${data.sales.length} Sale`:"—"}</span><span>Vé mời được thống kê riêng, không nâng bậc hoa hồng.</span></div>
  </section>

  {selected?<section id="sale-order-details" className={styles.panel} aria-labelledby="sale-detail-heading">
   <div className={styles.panelHeader}><div><h2 id="sale-detail-heading" tabIndex={-1} ref={detailHeading}>Đơn của {selected.name}</h2><p>@{selected.username} · {selected.paidTickets} vé bán · {money(selected.revenue)} doanh số · {money(selected.commission)} hoa hồng</p></div><button type="button" className={styles.secondary} onClick={()=>setSelectedId("")}>Đóng chi tiết</button></div>
   <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={"Đơn hàng của "+selected.name}>
    <table className={`${styles.table} ${styles.ordersTable}`}><thead><tr><th scope="col">Mã đơn</th><th scope="col">Show</th><th scope="col">Ghế</th><th scope="col">Thanh toán lúc</th><th scope="col" className={styles.numeric}>Số tiền</th></tr></thead><tbody>{selectedOrders.length?selectedOrders.map(order=><tr key={order.code}><th scope="row"><code>{order.code}</code>{order.isComplimentary?<small className={styles.freeSeats}>Vé mời / miễn phí</small>:null}</th><td>{order.showName}</td><td className={styles.seats}>{order.seats.join(", ")||"—"}</td><td>{displayTime(order.paidAt)}</td><td className={styles.numeric}>{money(order.amount)}</td></tr>):<tr><td colSpan={5} className={styles.empty}>Sale chưa có đơn đã thanh toán trong khoảng thời gian này.</td></tr>}</tbody></table>
   </div>
   {selected.orders.length>20?<div className={styles.pagination}><button type="button" className={styles.secondary} disabled={orderPage===0} onClick={()=>setOrderPage(value=>value-1)}>← Trước</button><span>Trang {orderPage+1} / {Math.ceil(selected.orders.length/20)}</span><button type="button" className={styles.secondary} disabled={(orderPage+1)*20>=selected.orders.length} onClick={()=>setOrderPage(value=>value+1)}>Sau →</button></div>:null}
  </section>:null}

  {data?<div className={styles.notes}>
   <p><strong>Cách tính:</strong> Hoa hồng áp dụng trên doanh số đã thanh toán trong khoảng thời gian và show đang chọn. Bậc hiện tại: 1–10 vé {data.settings.rate_1_10}%, 11–30 vé {data.settings.rate_11_30}%, 31–50 vé {data.settings.rate_31_50}%, từ 51 vé {data.settings.rate_51_plus}%. Đây là số tiền tạm tính để đối soát.</p>
   {data.unassigned.orders>0?<p className={styles.unassigned}>{data.unassigned.orders} đơn đã thanh toán chưa xác định được Sale ({data.unassigned.tickets} vé, {money(data.unassigned.revenue)}), chưa cộng vào doanh số nhân viên ở trên.</p>:null}
  </div>:null}
 </section>;
}

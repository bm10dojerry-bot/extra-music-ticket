"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import SeatBooking from "./seat-booking";
import SupportInbox from "../support-inbox";
import {useLiveSalePresence} from "../live-presence";
import type {StaffSaleReportResponse} from "../../lib/sale-performance";
import CommissionSummary from "./commission-summary";
import TicketLinkActions from "./ticket-link-actions";
import styles from "./sale-workspace.module.css";

type ShowOption={id:string;artist:string;date:string;time:string;venue:string;status:string;prices?:Record<string,number|null>};
type Lead={id:string;show_id:string;customer_name:string;customer_phone:string;note:string;status:string;status_confirmed:boolean;created_at:string};
type PaidCustomer={code:string;show_id:string;seats:string[];buyer_name:string;buyer_phone:string;buyer_email:string;amount_vnd:number;paid_at:string;email_status?:"sent"|"sending"|"queued"|null};
type Report=StaffSaleReportResponse;
type Tab="home"|"tickets"|"commission"|"customers";
type LoadPart="customers"|"report"|"shows";
const tabs:ReadonlyArray<{id:Tab;label:string;title:string;description:string}>=[
 {id:"home",label:"Home",title:"Tổng quan của bạn",description:"Doanh số và kết quả bán vé của riêng bạn."},
 {id:"tickets",label:"Bán vé",title:"Bán vé",description:"Chọn show, giữ ghế và theo dõi thanh toán cho khách."},
 {id:"commission",label:"Hoa hồng",title:"Hoa hồng",description:"Theo dõi hoa hồng và tiến độ từng bậc của mỗi show."},
 {id:"customers",label:"Chăm sóc khách hàng",title:"Chăm sóc khách hàng",description:"Tra cứu vé, cập nhật khách đang chăm sóc và trả lời tư vấn."},
];
const leadStatuses=[["new","Mới"],["contacted","Đã liên hệ"],["awaiting_payment","Chờ thanh toán"],["cancelled","Hủy"]] as const;
const emailStatuses={sent:"Đã gửi email",sending:"Đang gửi email",queued:"Chờ gửi email"};
const numbers=new Intl.NumberFormat("vi-VN");
const money=(value:number)=>numbers.format(Math.round(value))+" đ";
const shortDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split("-").reverse().join("/"):value;
const dateTime=(value:string)=>{const at=new Date(value);return Number.isFinite(at.getTime())?at.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";};
const searchText=(value:string)=>value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d");

function MenuIcon({tab}:{tab:Tab}){
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {tab==="home"?<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h5v-6h4v6h5V9"/></>:tab==="tickets"?<><path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Z"/><path d="M15 5v3m0 3v2m0 3v3"/></>:tab==="commission"?<><path d="m6 18 12-12"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></>:<><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/></>}
 </svg>;
}

export default function SaleWorkspace({name}:{name:string}){
 useLiveSalePresence();
 const [activeTab,setActiveTab]=useState<Tab>("home");
 const [visited,setVisited]=useState<Record<Tab,boolean>>({home:true,tickets:false,commission:false,customers:false});
 const [loading,setLoading]=useState<Record<LoadPart,boolean>>({customers:true,report:true,shows:true});
 const [loadErrors,setLoadErrors]=useState<Partial<Record<LoadPart,string>>>({});
 const [customersReady,setCustomersReady]=useState(false);
 const [paidCustomersList,setPaidCustomersList]=useState<PaidCustomer[]>([]);
 const [draftStatuses,setDraftStatuses]=useState<Record<string,string>>({});
 const [savingId,setSavingId]=useState("");
 const [shows,setShows]=useState<ShowOption[]>([]);
 const [leads,setLeads]=useState<Lead[]>([]);
 const [report,setReport]=useState<Report|null>(null);
 const [error,setError]=useState("");
 const [customerSearch,setCustomerSearch]=useState("");
 const requestVersion=useRef(0),mounted=useRef(true),focusHeading=useRef(false);
 const heading=useRef<HTMLHeadingElement>(null);

 const load=useCallback(async()=>{
  if(!mounted.current)return;
  const version=++requestVersion.current;
  setLoading({customers:true,report:true,shows:true});setLoadErrors({});
  async function read<T>(part:LoadPart,url:string,label:string,apply:(data:T)=>void){
   try{
    const response=await fetch(url,{cache:"no-store"});
    const data=await response.json() as T&{error?:string};
    if(!response.ok)throw Error(data.error||"Vui lòng thử lại.");
    if(mounted.current&&version===requestVersion.current)apply(data);
   }catch(cause){
    if(mounted.current&&version===requestVersion.current)setLoadErrors(old=>({...old,[part]:label+": "+(cause instanceof Error?cause.message:"Không kết nối được.")}));
   }finally{
    if(mounted.current&&version===requestVersion.current)setLoading(old=>({...old,[part]:false}));
   }
  }
  await Promise.allSettled([
   read<{requests?:Lead[];paidCustomers?:PaidCustomer[]}>("customers","/api/staff/sale-requests","Khách hàng",data=>{setLeads(data.requests||[]);setPaidCustomersList(data.paidCustomers||[]);setCustomersReady(true);}),
   read<Report>("report","/api/staff/reports","Báo cáo",setReport),
   read<{shows?:ShowOption[]}>("shows","/api/staff/sale-shows","Danh sách show",data=>setShows(data.shows||[])),
  ]);
 },[]);
 const refresh=useCallback(()=>{void load();},[load]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;requestVersion.current++;};},[load]);
 useEffect(()=>{if(focusHeading.current){heading.current?.focus();focusHeading.current=false;}},[activeTab]);

 function navigate(tab:Tab){
  if(tab===activeTab)return;
  focusHeading.current=true;
  setVisited(old=>old[tab]?old:{...old,[tab]:true});setActiveTab(tab);
 }
 async function status(id:string,value:string){
  setSavingId(id);setError("");
  try{
   const response=await fetch("/api/staff/sale-requests",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status:value})});
   if(!response.ok){const data=await response.json();throw Error(data.error||"Không cập nhật được");}
   setDraftStatuses(old=>{const next={...old};delete next[id];return next;});await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Không cập nhật được");}
  finally{setSavingId("");}
 }

 const current=tabs.find(tab=>tab.id===activeTab)!;
 const workspaceLoading=Object.values(loading).some(Boolean);
 const failures=Object.entries(loadErrors);
 const showNames=new Map([...(report?.shows||[]),...shows].map(show=>[show.id,show.artist]));
 const query=searchText(customerSearch.trim());
 const paidCustomers=paidCustomersList.filter(order=>searchText([order.buyer_name,order.buyer_phone,order.buyer_email,order.code,showNames.get(order.show_id)||order.show_id,...order.seats].join(" ")).includes(query));
 const visibleLeads=leads.filter(lead=>searchText([lead.customer_name,lead.customer_phone,lead.note,showNames.get(lead.show_id)||lead.show_id].join(" ")).includes(query));
 const activeLeads=leads.filter(lead=>lead.status!=="cancelled").length;
 const showResults=(report?.commissionByShow||[]).filter(show=>show.paidOrders>0||show.paidTickets>0||show.revenue>0||show.complimentaryTickets>0);
 const from=report?.filters.from||"",to=report?.filters.to||"";
 const period=from&&to?shortDate(from)+" – "+shortDate(to):from?"Từ "+shortDate(from):to?"Đến "+shortDate(to):"Toàn bộ thời gian";
 const initials=name.trim().split(/\s+/).slice(-2).map(part=>part[0]||"").join("").toUpperCase()||"S";

 return <div className={styles.shell}>
  <div className={styles.workspace}>
   <aside className={styles.sidebar} aria-label="Điều hướng Sale">
    <a className={styles.brand} href="https://iextra.net/" target="_blank" rel="noopener noreferrer"><span className={styles.brandMark}>+1</span><span><strong>EXTRA</strong><small>MUSIC SHOW</small></span></a>
    <p className={styles.menuLabel}>KHÔNG GIAN SALE</p>
    <nav className={styles.navigation} aria-label="Menu Sale">
     {tabs.map(tab=><button key={tab.id} id={"sale-nav-"+tab.id} type="button" className={activeTab===tab.id?styles.navActive:styles.navButton} aria-current={activeTab===tab.id?"page":undefined} aria-controls={"sale-panel-"+tab.id} onClick={()=>navigate(tab.id)}><MenuIcon tab={tab.id}/><span>{tab.label}</span><span className={styles.navArrow} aria-hidden="true">›</span></button>)}
    </nav>
    <div className={styles.sidebarBottom}>
     <div className={styles.account}><span className={styles.avatar} aria-hidden="true">{initials}</span><div><strong>{name}</strong><small>Nhân viên Sale</small></div></div>
     <a className={styles.utilityLink} href="/reset-password?from=sale">Đổi mật khẩu <span aria-hidden="true">↗</span></a>
     <a className={styles.utilityLink} href="https://iextra.net/" target="_blank" rel="noopener noreferrer">Xem website <span aria-hidden="true">↗</span></a>
     <form action="/api/staff/logout" method="post"><button className={styles.logout} type="submit">Đăng xuất</button></form>
    </div>
   </aside>

   <main className={styles.main} aria-labelledby="sale-workspace-title">
    <div className={styles.mobileAccount}><div><span>+1 EXTRA · SALE</span><strong>{name}</strong></div><div className={styles.mobileUtilities}><a href="/reset-password?from=sale">Đổi mật khẩu</a><form action="/api/staff/logout" method="post"><button type="submit">Đăng xuất</button></form></div></div>
    <header className={styles.pageHeader}>
     <div><p className={styles.eyebrow}>SALE / {current.label.toLocaleUpperCase("vi")}</p><h1 id="sale-workspace-title" tabIndex={-1} ref={heading}>{current.title}</h1><p className={styles.description}>{current.description}</p></div>
     <button className={styles.refresh} type="button" disabled={workspaceLoading} onClick={refresh}><span aria-hidden="true">↻</span> {workspaceLoading?"Đang cập nhật…":"Cập nhật"}</button>
    </header>
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    {failures.length?<div className={styles.error} role="alert"><strong>Một số dữ liệu chưa được cập nhật.</strong><ul>{failures.map(([key,message])=><li key={key}>{message}</li>)}</ul></div>:null}

    <section id="sale-panel-home" className={styles.view} hidden={activeTab!=="home"} aria-labelledby="sale-nav-home">
     <div className={styles.revenueCard}>
      <div><p>DOANH SỐ CỦA TÔI</p><h2>{report?money(report.totals.revenue):"—"}</h2><span>{period} · Các đơn đã xác nhận thanh toán</span></div>
      <button className={styles.primary} type="button" onClick={()=>navigate("tickets")}><MenuIcon tab="tickets"/> Bán vé <span aria-hidden="true">↗</span></button>
     </div>
     <div className={styles.metrics}>
      <article><span>Đơn đã thanh toán</span><strong>{report?numbers.format(report.totals.orders):"—"}</strong><small>Đơn của tài khoản bạn</small></article>
      <article><span>Vé đã thanh toán</span><strong>{report?numbers.format(report.totals.commissionTickets):"—"}</strong><small>{report?`${report.totals.complimentaryTickets} vé mời / tặng được tách riêng`:"Chỉ tính vé mua đã xác minh"}</small></article>
      <article className={styles.commissionMetric}><span>Hoa hồng tạm tính</span><strong>{report?money(report.commissionTotal):"—"}</strong><button type="button" onClick={()=>navigate("commission")}>{report?.commissionComplete===false?"Còn đơn chờ đối soát":"Xem theo từng show"} <span aria-hidden="true">→</span></button></article>
      <article><span>Yêu cầu đang chăm sóc</span><strong>{customersReady?numbers.format(activeLeads):"—"}</strong><button type="button" onClick={()=>navigate("customers")}>Mở khách hàng <span aria-hidden="true">→</span></button></article>
     </div>
     {report?.commissionComplete===false?<p className={styles.notice} role="status">Có đơn đang chờ đối soát vé hoặc hoa hồng. Số vé và hoa hồng hiển thị là phần đã xác định được. <button type="button" onClick={()=>navigate("commission")}>Xem chi tiết →</button></p>:null}
     <section className={styles.card} aria-labelledby="sale-home-shows">
      <div className={styles.cardHeader}><div><h2 id="sale-home-shows">Kết quả theo show</h2><p>{period}</p></div>{report?<span className={styles.updatedAt}>Cập nhật {dateTime(report.updatedAt)}</span>:null}</div>
      {showResults.length?<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Kết quả bán vé theo show"><table className={styles.statsTable}><thead><tr><th scope="col">Show</th><th scope="col" className={styles.numeric}>Đơn</th><th scope="col" className={styles.numeric}>Vé đã trả</th><th scope="col" className={styles.numeric}>Doanh số</th></tr></thead><tbody>{showResults.map(show=><tr key={show.saleId+":"+show.showId}><th scope="row"><strong>{show.showName}</strong><small>{shortDate(show.showDate)}</small></th><td className={styles.numeric}>{numbers.format(show.paidOrders)}</td><td className={styles.numeric}>{numbers.format(show.paidTickets)}{show.complimentaryTickets>0?<small>+{show.complimentaryTickets} vé mời / tặng</small>:null}</td><td className={styles.numeric}>{money(show.revenue)}</td></tr>)}</tbody></table></div>:<div className={styles.empty}><MenuIcon tab="tickets"/><h3>{loading.report&&!report?"Đang tải báo cáo…":!report?"Chưa tải được báo cáo":"Chưa có kết quả bán vé"}</h3><p>{report?"Các đơn đã thanh toán của bạn sẽ xuất hiện tại đây.":"Bạn có thể dùng nút Cập nhật để tải lại dữ liệu."}</p>{report?<button type="button" className={styles.secondary} onClick={()=>navigate("tickets")}>Mở bán vé</button>:null}</div>}
     </section>
    </section>

    {visited.tickets?<section key="tickets" id="sale-panel-tickets" className={styles.view} hidden={activeTab!=="tickets"} aria-labelledby="sale-nav-tickets"><SeatBooking shows={shows} active={activeTab==="tickets"} onPaid={refresh}/></section>:null}
    {visited.commission?<section key="commission" id="sale-panel-commission" className={styles.view} hidden={activeTab!=="commission"} aria-labelledby="sale-nav-commission"><CommissionSummary report={report} ownOnly refreshing={loading.report} onRefresh={refresh}/></section>:null}
    {visited.customers?<section key="customers" id="sale-panel-customers" className={styles.view} hidden={activeTab!=="customers"} aria-labelledby="sale-nav-customers">
     <div className={styles.customerTools}><label htmlFor="sale-customer-search">Tìm khách hàng<input id="sale-customer-search" type="search" value={customerSearch} onChange={event=>setCustomerSearch(event.target.value)} placeholder="Tên, số điện thoại, email hoặc mã đơn…"/></label><div><span><strong>{customersReady?paidCustomersList.length:"—"}</strong> đơn đã thanh toán</span><span><strong>{customersReady?leads.length:"—"}</strong> yêu cầu chăm sóc</span></div></div>
     <section className={styles.card} aria-labelledby="sale-paid-customers">
      <div className={styles.cardHeader}><div><h2 id="sale-paid-customers">Khách đã mua vé</h2><p>Thông tin thanh toán và vé điện tử của khách hàng bạn phụ trách.</p></div>{customersReady?<span className={styles.count}>{paidCustomers.length} / {paidCustomersList.length} đơn</span>:null}</div>
      {paidCustomers.length?<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Khách đã thanh toán và thao tác lấy vé"><table className={styles.customersTable}><thead><tr><th scope="col">Khách hàng</th><th scope="col">Show / ghế</th><th scope="col">Thanh toán</th><th scope="col">Vé điện tử</th></tr></thead><tbody>{paidCustomers.map(order=><tr key={order.code}>
       <th scope="row"><strong>{order.buyer_name}</strong><span>{order.buyer_phone||"—"}</span><small className={styles.email}>{order.buyer_email||"Chưa có email"}</small>{order.email_status&&emailStatuses[order.email_status]?<small className={styles.emailStatus}>{emailStatuses[order.email_status]}</small>:null}</th>
       <td><strong>{showNames.get(order.show_id)||order.show_id}</strong><small className={styles.seats}>Ghế {(order.seats||[]).join(", ")||"—"}</small></td>
       <td><strong className={styles.amount}>{money(order.amount_vnd)}</strong><span className={styles.paidBadge}>Đã thanh toán</span><small>{dateTime(order.paid_at)}</small></td>
       <td><code className={styles.orderCode}>{order.code}</code><TicketLinkActions orderCode={order.code}/></td>
      </tr>)}</tbody></table></div>:<p className={styles.emptyText}>{!customersReady?loading.customers?"Đang tải khách hàng…":"Chưa tải được danh sách khách hàng.":query?"Không tìm thấy đơn phù hợp.":"Chưa có khách mua vé thành công được gắn với tài khoản của bạn."}</p>}
     </section>
     <section className={styles.card} aria-labelledby="sale-customer-leads">
      <div className={styles.cardHeader}><div><h2 id="sale-customer-leads">Khách đang chăm sóc</h2><p>Theo dõi liên hệ và xác nhận trạng thái từng yêu cầu.</p></div>{customersReady?<span className={styles.count}>{visibleLeads.length} / {leads.length} yêu cầu</span>:null}</div>
      {visibleLeads.length?<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Yêu cầu khách hàng đang chăm sóc"><table className={styles.leadsTable}><thead><tr><th scope="col">Khách hàng</th><th scope="col">Show</th><th scope="col">Ghi chú</th><th scope="col">Trạng thái</th></tr></thead><tbody>{visibleLeads.map(lead=>{
       const locked=lead.status_confirmed&&lead.status!=="cancelled";
       return <tr key={lead.id}><th scope="row"><strong>{lead.customer_name}</strong><span>{lead.customer_phone||"—"}</span></th><td>{showNames.get(lead.show_id)||lead.show_id}</td><td className={styles.leadNote}>{lead.note||"—"}</td><td><div className={styles.leadActions}><select aria-label={"Trạng thái của "+lead.customer_name} disabled={locked||savingId===lead.id} value={draftStatuses[lead.id]??lead.status} onChange={event=>setDraftStatuses(old=>({...old,[lead.id]:event.target.value}))}>{leadStatuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={savingId===lead.id||locked||!draftStatuses[lead.id]||(lead.status_confirmed&&draftStatuses[lead.id]===lead.status)} onClick={()=>void status(lead.id,draftStatuses[lead.id])}>{savingId===lead.id?"Đang lưu…":locked?"Đã khóa":"Xác nhận"}</button></div>{lead.status_confirmed&&lead.status==="cancelled"?<small className={styles.reopenNote}>Có thể sửa yêu cầu đã hủy</small>:null}</td></tr>;
      })}</tbody></table></div>:<p className={styles.emptyText}>{!customersReady?loading.customers?"Đang tải yêu cầu…":"Chưa tải được yêu cầu khách hàng.":query?"Không tìm thấy yêu cầu phù hợp.":"Chưa có yêu cầu chăm sóc khách hàng."}</p>}
     </section>
     <div className={styles.inbox}><SupportInbox embedded active={activeTab==="customers"}/></div>
    </section>:null}
   </main>
  </div>
 </div>;
}

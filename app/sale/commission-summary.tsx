"use client";

import {useId,useState} from "react";
import type {SalePerformanceShowCommission,StaffSaleReportResponse} from "../../lib/sale-performance";
import styles from "./commission-summary.module.css";

const numbers=new Intl.NumberFormat("vi-VN");
const money=(value:number)=>numbers.format(value)+" đ";
const percent=(value:number)=>numbers.format(value)+"%";
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split("-").reverse().join("/"):value;
const groupKey=(group:SalePerformanceShowCommission)=>group.saleId+":"+group.showId;
const ticketRange=(first:number,last:number)=>first===last?String(first):first+"–"+last;

type Props={
 report:StaffSaleReportResponse|null;
 ownOnly?:boolean;
 periodLabel?:string;
 refreshing?:boolean;
 onRefresh?:()=>void;
};

export default function CommissionSummary({report,ownOnly=false,periodLabel,refreshing=false,onRefresh}:Props){
 const id=useId();
 const [selectedKey,setSelectedKey]=useState("");
 const [orderPage,setOrderPage]=useState(0);
 const groups=report?.commissionByShow||[];
 const selected=groups.find(group=>groupKey(group)===selectedKey)||groups.find(group=>group.lifetimePaidTickets>0||group.paidOrders>0||group.commissionIssues.length>0)||groups[0];
 const orders=selected?(report?.rows||[]).filter(order=>order.saleId===selected.saleId&&(order.show_id||"")===selected.showId):[];
 const pageCount=Math.max(1,Math.ceil(orders.length/10));
 const page=Math.min(orderPage,pageCount-1);
 const visibleOrders=orders.slice(page*10,(page+1)*10);
 const policy=selected?.policy;
 const lifetimeLast=selected?.lifetimeComplete?(selected.lifetimeLastTicket??(selected.lifetimePaidTickets===0?0:null)):null;
 const nextTicket=lifetimeLast===null?null:lifetimeLast+1;
 const nextIndex=nextTicket===null||!policy?-1:policy.tiers.findIndex(tier=>nextTicket<=tier.maxTickets);
 const currentTier=lifetimeLast===null||lifetimeLast===0?undefined:policy?.tiers.find(tier=>lifetimeLast<=tier.maxTickets);
 const nextTier=nextIndex<0?undefined:policy?.tiers[nextIndex];
 const futureTier=nextIndex<0?undefined:policy?.tiers[nextIndex+1];
 const futureStart=nextTier?nextTier.maxTickets+1:null;
 const groupComplete=selected?.commissionComplete!==false;
 const overallComplete=report?.commissionComplete!==false;
 const from=report?.filters.from||"",to=report?.filters.to||"";
 const period=periodLabel||(from&&to?date(from)+" – "+date(to):from?"Từ "+date(from):to?"Đến "+date(to):"Toàn bộ thời gian");

 return <section className={styles.panel} aria-labelledby={id+"-title"} aria-busy={refreshing}>
  <header className={styles.header}>
   <div><h2 id={id+"-title"}>{ownOnly?"Hoa hồng theo show của tôi":"Hoa hồng theo Sale và show"}</h2><p>Mỗi show có chính sách riêng. Hoa hồng cộng lũy tiến theo từng vé đã thanh toán.</p></div>
   {onRefresh?<button type="button" className={styles.refresh} disabled={refreshing} onClick={onRefresh}>{refreshing?"Đang cập nhật…":"↻ Cập nhật hoa hồng"}</button>:null}
  </header>
  {report&&!overallComplete?<p className={styles.warning} role="status"><strong>Tổng hoa hồng chưa được tính đủ.</strong> Một số đơn cần đối soát giá vé hoặc vé mời. Số tiền hiển thị là phần đã xác định được.</p>:null}
  {!report?<p className={styles.empty} role="status">Đang tải dữ liệu hoa hồng…</p>:!selected?<p className={styles.empty}>Chưa có dữ liệu hoa hồng theo show trong báo cáo này.</p>:<>
   <div className={styles.selection}>
    <label htmlFor={id+"-show"}>{ownOnly?"Chọn show":"Chọn Sale và show"}</label>
    <select id={id+"-show"} value={groupKey(selected)} onChange={event=>{setSelectedKey(event.target.value);setOrderPage(0);}}>
     {groups.map(group=><option key={groupKey(group)} value={groupKey(group)}>{ownOnly?"":group.saleName+" · "}{group.showName}{group.showDate?" · "+date(group.showDate):""}</option>)}
    </select>
    <p>{period} · Số thứ tự vé và tiến độ bậc tính trên toàn bộ lịch sử của Sale trong show.</p>
   </div>

   <div className={styles.metrics}>
    <article><span>Vé đã trả trong báo cáo</span><strong>{numbers.format(selected.paidTickets)}</strong><small>{selected.paidOrders} đơn · {selected.complimentaryTickets} vé mời / miễn phí được tách riêng</small></article>
    <article><span>Doanh số trong báo cáo</span><strong>{money(selected.revenue)}</strong><small>{selected.showName}</small></article>
    <article className={styles.reward}><span>{groupComplete?"Hoa hồng tạm tính của show":"Hoa hồng đã xác định của show"}</span><strong>{money(selected.commission)}</strong><small>{groupComplete?"Tổng các phần hoa hồng theo từng bậc":"Còn đơn cần đối soát trước khi chốt"}</small></article>
   </div>

   {policy?<>
    <div className={styles.progress}>
     <div><span>{selected.lifetimeComplete?"Vé đã thanh toán của show · toàn kỳ":"Vé đã xác định của show · toàn kỳ"}</span><strong>{numbers.format(selected.lifetimePaidTickets)} vé</strong></div>
     <div><span>Bậc của vé đã trả gần nhất</span><strong>{lifetimeLast===null?"Chờ đối soát":lifetimeLast===0?"Chưa có vé":currentTier?percent(currentTier.rate):"Ngoài phạm vi chính sách"}</strong></div>
     <div><span>Bậc cho vé tiếp theo</span><strong>{nextTicket===null?"Chờ đối soát":nextTier?percent(nextTier.rate):"Chưa có bậc được cấu hình"}</strong>{nextTier&&nextTicket!==null?<small>Vé thứ {nextTicket}</small>:null}</div>
    </div>
    {nextTier&&nextTicket!==null?<p className={styles.progressText}>{currentTier&&currentTier!==nextTier?`Vé tiếp theo, thứ ${nextTicket}, bắt đầu bậc ${percent(nextTier.rate)}.`:futureTier&&futureStart!==null?`Bậc kế tiếp ${percent(futureTier.rate)} bắt đầu từ vé thứ ${futureStart}. Còn ${futureStart-nextTicket+1} vé đã thanh toán để đạt vé đầu tiên của bậc đó.`:`Chính sách hiện tại áp dụng đến vé thứ ${nextTier.maxTickets}.`}</p>:null}
    <ol className={styles.policy} aria-label="Các bậc hoa hồng của show">
     {policy.tiers.map((tier,index)=>{
      const previous=index===0?0:policy.tiers[index-1].maxTickets;
      const paid=lifetimeLast===null?null:Math.max(0,Math.min(lifetimeLast,tier.maxTickets)-previous);
      return <li key={tier.maxTickets} className={index===nextIndex?styles.nextBand:undefined}>
       <span>Vé {previous+1}–{tier.maxTickets}</span><strong>{percent(tier.rate)}</strong>
       <small>{paid===null?"Tiến độ chờ đối soát":`${paid} / ${tier.maxTickets-previous} vé đã trả`}</small>
       {index===nextIndex?<b>Áp dụng cho vé tiếp theo</b>:null}
      </li>;
     })}
    </ol>
    <p className={styles.note}>Tỷ lệ áp dụng cho phần tiền của vé thuộc từng bậc. Đơn nhiều ghế có thể được chia qua nhiều bậc. Vé mời, đơn giữ chỗ và đơn chưa thanh toán không tăng bậc. Số tiền là tạm tính để đối soát, chưa phải khoản đã chi trả.</p>
   </>:<p className={styles.warning}>Show này chưa có chính sách hoa hồng hợp lệ. Vui lòng chờ quản trị viên thiết lập trước khi chốt số tiền.</p>}

   {selected.commissionIssues.length?<details className={styles.issues}>
    <summary>{selected.commissionIssues.length} đơn cần đối soát</summary>
    <ul className={styles.issueList} tabIndex={0} aria-label="Các đơn cần đối soát hoa hồng">{selected.commissionIssues.map((issue,index)=><li key={issue.orderCode+":"+index}><strong>{issue.orderCode}</strong> · {issue.message}</li>)}</ul>
   </details>:null}

   <details key={groupKey(selected)} className={styles.details}>
    <summary>Xem phân bổ theo bậc và chi tiết đơn của show</summary>
    <h3>Phân bổ hoa hồng trong báo cáo</h3>
    {selected.bands.length?<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Phân bổ hoa hồng theo bậc">
     <table><thead><tr><th scope="col">Bậc vé</th><th scope="col">Tỷ lệ</th><th scope="col">Vé đã trả</th><th scope="col">Doanh số tính hoa hồng</th><th scope="col">Hoa hồng</th></tr></thead>
      <tbody>{selected.bands.map((band,index)=><tr key={band.fromTicket+":"+band.toTicket+":"+index}><th scope="row">Vé {ticketRange(band.fromTicket,band.toTicket)}</th><td>{percent(band.rate)}</td><td>{band.tickets}</td><td>{money(band.revenue)}</td><td>{money(band.commission)}</td></tr>)}</tbody>
     </table>
    </div>:<p className={styles.empty}>{groupComplete?"Chưa có vé đủ điều kiện tính hoa hồng trong báo cáo này.":"Chưa xác định được phần hoa hồng của các đơn đang chờ đối soát."}</p>}

    <h3>Đơn và cách chia qua từng bậc</h3>
    {report.rowsLimited?<p className={styles.note}>Chi tiết lấy tối đa 500 đơn gần nhất trong báo cáo. Tổng hoa hồng vẫn bao gồm toàn bộ phần đã xác định được trong bộ lọc.</p>:null}
    {visibleOrders.length?<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Chi tiết hoa hồng của từng đơn">
     <table className={styles.orders}><thead><tr><th scope="col">Đơn / ghế</th><th scope="col">Vé tính bậc</th><th scope="col">Giá trị đơn</th><th scope="col">Phân bổ hoa hồng</th><th scope="col">Hoa hồng tạm tính</th></tr></thead>
      <tbody>{visibleOrders.map(order=><tr key={order.order_code}>
       <th scope="row"><code>{order.order_code}</code><small>{order.seats.join(", ")||"—"}</small></th>
       <td>{order.paidTickets} vé đã trả{order.complimentaryTickets>0?<small>+ {order.complimentaryTickets} vé mời / miễn phí</small>:null}{order.firstTicket!==null&&order.lastTicket!==null?<small>Vé thứ {ticketRange(order.firstTicket,order.lastTicket)}</small>:null}</td>
       <td className={styles.amount}>{money(order.amount_vnd)}</td>
       <td>{order.commissionBands.length?<ul className={styles.split}>{order.commissionBands.map((band,index)=><li key={band.fromTicket+":"+index}><strong>{band.tickets} vé · {percent(band.rate)}</strong><span>{money(band.revenue)} → {money(band.commission)}</span></li>)}</ul>:<span>{order.isComplimentary?"Vé mời / miễn phí, không tính hoa hồng":order.commissionIssue?"Chờ đối soát":"Chưa có phần hoa hồng"}</span>}{order.commissionIssue?<small className={styles.orderIssue}>{order.commissionIssue}</small>:null}</td>
       <td className={styles.amount}>{money(order.commission)}{order.commissionIssue?<small>Phần đã xác định</small>:null}</td>
      </tr>)}</tbody>
     </table>
    </div>:<p className={styles.empty}>{report.rowsLimited&&selected.paidOrders>0?"Đơn của show này không nằm trong 500 đơn gần nhất đang hiển thị.":"Chưa có đơn của show này trong phần chi tiết báo cáo."}</p>}
    {pageCount>1?<nav className={styles.pagination} aria-label="Phân trang chi tiết hoa hồng"><button type="button" disabled={page===0} onClick={()=>setOrderPage(page-1)}>← Trước</button><span>Trang {page+1} / {pageCount}</span><button type="button" disabled={page+1>=pageCount} onClick={()=>setOrderPage(page+1)}>Sau →</button></nav>:null}
   </details>
  </>}
 </section>;
}

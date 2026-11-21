"use client";
import {useEffect,useState} from "react";
type Show={id:string;artist:string;date:string};
type Report={totals:{orders:number;tickets:number;revenue:number};byDay:{day:string;orders:number;tickets:number;revenue:number}[];summary:{showId:string;showName:string;revenue:number;tickets:number;orders:number}[]};
const money=(n:number)=>new Intl.NumberFormat("vi-VN").format(n)+" đ";
export default function AdminDetailedCharts({shows,overview}:{shows:Show[];overview:Report|null}){
 const [show,setShow]=useState("all"),[detail,setDetail]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 useEffect(()=>{if(show==="all"){setDetail(null);setError("");return}let active=true;setLoading(true);fetch("/api/staff/reports?show="+encodeURIComponent(show),{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được báo cáo");if(active){setDetail(d);setError("")}}).catch(e=>{if(active){setDetail(null);setError(e instanceof Error?e.message:"Lỗi báo cáo")}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[show]);
 const report=show==="all"?overview:detail;
 const days=[...(report?.byDay||[])].sort((a,b)=>a.day.localeCompare(b.day)).slice(-21);
 const max=Math.max(1,...days.map(d=>d.revenue));
 const total=report?.totals.revenue||0;
 return <article className="admin-report-panel extra-admin-detail"><div className="extra-admin-detail-head"><div><h3>Phân tích doanh thu chi tiết</h3><p className="admin-help">Dữ liệu đơn đã xác minh thanh toán. Chọn show để xem riêng doanh thu và vé.</p></div><label>Chương trình <select value={show} onChange={e=>setShow(e.target.value)}><option value="all">Tất cả show</option>{shows.map(s=><option key={s.id} value={s.id}>{s.artist} · {s.date}</option>)}</select></label></div>
 {loading&&<p>Đang tải biểu đồ...</p>}{error&&<p role="alert" className="notice">{error}</p>}
 {!loading&&report&&<><div className="extra-admin-detail-kpis"><div><span>Doanh thu</span><strong>{money(total)}</strong></div><div><span>Đơn thành công</span><strong>{report.totals.orders}</strong></div><div><span>Vé bán</span><strong>{report.totals.tickets}</strong></div></div><div className="extra-admin-detail-bars" role="img" aria-label="Biểu đồ doanh thu theo ngày">{days.length?days.map(d=><div key={d.day} className="extra-admin-detail-col" title={d.day+" · "+money(d.revenue)}><span>{d.revenue?Math.round(d.revenue/100000)/10+"tr":"0"}</span><div className="extra-admin-detail-bar-track"><i style={{height:Math.max(d.revenue?3:0,100*d.revenue/max)+"%"}}/></div><small>{d.day.slice(5)}</small></div>):<p className="admin-report-empty">Chưa có giao dịch cho bộ lọc này.</p>}</div><div className="extra-admin-detail-foot"><span>Doanh thu theo ngày (VNĐ)</span><span>{days.length} ngày có dữ liệu</span></div></>}
 </article>
}

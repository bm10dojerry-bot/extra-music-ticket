"use client";
import {useEffect,useState} from "react";
type Totals={sessions:number;viewing:number;selecting:number;payment:number;saleOnline:number;saleEnabled:number;heldOrders:number;heldSeats:number};
type Show={showId:string;artist:string;date:string;viewing:number;selecting:number;payment:number;heldOrders:number;heldSeats:number};
type Sale={id:string;name:string;lastSeen?:string;openLeads:number};
type Data={checkedAt:string;totals:Totals;shows:Show[];onlineSales:Sale[];partial:boolean;note:string};
export default function LiveMonitor(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let mounted=true;let current:AbortController|null=null;
  async function load(){
   current?.abort();const controller=new AbortController();current=controller;
   try{
    const res=await fetch("/api/admin/live-monitor",{cache:"no-store",signal:controller.signal});
    const d=await res.json();if(!res.ok)throw Error(d.error||"Không tải được dữ liệu");
    if(mounted){setData(d);setError("")}
   }catch(e){if(mounted&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Lỗi kết nối")}
   finally{if(mounted&&!controller.signal.aborted)setLoading(false)}
  }
  void load();const timer=window.setInterval(()=>void load(),10000);
  return()=>{mounted=false;window.clearInterval(timer);current?.abort()};
 },[]);
 const cards=[
  ["Phiên trực tuyến",data?.totals.sessions,"Phiên trình duyệt đang hoạt động"],
  ["Đang xem",data?.totals.viewing,"Xem trang web hoặc show"],
  ["Đang chọn ghế",data?.totals.selecting,"Đã chọn ít nhất một ghế"],
  ["Đang thanh toán",data?.totals.payment,"Đang ở bước thanh toán QR"],
  ["Ghế giữ chỗ",data?.totals.heldSeats,"Từ đơn còn thời hạn"],
  ["Sale trực tuyến",data?data.totals.saleOnline+" / "+data.totals.saleEnabled:undefined,"Đang mở cổng Sale"]
 ] as const;
 return <section className="admin-report-panel" style={{padding:22,margin:"18px 0"}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
   <div><h2 style={{margin:"0 0 8px"}}>Giám sát trực tuyến</h2><p className="admin-help">Tự cập nhật mỗi 10 giây · phiên không hoạt động sau 75 giây sẽ không còn được tính.</p></div>
   <span style={{fontSize:13,color:"#c1c5ce"}}>{data?"Cập nhật "+new Date(data.checkedAt).toLocaleTimeString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}):"Đang kết nối..."}</span>
  </div>
  {error&&<p role="alert" className="notice">{error}</p>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:12,margin:"18px 0"}}>
   {cards.map(([label,value,description])=><article key={label} style={{background:"#181d27",border:"1px solid #333947",borderRadius:12,padding:16}}>
    <div style={{fontSize:13,color:"#cad0dc"}}>{label}</div>
    <strong style={{display:"block",fontSize:29,margin:"8px 0",color:"#fff"}}>{value??(loading?"…":"—")}</strong>
    <small style={{color:"#aab2c3"}}>{description}</small>
   </article>)}
  </div>
  <h3>Theo từng show</h3>
  <div className="admin-report-table-wrap"><table><thead><tr><th>Show</th><th>Đang xem</th><th>Chọn ghế</th><th>Thanh toán</th><th>Ghế đang giữ</th></tr></thead><tbody>
   {(data?.shows||[]).map(s=><tr key={s.showId}><td>{s.artist}<small style={{display:"block",color:"#abb2c0"}}>{s.date}</small></td><td>{s.viewing}</td><td>{s.selecting}</td><td>{s.payment}</td><td>{s.heldSeats} ghế / {s.heldOrders} đơn</td></tr>)}
  </tbody></table></div>
  <h3 style={{margin:"22px 0 12px"}}>Sale đang trực tuyến ({data?.onlineSales.length??"—"})</h3>
  <div className="admin-report-table-wrap"><table><thead><tr><th>Nhân viên</th><th>Hoạt động gần nhất</th><th>Khách đang chăm sóc được ghi nhận</th></tr></thead><tbody>
   {(data?.onlineSales||[]).map(s=><tr key={s.id}><td>{s.name}</td><td>{s.lastSeen?new Date(s.lastSeen).toLocaleTimeString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}):"—"}</td><td>{s.openLeads}</td></tr>)}
  </tbody></table></div>
  {data?.onlineSales.length===0&&<p className="admin-help">Chưa có phiên Sale gửi tín hiệu trong 75 giây vừa qua.</p>}
  {data?.partial&&<p className="notice">Bản ghi đạt giới hạn tải, có thể thiếu dữ liệu ở một số bộ đếm.</p>}
  <p className="admin-help">{data?.note||"Chỉ hiển thị dữ liệu thực tế."} Hồ sơ khách đang chăm sóc không đồng nghĩa Sale đang thao tác với hồ sơ đó đúng thời điểm này.</p>
 </section>;
}

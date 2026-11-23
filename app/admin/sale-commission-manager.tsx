"use client";
import {useEffect,useState} from "react";
import {SALE_COMMISSION_BANDS,saleCommissionAmount,saleCommissionRate,type SaleCommissionSettings} from "../../lib/sale-commission";
type Settings=SaleCommissionSettings&{updated_at:string;updated_by:string};
type Key=keyof SaleCommissionSettings;
const money=(n:number)=>new Intl.NumberFormat("vi-VN").format(n)+" đ";
const toDraft=(s:SaleCommissionSettings):Record<Key,string>=>({
 rate_1_10:String(s.rate_1_10),rate_11_30:String(s.rate_11_30),
 rate_31_50:String(s.rate_31_50),rate_51_plus:String(s.rate_51_plus)
});
export default function SaleCommissionManager(){
 const [saved,setSaved]=useState<Settings|null>(null);
 const [draft,setDraft]=useState<Record<Key,string>>({rate_1_10:"",rate_11_30:"",rate_31_50:"",rate_51_plus:""});
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [exampleTickets,setExampleTickets]=useState(20);
 async function load(){
  setLoading(true);setError("");
  try{const r=await fetch("/api/admin/sale-commission",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được cấu hình.");
   setSaved(d.settings);setDraft(toDraft(d.settings))
  }catch(e){setError(e instanceof Error?e.message:"Không thể tải tỷ lệ thưởng.")}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 const value={} as SaleCommissionSettings;
 const valid=SALE_COMMISSION_BANDS.every(b=>{
  const s=draft[b.key].trim(),v=Number(s);
  if(s===""||!Number.isFinite(v)||v<0||v>100||Math.abs(v*100-Math.round(v*100))>0.000001)return false;
  value[b.key]=v;
  return true;
 });
 const dirty=!!saved&&SALE_COMMISSION_BANDS.some(b=>draft[b.key]!==String(saved[b.key]));
 async function save(){
  if(!saved||!valid||!dirty||saving)return;
  setSaving(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/admin/sale-commission",{method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...value,updated_at:saved.updated_at})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không lưu được tỷ lệ thưởng.");
   const verify=await fetch("/api/admin/sale-commission",{cache:"no-store"});const confirmed=await verify.json();
   if(!verify.ok||!confirmed.settings||SALE_COMMISSION_BANDS.some(b=>Number(confirmed.settings[b.key])!==value[b.key]))throw Error("Đã lưu nhưng chưa xác minh được tỷ lệ mới. Hãy tải lại.");
   setSaved(confirmed.settings);setDraft(toDraft(confirmed.settings));setNotice("Đã lưu và xác minh 4 tỷ lệ thưởng. Báo cáo Sale và Admin sẽ dùng mức mới khi tải lại.");
  }catch(e){setError(e instanceof Error?e.message:"Có lỗi khi lưu bảng thưởng.")}
  finally{setSaving(false)}
 }
 const sampleRevenue=10000000;
 return <section style={{maxWidth:1020,color:"#e9edf4"}}>
  <div style={{padding:"24px",border:"1px solid #333b49",background:"#151b26",borderRadius:16,marginBottom:16}}>
   <p style={{margin:0,color:"#f6b461",letterSpacing:2,fontSize:11,fontWeight:800}}>QUẢN LÝ NHÂN SỰ · EXTRA MUSIC SHOW</p>
   <h2 style={{fontSize:26,margin:"10px 0 8px"}}>Thưởng hiệu suất Sale</h2>
   <p style={{margin:0,color:"#aab4c3",lineHeight:1.7}}>Điều chỉnh phần trăm thưởng theo tổng số vé bán đã thanh toán của từng nhân viên. Mọi thay đổi được lưu vào cơ sở dữ liệu và áp dụng cho báo cáo thưởng tạm tính khi tải lại, không tự chi tiền thưởng.</p>
  </div>
  {error&&<p role="alert" style={{background:"#4e1823",border:"1px solid #ef8892",borderRadius:10,padding:14,color:"#ffe3e6"}}>{error}</p>}
  {notice&&<p role="status" style={{background:"#14372e",border:"1px solid #36896b",borderRadius:10,padding:14,color:"#dcfff3"}}>{notice}</p>}
  <div style={{background:"#151b26",border:"1px solid #333b49",borderRadius:16,padding:20}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:18}}>
    <h3 style={{fontSize:18,margin:0}}>Thiết lập % theo số vé</h3>
    <button type="button" onClick={()=>{setNotice("");void load()}} disabled={saving||loading} style={{borderRadius:8,padding:"9px 14px",color:"#e9edf4",background:"#282f3d",border:"1px solid #495264"}}>{loading?"Đang tải...":"↻ Tải lại"}</button>
   </div>
   {SALE_COMMISSION_BANDS.map(b=><label key={b.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"14px 0",borderBottom:"1px solid #303845",flexWrap:"wrap"}}>
    <span style={{fontWeight:700}}>{b.label}<small style={{display:"block",fontWeight:400,color:"#aeb8c8",marginTop:4}}>{b.minTickets===51?"Bậc thưởng cao nhất":"Số vé đã được thanh toán"}</small></span>
    <span style={{display:"flex",alignItems:"center",gap:9}}>
     <input aria-label={"Thưởng "+b.label} type="number" min={0} max={100} step="0.01" inputMode="decimal" disabled={loading||saving||!saved} value={draft[b.key]} onChange={e=>{setDraft(x=>({...x,[b.key]:e.target.value}));setNotice("")}} style={{width:112,background:"#0e1520",color:"#fff",border:"1px solid #64748b",borderRadius:8,padding:"11px 12px",fontSize:18,fontWeight:700,textAlign:"right"}}/>
     <span style={{fontWeight:700,color:"#ffbd76"}}>%</span>
    </span>
   </label>)}
   <p style={{fontSize:13,color:"#adb7c7",lineHeight:1.7,margin:"15px 0"}}>Bậc tính thưởng: 1–10, 11–30, 31–50, 51–550 vé; nếu tổng số vé ở nhiều show vượt 550, tiếp tục dùng bậc cuối. Tỷ lệ được tính trên toàn bộ doanh thu có xác minh theo bộ lọc báo cáo, không cộng dồn tỷ lệ giữa các bậc. Vé miễn phí, vé chờ thanh toán và đơn chưa gán Sale không được tính thưởng cho nhân viên.</p>
   <div style={{display:"flex",gap:10,justifyContent:"flex-end",alignItems:"center",flexWrap:"wrap"}}>
    <button type="button" disabled={!dirty||saving||loading} onClick={()=>{if(saved){setDraft(toDraft(saved));setError("");setNotice("")}}} style={{padding:"11px 18px",borderRadius:9,background:"#2b3340",border:"1px solid #495264",color:"#fff"}}>Hoàn tác</button>
    <button type="button" disabled={!valid||!dirty||saving||loading||!saved} onClick={()=>void save()} style={{padding:"12px 23px",borderRadius:9,background:"#e14c59",border:0,color:"white",fontWeight:800,opacity:!valid||!dirty||saving||loading||!saved?.6:1}}>{saving?"Đang lưu...":"Lưu thay đổi %"}</button>
   </div>
  </div>
  <div style={{background:"#151b26",border:"1px solid #333b49",borderRadius:16,padding:20,marginTop:16}}>
   <h3 style={{margin:"0 0 10px"}}>Xem thử tiền thưởng</h3>
   <p style={{fontSize:13,color:"#aeb8c8"}}>Ví dụ nhân viên bán vé có doanh thu đã xác minh là {money(sampleRevenue)}.</p>
   <label style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>Số vé bán
    <input type="number" min={0} max={10000} step={1} value={exampleTickets} onChange={e=>setExampleTickets(Math.max(0,Math.min(10000,Math.floor(Number(e.target.value)||0))))} style={{width:125,padding:10,border:"1px solid #64748b",borderRadius:8,background:"#0e1520",color:"#fff"}}/>
   </label>
   <p style={{fontSize:18,marginBottom:0}}>Tỷ lệ: <strong style={{color:"#ffbd76"}}>{valid?(saleCommissionRate(exampleTickets,value)*100).toLocaleString("vi-VN"):"—"}%</strong> · Thưởng tạm tính: <strong style={{color:"#86efac"}}>{valid?money(saleCommissionAmount(exampleTickets,sampleRevenue,value)):"—"}</strong></p>
  </div>
  {saved&&<p style={{fontSize:12,color:"#aab4c3",marginTop:14}}>Cập nhật gần nhất: {new Date(saved.updated_at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})} · {saved.updated_by}</p>}
 </section>;
}

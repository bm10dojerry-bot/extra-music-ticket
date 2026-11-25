"use client";
import {useState, type FormEvent} from "react";
import {prepareShow} from "../../../lib/marketing-show-intake";
import {planMarketing} from "../../../lib/marketing-director";
export default function ShowIntakeForm(){
 const [result,setResult]=useState<ReturnType<typeof prepareShow>|null>(null);
 const [tasks,setTasks]=useState<ReturnType<typeof planMarketing>>([]);
 const [error,setError]=useState("");
 function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError("");setResult(null);setTasks([]);
  try{
   const f=new FormData(e.currentTarget);
   const s=(k:string)=>String(f.get(k)||"");
   const n=(k:string)=>Number(s(k));
   const now=new Date();
   const input=prepareShow({artist:s("artist"),venue:s("venue"),startsAt:s("startsAt")+":00+07:00",capacity:n("capacity"),bookingVnd:n("bookingVnd"),adsVnd:n("adsVnd"),printingVnd:n("printingVnd"),otherVnd:n("otherVnd"),startingPriceVnd:n("startingPriceVnd"),targetProfitVnd:n("targetProfitVnd"),mediaDriveUrl:s("mediaDriveUrl"),setlist:s("setlist"),artistConfirmed:f.has("artistConfirmed"),mediaRightsConfirmed:f.has("mediaRightsConfirmed")},now);
   const planned=planMarketing({id:"preview",startsAt:input.startsAt,capacity:input.capacity,paidTickets:0},now);
   setResult(input);setTasks(planned);
  }catch{setError("Kiểm tra thông tin, ngày diễn, chi phí, xác nhận nghệ sĩ và đường dẫn Drive.");}
 }
 return <section><h2>Tạo show mới</h2><p>Bản thử nghiệm lập kế hoạch, chưa lưu show hoặc chạy quảng cáo.</p><form onSubmit={submit} style={{display:"grid",gap:12,maxWidth:650}}>
 {([["artist","Nghệ sĩ","text"],["venue","Địa điểm","text"],["startsAt","Ngày giờ diễn (Việt Nam)","datetime-local"],["mediaDriveUrl","Link Google Drive","url"]] as const).map(([key,label,type])=><label key={key}>{label}<input style={{display:"block",width:"100%"}} name={key} type={type} required/></label>)}
 {([["capacity","Sức chứa"],["bookingVnd","Booking (đ)"],["adsVnd","Quảng cáo (đ)"],["printingVnd","In ấn (đ)"],["otherVnd","Chi phí khác gồm thuế, hoa hồng dự kiến (đ)"],["startingPriceVnd","Giá vé khởi điểm (đ)"],["targetProfitVnd","Lợi nhuận mục tiêu (đ)"]] as const).map(([key,label])=><label key={key}>{label}<input style={{display:"block",width:"100%"}} name={key} type="number" min={key==="capacity"||key==="startingPriceVnd"?1:0} step="1" required/></label>)}
 <label>Danh sách bài hát<textarea name="setlist" required style={{display:"block",width:"100%"}}/></label>
 <label><input name="artistConfirmed" type="checkbox" required/> Đã xác nhận nghệ sĩ</label>
 <label><input name="mediaRightsConfirmed" type="checkbox" required/> Có quyền sử dụng media</label>
 <button type="submit">Khởi tạo kế hoạch AI</button></form>
 {error&&<p role="alert">{error}</p>}
 {result&&<section aria-live="polite"><h3>Kế hoạch thử nghiệm: {result.artist}</h3><p>Chi phí: {result.plannedCostVnd.toLocaleString("vi-VN")}đ</p><p>Doanh thu mục tiêu: {result.targetRevenueVnd.toLocaleString("vi-VN")}đ</p><p>Giá trung bình tối thiểu nếu bán hết: {result.minimumAverageAtFullCapacityVnd.toLocaleString("vi-VN")}đ</p><p>Chưa tính chi phí phát sinh ngoài dữ liệu nhập. Chưa xác minh quyền Drive.</p><ul>{tasks.map(t=><li key={t.id}>{t.agent}: {t.action}</li>)}</ul></section>}
 </section>
}

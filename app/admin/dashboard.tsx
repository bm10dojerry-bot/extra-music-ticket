"use client";
import {useEffect,useState} from "react";
import {mediaSlots} from "../../lib/media";
import {shows as defaultShows} from "../../lib/shows";
import {venues} from "../../lib/venues";
import {defaultShows as ticketDefaults} from "../../lib/show-data";
import type {ManagedShow} from "../../lib/show-data";
type FormShow={id:string;artist:string;title:string;date:string;time:string;venue:string;status:string;prices:Record<string,number|null>;posterUrl:string|null};
const toForm=(x:Partial<FormShow>):FormShow=>({id:x.id||"",artist:x.artist||"",title:x.title||"",date:x.date||"",time:x.time||"19:30",venue:x.venue||"moana",status:x.status||"announced",prices:{A:x.prices?.A??null,B:x.prices?.B??null,C:x.prices?.C??null,D:x.prices?.D??null},posterUrl:x.posterUrl||null});
export default function AdminMedia(){
 const secret="session";const [tab,setTab]=useState<"overview"|"shows"|"venues">("shows");const [showList,setShowList]=useState<FormShow[]>(ticketDefaults().map(toForm));const [form,setForm]=useState<FormShow>(toForm(ticketDefaults()[0]||{}));const [showBusy,setShowBusy]=useState(false);const [showReady,setShowReady]=useState(false);
 const [images,setImages]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const [selectedPoster,setSelectedPoster]=useState<File|null>(null);const [message,setMessage]=useState("");const [posterStatus,setPosterStatus]=useState("");const [posterPreview,setPosterPreview]=useState<string|null>(null);
 useEffect(()=>{fetch("/api/public/media",{cache:"no-store"}).then(r=>r.json()).then(d=>setImages(d.images||{})).catch(()=>{});void loadShowList(true)},[]);
 async function loadShowList(silent=false){try{const res=await fetch("/api/admin/shows",{headers:{},cache:"no-store"});const data=await res.json();if(!res.ok)throw Error(data.error||"Không tải được danh sách.");const managed=data.shows as (ManagedShow&{rawStatus?:string})[];const known=new Map(managed.map(x=>[x.id,toForm({...x,status:x.rawStatus||x.status})]));const merged=[...ticketDefaults().map(x=>known.get(x.id)||toForm(x)),...managed.filter(x=>!defaultShows.some(d=>d.id===x.id)).map(x=>toForm({...x,status:x.rawStatus||x.status}))];setShowList(merged);setShowReady(true);setForm(current=>merged.find(x=>x.id===current.id)||current);if(!silent)setMessage("Đã tải danh sách show.");}catch(e){if(!silent)setMessage(e instanceof Error?e.message:"Không tải được dữ liệu.")}}
async function saveShow(){
 if(!form.id){setMessage("Hãy nhập mã show.");return}
 setShowBusy(true);setMessage("");setPosterStatus("⏳ Đang lưu thông tin show...");
 try{
  const res=await fetch("/api/admin/shows",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
  const data=await res.json();if(!res.ok)throw Error(data.error||"Không lưu được thông tin show.");
  if(selectedPoster){
   setPosterStatus("⏳ Đã lưu thông tin. Đang upload poster...");
   const body=new FormData();body.append("showId",form.id);body.append("file",selectedPoster);
   const upload=await fetch("/api/admin/show-poster",{method:"POST",body});
   const result=await upload.json();if(!upload.ok)throw Error(result.error||"Không lưu được poster.");
  }
  setPosterStatus("⏳ Đang xác minh dữ liệu đã lưu...");
  const verify=await fetch("/api/admin/shows",{cache:"no-store"});
  const verified=await verify.json();if(!verify.ok)throw Error(verified.error||"Không thể xác minh dữ liệu.");
  const stored=(verified.shows as ManagedShow[]).find(x=>x.id===form.id);
  if(!stored)throw Error("Chưa tìm thấy show trong dữ liệu đã lưu.");
  if(selectedPoster&&!stored.posterUrl)throw Error("Chưa tìm thấy poster đã lưu. Vui lòng thử lại.");
  setForm(toForm({...stored,status:stored.status}));
  setSelectedPoster(null);setPosterPreview(null);
  setPosterStatus("✅ Đã lưu và đăng show thành công! Đang mở trang chủ...");
  setMessage("✅ Đã lưu thông tin và poster thành công.");
  window.setTimeout(()=>window.location.assign("/"),1800);
 }catch(e){const msg=e instanceof Error?e.message:"Có lỗi khi lưu show.";setPosterStatus("❌ "+msg);setMessage(msg)}
 finally{setShowBusy(false)}
}
function selectPoster(file:File|undefined){
 if(!file)return;
 if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024||file.size===0){setPosterStatus("❌ Chỉ chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.");return}
 setSelectedPoster(file);setPosterPreview(URL.createObjectURL(file));setPosterStatus("✓ Đã chọn ảnh. Bấm Lưu & Đăng lên trang chủ để tải ảnh cùng thông tin show.");setMessage("");
}
async function upload(slot:string,file:File|undefined){
 if(!file)return;
 if(!secret){setMessage("Nhập mật khẩu quản trị trước khi tải ảnh.");return}
 setBusy(slot);setMessage("");
 try{
 const body=new FormData();body.append("slot",slot);body.append("file",file);
 const res=await fetch("/api/admin/media",{method:"POST",headers:{},body});
 const data=await res.json();
 if(!res.ok)throw Error(data.error||"Không thể tải ảnh.");
 setImages(old=>({...old,[slot]:data.url}));setMessage("Đã lưu ảnh thành công. Website sẽ tự hiển thị ảnh mới.");
 }catch(e){setMessage(e instanceof Error?e.message:"Có lỗi xảy ra.");}finally{setBusy(null)}
 }
 return <main className="admin-page"><a href="/" className="logo">+1 <span>EXTRA</span> MUSIC</a><div className="admin-heading"><div className="admin-heading-top"><h1>Quản trị Extra Music Show</h1><a className="admin-logout" href="/staff">Trung tâm nhân sự</a></div><p>Quản lý lịch diễn, poster ca sĩ, địa điểm và bảng giá từng show.</p></div><div className="admin-tabs"><button type="button" className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Tổng quan</button><button type="button" className={tab==="shows"?"active":""} onClick={()=>setTab("shows")}>Quản lý show</button><button type="button" className={tab==="venues"?"active":""} onClick={()=>setTab("venues")}>Ảnh sân khấu</button></div>{message&&<p role="status" className="notice">{message}</p>}{tab==="overview"?<section className="admin-overview"><h2>Trung tâm quản trị</h2><p>Quản lý nội dung chương trình và hình ảnh trực tiếp trên website.</p><div className="admin-overview-cards"><button type="button" onClick={()=>setTab("shows")}>Quản lý show · Lịch diễn, poster, giá vé →</button><button type="button" onClick={()=>setTab("venues")}>Ảnh sân khấu · Moana, CCC, Lào Cai →</button></div></section>:tab==="venues"?<div className="admin-media-grid">{mediaSlots.map(item=><section className="admin-media-card" key={item.id}><h2>{item.name}</h2><div className="admin-media-preview">{images[item.id]?<img src={images[item.id]} alt={item.name}/>:<span>Chưa có ảnh tải từ Admin. Website dùng ảnh mặc định.</span>}</div><label className="admin-upload"> {busy===item.id?"Đang tải ảnh...":"Chọn ảnh mới (JPG, PNG, WebP · tối đa 5 MB)"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy} onChange={e=>{void upload(item.id,e.target.files?.[0]);e.target.value=""}}/></label></section>)}</div>:<div className="admin-show-layout"><section className="admin-show-list"><div className="admin-list-top"><h2>Danh sách show</h2><button type="button" onClick={()=>{setForm(toForm({}));setPosterPreview(null);setSelectedPoster(null);setPosterStatus("");setMessage("")}}>+ Thêm show</button></div><button type="button" className="admin-refresh" onClick={()=>void loadShowList()}>Tải danh sách từ Supabase</button>{showList.map(x=><button type="button" className={"admin-show-item "+(form.id===x.id?"active":"")} key={x.id} onClick={()=>{setForm(toForm(x));setPosterPreview(null);setMessage("")}}><strong>{x.artist}</strong><small>{x.date} · {venues.find(v=>v.id===x.venue)?.name}</small></button>)}{!showReady&&<p className="admin-help">Danh sách ban đầu là lịch mẫu. Bấm tải danh sách để lấy dữ liệu đã lưu.</p>}</section><section className="admin-show-editor"><h2>{form.id?"Chỉnh sửa show: "+form.artist:"Tạo show mới"}</h2><p className="admin-help">Điền thông tin và chọn poster, sau đó bấm Lưu & Đăng lên trang chủ.</p><div className="admin-fields"><label>Mã show (không dấu, không khoảng trắng)<input value={form.id} disabled={showList.some(x=>x.id===form.id)&&showReady} onChange={e=>setForm(f=>({...f,id:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"")}))} placeholder="vd: ca-si-2027"/></label><label>Ca sĩ / nhóm nhạc<input value={form.artist} onChange={e=>setForm(f=>({...f,artist:e.target.value}))} placeholder="Tên ca sĩ"/></label><label>Tên chương trình<input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label><label>Ngày biểu diễn<input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></label><label>Giờ bắt đầu<input type="time" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))}/></label><label>Địa điểm<select value={form.venue} onChange={e=>setForm(f=>({...f,venue:e.target.value}))}>{venues.map(v=><option value={v.id} key={v.id}>{v.name}</option>)}</select></label><label>Trạng thái<select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option value="announced">Đang mở giới thiệu</option><option value="pending">Chờ xác nhận</option><option value="sold_out">Hết vé (thủ công)</option><option value="hidden">Ẩn khỏi website</option><option value="live">Đang diễn ra</option><option value="ended">Đã kết thúc</option></select></label></div><h3>Giá vé từng hạng (VNĐ)</h3><p className="admin-help">Để trống hạng chưa có giá. Giá 0đ chỉ dành cho vé miễn phí.</p><div className="admin-price-grid">{(["A","B","C","D"] as const).map(z=><label key={z}>Hạng {z}<input type="number" min="0" step="1000" placeholder="Chưa có giá" value={form.prices[z]??""} onChange={e=>setForm(f=>({...f,prices:{...f.prices,[z]:e.target.value===""?null:Number(e.target.value)}}))}/></label>)}</div><h3>Poster ca sĩ</h3>{posterStatus&&<p role="status" aria-live="polite" style={{padding:"12px",border:"1px solid currentColor",borderRadius:8,fontWeight:700,overflowWrap:"anywhere"}}>{posterStatus}</p>}<div className="admin-poster-preview">{(posterPreview||form.posterUrl)?<img src={posterPreview||form.posterUrl||""} alt={"Poster "+form.artist} style={{maxWidth:"100%",maxHeight:320,objectFit:"contain"}}/>:<span>Chưa có poster</span>}</div>{posterPreview&&!form.posterUrl&&<p className="admin-help">Ảnh đang chọn, chưa đăng lên trang chủ.</p>}{form.posterUrl&&<p className="admin-help"><a href={form.posterUrl} target="_blank" rel="noopener noreferrer">Xem ảnh đã lưu trên Supabase ↗</a></p>}<div style={{width:270,maxWidth:"100%",display:"flex",justifyContent:"center"}}><label className="admin-upload" style={{display:"inline-block",width:"auto",minWidth:116,padding:"10px 16px",marginTop:12}}>{showBusy?"⏳ Đang xử lý...":"📤 Chọn ảnh"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={showBusy} onChange={e=>{selectPoster(e.target.files?.[0]);e.target.value=""}}/></label></div><button type="button" className="admin-save" disabled={showBusy} onClick={()=>void saveShow()} style={{marginTop:18}}>{showBusy?"Đang lưu & đăng...":"Lưu & Đăng lên trang chủ"}</button><p className="admin-help">Sau khi chọn ảnh, bấm Lưu & Đăng lên trang chủ để cập nhật tất cả.</p></section></div>}<p className="admin-help">Chỉ tài khoản đã đăng nhập mới có quyền cập nhật thông tin.</p></main>
}

"use client";
import {useEffect,useState} from "react";
import {mediaSlots} from "../../lib/media";
export default function AdminMedia(){
 const [secret,setSecret]=useState("");
 const [images,setImages]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const [message,setMessage]=useState("");
 useEffect(()=>{fetch("/api/public/media",{cache:"no-store"}).then(r=>r.json()).then(d=>setImages(d.images||{})).catch(()=>{})},[]);
 async function upload(slot:string,file:File|undefined){
 if(!file)return;
 if(!secret){setMessage("Nhập mật khẩu quản trị trước khi tải ảnh.");return}
 setBusy(slot);setMessage("");
 try{
 const body=new FormData();body.append("slot",slot);body.append("file",file);
 const res=await fetch("/api/admin/media",{method:"POST",headers:{"x-admin-secret":secret},body});
 const data=await res.json();
 if(!res.ok)throw Error(data.error||"Không thể tải ảnh.");
 setImages(old=>({...old,[slot]:data.url}));setMessage("Đã lưu ảnh thành công. Website sẽ tự hiển thị ảnh mới.");
 }catch(e){setMessage(e instanceof Error?e.message:"Có lỗi xảy ra.");}finally{setBusy(null)}
 }
 return <main className="admin-page"><a href="/" className="logo">+1 <span>EXTRA</span> MUSIC</a><div className="admin-heading"><h1>Quản lý hình ảnh</h1><p>Thay ảnh sân khấu trực tiếp, không cần tải lên GitHub.</p></div><div className="admin-password"><label htmlFor="admin-password">Mật khẩu quản trị</label><input id="admin-password" type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Nhập mật khẩu quản trị"/></div>{message&&<p role="status" className="notice">{message}</p>}<div className="admin-media-grid">{mediaSlots.map(item=><section className="admin-media-card" key={item.id}><h2>{item.name}</h2><div className="admin-media-preview">{images[item.id]?<img src={images[item.id]} alt={item.name}/>:<span>Chưa có ảnh tải từ Admin. Website dùng ảnh mặc định.</span>}</div><label className="admin-upload"> {busy===item.id?"Đang tải ảnh...":"Chọn ảnh mới (JPG, PNG, WebP · tối đa 5 MB)"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy} onChange={e=>{void upload(item.id,e.target.files?.[0]);e.target.value=""}}/></label></section>)}</div><p className="admin-help">Ảnh chỉ được cập nhật khi nhập đúng mật khẩu. Mật khẩu không được lưu trong trình duyệt.</p></main>
}

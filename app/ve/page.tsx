"use client";
import {useEffect,useState} from "react";
import QRCode from "qrcode";
type Ticket={id:string;seat:string;checkedIn:boolean;qrValue:string};
type Data={code:string;showId:string;buyerName:string;amount:number;tickets:Ticket[]};
export default function TicketsPage(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[images,setImages]=useState<Record<string,string>>({});
 useEffect(()=>{const q=new URLSearchParams(window.location.search);const code=q.get("code"),token=q.get("token");if(!code||!token){setError("Thiếu mã đơn hoặc mã bảo mật");return}
 fetch("/api/tickets?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(token),{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được vé");return d as Data}).then(async d=>{setData(d);const entries=await Promise.all(d.tickets.map(async t=>[t.id,await QRCode.toDataURL(t.qrValue,{width:320,margin:2,errorCorrectionLevel:"M"})] as const));setImages(Object.fromEntries(entries))}).catch(e=>setError(e instanceof Error?e.message:"Không tải được vé"))},[]);
 return <main style={{minHeight:"100vh",background:"radial-gradient(ellipse at 50% 0%,#3a3020 0%,#101114 48%,#08090b 100%)",color:"#f8f4e9",padding:"32px 16px 70px",fontFamily:"Arial,sans-serif"}}>
 <div style={{maxWidth:640,margin:"auto"}}>
 <header style={{textAlign:"center",marginBottom:32}}><a href="/" style={{color:"#e6c78a",textDecoration:"none",fontWeight:900,letterSpacing:4,fontSize:22}}>+1 EXTRA</a><div style={{fontSize:11,letterSpacing:5,color:"#bda77f",marginTop:8}}>MUSIC SHOW · E-TICKET</div></header>
 <div style={{textAlign:"center",marginBottom:26}}><div style={{color:"#d8bb82",fontSize:12,letterSpacing:3}}>CHÀO MỪNG BẠN ĐẾN VỚI EXTRA</div><h1 style={{fontSize:"clamp(26px,6vw,38px)",margin:"12px 0"}}>Tấm vé cho một đêm đáng nhớ</h1><p style={{color:"#c6c0b5",lineHeight:1.7}}>Cảm ơn bạn đã chọn đồng hành cùng +1 EXTRA MUSIC SHOW.</p></div>
 {error&&<div role="alert" style={{padding:20,background:"#382024",borderRadius:12}}>{error}</div>}
 {!data&&!error&&<p style={{textAlign:"center"}}>Đang chuẩn bị vé của bạn...</p>}
 {data&&<><div style={{textAlign:"center",marginBottom:22,color:"#d4c4a6"}}>Khách mời: <strong style={{color:"#fff"}}>{data.buyerName}</strong><div style={{fontSize:12,marginTop:8}}>Mã đơn {data.code}</div></div>
 <div style={{display:"grid",gap:24}}>{data.tickets.map((t,i)=><section key={t.id} style={{border:"1px solid #8c744b",borderRadius:22,overflow:"hidden",background:"#161719",boxShadow:"0 20px 50px #0007"}}>
 <div style={{background:"linear-gradient(135deg,#41331e,#161719 70%)",padding:"30px 24px 25px",textAlign:"center",borderBottom:"1px dashed #806b4c"}}>
 <div style={{fontSize:11,color:"#e8c98e",letterSpacing:4}}>VÉ ĐIỆN TỬ · +1 EXTRA MUSIC SHOW</div>
 <div style={{fontSize:28,fontWeight:800,marginTop:15,letterSpacing:1}}>ĐÊM NHẠC CỦA BẠN</div>
 <div style={{fontSize:13,color:"#cbb891",marginTop:10}}>Mã chương trình: {data.showId}</div>
 </div>
 <div style={{padding:"26px 24px",textAlign:"center"}}>
 <div style={{display:"flex",justifyContent:"space-around",gap:12,marginBottom:24}}>
 <div><div style={{fontSize:11,color:"#b4a68c",letterSpacing:2}}>HẠNG VÉ</div><strong style={{fontSize:24,color:"#f1d59a"}}>{t.seat.split(/[-0-9]/)[0]||"EXTRA"}</strong></div>
 <div><div style={{fontSize:11,color:"#b4a68c",letterSpacing:2}}>SỐ GHẾ</div><strong style={{fontSize:24,color:"#fff"}}>{t.seat}</strong></div>
 </div>
 <div style={{display:"inline-block",padding:12,background:"#fff",borderRadius:14}}>{images[t.id]?<img alt={"Mã QR vé ghế "+t.seat} src={images[t.id]} width={228} height={228} style={{display:"block",maxWidth:"100%"}}/>:<div style={{width:228,height:228,color:"#333",display:"grid",placeItems:"center"}}>Đang tạo QR...</div>}</div>
 <p style={{fontSize:12,color:"#cfc4ae",marginTop:18}}>Xuất trình mã QR này tại cổng check-in</p>
 <div style={{marginTop:20,padding:"11px 15px",borderRadius:30,display:"inline-block",background:t.checkedIn?"#493020":"#27372c",color:t.checkedIn?"#ffcf9a":"#b8e8c0",fontSize:13,fontWeight:700}}>{t.checkedIn?"ĐÃ CHECK-IN":"✓ VÉ CHƯA SỬ DỤNG"}</div>
 </div>
 <div style={{background:"#23211d",padding:"18px 22px",textAlign:"center",fontSize:13,color:"#e0cba5",lineHeight:1.7}}>Âm nhạc sẽ hay hơn khi có bạn ở đó. Hẹn gặp bạn tại EXTRA!<div style={{fontSize:11,color:"#9c907a",marginTop:6}}>Vé {i+1}/{data.tickets.length} · Mỗi QR chỉ dùng check-in một lần</div></div>
 </section>)}</div>
 <p style={{textAlign:"center",color:"#aaa397",fontSize:12,lineHeight:1.7,marginTop:28}}>Hãy giữ kín liên kết vé này. Không chia sẻ QR với người khác.<br/>Lưu trang vé để xuất trình khi đến sự kiện.</p>
 </>}
 </div></main>
}
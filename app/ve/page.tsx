"use client";
import {useEffect,useState} from "react";
import QRCode from "qrcode";
type Ticket={id:string;seat:string;zone:string|null;checkedIn:boolean;qrValue:string};
type Data={code:string;showId:string;showTitle:string;artist:string|null;showDate:string|null;showTime:string|null;venueName:string|null;venueAddress:string|null;buyerName:string;isVipInvitation?:boolean;amount:number;tickets:Ticket[]};
export default function TicketsPage(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[images,setImages]=useState<Record<string,string>>({});
 useEffect(()=>{const q=new URLSearchParams(window.location.search);const code=q.get("code"),token=q.get("token");if(!code||!token){setError("Thiếu mã đơn hoặc mã bảo mật");return}
 fetch("/api/tickets?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(token),{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được vé");return d as Data}).then(async d=>{setData(d);const entries=await Promise.all(d.tickets.map(async t=>[t.id,await QRCode.toDataURL(t.qrValue,{width:320,margin:2,errorCorrectionLevel:"M"})] as const));setImages(Object.fromEntries(entries))}).catch(e=>setError(e instanceof Error?e.message:"Không tải được vé"))},[]);
 return <main style={{minHeight:"100vh",background:"radial-gradient(ellipse at 50% 0%,#3a1924 0%,#101114 48%,#08090b 100%)",color:"#f8f4e9",padding:"32px 16px 70px",fontFamily:"Arial,sans-serif"}}>
 <div style={{maxWidth:640,margin:"auto"}}>
 <header style={{textAlign:"center",marginBottom:32}}><a href="/" style={{color:"#ff5260",textDecoration:"none",fontWeight:900,letterSpacing:4,fontSize:22}}>+1 EXTRA</a><div style={{fontSize:11,letterSpacing:5,color:"#ffffff",marginTop:8}}>MUSIC SHOW · E-TICKET</div></header>
 <div style={{textAlign:"center",marginBottom:26}}><div style={{color:"#ff6878",fontSize:12,letterSpacing:3}}>CHÀO MỪNG BẠN ĐẾN VỚI EXTRA</div><h1 style={{fontSize:"clamp(26px,6vw,38px)",margin:"12px 0"}}>{data?.isVipInvitation?"THƯ MỜI VIP · +1 EXTRA":"Tấm vé cho một đêm đáng nhớ"}</h1><p style={{color:"#c6c0b5",lineHeight:1.7}}>{data?.isVipInvitation?"Trân trọng kính mời bạn tham dự +1 EXTRA MUSIC SHOW.":"Cảm ơn bạn đã chọn đồng hành cùng +1 EXTRA MUSIC SHOW."}</p></div>
 {error&&<div role="alert" style={{padding:20,background:"#382024",borderRadius:12}}>{error}</div>}
 {!data&&!error&&<p style={{textAlign:"center"}}>Đang chuẩn bị vé của bạn...</p>}
 {data&&<><div style={{textAlign:"center",marginBottom:22,color:"#d4c4c7"}}>Mã đơn <strong style={{color:"#fff"}}>{data.code}</strong></div>
 <div style={{display:"grid",gap:24}}>{data.tickets.map((t,i)=><section key={t.id} style={{border:"1px solid #65343d",borderRadius:22,overflow:"hidden",background:"#161719",boxShadow:"0 20px 50px #0007"}}>
 <div style={{textAlign:"center",padding:"18px 20px 0",color:"#d4c4c7",fontSize:14}}>{data.isVipInvitation?"Khách mời VIP":t.zone==="A"||t.zone==="B"?"The VIP":"Khách hàng"}: <strong style={{color:"#fff"}}>{data.buyerName}</strong></div>
 <div style={{background:"linear-gradient(135deg,#481b27,#161719 70%)",padding:"30px 24px 25px",textAlign:"center",borderBottom:"1px dashed #806b4c"}}>
 <div style={{fontSize:11,color:"#ff8995",letterSpacing:4}}>{data.isVipInvitation?"VÉ MỜI VIP · +1 EXTRA MUSIC SHOW":"VÉ ĐIỆN TỬ · +1 EXTRA MUSIC SHOW"}</div>
 <div style={{fontSize:28,fontWeight:800,marginTop:15,letterSpacing:1}}>{data.artist||"+1 EXTRA MUSIC SHOW"}</div>
 <div style={{fontSize:13,color:"#ffc3c9",marginTop:10}}>{data.showTitle}</div>
 </div>
 <div style={{padding:"26px 24px",textAlign:"center"}}>
 <div style={{marginBottom:22,lineHeight:1.7,color:"#eee",fontSize:14}}>{data.showDate&&<div>📅 {data.showDate.split("-").reverse().join("/")} · {data.showTime||"Theo lịch chương trình"}</div>}{data.venueName&&<div>📍 {data.venueName}</div>}{data.venueAddress&&<div style={{color:"#c9b3b8",fontSize:12}}>{data.venueAddress}</div>}</div><div style={{display:"flex",justifyContent:"space-around",gap:12,marginBottom:24}}>
 <div><div style={{fontSize:11,color:"#c4a4aa",letterSpacing:2}}>DÃY GHẾ</div><strong style={{fontSize:24,color:"#ff8995"}}>{t.seat.replace(/[0-9]/g,"")||"EXTRA"}</strong></div>
 <div><div style={{fontSize:11,color:"#c4a4aa",letterSpacing:2}}>SỐ GHẾ</div><strong style={{fontSize:24,color:"#fff"}}>{t.seat}</strong></div>
 </div>
 <div style={{display:"inline-block",padding:12,background:"#fff",borderRadius:14}}>{images[t.id]?<img alt={"Mã QR vé ghế "+t.seat} src={images[t.id]} width={228} height={228} style={{display:"block",maxWidth:"100%"}}/>:<div style={{width:228,height:228,color:"#333",display:"grid",placeItems:"center"}}>Đang tạo QR...</div>}</div>
 <p style={{fontSize:12,color:"#d7bfc2",marginTop:18}}>Xuất trình mã QR này tại cổng check-in</p>{data.venueAddress&&<a href={"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(data.venueName+" "+data.venueAddress)} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",marginTop:10,padding:"12px 20px",borderRadius:10,background:"#ed2839",color:"#fff",fontWeight:700,textDecoration:"none",fontSize:14}}>📍 Chỉ đường đến địa điểm biểu diễn</a>}
 <div style={{marginTop:20,padding:"11px 15px",borderRadius:30,display:"inline-block",background:t.checkedIn?"#493020":"#27372c",color:t.checkedIn?"#ffcf9a":"#b8e8c0",fontSize:13,fontWeight:700}}>{t.checkedIn?"ĐÃ CHECK-IN":"✓ VÉ CHƯA SỬ DỤNG"}</div>
 </div>
 <div style={{background:"#281b22",padding:"18px 22px",textAlign:"center",fontSize:13,color:"#f5c7ce",lineHeight:1.7}}>Âm nhạc sẽ hay hơn khi có bạn ở đó. Hẹn gặp bạn tại EXTRA!<div style={{fontSize:11,color:"#a98f95",marginTop:6}}>Vé {i+1}/{data.tickets.length} · Mỗi QR chỉ dùng check-in một lần</div></div>
 </section>)}</div>
 <p style={{textAlign:"center",color:"#aaa397",fontSize:12,lineHeight:1.7,marginTop:28}}>Hãy giữ kín liên kết vé này. Không chia sẻ QR với người khác.<br/>Lưu trang vé để xuất trình khi đến sự kiện.</p>
 </>}
 </div></main>
}
"use client";
import {useEffect,useRef,useState} from "react";
type Scanner={detect:(v:HTMLVideoElement)=>Promise<{rawValue:string}[]>};
export default function CheckinPage(){
 const [value,setValue]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[camera,setCamera]=useState(false);
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null);
 useEffect(()=>{const q=new URLSearchParams(window.location.search);if(q.has("ticket")&&q.has("secret"))setValue(window.location.href)},[]);
 useEffect(()=>{if(!camera)return;let alive=true;let detector:Scanner|null=null;let timer:ReturnType<typeof setInterval>|undefined;
 const start=async()=>{try{
 const w=window as unknown as {BarcodeDetector?:new(o:{formats:string[]})=>Scanner};
 if(!w.BarcodeDetector)throw Error("Trình duyệt không hỗ trợ quét QR trực tiếp. Hãy dùng Chrome trên điện thoại hoặc dán mã vé.");
 detector=new w.BarcodeDetector({formats:["qr_code"]});
 const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});if(!alive){s.getTracks().forEach(t=>t.stop());return}stream.current=s;if(video.current){video.current.srcObject=s;await video.current.play()}
 timer=setInterval(async()=>{if(!detector||!video.current||video.current.readyState<2)return;try{const found=await detector.detect(video.current);if(found[0]?.rawValue){setValue(found[0].rawValue);setCamera(false)}}catch{}},650);
 }catch(e){setMessage(e instanceof Error?e.message:"Không mở được camera");setCamera(false)}};
 void start();return()=>{alive=false;if(timer)clearInterval(timer);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}},[camera]);
 async function checkin(){setBusy(true);setMessage("");try{const u=new URL(value,window.location.origin);if(u.protocol!=="https:"||!["iextra.net","checkin.iextra.net"].includes(u.hostname)||u.pathname!=="/checkin")throw Error("Mã vé không thuộc hệ thống Extra Music Show");const ticket=u.searchParams.get("ticket"),secret=u.searchParams.get("secret");if(!ticket||!secret)throw Error("Mã vé không hợp lệ");const r=await fetch("/api/staff/checkin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket,secret})});const d=await r.json();setMessage(d.result==="checked_in"?"✅ CHECK-IN THÀNH CÔNG":d.result==="already_used"?"⛔ VÉ ĐÃ SỬ DỤNG":d.error||"⛔ Vé không hợp lệ");if(d.result==="checked_in")setValue("")}catch(e){setMessage(e instanceof Error?e.message:"Lỗi check-in")}finally{setBusy(false)}}
 return <main style={{minHeight:"100vh",background:"#0e1015",color:"white",fontFamily:"Arial,sans-serif",padding:24}}><div style={{maxWidth:560,margin:"auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><a href="https://iextra.net" style={{color:"#f87171"}}>+1 EXTRA MUSIC</a><form action="/api/staff/logout" method="post"><button type="submit" style={{padding:8}}>Đăng xuất</button></form></div><h1>Quét QR check-in</h1><p>Nhân viên đã đăng nhập với quyền soát vé. Mỗi vé chỉ quét thành công một lần.</p><button onClick={()=>setCamera(!camera)} style={{padding:12,background:"#be343b",color:"white",border:0,borderRadius:6}}>{camera?"Tắt camera":"Mở camera quét QR"}</button>{camera&&<video ref={video} playsInline muted style={{width:"100%",marginTop:16}}/>}<p>Hoặc dán đường dẫn QR vé:</p><textarea value={value} onChange={e=>setValue(e.target.value)} rows={3} style={{width:"100%",padding:12,boxSizing:"border-box"}}/><button disabled={busy||!value.trim()} onClick={()=>void checkin()} style={{marginTop:12,padding:14,background:"#be343b",color:"white",border:0,borderRadius:6}}>{busy?"Đang xác minh...":"XÁC NHẬN CHECK-IN"}</button>{message&&<h2 role="status">{message}</h2>}</div></main>
}

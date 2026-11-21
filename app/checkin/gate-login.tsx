"use client";
import {useState} from "react";
export default function GateLogin(){
 const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{
 const res=await fetch("/api/staff/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
 const data=await res.json();if(!res.ok)throw Error(data.error||"Không đăng nhập được");
 if(!["admin","show_manager","sale","checkin"].includes(data.role))throw Error("Tài khoản này không có quyền soát vé.");
 window.location.assign("/");
 }catch(e){setError(e instanceof Error?e.message:"Lỗi đăng nhập")}finally{setBusy(false)}}
 return <main style={{background:"#0c0e14",color:"white",minHeight:"100vh",padding:"40px 18px",fontFamily:"Arial,sans-serif"}}><section style={{maxWidth:440,margin:"auto",padding:28,background:"#1a1d25",border:"1px solid #41444e",borderRadius:18}}>
 <a href="/" style={{color:"#ff7474",textDecoration:"none",fontWeight:800}}>+1 EXTRA MUSIC SHOW</a><p style={{fontSize:12,letterSpacing:2,color:"#c3a1a1"}}>BỘ PHẬN SOÁT VÉ</p><h1>Đăng nhập check-in</h1><p style={{color:"#bbb"}}>Dành riêng cho nhân viên kiểm soát vé tại cổng.</p>
 <form onSubmit={login} style={{display:"grid",gap:12}}><label htmlFor="gate-user">Tên đăng nhập</label><input id="gate-user" autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)} style={{padding:14,borderRadius:8}}/><label htmlFor="gate-password">Mật khẩu</label><input id="gate-password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} style={{padding:14,borderRadius:8}}/><button disabled={busy} type="submit" style={{padding:16,background:"#c43c44",color:"white",border:0,borderRadius:9,fontWeight:800,cursor:"pointer"}}>{busy?"Đang đăng nhập...":"ĐĂNG NHẬP SOÁT VÉ"}</button></form>
 {error&&<p role="alert" style={{color:"#ff9898"}}>{error}</p>}<p style={{fontSize:12,color:"#aaa"}}>Liên hệ quản trị viên để được cấp tài khoản.</p></section></main>;
}

"use client";
import {useState} from "react";
export default function ResetPassword(){
 const [email,setEmail]=useState(""),[code,setCode]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState("");
 const [requested,setRequested]=useState(false),[complete,setComplete]=useState(false),[show,setShow]=useState(false),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""),[error,setError]=useState("");
 const params=typeof window==="undefined"?new URLSearchParams():new URLSearchParams(window.location.search);
 const token=params.get("token");
 const section=params.get("from")||"staff";
 const loginHref=section==="sale"?"https://sale.iextra.net":section==="checkin"?"https://checkin.iextra.net":section==="admin"?"https://admin.iextra.net":"https://iextra.net/staff";
 const loginLabel=section==="sale"?"Sale":section==="checkin"?"Check-in":section==="admin"?"Admin":"Nhân viên";
 async function requestCode(e?:React.FormEvent){
  e?.preventDefault();
  setBusy(true);setError("");setMessage("");
  try{
   const r=await fetch("/api/auth/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim()})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không gửi được mã.");
   setRequested(true);setMessage(d.message||"Nếu email đã đăng ký, mã xác nhận sẽ được gửi đến hộp thư.");
  }catch(e){setError(e instanceof Error?e.message:"Không gửi được mã xác nhận.")}
  finally{setBusy(false)}
 }
 async function reset(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");setMessage("");
  if(password!==confirm){setError("Hai mật khẩu mới không khớp.");setBusy(false);return}
  if(!token&&!/^\d{6}$/.test(code)){setError("Vui lòng nhập đúng 6 chữ số xác nhận từ email.");setBusy(false);return}
  try{
   const r=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(token?{token,password}:{email:email.trim(),code,password})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không thể thay đổi mật khẩu.");
   setComplete(true);setPassword("");setConfirm("");setCode("");
   setMessage("Mật khẩu đã được cập nhật thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.");
  }catch(e){setError(e instanceof Error?e.message:"Không thể thay đổi mật khẩu.")}
  finally{setBusy(false)}
 }
 const settingPassword=Boolean(token||requested);
 return <main className="admin-login-shell">
  <a href="https://iextra.net" className="logo">+1 <span>EXTRA</span> MUSIC</a>
  <section className="admin-login-card">
   <div className="eyebrow">BẢO MẬT TÀI KHOẢN</div>
   <h1>Đổi / Quên mật khẩu</h1>
   <p>{token?"Thiết lập lại mật khẩu bằng liên kết khôi phục.":complete?"Mật khẩu mới đã được lưu.":"Hệ thống gửi mã xác nhận 6 số đến email đăng ký của tài khoản. Mã có hiệu lực 10 phút, dùng một lần."}</p>
   {error&&<p role="alert" className="admin-login-error">{error}</p>}
   {message&&<p role="status" style={{color:"#86efac",lineHeight:1.6}}>{message}</p>}
   {complete?
    <a href={loginHref} style={{display:"block",padding:13,background:"#c53d46",borderRadius:8,color:"#fff",textAlign:"center",textDecoration:"none",fontWeight:700}}>Đăng nhập {loginLabel}</a>
   :!settingPassword?
    <form onSubmit={requestCode}>
     <label htmlFor="reset-email">Email đã đăng ký</label>
     <input id="reset-email" required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="ten@domain.com" />
     <button type="submit" disabled={busy}>{busy?"Đang gửi...":"Gửi mã xác nhận qua email"}</button>
    </form>
   :
    <form onSubmit={reset}>
     {!token&&<>
      <label htmlFor="reset-code-email">Email tài khoản</label>
      <input id="reset-code-email" type="email" required readOnly value={email} autoComplete="email"/>
      <label htmlFor="reset-code">Mã xác nhận 6 số</label>
      <input id="reset-code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000" style={{fontSize:22,letterSpacing:5,fontWeight:700,textAlign:"center"}}/>
     </>}
     <label htmlFor="reset-new-pass">Mật khẩu mới (từ 12 ký tự)</label>
     <input id="reset-new-pass" type={show?"text":"password"} required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
     <label htmlFor="reset-confirm-pass">Nhập lại mật khẩu mới</label>
     <input id="reset-confirm-pass" type={show?"text":"password"} required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/>
     <label style={{display:"flex",alignItems:"center",gap:8,margin:"10px 0"}}><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)} style={{width:18,height:18}}/> Hiện mật khẩu</label>
     <button type="submit" disabled={busy}>{busy?"Đang xác minh...":"Xác nhận mã & lưu mật khẩu"}</button>
     {!token&&<p style={{fontSize:13,color:"#b7c0cc",lineHeight:1.6}}>Không nhận được mã? Kiểm tra thư mục Spam. Chỉ gửi lại sau ít nhất 60 giây. Tối đa 5 yêu cầu/giờ và 5 lần thử mỗi mã.</p>}
     {!token&&<button type="button" disabled={busy} onClick={()=>void requestCode()} style={{background:"#30343d",border:"1px solid #606875",marginTop:4}}>Gửi lại mã</button>}
    </form>
   }
   <p style={{marginTop:18}}><a href={loginHref}>← Về trang đăng nhập {loginLabel}</a></p>
  </section>
 </main>;
}

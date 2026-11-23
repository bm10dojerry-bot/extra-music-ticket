import "server-only";
import {createHash,createHmac,randomBytes,randomInt} from "node:crypto";
import {staffDb,makePasswordHash,verifyPassword} from "./staff-auth";
import {isAdminSecret} from "./admin-auth";
export const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export const isEmail=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254;
export async function checkOwnerPassword(password:string){try{const rows=await staffDb("owner_credentials?id=eq.owner&select=password_hash&limit=1") as {password_hash:string}[];return rows.length?verifyPassword(password,rows[0].password_hash):isAdminSecret(password)}catch{return isAdminSecret(password)}}
export async function sendResetEmail(email:string,kind:"owner"|"staff",accountId:string){
 const previous=await staffDb("password_reset_tokens?account_kind=eq."+kind+"&account_id=eq."+encodeURIComponent(accountId)+"&select=created_at&order=created_at.desc&limit=1") as {created_at:string}[];
 if(previous[0]&&Date.now()-Date.parse(previous[0].created_at)<5*60*1000)return;
 const token=randomBytes(32).toString("hex"),hash=tokenHash(token);
 const origin="https://iextra.net";
 const link=origin+"/reset-password?token="+encodeURIComponent(token);
 await staffDb("password_reset_tokens",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({token_hash:hash,account_kind:kind,account_id:accountId,expires_at:new Date(Date.now()+15*60*1000).toISOString()})});
 const key=process.env.RESEND_API_KEY,from=process.env.REPORT_FROM_EMAIL;
 if(!key||!from)throw Error("Chưa cấu hình dịch vụ email");
 const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Extra Music Show - Đặt lại mật khẩu",html:'<h2>Đặt lại mật khẩu Extra Music Show</h2><p>Liên kết có hiệu lực 15 phút và chỉ dùng một lần.</p><p><a href="'+link+'">Đặt lại mật khẩu</a></p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>'})});
 if(!res.ok)throw Error("Không gửi được email");
}
export async function applyReset(token:string,password:string){const claimed=await staffDb("rpc/claim_password_reset",{method:"POST",body:JSON.stringify({p_hash:tokenHash(token)})}) as {account_kind:string;account_id:string}[];const row=claimed[0];if(!row)return false;
 if(row.account_kind==="owner"){await staffDb("owner_credentials?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:"owner",password_hash:makePasswordHash(password),updated_at:new Date().toISOString()})})}
 else if(row.account_kind==="staff"){await staffDb("staff_accounts?id=eq."+encodeURIComponent(row.account_id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({password_hash:makePasswordHash(password)})})}else return false;
 return true;
}

/** Email verification code: six digits, valid ten minutes, max five attempts. */
export const ownerResetEmail=()=>String(process.env.ADMIN_OWNER_EMAIL||"bm10dojerry@gmail.com").trim().toLowerCase();
function codeDigest(email:string,code:string){
 const pepper=process.env.ADMIN_MEDIA_SECRET||"";
 if(pepper.length<24)throw Error("Khóa bảo mật chưa được cấu hình.");
 return createHmac("sha256",pepper).update(email+":"+code).digest("hex");
}
export async function requestPasswordResetCode(emailInput:string){
 const email=emailInput.trim().toLowerCase();
 if(!isEmail(email))throw Error("Email không hợp lệ.");
 const key=process.env.RESEND_API_KEY,from=process.env.REPORT_FROM_EMAIL;
 if(!key||!from)throw Error("Dịch vụ email chưa được cấu hình.");
 let kind:"owner"|"staff"|null=null,accountId="";
 if(email===ownerResetEmail()){kind="owner";accountId="owner"}
 else{
  const rows=await staffDb("staff_accounts?email=eq."+encodeURIComponent(email)+"&active=eq.true&select=id&limit=1") as {id:string}[];
  if(rows[0]){kind="staff";accountId=rows[0].id}
 }
 // Generic response for an unknown or disabled account: never disclose membership.
 if(!kind)return;
 const code=String(randomInt(0,1000000)).padStart(6,"0");
 const issued=await staffDb("rpc/issue_password_reset_email_code",{
  method:"POST",body:JSON.stringify({p_kind:kind,p_account_id:accountId,p_email:email,p_hash:codeDigest(email,code)})
 }) as boolean;
 if(!issued)return;
 const res=await fetch("https://api.resend.com/emails",{
  method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({
   from,to:[email],subject:"+1 EXTRA MUSIC SHOW - Mã xác nhận đổi mật khẩu",
   text:"Mã xác nhận đổi mật khẩu của bạn là: "+code+"\nMã có hiệu lực 10 phút, dùng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.",
   html:'<div style="font-family:Arial,sans-serif;color:#182131"><h2>+1 EXTRA MUSIC SHOW</h2><p>Mã xác nhận đổi mật khẩu của bạn:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">'+code+'</p><p>Mã có hiệu lực <b>10 phút</b>, dùng một lần. Tuyệt đối không chia sẻ mã với người khác.</p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p></div>'
  })
 });
 if(!res.ok)throw Error("Không gửi được email xác nhận.");
}
export async function applyPasswordResetCode(emailInput:string,code:string,password:string){
 const email=emailInput.trim().toLowerCase();
 if(!isEmail(email)||!/^\d{6}$/.test(code)||password.length<12||password.length>128)return false;
 const claimed=await staffDb("rpc/claim_password_reset_email_code",{
  method:"POST",body:JSON.stringify({p_email:email,p_hash:codeDigest(email,code)})
 }) as {account_kind:string;account_id:string}[];
 const row=claimed?.[0];if(!row)return false;
 if(row.account_kind==="owner"&&row.account_id==="owner"){
  await staffDb("owner_credentials?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
   body:JSON.stringify({id:"owner",password_hash:makePasswordHash(password),updated_at:new Date().toISOString()})});
  return true;
 }
 if(row.account_kind==="staff"){
  const updated=await staffDb("staff_accounts?id=eq."+encodeURIComponent(row.account_id)+"&email=eq."+encodeURIComponent(email)+"&active=eq.true",{
   method:"PATCH",headers:{Prefer:"return=representation"},
   body:JSON.stringify({password_hash:makePasswordHash(password)})
  }) as {id:string}[];
  return updated.length===1;
 }
 return false;
}

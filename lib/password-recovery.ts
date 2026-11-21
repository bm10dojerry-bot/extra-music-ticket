import "server-only";
import {createHash,randomBytes} from "node:crypto";
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

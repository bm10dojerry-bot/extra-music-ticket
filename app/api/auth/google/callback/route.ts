import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {staffDb,STAFF_COOKIE,createStaffSession,type Staff} from "../../../../../lib/staff-auth";
import {ADMIN_COOKIE,createAdminSession} from "../../../../../lib/admin-session";
export const runtime="nodejs";
const origin="https://iextra.net";
const failure=(reason:string,dest:string)=>NextResponse.redirect(origin+"/"+dest+"?login_error="+encodeURIComponent(reason));
export async function GET(req:NextRequest){
 const saved=req.cookies.get("extra_google_oauth")?.value||"";
 const [state,dest,extra]=saved.split(".");
 const destination=dest==="admin"?"admin":"staff";
 const code=req.nextUrl.searchParams.get("code"),received=req.nextUrl.searchParams.get("state");
 if(!state||extra||!/^[a-f0-9]{64}$/.test(state)||!received||received.length!==state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(received))||!code)return failure("invalid_state",destination);
 const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;
 if(!clientId||!clientSecret)return failure("google_not_configured",destination);
 try{
 const exchange=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:origin+"/api/auth/google/callback",grant_type:"authorization_code"}),cache:"no-store"});
 if(!exchange.ok){const details=await exchange.json().catch(()=>({})) as {error?:string};return failure(details.error==="invalid_client"?"invalid_client":details.error==="invalid_grant"?"invalid_grant":"token_exchange_failed",destination)}
 const token=await exchange.json() as {access_token?:string};
 if(!token.access_token)return failure("token_missing",destination);
 const profileRes=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+token.access_token},cache:"no-store"});
 if(!profileRes.ok)return failure("profile_failed",destination);
 const profile=await profileRes.json() as {email?:string;email_verified?:boolean};
 if(!profile.email||profile.email_verified!==true)return failure("unverified_email",destination);
 const email=profile.email.trim().toLowerCase();
 const owner="bm10dojerry@gmail.com";
 const res=NextResponse.redirect(origin+(destination==="admin"?"/admin":"/staff"));
 if(owner&&email===owner){
 if(!process.env.ADMIN_MEDIA_SECRET||process.env.ADMIN_MEDIA_SECRET.length<24)return failure("admin_session_secret_short",destination);
 res.cookies.set(ADMIN_COOKIE,createAdminSession(),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:8*3600});
 }else{
 const rows=await staffDb("staff_accounts?email=eq."+encodeURIComponent(email)+"&active=eq.true&select=id,username,display_name,role,active&limit=1") as Staff[];
 if(!rows[0])return failure("not_authorized",destination);
 res.cookies.set(STAFF_COOKIE,createStaffSession(rows[0]),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:8*3600});
 }
 res.cookies.set("extra_google_oauth","",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth/google",maxAge:0});
 return res;
 }catch{return failure("server_error",destination)}
}

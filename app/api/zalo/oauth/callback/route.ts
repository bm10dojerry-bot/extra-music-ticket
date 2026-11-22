import {NextRequest,NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {staffDb} from "../../../../../lib/staff-auth";
export const runtime="nodejs";
const callbackUrl="https://iextra.net/api/zalo/oauth/callback";
function finish(status:"success"|"error",reason:string){
 const url=new URL("https://admin.iextra.net/admin");
 url.searchParams.set("zalo",status);url.searchParams.set("reason",reason);
 return NextResponse.redirect(url,302);
}
export async function GET(req:NextRequest){
 const code=req.nextUrl.searchParams.get("code")||"",state=req.nextUrl.searchParams.get("state")||"";
 if(req.nextUrl.searchParams.has("error"))return finish("error","denied");
 if(!/^[A-Za-z0-9_-]{24,256}$/.test(state)||!code||code.length>2048)return finish("error","invalid");
 try{
  const hash=createHash("sha256").update(state).digest("hex");
  const verifier=await staffDb("rpc/extra_consume_zalo_oauth_state",{method:"POST",body:JSON.stringify({p_hash:hash})}) as string|null;
  if(!verifier)return finish("error","expired");
  const secret=process.env.ZALO_APP_SECRET,appId=process.env.ZALO_APP_ID||"4502345524689201342";
  if(!secret)return finish("error","configuration");
  const body=new URLSearchParams({code,app_id:appId,grant_type:"authorization_code",code_verifier:verifier});
  const response=await fetch("https://oauth.zaloapp.com/v4/oa/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","secret_key":secret},body,signal:AbortSignal.timeout(12000),cache:"no-store"});
  const result=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;error?:number};
  if(!response.ok||!result.access_token||!result.refresh_token)return finish("error","exchange");
  const expiresIn=Number(result.expires_in)||86400;
  await staffDb("extra_zalo_oauth_tokens?on_conflict=singleton",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({singleton:true,access_token:result.access_token,refresh_token:result.refresh_token,expires_at:new Date(Date.now()+Math.max(300,Math.min(expiresIn,86400))*1000).toISOString(),refresh_lease_until:null,updated_at:new Date().toISOString()})});
  return finish("success","connected");
 }catch(e){console.error("[zalo-oauth] callback failed",e instanceof Error?e.message:"unknown");return finish("error","connection")}
}

import "server-only";
import {NextRequest,NextResponse} from "next/server";
import {staffDb} from "./staff-auth";
import {analyticsConnectAvailable,clearAnalyticsCache} from "./google-analytics";
import {analyticsHash,GOOGLE_ANALYTICS_ADMIN_ORIGIN,GOOGLE_ANALYTICS_COOKIE,GOOGLE_ANALYTICS_REDIRECT,GOOGLE_ANALYTICS_SCOPE,
 newAnalyticsAuthorization,openAnalyticsSecret,sealAnalyticsSecret,validAnalyticsBinding,validAnalyticsState} from "./google-analytics-security";

type CallbackCode="connected"|"denied"|"invalid_state"|"not_configured"|"oauth_failed"|"scope_missing"|"refresh_token_missing"|"connection_changed"|"unavailable";
const cookieOptions={httpOnly:true,secure:true,sameSite:"lax" as const,domain:".iextra.net",path:"/api/auth/google/callback"};
export function analyticsCallbackRedirect(code:CallbackCode){
 const response=NextResponse.redirect(GOOGLE_ANALYTICS_ADMIN_ORIGIN+"/admin?ga4="+code,303);
 response.cookies.set(GOOGLE_ANALYTICS_COOKIE,"",{...cookieOptions,maxAge:0});
 response.headers.set("Cache-Control","no-store");response.headers.set("Referrer-Policy","no-referrer");return response;
}
export async function startAnalyticsAuthorization(actorId:string):Promise<NextResponse>{
 if(!analyticsConnectAvailable())return analyticsCallbackRedirect("not_configured");
 try{
  const {state,binding,verifier,challenge}=newAnalyticsAuthorization();
  const saved=await staffDb("rpc/extra_start_google_analytics_oauth",{method:"POST",body:JSON.stringify({
   p_state_hash:analyticsHash(state),p_browser_hash:analyticsHash(binding),
   p_verifier_cipher:sealAnalyticsSecret(verifier,process.env.ADMIN_MEDIA_SECRET!,"pkce-verifier"),p_authorized_by:actorId,
  })});
  if(saved!==true)return analyticsCallbackRedirect("unavailable");
  const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,redirect_uri:GOOGLE_ANALYTICS_REDIRECT,response_type:"code",
   scope:GOOGLE_ANALYTICS_SCOPE,access_type:"offline",prompt:"consent select_account",include_granted_scopes:"false",
   state,code_challenge:challenge,code_challenge_method:"S256"});
  const response=NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+params,303);
  response.cookies.set(GOOGLE_ANALYTICS_COOKIE,binding,{...cookieOptions,maxAge:600});
  response.headers.set("Cache-Control","no-store");response.headers.set("Referrer-Policy","no-referrer");return response;
 }catch{return analyticsCallbackRedirect("unavailable");}
}

/** Only called by the existing Google callback for ga4.-prefixed states.
 * The initiating Admin was authorized before state creation. The callback is on
 * the public hostname, so its binding deliberately does not depend on a host-only
 * Admin login cookie being sent to iextra.net.
 */
export async function handleAnalyticsCallback(req:NextRequest):Promise<NextResponse>{
 const state=req.nextUrl.searchParams.get("state")||"",binding=req.cookies.get(GOOGLE_ANALYTICS_COOKIE)?.value||"";
 if(req.nextUrl.origin!=="https://iextra.net"||!validAnalyticsState(state)||!validAnalyticsBinding(binding))return analyticsCallbackRedirect("invalid_state");
 if(!analyticsConnectAvailable())return analyticsCallbackRedirect("not_configured");
 try{
  const rows=await staffDb("rpc/extra_consume_google_analytics_oauth",{method:"POST",body:JSON.stringify({p_state_hash:analyticsHash(state),p_browser_hash:analyticsHash(binding)})}) as Array<{verifier_cipher:string;expected_version:string;authorized_by:string}>;
  if(!Array.isArray(rows)||rows.length!==1)return analyticsCallbackRedirect("invalid_state");
  const attempt=rows[0];
  if(req.nextUrl.searchParams.has("error"))return analyticsCallbackRedirect(req.nextUrl.searchParams.get("error")==="access_denied"?"denied":"oauth_failed");
  const code=req.nextUrl.searchParams.get("code")||"";if(!code||code.length>4096)return analyticsCallbackRedirect("oauth_failed");
  let verifier:string;
  try{verifier=openAnalyticsSecret(attempt.verifier_cipher,process.env.ADMIN_MEDIA_SECRET!,"pkce-verifier");}
  catch{return analyticsCallbackRedirect("oauth_failed");}
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
   body:new URLSearchParams({grant_type:"authorization_code",code,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri:GOOGLE_ANALYTICS_REDIRECT,code_verifier:verifier}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  // Never propagate Google's raw response, token values, or OAuth codes to logs/UI.
  const token=await response.json().catch(()=>null) as null|{scope?:string;refresh_token?:string;access_token?:string;token_type?:string};
  if(!response.ok||!token||typeof token.access_token!=="string"||!token.access_token||token.token_type!=="Bearer")return analyticsCallbackRedirect("oauth_failed");
  if(typeof token.scope!=="string"||!token.scope.split(" ").includes(GOOGLE_ANALYTICS_SCOPE))return analyticsCallbackRedirect("scope_missing");
  if(typeof token.refresh_token!=="string"||!token.refresh_token||token.refresh_token.length>8192)return analyticsCallbackRedirect("refresh_token_missing");
  const saved=await staffDb("rpc/extra_finish_google_analytics_oauth",{method:"POST",body:JSON.stringify({
   p_expected_version:attempt.expected_version,p_refresh_cipher:sealAnalyticsSecret(token.refresh_token,process.env.ADMIN_MEDIA_SECRET!,"refresh-token"),
   p_authorized_by:attempt.authorized_by,
  })});
  if(saved!==true)return analyticsCallbackRedirect("connection_changed");
  clearAnalyticsCache();return analyticsCallbackRedirect("connected");
 }catch{return analyticsCallbackRedirect("unavailable");}
}

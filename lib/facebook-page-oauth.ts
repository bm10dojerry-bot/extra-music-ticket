import "server-only";
import {randomBytes} from "node:crypto";
import {after,NextRequest,NextResponse} from "next/server";
import {ADMIN_COOKIE,validAdminSession} from "./admin-session";
import {STAFF_COOKIE,decodeStaffSession,requireRole} from "./staff-auth";
import {
 FACEBOOK_ADMIN_ORIGIN,FACEBOOK_APP_ID,FACEBOOK_PAGE_ID,FACEBOOK_OAUTH_CALLBACK,FACEBOOK_MESSENGER_WEBHOOK,
 FACEBOOK_OAUTH_COOKIE,FACEBOOK_OAUTH_CONTINUE_COOKIE,FACEBOOK_REQUIRED_PAGE_SCOPES,facebookObject,
 facebookHash,facebookBrowserSessionHash,facebookConnectionRpc,getFacebookOAuthConfig,isFacebookAdminOrigin,
 openFacebookSecret,sealFacebookSecret,validFacebookBrowserBinding,validFacebookState,validFacebookToken,validFacebookVersion,
 type FacebookOAuthConfig,
} from "./facebook-page-connection";

type Json=Record<string,unknown>;
export type FacebookCallbackCode="connected"|"cancelled"|"admin_required"|"invalid_state"|"not_configured"|"scope_missing"|"page_missing"|"token_invalid"|"page_access_failed"|"subscription_failed"|"connection_changed"|"oauth_failed"|"unavailable";
const CALLBACK_CODES=new Set<FacebookCallbackCode>(["connected","cancelled","admin_required","invalid_state","not_configured","scope_missing","page_missing","token_invalid","page_access_failed","subscription_failed","connection_changed","oauth_failed","unavailable"]);
const COOKIE_PATH="/api/admin/facebook/oauth/callback";
const cookieOptions={httpOnly:true,secure:true,sameSite:"lax" as const,path:COOKIE_PATH};
const continuationOptions={...cookieOptions,sameSite:"strict" as const};
const securityHeaders={"Cache-Control":"no-store, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
const numeric=(value:unknown):value is string=>typeof value==="string"&&/^[0-9]{5,80}$/.test(value);
const tokenError=(code:FacebookCallbackCode)=>new FacebookAuthorizationError(code);
class FacebookAuthorizationError extends Error{
 constructor(public readonly code:FacebookCallbackCode){super("Facebook authorization did not complete");this.name="FacebookAuthorizationError";}
}
function failure(code:FacebookCallbackCode,status=503){
 const messages:Partial<Record<FacebookCallbackCode,string>>={
  admin_required:"Chỉ Admin được kết nối Facebook từ cổng quản trị.",
  not_configured:"Máy chủ chưa sẵn sàng kết nối Facebook. Vui lòng kiểm tra cấu hình ứng dụng.",
 };
 return NextResponse.json({error:messages[code]||"Chưa bắt đầu được kết nối Facebook. Vui lòng thử lại."},{status,headers:securityHeaders});
}
export function facebookCallbackRedirect(code:FacebookCallbackCode):NextResponse{
 const safeCode=CALLBACK_CODES.has(code)?code:"unavailable";
 const response=NextResponse.redirect(FACEBOOK_ADMIN_ORIGIN+"/admin?section=ai-sales&facebook_connection="+safeCode,303);
 for(const [key,value] of Object.entries(securityHeaders))response.headers.set(key,value);
 response.cookies.set(FACEBOOK_OAUTH_COOKIE,"",{...cookieOptions,maxAge:0});
 response.cookies.set(FACEBOOK_OAUTH_CONTINUE_COOKIE,"",{...continuationOptions,maxAge:0});
 return response;
}

/** A fresh role lookup and the exact initiating auth cookie are both required. */
async function currentAdmin(req:NextRequest):Promise<{id:string;session:string}|null>{
 const actor=await requireRole(["admin"]);
 if(!actor||!actor.active)return null;
 if(actor.id==="owner"){
  const cookie=req.cookies.get(ADMIN_COOKIE)?.value;
  return validAdminSession(cookie)?{id:actor.id,session:ADMIN_COOKIE+":"+cookie}:null;
 }
 const cookie=req.cookies.get(STAFF_COOKIE)?.value;
 return cookie&&decodeStaffSession(cookie)?.id===actor.id?{id:actor.id,session:STAFF_COOKIE+":"+cookie}:null;
}

export async function startFacebookPageAuthorization(req:NextRequest):Promise<NextResponse>{
 if(!isFacebookAdminOrigin(req.url,req.headers))return failure("admin_required",403);
 try{
  const actor=await currentAdmin(req);
  if(!actor)return failure("admin_required",403);
  const config=getFacebookOAuthConfig();if(!config)return failure("not_configured");
  const state="fbpage."+randomBytes(32).toString("hex"),binding=randomBytes(32).toString("base64url");
  const saved=await facebookConnectionRpc("oauth_start",{
   p_state_hash:facebookHash("oauth-state",state),p_browser_hash:facebookBrowserSessionHash(binding,actor.session),
   p_callback_browser_hash:facebookHash("callback-browser",binding),p_authorized_by:actor.id,p_origin:FACEBOOK_ADMIN_ORIGIN,
  });
  if(saved.outcome!=="started")return failure("unavailable");
  const url=new URL("https://www.facebook.com/"+config.apiVersion+"/dialog/oauth");
  const params:Record<string,string>={client_id:FACEBOOK_APP_ID,redirect_uri:FACEBOOK_OAUTH_CALLBACK,state,response_type:"code",auth_type:"rerequest"};
  if(config.configurationId)params.config_id=config.configurationId;
  else params.scope=[...FACEBOOK_REQUIRED_PAGE_SCOPES,"business_management"].join(",");
  for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
  const response=NextResponse.json({ok:true,authorizationUrl:url.toString()},{headers:securityHeaders});
  response.cookies.set(FACEBOOK_OAUTH_COOKIE,binding,{...cookieOptions,maxAge:600});
  response.cookies.set(FACEBOOK_OAUTH_CONTINUE_COOKIE,"",{...continuationOptions,maxAge:0});
  return response;
 }catch{return failure("unavailable");}
}

function continuationLanding(state:string):NextResponse{
 const nonce=randomBytes(18).toString("base64url"),path=COOKIE_PATH+"?continue=1";
 // The code is already encrypted in the server attempt. This document contains
 // no OAuth parameters; its same-origin navigation restores Strict login cookies.
 const html='<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Tiếp tục kết nối Facebook</title><body><p>Đang hoàn tất kết nối Facebook…</p><script nonce="'+nonce+'">window.location.replace("'+path+'");</script><noscript><a href="'+path+'">Tiếp tục kết nối Facebook</a></noscript></body></html>';
 const response=new NextResponse(html,{status:200,headers:{...securityHeaders,"Content-Type":"text/html; charset=utf-8",
  "Content-Security-Policy":"default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
 response.cookies.set(FACEBOOK_OAUTH_CONTINUE_COOKIE,state,{...continuationOptions,maxAge:120});
 return response;
}

async function graph(config:FacebookOAuthConfig,path:string,params:Record<string,string>,auth:string|null,code:FacebookCallbackCode,deadline:number,method:"GET"|"POST"="GET"):Promise<Json>{
 if(!new RegExp("^(oauth/access_token|debug_token|me(?:/accounts)?|"+FACEBOOK_PAGE_ID+"/(?:published_posts|subscribed_apps)|"+FACEBOOK_APP_ID+"/subscriptions)$").test(path))throw tokenError(code);
 const remaining=deadline-Date.now();if(remaining<=0)throw tokenError(code);
 const url=new URL("https://graph.facebook.com/"+config.apiVersion+"/"+path),headers:Record<string,string>={Accept:"application/json"};
 if(auth)headers.Authorization="Bearer "+auth;
 let body:string|undefined;
 if(method==="GET")for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
 else{headers["Content-Type"]="application/x-www-form-urlencoded";body=new URLSearchParams(params).toString();}
 try{
  const response=await fetch(url.toString(),{method,headers,...(body?{body}:{}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(Math.max(1,Math.min(9000,remaining)))});
  const text=await response.text();if(text.length>1_000_000)throw Error();
  const data=facebookObject(JSON.parse(text));
  if(!response.ok||!data||data.error)throw Error();
  return data;
 }catch{throw tokenError(code);}
}
function nextCursor(data:Json,code:FacebookCallbackCode):string|null{
 const paging=facebookObject(data.paging);
 if(!paging||!paging.next)return null;
 const after=facebookObject(paging.cursors)?.after;
 if(typeof paging.next!=="string"||typeof after!=="string"||!after||after.length>4096||/[\s\u0000-\u001f\u007f]/.test(after))throw tokenError(code);
 return after;
}
async function graphList(config:FacebookOAuthConfig,path:string,params:Record<string,string>,auth:string,code:FacebookCallbackCode,deadline:number):Promise<Json[]>{
 const rows:Json[]=[],seen=new Set<string>();let after:string|null=null;
 for(let page=0;page<5;page++){
  const data=await graph(config,path,{...params,...(after?{after}:{})},auth,code,deadline);
  if(!Array.isArray(data.data)||data.data.length>100||rows.length+data.data.length>500)throw tokenError(code);
  for(const raw of data.data){const row=facebookObject(raw);if(!row)throw tokenError(code);rows.push(row);}
  const next=nextCursor(data,code);if(!next)return rows;
  if(seen.has(next))throw tokenError(code);seen.add(next);after=next;
 }
 throw tokenError(code);
}
function exchangedToken(data:Json):string{
 if(!validFacebookToken(data.access_token)||(data.token_type!==undefined&&(typeof data.token_type!=="string"||data.token_type.toLowerCase()!=="bearer")))throw tokenError("token_invalid");
 return data.access_token;
}
function expiry(value:unknown,required=false):string|null{
 if(value===undefined&&!required)return null;
 if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||(value!==0&&value<=Math.floor(Date.now()/1000)))throw tokenError("token_invalid");
 if(value===0)return null;
 try{return new Date(value*1000).toISOString();}catch{throw tokenError("token_invalid");}
}
function validateToken(data:Json,type:"USER"|"PAGE"){
 const token=facebookObject(data.data);
 if(!token||token.is_valid!==true||token.app_id!==FACEBOOK_APP_ID||(token.type!==undefined&&token.type!==type)||
  (type==="PAGE"&&token.profile_id!==undefined&&token.profile_id!==FACEBOOK_PAGE_ID)||!numeric(token.user_id))throw tokenError("token_invalid");
 const expiresAt=expiry(token.expires_at,true),dataAccessExpiresAt=expiry(token.data_access_expires_at);
 if(!Array.isArray(token.scopes)||token.scopes.length>100||!token.scopes.every(scope=>typeof scope==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(scope)))throw tokenError("scope_missing");
 const scopes=token.scopes as string[];
 const granular=token.granular_scopes===undefined?[]:token.granular_scopes;
 if(!Array.isArray(granular)||granular.length>100)throw tokenError("scope_missing");
 for(const scope of FACEBOOK_REQUIRED_PAGE_SCOPES){
  if(!scopes.includes(scope))throw tokenError("scope_missing");
  for(const raw of granular){
   const grant=facebookObject(raw);if(!grant||typeof grant.scope!=="string")throw tokenError("scope_missing");
   if(grant.scope!==scope||grant.target_ids===undefined)continue;
   if(!Array.isArray(grant.target_ids)||!grant.target_ids.every(id=>typeof id==="string"&&/^[0-9]+$/.test(id)||typeof id==="number"&&Number.isSafeInteger(id)&&id>0)||!grant.target_ids.some(id=>String(id)===FACEBOOK_PAGE_ID))throw tokenError("scope_missing");
  }
 }
 return {scopes,userId:token.user_id,expiresAt,dataAccessExpiresAt};
}
function requiredTasks(value:unknown):boolean{
 if(!Array.isArray(value)||!value.every(task=>typeof task==="string"))return false;
 const tasks=new Set(value);
 return tasks.has("PROFILE_PLUS_FULL_CONTROL")||
  (["MODERATE","PROFILE_PLUS_MODERATE"].some(task=>tasks.has(task))&&["MESSAGING","PAGES_MESSAGING","PROFILE_PLUS_MESSAGING"].some(task=>tasks.has(task)));
}
async function selectedPageToken(config:FacebookOAuthConfig,userToken:string,deadline:number):Promise<string>{
 const seen=new Set<string>();let after:string|null=null;
 for(let page=0;page<5;page++){
  const data=await graph(config,"me/accounts",{fields:"id,name,tasks,access_token",limit:"50",...(after?{after}:{})},userToken,"page_missing",deadline);
  if(!Array.isArray(data.data)||data.data.length>100)throw tokenError("page_missing");
  const matching=data.data.map(facebookObject).filter(row=>row?.id===FACEBOOK_PAGE_ID);
  if(matching.length>1)throw tokenError("token_invalid");
  if(matching.length===1){const page=matching[0]!;if(!validFacebookToken(page.access_token)||!requiredTasks(page.tasks))throw tokenError("page_access_failed");return page.access_token;}
  const next=nextCursor(data,"page_missing");if(!next)break;
  if(seen.has(next))throw tokenError("page_missing");seen.add(next);after=next;
 }
 throw tokenError("page_missing");
}
async function verifyPageRead(config:FacebookOAuthConfig,pageToken:string,deadline:number):Promise<void>{
 const [identity,posts]=await Promise.all([
  graph(config,"me",{fields:"id"},pageToken,"token_invalid",deadline),
  graph(config,FACEBOOK_PAGE_ID+"/published_posts",{fields:"id,from{id},comments.limit(1){id,message,can_reply_privately}",limit:"1"},pageToken,"page_access_failed",deadline),
 ]);
 if(identity.id!==FACEBOOK_PAGE_ID)throw tokenError("token_invalid");
 if(!Array.isArray(posts.data)||posts.data.length>1)throw tokenError("page_access_failed");
 for(const raw of posts.data){
  const post=facebookObject(raw),comments=facebookObject(post?.comments);
  if(!post||typeof post.id!=="string"||(!numeric(post.id)&&!new RegExp("^"+FACEBOOK_PAGE_ID+"_[0-9]{5,80}$").test(post.id))||facebookObject(post.from)?.id!==FACEBOOK_PAGE_ID||!Array.isArray(comments?.data))throw tokenError("page_access_failed");
  for(const rawComment of comments.data){const comment=facebookObject(rawComment);if(!comment||typeof comment.id!=="string"||!/^[0-9]{5,80}(_[0-9]{5,80}){0,2}$/.test(comment.id)||typeof comment.can_reply_privately!=="boolean")throw tokenError("page_access_failed");}
 }
}
function fields(value:unknown,allowObjects=false):string[]{
 if(!Array.isArray(value)||value.length>200)throw tokenError("subscription_failed");
 const names=value.map(item=>typeof item==="string"?item:allowObjects?facebookObject(item)?.name:null);
 if(!names.every((name):name is string=>typeof name==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(name)))throw tokenError("subscription_failed");
 return [...new Set(names as string[])];
}
function pageSubscription(rows:Json[]):{exists:boolean;fields:string[]}{
 if(!rows.every(row=>numeric(row.id)))throw tokenError("subscription_failed");
 const own=rows.filter(row=>row.id===FACEBOOK_APP_ID);if(own.length>1)throw tokenError("subscription_failed");
 return {exists:own.length===1,fields:own.length?fields(own[0].subscribed_fields):[]};
}
function appSubscription(rows:Json[]):{exists:boolean;active:boolean;fields:string[]}{
 if(!rows.every(row=>typeof row.object==="string"))throw tokenError("subscription_failed");
 const page=rows.filter(row=>row.object==="page");if(page.length>1)throw tokenError("subscription_failed");
 if(!page.length)return {exists:false,active:false,fields:[]};
 if(page[0].callback_url!==FACEBOOK_MESSENGER_WEBHOOK||typeof page[0].active!=="boolean")throw tokenError("subscription_failed");
 return {exists:true,active:page[0].active,fields:fields(page[0].fields,true)};
}
const saleFields=["messages","messaging_postbacks","messaging_referrals"] as const;
export async function verifySaleSubscriptions(config:FacebookOAuthConfig,pageToken:string,deadline:number,includeFeed=false){
 const required=includeFeed?[...saleFields,"feed"]:[...saleFields];
 const hasRequired=(values:string[])=>required.every(field=>values.includes(field));
 const appAuth=FACEBOOK_APP_ID+"|"+config.appSecret;
 const readPage=()=>graphList(config,FACEBOOK_PAGE_ID+"/subscribed_apps",{fields:"id,subscribed_fields",limit:"100"},pageToken,"subscription_failed",deadline);
 const readApp=()=>graphList(config,FACEBOOK_APP_ID+"/subscriptions",{},appAuth,"subscription_failed",deadline);
 const [pageRows,appRows]=await Promise.all([readPage(),readApp()]);
 const beforePage=pageSubscription(pageRows),beforeApp=appSubscription(appRows);
 // The caller has already verified this exact app, Page, scopes, tasks and reads.
 // Keep all existing Messenger fields and never replace an unrelated callback.
 if(!beforeApp.active||!hasRequired(beforeApp.fields)){
  if(config.verifyToken.length<16)throw tokenError("subscription_failed");
  const ack=await graph(config,FACEBOOK_APP_ID+"/subscriptions",{object:"page",callback_url:FACEBOOK_MESSENGER_WEBHOOK,
   fields:[...new Set([...beforeApp.fields,...required])].join(","),verify_token:config.verifyToken,include_values:"true"},appAuth,"subscription_failed",deadline,"POST");
  if(ack.success!==true&&ack.success!=="true")throw tokenError("subscription_failed");
 }
 if(!hasRequired(beforePage.fields)){
  const ack=await graph(config,FACEBOOK_PAGE_ID+"/subscribed_apps",{subscribed_fields:[...new Set([...beforePage.fields,...required])].join(",")},pageToken,"subscription_failed",deadline,"POST");
  if(ack.success!==true&&ack.success!=="true")throw tokenError("subscription_failed");
 }
 const [pageAfter,appAfter]=await Promise.all([readPage(),readApp()]);
 const afterPage=pageSubscription(pageAfter),afterApp=appSubscription(appAfter);
 if(!afterPage.exists||!hasRequired(afterPage.fields)||!afterApp.active||!hasRequired(afterApp.fields)||
  !beforePage.fields.every(field=>afterPage.fields.includes(field))||!beforeApp.fields.every(field=>afterApp.fields.includes(field)))throw tokenError("subscription_failed");
 return {addedToApp:required.filter(field=>!beforeApp.fields.includes(field)),addedToPage:required.filter(field=>!beforePage.fields.includes(field))};
}

async function completeFacebookAuthorization(req:NextRequest,binding:string):Promise<NextResponse>{
 const state=req.cookies.get(FACEBOOK_OAUTH_CONTINUE_COOKIE)?.value||"";
 if(!validFacebookState(state))return facebookCallbackRedirect("invalid_state");
 const actor=await currentAdmin(req);if(!actor)return facebookCallbackRedirect("admin_required");
 const config=getFacebookOAuthConfig();if(!config)return facebookCallbackRedirect("not_configured");
 const attempt=await facebookConnectionRpc("oauth_consume",{p_state_hash:facebookHash("oauth-state",state),p_browser_hash:facebookBrowserSessionHash(binding,actor.session),p_authorized_by:actor.id,p_origin:FACEBOOK_ADMIN_ORIGIN});
 if(attempt.outcome!=="consumed"||attempt.authorized_by!==actor.id||!validFacebookVersion(attempt.attempt_id)||!validFacebookVersion(attempt.exchange_token)||!validFacebookVersion(attempt.expected_version))return facebookCallbackRedirect("invalid_state");
 if(attempt.callback_result==="cancelled"||attempt.callback_result==="oauth_failed")return facebookCallbackRedirect(attempt.callback_result);
 if(attempt.callback_result!=="code"||typeof attempt.code_cipher!=="string")return facebookCallbackRedirect("invalid_state");
 let code:string;try{code=openFacebookSecret(attempt.code_cipher,"oauth-code");}catch{return facebookCallbackRedirect("invalid_state");}
 // Leave time in the two-minute receipt/function budget for the durable commit.
 const deadline=Date.now()+75_000;
 const userToken=exchangedToken(await graph(config,"oauth/access_token",{client_id:FACEBOOK_APP_ID,client_secret:config.appSecret,redirect_uri:FACEBOOK_OAUTH_CALLBACK,code},null,"oauth_failed",deadline));
 const longToken=exchangedToken(await graph(config,"oauth/access_token",{grant_type:"fb_exchange_token",client_id:FACEBOOK_APP_ID,client_secret:config.appSecret,fb_exchange_token:userToken},null,"oauth_failed",deadline));
 const appAuth=FACEBOOK_APP_ID+"|"+config.appSecret;
 const userMetadata=validateToken(await graph(config,"debug_token",{input_token:longToken},appAuth,"token_invalid",deadline),"USER");
 const pageToken=await selectedPageToken(config,longToken,deadline);
 const metadata=validateToken(await graph(config,"debug_token",{input_token:pageToken},appAuth,"token_invalid",deadline),"PAGE");
 if(metadata.userId!==userMetadata.userId)throw tokenError("token_invalid");
 await verifyPageRead(config,pageToken,deadline);
 await verifySaleSubscriptions(config,pageToken,deadline,true);
 const finishArgs={
  p_attempt_id:attempt.attempt_id,p_exchange_token:attempt.exchange_token,p_authorized_by:actor.id,p_page_token_cipher:sealFacebookSecret(pageToken,"page-token"),
  p_verified_metadata:{app_id:FACEBOOK_APP_ID,page_id:FACEBOOK_PAGE_ID,granted_scopes:[...new Set(metadata.scopes.filter(scope=>(FACEBOOK_REQUIRED_PAGE_SCOPES as readonly string[]).includes(scope)||scope==="business_management"))],verified_at:new Date().toISOString(),token_expires_at:metadata.expiresAt,data_access_expires_at:metadata.dataAccessExpiresAt},
 };
 let saved:Json;
 try{saved=await facebookConnectionRpc("oauth_finish",finishArgs);}
 catch{
  // The DB may have committed before its response was lost. Reuse the exact
  // receipt and ciphertext; never repeat the provider code exchange or writes.
  saved=await facebookConnectionRpc("oauth_finish",finishArgs);
 }
 if(saved.outcome!=="connected"||!validFacebookVersion(saved.version))return facebookCallbackRedirect("connection_changed");
 // Refresh connection diagnostics even while the user has paused the worker.
 // This invokes no queue, sends no messages, and never changes either enable gate.
 try{after(async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([
   (async()=>{const {refreshCommentAccess}=await import("./ai-comment-leads");await refreshCommentAccess();})().catch(()=>{}),
   new Promise<void>(resolve=>{timer=setTimeout(resolve,20_000);}),
  ]);}finally{if(timer)clearTimeout(timer);}
 });}catch{/* A successful credential commit must not depend on after() availability. */}
 return facebookCallbackRedirect("connected");
}

export async function handleFacebookPageCallback(req:NextRequest):Promise<NextResponse>{
 if(req.nextUrl.origin!==FACEBOOK_ADMIN_ORIGIN||req.nextUrl.pathname!==COOKIE_PATH)return facebookCallbackRedirect("invalid_state");
 const binding=req.cookies.get(FACEBOOK_OAUTH_COOKIE)?.value||"";
 if(!validFacebookBrowserBinding(binding))return facebookCallbackRedirect("invalid_state");
 try{
  if(req.nextUrl.searchParams.has("continue")){
   if(req.nextUrl.searchParams.getAll("continue").length!==1||req.nextUrl.searchParams.get("continue")!=="1"||["code","state","error"].some(key=>req.nextUrl.searchParams.has(key)))return facebookCallbackRedirect("invalid_state");
   return await completeFacebookAuthorization(req,binding);
  }
  const params=req.nextUrl.searchParams,state=params.get("state")||"";
  if(params.getAll("state").length!==1||!validFacebookState(state)||params.getAll("code").length>1||params.getAll("error").length>1)return facebookCallbackRedirect("invalid_state");
  if(!getFacebookOAuthConfig())return facebookCallbackRedirect("not_configured");
  const error=params.get("error"),code=params.get("code")||"";
  if(error&&code)return facebookCallbackRedirect("invalid_state");
  const result=error?(error==="access_denied"?"cancelled":"oauth_failed"):"code";
  if(result==="code"&&(!code||code.length>8192||/[^\x21-\x7e]/.test(code)))return facebookCallbackRedirect("oauth_failed");
  const staged=await facebookConnectionRpc("oauth_stage_callback",{p_state_hash:facebookHash("oauth-state",state),p_callback_browser_hash:facebookHash("callback-browser",binding),p_code_cipher:result==="code"?sealFacebookSecret(code,"oauth-code"):null,p_callback_result:result});
  if(staged.outcome!=="staged")return facebookCallbackRedirect("invalid_state");
  return continuationLanding(state);
 }catch(error){return facebookCallbackRedirect(error instanceof FacebookAuthorizationError?error.code:"unavailable");}
}

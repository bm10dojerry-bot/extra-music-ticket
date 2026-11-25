import "server-only";
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";
import {staffDb} from "./staff-auth";

export const FACEBOOK_PAGE_ID="1223940670813189";
export const FACEBOOK_APP_ID="2447629075989535";
export const FACEBOOK_ADMIN_ORIGIN="https://admin.iextra.net";
export const FACEBOOK_OAUTH_CALLBACK=FACEBOOK_ADMIN_ORIGIN+"/api/admin/facebook/oauth/callback";
export const FACEBOOK_MESSENGER_WEBHOOK="https://iextra.net/api/meta/messenger/webhook";
export const FACEBOOK_REQUIRED_PAGE_SCOPES=["pages_messaging","pages_read_engagement","pages_read_user_content","pages_manage_metadata","pages_show_list"] as const;
export const FACEBOOK_OAUTH_COOKIE="extra_facebook_page_oauth";
export const FACEBOOK_OAUTH_CONTINUE_COOKIE="extra_facebook_page_oauth_continue";
const DOMAIN="extra.facebook-page-connection.v1";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type SecretPurpose="page-token"|"oauth-code";
type Json=Record<string,unknown>;
export type FacebookPageCredential={pageId:string;pageToken:string;source:"env"|"stored";version:string};
export type FacebookOAuthConfig={appId:string;pageId:string;appSecret:string;verifyToken:string;apiVersion:string;configurationId:string|null};
export type FacebookPageConnectionStatus={mode:"env"|"stored"|"disabled";version:string;connected:boolean;expired:boolean;verifiedAt:string|null;grantedScopes:string[]}|null;
export const facebookObject=(value:unknown):Json|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Json:null;
export const validFacebookState=(value:string)=>/^fbpage\.[a-f0-9]{64}$/.test(value);
export const validFacebookBrowserBinding=(value:string)=>/^[A-Za-z0-9_-]{43}$/.test(value);
export const validFacebookVersion=(value:unknown):value is string=>typeof value==="string"&&UUID.test(value);
export const validFacebookToken=(value:unknown):value is string=>typeof value==="string"&&value.length>=20&&value.length<=8192&&!/[\s\u0000-\u001f\u007f]/.test(value);
export const facebookHash=(purpose:string,value:string)=>createHash("sha256").update(JSON.stringify([DOMAIN,purpose,value])).digest("hex");
export const facebookBrowserSessionHash=(binding:string,session:string)=>facebookHash("browser-session",JSON.stringify([binding,facebookHash("admin-session",session)]));

function encryptionKey(purpose:SecretPurpose):Buffer{
 const secret=process.env.ADMIN_MEDIA_SECRET||"";
 if(secret.length<24)throw Error("Facebook credential encryption is unavailable");
 return createHmac("sha256",secret).update(DOMAIN+":"+purpose).digest();
}
function associatedData(purpose:SecretPurpose){return Buffer.from([DOMAIN,purpose,FACEBOOK_APP_ID,FACEBOOK_PAGE_ID].join(":"));}
export function sealFacebookSecret(value:string,purpose:SecretPurpose):string{
 if(typeof value!=="string"||!value||value.length>8192)throw Error("Invalid Facebook credential");
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(purpose),iv);
 cipher.setAAD(associatedData(purpose));
 const body=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return ["v1",iv.toString("base64url"),body.toString("base64url"),cipher.getAuthTag().toString("base64url")].join(".");
}
export function openFacebookSecret(value:string,purpose:SecretPurpose):string{
 try{
  if(typeof value!=="string"||value.length<(purpose==="oauth-code"?45:70)||value.length>12000)throw Error();
  const [version,nonce,body,tag,extra]=value.split(".");
  if(version!=="v1"||extra||!nonce||!body||!tag||![nonce,body,tag].every(part=>/^[A-Za-z0-9_-]+$/.test(part)))throw Error();
  const iv=Buffer.from(nonce,"base64url"),authTag=Buffer.from(tag,"base64url");
  if(iv.length!==12||nonce.length!==16||authTag.length!==16||tag.length!==22)throw Error();
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(purpose),iv);
  decipher.setAAD(associatedData(purpose));decipher.setAuthTag(authTag);
  const result=Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8");
  if(!result||result.length>8192)throw Error();
  return result;
 }catch{throw Error("Facebook credential could not be opened");}
}

export function getFacebookOAuthConfig():FacebookOAuthConfig|null{
 const appSecret=process.env.META_MESSENGER_APP_SECRET||"",verifyToken=process.env.META_MESSENGER_VERIFY_TOKEN||"";
 const apiVersion=process.env.META_MESSENGER_GRAPH_VERSION||"v27.0",configurationId=process.env.META_FACEBOOK_LOGIN_CONFIG_ID||null;
 if(appSecret.length<16||(process.env.ADMIN_MEDIA_SECRET||"").length<24||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY||
  !/^v[1-9][0-9]{0,2}\.[0-9]{1,2}$/.test(apiVersion)||(configurationId!==null&&!/^[0-9]{5,40}$/.test(configurationId))||
  (process.env.META_MESSENGER_PAGE_ID&&process.env.META_MESSENGER_PAGE_ID!==FACEBOOK_PAGE_ID))return null;
 return {appId:FACEBOOK_APP_ID,pageId:FACEBOOK_PAGE_ID,appSecret,verifyToken,apiVersion,configurationId};
}
export function isFacebookAdminOrigin(requestUrl:string,headers:Pick<Headers,"get">):boolean{
 try{return new URL(requestUrl).origin===FACEBOOK_ADMIN_ORIGIN&&headers.get("origin")===FACEBOOK_ADMIN_ORIGIN&&
  (!headers.get("sec-fetch-site")||headers.get("sec-fetch-site")==="same-origin");}catch{return false;}
}

const RPC_NAMES=new Set(["oauth_start","oauth_stage_callback","oauth_consume","oauth_finish","connection_secret","connection_status"]);
/** Fixed service-role RPCs only; raw database errors are never propagated. */
export async function facebookConnectionRpc(name:string,args:Json={}):Promise<Json>{
 if(!RPC_NAMES.has(name))throw Error("Unknown Facebook connection operation");
 try{
  const response=facebookObject(await staffDb("rpc/extra_facebook_"+name,{method:"POST",body:JSON.stringify(args),signal:AbortSignal.timeout(10_000)}));
  if(!response)throw Error();
  return response;
 }catch{throw Error("Facebook connection storage is unavailable");}
}
function validExpiry(value:unknown):boolean{
 return value===null||(typeof value==="string"&&Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now());
}
function validVerifiedAt(value:unknown):value is string{
 return typeof value==="string"&&Number.isFinite(Date.parse(value))&&Date.parse(value)>0&&Date.parse(value)<=Date.now()+60_000;
}

/** A revoked/disabled/stored-invalid connection must never resurrect an env token. */
export async function resolveFacebookPageCredential():Promise<FacebookPageCredential|null>{
 try{
  const row=await facebookConnectionRpc("connection_secret");
  if(row.outcome!=="available"||row.app_id!==FACEBOOK_APP_ID||row.page_id!==FACEBOOK_PAGE_ID||!validFacebookVersion(row.version))return null;
  if(row.mode==="env"){
   const token=process.env.META_MESSENGER_PAGE_ACCESS_TOKEN;
   return process.env.META_MESSENGER_PAGE_ID===FACEBOOK_PAGE_ID&&validFacebookToken(token)?{pageId:FACEBOOK_PAGE_ID,pageToken:token,source:"env",version:row.version}:null;
  }
  if(row.mode!=="stored"||typeof row.page_token_cipher!=="string"||!validVerifiedAt(row.verified_at)||!validExpiry(row.token_expires_at)||!validExpiry(row.data_access_expires_at))return null;
  const token=openFacebookSecret(row.page_token_cipher,"page-token");
  return validFacebookToken(token)?{pageId:FACEBOOK_PAGE_ID,pageToken:token,source:"stored",version:row.version}:null;
 }catch{return null;}
}
/** Safe status DTO; the credential RPC is deliberately not used for UI state. */
export async function getFacebookPageConnectionStatus():Promise<FacebookPageConnectionStatus>{
 try{
  const row=await facebookConnectionRpc("connection_status");
  if(row.outcome!=="available"||row.app_id!==FACEBOOK_APP_ID||row.page_id!==FACEBOOK_PAGE_ID||!validFacebookVersion(row.version)||!["env","stored","disabled"].includes(String(row.mode)))return null;
  return {mode:row.mode as "env"|"stored"|"disabled",version:row.version,connected:row.connected===true,expired:row.expired===true,
   verifiedAt:validVerifiedAt(row.verified_at)?row.verified_at:null,
   grantedScopes:Array.isArray(row.granted_scopes)?row.granted_scopes.filter((scope):scope is string=>typeof scope==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(scope)):[]};
 }catch{return null;}
}

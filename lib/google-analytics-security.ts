import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";

export const GOOGLE_ANALYTICS_SCOPE="https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_ANALYTICS_REDIRECT="https://iextra.net/api/auth/google/callback";
export const GOOGLE_ANALYTICS_ADMIN_ORIGIN="https://admin.iextra.net";
export const GOOGLE_ANALYTICS_COOKIE="extra_ga4_oauth";
type SecretPurpose="refresh-token"|"pkce-verifier";
const domain="extra.google-analytics.v1";
const encoded=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value);

function key(secret:string,purpose:SecretPurpose){
 if(secret.length<24)throw Error("Analytics encryption is not configured");
 return createHmac("sha256",secret).update(domain+":"+purpose).digest();
}
export function sealAnalyticsSecret(value:string,secret:string,purpose:SecretPurpose):string{
 if(!value||value.length>8192)throw Error("Invalid analytics secret");
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret,purpose),iv);
 cipher.setAAD(Buffer.from(domain+":"+purpose));
 const body=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return ["v1",iv.toString("base64url"),body.toString("base64url"),cipher.getAuthTag().toString("base64url")].join(".");
}
export function openAnalyticsSecret(value:string,secret:string,purpose:SecretPurpose):string{
 const [version,iv,body,tag,extra]=value.split(".");
 if(version!=="v1"||extra||!iv||!body||!tag||![iv,body,tag].every(encoded)||value.length>12000)
  throw Error("Invalid analytics ciphertext");
 const nonce=Buffer.from(iv,"base64url"),authTag=Buffer.from(tag,"base64url");
 if(nonce.length!==12||authTag.length!==16)throw Error("Invalid analytics ciphertext");
 const decipher=createDecipheriv("aes-256-gcm",key(secret,purpose),nonce);
 decipher.setAAD(Buffer.from(domain+":"+purpose));decipher.setAuthTag(authTag);
 return Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8");
}
export const analyticsHash=(value:string)=>createHash("sha256").update(domain+":"+value).digest("hex");
export const validAnalyticsState=(value:string)=>/^ga4\.[a-f0-9]{64}$/.test(value);
export const validAnalyticsBinding=(value:string)=>/^[A-Za-z0-9_-]{43}$/.test(value);
export const validAnalyticsId=(value:string)=>/^[1-9][0-9]{0,19}$/.test(value);
export const validMeasurementId=(value:string)=>/^G-[A-Z0-9]{6,20}$/.test(value);

export function newAnalyticsAuthorization(){
 const state="ga4."+randomBytes(32).toString("hex"),binding=randomBytes(32).toString("base64url");
 const verifier=randomBytes(64).toString("base64url");
 return {state,binding,verifier,challenge:createHash("sha256").update(verifier).digest("base64url")};
}
export function isAnalyticsAdminOrigin(requestUrl:string,headers:Pick<Headers,"get">):boolean{
 try{
  return new URL(requestUrl).origin===GOOGLE_ANALYTICS_ADMIN_ORIGIN&&
   headers.get("origin")===GOOGLE_ANALYTICS_ADMIN_ORIGIN&&
   (!headers.get("sec-fetch-site")||headers.get("sec-fetch-site")==="same-origin");
 }catch{return false;}
}
export function compatibleAnalyticsSite(value:string):boolean{
 try{
  const url=new URL(value);
  return ["http:","https:"].includes(url.protocol)&&["iextra.net","www.iextra.net"].includes(url.hostname)&&
   !url.username&&!url.password&&!url.port;
 }catch{return false;}
}

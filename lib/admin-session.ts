import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
export const ADMIN_COOKIE="extra_admin_session";
const ttl=60*60*8;
function signature(payload:string){return createHmac("sha256",process.env.ADMIN_MEDIA_SECRET||"").update(payload).digest("hex")}
export function createAdminSession(){const expires=Math.floor(Date.now()/1000)+ttl;const payload=String(expires);return payload+"."+signature(payload)}
export function validAdminSession(cookie:string|undefined){if(!cookie||!process.env.ADMIN_MEDIA_SECRET||process.env.ADMIN_MEDIA_SECRET.length<24)return false;const [payload,mac,extra]=cookie.split(".");if(extra||!payload||!mac||!/^[0-9]+$/.test(payload)||!/^[a-f0-9]{64}$/.test(mac))return false;const exp=Number(payload);if(!Number.isSafeInteger(exp)||exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+ttl)return false;const a=Buffer.from(mac,"hex"),b=Buffer.from(signature(payload),"hex");return a.length===b.length&&timingSafeEqual(a,b)}

import "server-only";
import {createHmac,randomBytes,scryptSync,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {ADMIN_COOKIE,validAdminSession} from "./admin-session";
export type Role="admin"|"sale"|"show_manager"|"accountant";
export type Staff={id:string;username:string;display_name:string;role:Role;active:boolean};
export const STAFF_COOKIE="extra_staff_session";
const TTL=8*60*60;
const secret=()=>process.env.ADMIN_MEDIA_SECRET||"";
const sign=(payload:string)=>createHmac("sha256",secret()).update(payload).digest("hex");
export function makePasswordHash(password:string){const salt=randomBytes(16).toString("hex");return "scrypt$"+salt+"$"+scryptSync(password,salt,64).toString("hex")}
export function verifyPassword(password:string,hash:string){const [alg,salt,hex]=hash.split("$");if(alg!=="scrypt"||!salt||!hex||!/^[a-f0-9]{128}$/.test(hex))return false;const a=scryptSync(password,salt,64),b=Buffer.from(hex,"hex");return timingSafeEqual(a,b)}
export function createStaffSession(staff:Staff){const data=Buffer.from(JSON.stringify({id:staff.id,exp:Math.floor(Date.now()/1000)+TTL})).toString("base64url");return data+"."+sign(data)}
export function decodeStaffSession(cookie:string|undefined):{id:string}|null{if(!cookie||secret().length<24)return null;const [data,mac,extra]=cookie.split(".");if(extra||!data||!mac||!/^[a-f0-9]{64}$/.test(mac))return null;const a=Buffer.from(mac,"hex"),b=Buffer.from(sign(data),"hex");if(a.length!==b.length||!timingSafeEqual(a,b))return null;try{const obj=JSON.parse(Buffer.from(data,"base64url").toString());return typeof obj.id==="string"&&Number.isSafeInteger(obj.exp)&&obj.exp>Math.floor(Date.now()/1000)?{id:obj.id}:null}catch{return null}}
export async function staffDb(path:string,init:RequestInit={}){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Thiếu cấu hình Supabase");const res=await fetch(url+"/rest/v1/"+path,{...init,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(init.headers||{})},cache:"no-store"});if(!res.ok)throw Error("Database "+res.status+" "+(await res.text()).slice(0,140));if(res.status===204)return null;const body=await res.text();return body?JSON.parse(body):null}
export async function getStaff(cookie:string|undefined):Promise<Staff|null>{const payload=decodeStaffSession(cookie);if(!payload)return null;const rows=await staffDb("staff_accounts?id=eq."+encodeURIComponent(payload.id)+"&select=id,username,display_name,role,active&limit=1") as Staff[];return rows[0]?.active?rows[0]:null}
export async function getActor():Promise<Staff|null>{const jar=await cookies();if(validAdminSession(jar.get(ADMIN_COOKIE)?.value))return {id:"owner",username:"owner",display_name:"Chủ quản trị",role:"admin",active:true};try{const staff=await getStaff(jar.get(STAFF_COOKIE)?.value);if(staff)return staff}catch{}return null}
export async function requireRole(roles:Role[]):Promise<Staff|null>{const actor=await getActor();return actor&&roles.includes(actor.role)?actor:null}

import {staffDb} from "./staff-auth";
import {paidOrder} from "./extra-ticketing";
import {loadShows} from "./show-data";
type TokenRow={access_token:string;refresh_token:string;expires_at:string};
type Delivery={status:string;attempts:number};
const clean=(s:string)=>s.replace(/[\r\n]/g," ").slice(0,160);
export async function zaloConfigured(){
 const configured=Boolean(process.env.ZALO_APP_SECRET&&process.env.ZALO_ZBS_TEMPLATE_ID&&process.env.ZALO_ZBS_TEMPLATE_FIELDS);
 if(!configured)return false;
 if(process.env.ZALO_OA_REFRESH_TOKEN||process.env.ZALO_OA_ACCESS_TOKEN)return true;
 try{const rows=await staffDb("extra_zalo_oauth_tokens?singleton=eq.true&select=refresh_token&limit=1") as {refresh_token:string}[];return Boolean(rows[0]?.refresh_token)}catch{return false}
}
function templateMapping():Record<string,string>|null{
 try{const value=JSON.parse(process.env.ZALO_ZBS_TEMPLATE_FIELDS||"") as unknown;if(!value||typeof value!=="object"||Array.isArray(value))return null;const entries=Object.entries(value);if(!entries.length||entries.length>15||entries.some(([key,v])=>!/^[A-Za-z0-9_]{1,64}$/.test(key)||typeof v!=="string"||!["name","phone","code","seat","artist","show","date","venue","url","vip","amount"].includes(v)))return null;return Object.fromEntries(entries) as Record<string,string>}catch{return null}
}
function phoneVN(raw:string){let v=raw.replace(/\D/g,"");if(v.startsWith("0"))v="84"+v.slice(1);if(!/^84\d{9}$/.test(v))return null;return v}
async function token(){
 const rows=await staffDb("extra_zalo_oauth_tokens?singleton=eq.true&select=access_token,refresh_token,expires_at&limit=1") as TokenRow[];
 const current=rows[0];
 if(current&&Date.parse(current.expires_at)>Date.now()+300000)return current.access_token;
 if(!current&&process.env.ZALO_OA_ACCESS_TOKEN&&!process.env.ZALO_OA_REFRESH_TOKEN)return process.env.ZALO_OA_ACCESS_TOKEN;
 const claimed=await staffDb("rpc/extra_claim_zalo_refresh",{method:"POST",body:"{}"});
 if(claimed!==true){for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,350));const other=await staffDb("extra_zalo_oauth_tokens?singleton=eq.true&select=access_token,expires_at&limit=1") as TokenRow[];if(other[0]?.access_token&&Date.parse(other[0].expires_at)>Date.now()+60000)return other[0].access_token}throw Error("Zalo token refresh is in progress")}
 const refresh=current?.refresh_token||process.env.ZALO_OA_REFRESH_TOKEN;
 if(!refresh)throw Error("Zalo OAuth refresh token not configured");
 const body=new URLSearchParams({refresh_token:refresh,app_id:process.env.ZALO_APP_ID||"",grant_type:"refresh_token"});
 const response=await fetch("https://oauth.zaloapp.com/v4/oa/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","secret_key":process.env.ZALO_APP_SECRET||""},body,signal:AbortSignal.timeout(12000),cache:"no-store"});
 const result=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;error?:number;message?:string};
 if(!response.ok||!result.access_token||!result.refresh_token)throw Error("Zalo OAuth refresh rejected");
 const expiresAt=new Date(Date.now()+Math.min(24*3600,Math.max(600,Number(result.expires_in)||24*3600))*1000).toISOString();
 await staffDb("extra_zalo_oauth_tokens?on_conflict=singleton",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({singleton:true,access_token:result.access_token,refresh_token:result.refresh_token,expires_at:expiresAt,refresh_lease_until:null,updated_at:new Date().toISOString()})});
 return result.access_token;
}
export async function sendZaloTicket(code:string):Promise<"accepted"|"skipped"|"failed">{
 if(!await zaloConfigured())return "skipped";
 const mapping=templateMapping();if(!mapping)return "skipped";
 const order=await paidOrder(code);if(!order||order.status!=="paid")return "skipped";
 const phone=phoneVN(order.buyer_phone||"");if(!phone)return "skipped";
 const rows=await staffDb("extra_zalo_delivery?order_code=eq."+encodeURIComponent(code)+"&select=status,attempts&limit=1") as Delivery[];
 if(rows[0]?.status==="accepted"||rows[0]?.attempts>=5)return "skipped";
 const claimed=await staffDb("rpc/extra_claim_zalo_delivery",{method:"POST",body:JSON.stringify({p_code:code})});
 if(claimed!==true)return "skipped";
 try{
  const show=(await loadShows()).find(s=>s.id===order.show_id);
  const values:Record<string,string>={name:clean(order.buyer_name),phone,code,seat:order.seats.join(", "),artist:clean(show?.artist||""),show:clean(show?.title||""),date:show?.date||"",venue:show?.venue||"",url:"https://iextra.net/ve?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(order.access_token),vip:order.is_vip_invitation?"Vé mời VIP":"Vé điện tử",amount:order.is_vip_invitation?"Miễn phí":new Intl.NumberFormat("vi-VN").format(order.amount_vnd)+"đ"};
  const template_data=Object.fromEntries(Object.entries(mapping).map(([key,field])=>[key,values[field]||""]));
  const response=await fetch("https://business.openapi.zalo.me/message/template",{method:"POST",headers:{"Content-Type":"application/json","access_token":await token()},body:JSON.stringify({phone,template_id:process.env.ZALO_ZBS_TEMPLATE_ID,template_data,tracking_id:code}),signal:AbortSignal.timeout(12000),cache:"no-store"});
  const result=await response.json() as {error?:number;message?:string;data?:{msg_id?:string}};
  if(!response.ok||result.error!==0)throw Error("Zalo rejected request "+String(result.error??response.status));
  await staffDb("extra_zalo_delivery?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({status:"accepted",provider_message_id:result.data?.msg_id||null,accepted_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()})});
  return "accepted";
 }catch(e){
  const message=e instanceof Error?e.message:"Unknown Zalo error";
  console.warn("[zalo-zbs] delivery not accepted",code,message);
  const ambiguous=/timeout|abort|fetch failed|network|JSON/i.test(message);
  await staffDb("extra_zalo_delivery?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({status:ambiguous?"sending":"failed",last_error:clean(message),updated_at:new Date().toISOString()})}).catch(()=>{});
  return "failed";
 }
}

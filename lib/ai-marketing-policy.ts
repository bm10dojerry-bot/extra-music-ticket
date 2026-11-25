import type {MarketingObjective} from "./ai-marketing-admin-types";

export const MARKETING_TIMEZONE = "Asia/Ho_Chi_Minh" as const;
export const MARKETING_PAGE_ID = "1223940670813189";
export const MARKETING_INITIAL_BUDGET = 99_000;
export const MARKETING_SCALE_BUDGET = 299_000;
export const MARKETING_MAX_DAILY_CAP = 1_000_000;
export const MARKETING_SLOTS = ["11:30", "20:30"] as const;
export const MARKETING_ACCOUNTS = [
  {id:"1915621506464312",name:"extra 02"},
  {id:"1482182900406200",name:"extra 03"},
] as const;

export function marketingBusinessDate(now = new Date()):string {
  return new Date(now.getTime()+7*60*60*1000).toISOString().slice(0,10);
}

/** One objective per source post; the shows exchange objectives on the next day. */
export function marketingObjective(date:string,slot:number,plan:string):MarketingObjective {
  if(plan==="messages_only")return "messages";
  const day=Math.floor(Date.parse(date+"T00:00:00Z")/86_400_000);
  return (day+slot)%2===0?"messages":"sales";
}

export function marketingMetricsFreshness(asOf:string|null,now=Date.now()):"fresh"|"stale"|"unavailable" {
  if(!asOf)return "unavailable";
  const stamp=Date.parse(asOf);
  // Future-dated snapshots cannot establish fresh evidence either.
  if(!Number.isFinite(stamp)||stamp>now+60_000)return "unavailable";
  return now-stamp<=90*60_000?"fresh":"stale";
}

export function isMarketingAccount(value:unknown):value is string {
  return typeof value==="string"&&MARKETING_ACCOUNTS.some(account=>account.id===value);
}

export function safeMarketingUrl(value:unknown,kind:"website"|"image"|"facebook"):string|null {
  if(typeof value!=="string")return null;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password)return null;
    if(kind==="website"&&url.hostname==="iextra.net"&&url.pathname.startsWith("/show/"))return url.href;
    if(kind==="image"&&url.hostname==="fokntdvgzfldxbaglrdc.supabase.co"&&url.pathname.startsWith("/storage/v1/object/public/extra-media/"))return url.href;
    if(kind==="facebook"&&["facebook.com","www.facebook.com","m.facebook.com"].includes(url.hostname))return url.href;
  }catch{}
  return null;
}

export function marketingSettingsPatch(input:unknown):{patch:Record<string,unknown>}|{error:string} {
  if(!input||typeof input!=="object"||Array.isArray(input))return {error:"Yêu cầu không hợp lệ."};
  const body=input as Record<string,unknown>;
  if(body.action==="set_enabled"&&typeof body.enabled==="boolean")return {patch:{enabled:body.enabled}};
  if(body.action!=="configure")return {error:"Yêu cầu không hợp lệ."};
  if(body.accountId!==null&&!isMarketingAccount(body.accountId))return {error:"Chọn tài khoản quảng cáo đã kết nối."};
  if(!Number.isSafeInteger(body.dailyCapVnd)||Number(body.dailyCapVnd)<MARKETING_INITIAL_BUDGET*2||Number(body.dailyCapVnd)>MARKETING_MAX_DAILY_CAP)return {error:"Trần mỗi ngày phải từ 198.000đ đến 1.000.000đ cho toàn bộ luồng này."};
  if(!Array.isArray(body.slots)||body.slots.length!==2||body.slots.some((slot,index)=>slot!==MARKETING_SLOTS[index]))return {error:"Lịch đang đồng bộ lúc 11:30 và 20:30. Cần cập nhật lịch tự động trước khi đổi giờ đăng."};
  // Never forward ready flags, provider IDs, targeting, or an arbitrary JSON patch from the browser.
  return {patch:{account_id:body.accountId,daily_cap_vnd:body.dailyCapVnd}};
}

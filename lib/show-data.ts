import {shows,type Show} from "./shows";
import {mediaPublicUrl} from "./media";
export type ManagedShow=Show&{posterUrl:string|null;prices:Record<"A"|"B"|"C"|"D",number|null>};
export const blankPrices={A:null,B:null,C:null,D:null};
export function defaultShows():ManagedShow[]{return shows.map(s=>({...s,posterUrl:null,prices:{...blankPrices}}))}
type Row={id:string;artist:string;title:string;show_date:string;show_time:string;venue_id:Show["venue"];status:string;poster_path:string|null;prices:Record<string,unknown>};
export function normalizeShow(r:Row):ManagedShow{
 const prices={...blankPrices};
 for(const zone of ["A","B","C","D"] as const){const n=r.prices?.[zone];prices[zone]=typeof n==="number"&&Number.isSafeInteger(n)&&n>=0?n:null}
 return {id:r.id,artist:r.artist,title:r.title,date:r.show_date,time:r.show_time,venue:r.venue_id,status:r.status==="pending"?"pending":r.status==="sold_out"?"sold_out":"announced",posterUrl:r.poster_path?mediaPublicUrl(r.poster_path):null,prices};
}
export async function loadShows():Promise<ManagedShow[]>{
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return defaultShows();
 try{
 const res=await fetch(url+"/rest/v1/managed_shows?select=*&order=show_date.asc&limit=300",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!res.ok)return defaultShows();
 const rows=await res.json() as Row[];
 if(!rows.length)return defaultShows();
 const overrides=new Map(rows.map(r=>[r.id,r]));
 const defaults=defaultShows().filter(d=>!overrides.has(d.id));
 return [...defaults,...rows.filter(r=>r.status!=="hidden").map(normalizeShow)].sort((a,b)=>a.date.localeCompare(b.date));
 }catch{return defaultShows()}
}
export async function loadAllShows():Promise<(ManagedShow&{rawStatus?:string})[]>{
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error("Thiếu cấu hình Supabase");
 const res=await fetch(url+"/rest/v1/managed_shows?select=*&order=show_date.asc&limit=300",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!res.ok)throw Error("Chưa có bảng managed_shows. Hãy chạy SQL 004.");
 const rows=await res.json() as Row[];
 return rows.map(r=>({...normalizeShow(r),rawStatus:r.status}));
}

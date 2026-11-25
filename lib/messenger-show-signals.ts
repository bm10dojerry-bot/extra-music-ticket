import "server-only";
import {createHash} from "node:crypto";
import {staffDb} from "./staff-auth";
import {listAiSalesShows,type AiSalesShow} from "./ai-sales-checkout";
import {verifiedAds} from "./messenger-extra-ad-shows";

const table="extra_messenger_show_signals";
const day=86400000;
const obj=(v:unknown):Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v)?v as Record<string,unknown>:{};
const digits=(v:unknown):v is string=>typeof v==="string" && /^\d{5,80}$/.test(v);
const hash=(...parts:string[])=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const norm=(v:string)=>v.normalize("NFD").replace(/\p{M}/gu,"").replace(/[Đđ]/g,"d").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
type Catalog=Pick<AiSalesShow,"id"|"artist"|"date">[];
export function matchShowEvidence(text:string,shows:Catalog){
 const words=" "+norm(text)+" ";
 const named=shows.filter(s=>s.artist.split(/\s*(?:[+&,;]|\bvà\b)\s*/iu).some(a=>norm(a).length>=4 && words.includes(" "+norm(a)+" ")));
 const dates=[...text.matchAll(/\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(20\d\d))?\b/g)].map(m=>({day:m[1].padStart(2,"0"),month:m[2].padStart(2,"0"),year:m[3]}));
 const onDate=(s:Catalog[number])=>dates.some(d=>s.date.slice(5)===d.month+"-"+d.day && (!d.year||s.date.startsWith(d.year+"-")));
 // Multiple different artists or dates on a schedule must never collapse into the first match.
 if(new Set(dates.map(d=>d.day+"/"+d.month)).size>1)return {id:null,ambiguous:true};
 const candidates=named.length?(dates.length?named.filter(onDate):named):dates.length?shows.filter(onDate):[];
 const ambiguous=new Set(named.map(s=>norm(s.artist))).size>1 || Boolean(named.length && dates.length && !candidates.length) || candidates.length>1;
 return {id:!ambiguous && candidates.length===1?candidates[0].id:null,ambiguous};
}
export function metaImageURL(v:unknown):URL|null{
 if(typeof v!=="string"||v.length>4096)return null;
 try{const u=new URL(v);return u.protocol==="https:" && !u.username&&!u.password&&!u.port&&!u.hash && /(^|\.)(fbcdn\.net|fbsbx\.com)$/.test(u.hostname)?u:null;}catch{return null;}
}
type Signal={actor_key:string;event_key:string;kind:"ad"|"image";occurred_at:string;expires_at:string;show_id:string|null;media_url:string|null};
async function publishedShows(page:string,adId:string,postId:string){
 const lookups:Promise<string[]>[]=[];
 if(adId && !verifiedAds[adId]){
  const path="extra_marketing_allocations?page_id=eq."+page+"&ad_id=eq."+adId+"&select=extra_marketing_posts!inner(show_id)&limit=2";
  lookups.push(staffDb(path,{signal:AbortSignal.timeout(1600)}).then((rows:{extra_marketing_posts:{show_id:string}}[])=>rows.map(row=>row.extra_marketing_posts.show_id)));
 }
 if(postId && !verifiedAds[postId]){
  const path="extra_marketing_posts?facebook_post_id=eq."+page+"_"+postId+"&select=show_id&limit=2";
  lookups.push(staffDb(path,{signal:AbortSignal.timeout(1600)}).then((rows:{show_id:string}[])=>rows.map(row=>row.show_id)));
 }
 return (await Promise.all(lookups)).flat();
}
export async function signedSignals(page:string,value:unknown,catalog:()=>Promise<Catalog>,now=Date.now()):Promise<Signal[]>{
 const e=obj(value),m=obj(e.message),p=obj(e.postback),sender=obj(e.sender).id,t=e.timestamp;
 if(!digits(page)||!digits(sender)||sender===page||obj(e.recipient).id!==page||m.is_echo||typeof t!=="number"||!Number.isSafeInteger(t)||t<now-day||t>now+60000)return [];
 const actor_key=hash(page,sender),occurred_at=new Date(t).toISOString(),rows:Signal[]=[];
 const mid=typeof m.mid==="string"&&m.mid.length<=240?m.mid:"";
 if(mid && process.env.EXTRA_AI_SALE_INBOUND_IMAGE!=="0"){
  const attachments=(Array.isArray(m.attachments)?m.attachments:[]).map(obj).filter(x=>x.type==="image");
  if(attachments.length===1){
   const url=metaImageURL(obj(attachments[0].payload).url);
   if(url)rows.push({actor_key,event_key:hash(mid),kind:"image",occurred_at,expires_at:new Date(t+day).toISOString(),media_url:url.href,show_id:null});
  }
 }
 const refs=[e.referral,m.referral,p.referral].map(obj).filter(r=>r.source==="ADS");
 if(!refs.length)return rows;
 const ids=new Set<string>(),catalogShows=await catalog();
 let ambiguous=new Set(refs.map(r=>r.ad_id).filter(digits)).size>1;
 for(const r of refs){
  const data=obj(r.ads_context_data);
  const title=typeof data.ad_title==="string"?data.ad_title.slice(0,500):"";
  const found=matchShowEvidence(title,catalogShows);
  ambiguous ||= found.ambiguous;
  if(found.id)ids.add(found.id);
  const ref=typeof r.ref==="string"?r.ref.match(/^(?:show[:=]|(?:https:\/\/(?:www\.)?iextra\.net)?\/show\/)?([a-z0-9-]+)$/i)?.[1]:"";
  if(catalogShows.some(s=>s.id===ref))ids.add(ref!);
  if(page==="1223940670813189"){
   const post=String(data.post_id??"").replace(/^1223940670813189_/,"");
   const adId=digits(r.ad_id)?r.ad_id:"",postId=digits(post)?post:"";
   const saved=await publishedShows(page,adId,postId).catch(()=>[]);
   for(const mapped of [verifiedAds[adId],verifiedAds[postId],...saved]){
    if(mapped && catalogShows.some(s=>s.id===mapped))ids.add(mapped);
   }
  }
 }
 rows.push({actor_key,event_key:hash(mid||String(t),...refs.map(r=>String(r.ad_id??obj(r.ads_context_data).post_id??r.ref??"")).sort()),kind:"ad",occurred_at,expires_at:new Date(t+day).toISOString(),show_id:!ambiguous&&ids.size===1?[...ids][0]:null,media_url:null});
 return rows;
}
export async function recordSignedBatch(page:string,events:unknown[]){
 let catalog:ReturnType<typeof listAiSalesShows>|undefined;
 const rows=(await Promise.all(events.map(e=>signedSignals(page,e,()=>catalog??=listAiSalesShows())))).flat();
 if(rows.length)await staffDb(table+"?on_conflict=actor_key,event_key,kind",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(rows)});
}
export async function signedImage(mid:string,psid:string,page:string){
 const key=table+"?actor_key=eq."+hash(page,psid)+"&kind=eq.image&event_key=eq."+hash(mid);
 const rows=await staffDb(key+"&expires_at=gt."+new Date().toISOString()+"&select=media_url&limit=1") as {media_url:string|null}[];
 return metaImageURL(rows[0]?.media_url);
}
export async function rememberImageShow(mid:string,psid:string,page:string,showId:string){
 await staffDb(table+"?actor_key=eq."+hash(page,psid)+"&kind=eq.image&event_key=eq."+hash(mid),{method:"PATCH",body:JSON.stringify({show_id:showId})});
}
export async function recentShowSignal(page:string,psid:string,at:string){
 if(!digits(page)||!digits(psid)||!Number.isFinite(Date.parse(at)))return null;
 const upper=new Date(Math.min(Date.now()+60000,Date.parse(at)+1000)).toISOString();
 const rows=await staffDb(table+"?actor_key=eq."+hash(page,psid)+"&or=(kind.eq.ad,show_id.not.is.null)&occurred_at=lte."+upper+"&expires_at=gt."+new Date().toISOString()+"&select=show_id,occurred_at&order=occurred_at.desc&limit=1",{signal:AbortSignal.timeout(1700)}) as {show_id:string|null;occurred_at:string}[];
 return rows[0]??null;
}
export async function purgeShowSignals(){await staffDb(table+"?expires_at=lt."+new Date().toISOString(),{method:"DELETE"});}

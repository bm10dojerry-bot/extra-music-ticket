import "server-only";
import {getMessengerGraphConfig} from "./facebook-messenger";
import {staffDb} from "./staff-auth";
import {metaImageURL,recordSignedBatch} from "./messenger-show-signals";
import {incomingMessengerText} from "./ai-sales-policy";

type RemoteMessage={id?:string;created_time?:string;from?:{id?:string};to?:{data?:{id?:string}[]};message?:string;attachments?:{data?:{image_data?:{url?:string;media_url?:string;render_as_sticker?:boolean}}[]}};
type LocalMessage={id:number;sender:string;staff_name:string|null;body:string;external_message_id:string|null;created_at:string};
type Chat={id:string;messenger_psid:string};
const validMid=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_:.=-]{5,200}$/.test(v);
const digits=(v:unknown):v is string=>typeof v==="string"&&/^\d{5,80}$/.test(v);
const isMapPrompt=(m:LocalMessage|undefined)=>Boolean(m&&m.sender==="staff"&&m.staff_name==="EXTRA AI"&&validMid(m.external_message_id)&&/chấm, khoanh trực tiếp ghế/i.test(m.body));
export function selectMissedImage(messages:RemoteMessage[],last:LocalMessage,page:string,psid:string,now=Date.now()){
 if(!digits(page)||!digits(psid)||!isMapPrompt(last)||messages.length!==2)return null;
 const sorted=[...messages].sort((a,b)=>Date.parse(b.created_time||"")-Date.parse(a.created_time||""));
 const [image,previous]=sorted;
 const time=Date.parse(image.created_time||""),prior=Date.parse(previous.created_time||""),local=Date.parse(last.created_at);
 if(![time,prior,local].every(Number.isFinite)||time<=prior||time<local-2000||time<now-10*60000||time>now+5000)return null;
 if(previous.id!==last.external_message_id||previous.from?.id!==page||!previous.to?.data?.some(x=>x.id===psid))return null;
 if(!validMid(image.id)||image.id===previous.id||image.from?.id!==psid||!image.to?.data?.some(x=>x.id===page)||image.message?.trim())return null;
 const attachments=image.attachments?.data;
 if(!Array.isArray(attachments)||attachments.length!==1||!attachments[0]?.image_data||attachments[0].image_data.render_as_sticker)return null;
 const media=attachments[0].image_data;
 const url=metaImageURL(media.url??media.media_url);
 if(!url)return null;
 return {mid:image.id,psid,url:url.href,timestamp:time};
}
async function latest(chatId:string):Promise<LocalMessage|undefined>{
 const rows=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(chatId)+"&select=id,sender,staff_name,body,external_message_id,created_at&order=id.desc&limit=1",{signal:AbortSignal.timeout(1800)}) as LocalMessage[];
 return rows[0];
}
export async function recoverRecentSeatMapImages():Promise<{checked:number;recovered:number;errors:number}>{
 const stats={checked:0,recovered:0,errors:0};
 if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE==="0"||process.env.EXTRA_AI_SALE_IMAGE_RECOVERY==="0")return stats;
 try{
  const cfg=await getMessengerGraphConfig();if(!cfg)return stats;
  const settings=await staffDb("extra_messenger_ai_settings?page_id=eq."+cfg.pageId+"&enabled=eq.true&select=page_id&limit=1",{signal:AbortSignal.timeout(1800)}) as unknown[];
  if(!settings.length)return stats;
  const since=encodeURIComponent(new Date(Date.now()-10*60000).toISOString());
  const candidates=await staffDb("extra_support_chats?channel=eq.messenger&messenger_page_id=eq."+cfg.pageId+"&ai_mode=eq.auto&status=eq.open&last_staff_at=gt."+since+"&select=id,messenger_psid&order=last_staff_at.desc&limit=12",{signal:AbortSignal.timeout(1800)}) as Chat[];
  await Promise.all(candidates.filter(c=>digits(c.messenger_psid)).map(async chat=>{
   try{
    const last=await latest(chat.id);if(!last||!isMapPrompt(last))return;
    stats.checked++;
    const url=new URL("https://graph.facebook.com/"+cfg.apiVersion+"/"+cfg.pageId+"/conversations");
    url.searchParams.set("user_id",chat.messenger_psid);url.searchParams.set("platform","messenger");url.searchParams.set("limit","2");
    url.searchParams.set("fields","id,messages.limit(2){id,created_time,from,to,message,attachments{image_data}}");
    const res=await fetch(url,{headers:{Authorization:"Bearer "+cfg.pageToken},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
    if(!res.ok){stats.errors++;return;}
    const raw=await res.text();if(raw.length>128*1024)return;
    const data=JSON.parse(raw) as {data?:{messages?:{data?:RemoteMessage[]}}[]};
    if(data.data?.length!==1)return;
    const candidate=selectMissedImage(data.data[0].messages?.data??[],last,cfg.pageId,chat.messenger_psid);
    if(!candidate)return;
    const [current,scope]=await Promise.all([latest(chat.id),staffDb("extra_support_chats?id=eq."+encodeURIComponent(chat.id)+"&messenger_page_id=eq."+cfg.pageId+"&messenger_psid=eq."+chat.messenger_psid+"&ai_mode=eq.auto&status=eq.open&select=id&limit=1",{signal:AbortSignal.timeout(1800)}) as Promise<unknown[]>]);
    if(current?.id!==last.id||!scope.length)return;
    const known=await staffDb("extra_support_messages?external_message_id=eq."+encodeURIComponent(candidate.mid)+"&select=id&limit=1",{signal:AbortSignal.timeout(1800)}) as unknown[];
    if(known.length)return;
    // The authenticated Graph response is explicitly scoped to the current page and recipient.
    // Use the existing image signal store and idempotent intake, never direct order or send RPCs.
    const event={sender:{id:candidate.psid},recipient:{id:cfg.pageId},timestamp:candidate.timestamp,message:{mid:candidate.mid,attachments:[{type:"image",payload:{url:candidate.url}}]}};
    await recordSignedBatch(cfg.pageId,[event]).catch(()=>{});
    const body=incomingMessengerText(event.message);
    const result=await staffDb("rpc/extra_support_ingest_messenger",{method:"POST",body:JSON.stringify({p_page_id:cfg.pageId,p_psid:candidate.psid,p_mid:candidate.mid,p_text:body})}) as {outcome:string;ai_queued?:boolean};
    if(result.outcome==="received")stats.recovered++;
   }catch{stats.errors++;}
  }));
 }catch{stats.errors++;}
 if(stats.checked||stats.errors)console.info("[seat-map-recovery]",JSON.stringify(stats));
 return stats;
}

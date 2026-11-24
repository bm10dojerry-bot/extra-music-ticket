import {after,NextRequest,NextResponse} from "next/server";
import {createHmac,timingSafeEqual} from "node:crypto";
import {staffDb} from "../../../../../lib/staff-auth";
import {getMessengerConfig} from "../../../../../lib/facebook-messenger";
import {customerRequestsHuman} from "../../../../../lib/messenger-sale-memory";
import {classifyMessengerEcho,getMessengerSalePilot,readMessengerAdReferral,requiresMessengerSaleIsolation} from "../../../../../lib/messenger-sale-pilot";
import {messengerSaleRpc,processMessengerSaleChats} from "../../../../../lib/messenger-sale-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const reply=(message:string,status:number)=>new NextResponse(message,{status,headers:{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8"}});
const constantTimeEquals=(a:string,b:string)=>{
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
};
export async function GET(req:NextRequest){
 const config=getMessengerConfig();
 if(!config)return reply("Messenger Page integration not configured",503);
 if(requiresMessengerSaleIsolation()&&!getMessengerSalePilot(config.pageId))return reply("Messenger test environment not configured",503);
 const q=req.nextUrl.searchParams;
 const mode=q.get("hub.mode")||"",token=q.get("hub.verify_token")||"",challenge=q.get("hub.challenge")||"";
 if(mode==="subscribe"&&constantTimeEquals(token,config.verifyToken)&&challenge.length<512)return reply(challenge,200);
 return reply("Webhook verification denied",403);
}
type Event={
 sender?:{id?:string};recipient?:{id?:string};timestamp?:number;referral?:unknown;postback?:{referral?:unknown};
 message?:{mid?:string;text?:string;is_echo?:boolean;app_id?:string|number;metadata?:string;referral?:unknown;attachments?:unknown[]};
};
type PageEntry={id?:string;messaging?:Event[]};
type Body={object?:string;entry?:PageEntry[]};
type Ingest={outcome:string;chat_id?:string};
function messengerEventTime(value:unknown){
 return typeof value==="number"&&Number.isSafeInteger(value)&&value>0&&value<=Date.now()+60_000?new Date(value).toISOString():null;
}
export async function POST(req:NextRequest){
 const config=getMessengerConfig();
 if(!config)return reply("Messenger Page integration not configured",503);
 const pilot=getMessengerSalePilot(config.pageId);
 if(requiresMessengerSaleIsolation()&&!pilot)return reply("Messenger test environment not configured",503);
 const size=Number(req.headers.get("content-length")||0);
 if(size>150000)return reply("Payload too large",413);
 const raw=Buffer.from(await req.arrayBuffer());
 if(raw.length>150000)return reply("Payload too large",413);
 const provided=req.headers.get("x-hub-signature-256")||"";
 if(!/^sha256=[a-f0-9]{64}$/i.test(provided)){console.warn("[messenger-webhook] Rejected missing or malformed signed webhook");return reply("Invalid signature",403);}
 const expected="sha256="+createHmac("sha256",config.appSecret).update(raw).digest("hex");
 if(!constantTimeEquals(provided.toLowerCase(),expected)){console.warn("[messenger-webhook] Rejected signature mismatch; check App Secret belongs to connected Meta App");return reply("Invalid signature",403);}
 let data:Body;
 try{data=JSON.parse(raw.toString("utf8")) as Body}catch{return reply("Invalid JSON",400)}
 if(data?.object!=="page"||!Array.isArray(data.entry)){
  console.info("[messenger-webhook] Verified non-page event ignored");
  return reply("Ignored",200);
 }
 const work=new Map<string,string>();
 let handoff=false;
 let processed=0,ignored=0,unmatchedPages=0,duplicate=0,unknownEcho=0;
 console.info("[messenger-webhook] Verified signed Page payload, entryCount",Math.min(data.entry.length,30));
 try{
  for(const page of data.entry.slice(0,30)){
   if(page?.id!==config.pageId||!Array.isArray(page.messaging)){unmatchedPages+=1;continue;}
   for(const item of page.messaging.slice(0,35)){
    const message=item?.message;
    const mid=typeof message?.mid==="string"?message.mid:"";
    const body=typeof message?.text==="string"?message.text.trim():"";
    if(message?.is_echo){
     const psid=item.recipient?.id||"";
     if(!pilot||item.sender?.id!==config.pageId||!pilot.testers.has(psid)||!mid){ignored+=1;continue;}
     const origin=classifyMessengerEcho(message.app_id,message.metadata,pilot);
     if(origin.kind==="unknown"){unknownEcho+=1;continue;}
     if(origin.kind==="human"){
      if(!body&&!message.attachments?.length){ignored+=1;continue;}
      await messengerSaleRpc("extra_messenger_ai_record_human_echo",{
       p_page_id:config.pageId,p_psid:psid,p_mid:mid,p_text:body.slice(0,1200)||null,p_sent_at:messengerEventTime(item.timestamp)
      });
     }else{
      await messengerSaleRpc("extra_messenger_ai_confirm_echo",{
       p_page_id:config.pageId,p_psid:psid,p_token:origin.token,p_meta_mid:mid,p_sender:origin.kind,p_sent_at:messengerEventTime(item.timestamp)
      });
     }
     continue;
    }
    const psid=item?.sender?.id||"";
    const testConversation=pilot&&pilot.testers.has(psid)&&item.recipient?.id===config.pageId;
    if(pilot&&!testConversation){ignored+=1;continue;}
    const referral=testConversation?readMessengerAdReferral(message?.referral??item.referral??item.postback?.referral):null;
    if(referral&&(!body||!mid)){
     await messengerSaleRpc("extra_messenger_ai_record_referral",{
      p_page_id:config.pageId,p_psid:psid,p_referral:referral,p_sent_at:messengerEventTime(item.timestamp)
     });
     continue;
    }
    if(!mid||!psid||!body){ignored+=1;continue;}
    if(body.length>1200){ignored+=1;continue;}
    if(testConversation){
     const wantsHuman=customerRequestsHuman(body);
     const result=await messengerSaleRpc<Ingest>("extra_messenger_ai_ingest",{
      p_page_id:config.pageId,p_psid:psid,p_mid:mid,p_text:body,p_sent_at:messengerEventTime(item.timestamp),
      p_referral:referral,p_request_human:wantsHuman
     });
     if(result.outcome==="received")processed+=1;
     else if(result.outcome==="duplicate")duplicate+=1;
     else{ignored+=1;continue;}
     if(result.chat_id)work.set(result.chat_id,psid);
     handoff ||= wantsHuman;
     continue;
    }
    const result=await staffDb("rpc/extra_support_ingest_messenger",{
     method:"POST",body:JSON.stringify({p_page_id:config.pageId,p_psid:psid,p_mid:mid,p_text:body})
    }) as Ingest;
    if(result.outcome==="invalid"){ignored+=1;continue;}
    if(result.outcome==="duplicate"){duplicate+=1;continue;}
    if(result.outcome==="received"&&result.chat_id){
     processed+=1;
     try{await staffDb("rpc/extra_support_assign_chat",{method:"POST",body:JSON.stringify({p_chat_id:result.chat_id})})}
     catch{console.warn("[messenger-webhook] Chat queued; assignment retry on next inbox load")}
    }
   }
  }
 }catch{
  console.error("[messenger-webhook] Ingest failed; ask Meta to retry");
  return reply("Temporary processing failure",503);
 }
 if(pilot&&work.size){
  after(async()=>{
   if(handoff){
    await messengerSaleRpc("extra_support_dispatch_queue",{p_limit:64}).catch(()=>console.warn("[messenger-webhook] Human request is queued"));
   }
   await processMessengerSaleChats([...work].map(([chat_id,psid])=>({chat_id,psid})),pilot);
  });
 }
 // Deliberately no Page IDs, PSIDs, message bodies, tokens, or signatures in logs.
 console.info("[messenger-webhook] Completed",JSON.stringify({processed,ignored,unmatchedPages,duplicate,unknownEcho}));
 return reply("EVENT_RECEIVED",200);
}

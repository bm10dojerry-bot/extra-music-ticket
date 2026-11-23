import {NextRequest,NextResponse} from "next/server";
import {createHmac,timingSafeEqual} from "node:crypto";
import {staffDb} from "../../../../../lib/staff-auth";
import {getMessengerConfig} from "../../../../../lib/facebook-messenger";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(message:string,status:number)=>new NextResponse(message,{status,headers:{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8"}});
const constantTimeEquals=(a:string,b:string)=>{
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
};
export async function GET(req:NextRequest){
 const config=getMessengerConfig();
 if(!config)return reply("Messenger Page integration not configured",503);
 const q=req.nextUrl.searchParams;
 const mode=q.get("hub.mode")||"",token=q.get("hub.verify_token")||"",challenge=q.get("hub.challenge")||"";
 if(mode==="subscribe"&&constantTimeEquals(token,config.verifyToken)&&challenge.length<512)return reply(challenge,200);
 return reply("Webhook verification denied",403);
}
type Event={sender?:{id?:string};recipient?:{id?:string};message?:{mid?:string;text?:string;is_echo?:boolean};};
type PageEntry={id?:string;messaging?:Event[]};
type Body={object?:string;entry?:PageEntry[]};
type Ingest={outcome:string;chat_id?:string};
export async function POST(req:NextRequest){
 const config=getMessengerConfig();
 if(!config)return reply("Messenger Page integration not configured",503);
 const size=Number(req.headers.get("content-length")||0);
 if(size>150000)return reply("Payload too large",413);
 const raw=await req.text();
 if(raw.length>150000)return reply("Payload too large",413);
 const provided=req.headers.get("x-hub-signature-256")||"";
 if(!/^sha256=[a-f0-9]{64}$/i.test(provided)){console.warn("[messenger-webhook] Rejected missing or malformed signed webhook");return reply("Invalid signature",403);}
 const expected="sha256="+createHmac("sha256",config.appSecret).update(raw).digest("hex");
 if(!constantTimeEquals(provided.toLowerCase(),expected)){console.warn("[messenger-webhook] Rejected signature mismatch; check App Secret belongs to connected Meta App");return reply("Invalid signature",403);}
 let data:Body;
 try{data=JSON.parse(raw) as Body}catch{return reply("Invalid JSON",400)}
 if(data.object!=="page"||!Array.isArray(data.entry)){
  console.info("[messenger-webhook] Verified non-page event ignored");
  return reply("Ignored",200);
 }
 let processed=0,ignored=0,unmatchedPages=0,duplicate=0;
 console.info("[messenger-webhook] Verified signed Page payload, entryCount",Math.min(data.entry.length,30));
 try{
  for(const page of data.entry.slice(0,30)){
   if(page.id!==config.pageId||!Array.isArray(page.messaging)){unmatchedPages+=1;continue;}
   for(const item of page.messaging.slice(0,35)){
    const mid=item.message?.mid||"",psid=item.sender?.id||"",body=typeof item.message?.text==="string"?item.message.text.trim():"";
    if(item.message?.is_echo||!mid||!psid||!body){ignored+=1;continue;}
    if(body.length>1200){ignored+=1;continue;}
    const result=await staffDb("rpc/extra_support_ingest_messenger",{
     method:"POST",body:JSON.stringify({p_page_id:config.pageId,p_psid:psid,p_mid:mid,p_text:body})
    }) as Ingest;
    if(result.outcome==="invalid"){ignored+=1;continue;}
    if(result.outcome==="duplicate"){duplicate+=1;continue;}
    if(result.outcome==="received"&&result.chat_id){
     processed+=1;
     try{await staffDb("rpc/extra_support_assign_chat",{method:"POST",body:JSON.stringify({p_chat_id:result.chat_id})})}
     catch(err){console.warn("[messenger-webhook] Chat queued; assignment retry on next inbox load",err instanceof Error?err.message:"unknown")}
    }
   }
  }
 }catch(err){
  console.error("[messenger-webhook] Ingest failed; ask Meta to retry",err instanceof Error?err.message:"unknown");
  return reply("Temporary processing failure",503);
 }
 // Deliberately no Page IDs, PSIDs, message bodies, tokens, or signatures in logs.
 console.info("[messenger-webhook] Completed",JSON.stringify({processed,ignored,unmatchedPages,duplicate}));
 return reply("EVENT_RECEIVED",200);
}

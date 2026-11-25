import "server-only";
import {staffDb} from "./staff-auth";
import {COMMENT_PAGE_ID,commentOptOut} from "./ai-comment-policy";

type Context={comment:string;post:string;firstReply:string;showId:string|null};
/** Resolve only a real, already-ingested Messenger event; never use a comment author's ID as a recipient. */
export async function recordCommentMessengerInbound(pageId:string,item:unknown):Promise<void>{
 if(pageId!==COMMENT_PAGE_ID||!item||typeof item!=="object")return;
 const event=item as {sender?:{id?:string};recipient?:{id?:string};timestamp?:number;message?:{mid?:string;text?:string;is_echo?:boolean}};
 const psid=event.sender?.id,mid=event.message?.mid,stamp=event.timestamp;
 if(event.recipient?.id!==pageId||event.message?.is_echo||typeof psid!=="string"||!/^\d{5,80}$/.test(psid)||typeof mid!=="string"||mid.length<1||mid.length>200||typeof stamp!=="number"||!Number.isFinite(stamp)||stamp>Date.now()+60000||stamp<Date.now()-7*86400000)return;
 const chats=await staffDb("extra_support_chats?channel=eq.messenger&messenger_page_id=eq."+pageId+"&messenger_psid=eq."+psid+"&select=id&limit=1") as {id:string}[];
 if(!chats[0])return;
 await staffDb("rpc/extra_comment_ai_record_inbound",{method:"POST",body:JSON.stringify({p_page_id:pageId,p_psid:psid,p_chat_id:chats[0].id,p_mid:mid,p_message_at:new Date(stamp).toISOString(),p_opt_out:commentOptOut(event.message?.text||"")})});
}
/** This optional context can fail without disrupting ordinary checkout or paid-ticket delivery. */
export async function getCommentContextForChat(chatId:string):Promise<Context|null>{
 if(!/^[0-9a-f-]{36}$/i.test(chatId))return null;
 try{
  const rows=await staffDb("extra_comment_ai_leads?chat_id=eq."+chatId+"&page_id=eq."+COMMENT_PAGE_ID+"&state=eq.sent&responded_at=not.is.null&sent_at=gte."+encodeURIComponent(new Date(Date.now()-7*86400000).toISOString())+"&select=body,post_text,reply_body,show_id&order=sent_at.desc&limit=1") as {body:string;post_text:string;reply_body:string;show_id:string|null}[];
  const lead=rows[0];
  if(!lead){
   type Referral={allocation:{post:{show_id:string}|null}|null};
   const since=encodeURIComponent(new Date(Date.now()-7*86400000).toISOString());
   const matched=await staffDb("extra_marketing_referrals?chat_id=eq."+chatId+"&referral_at=gte."+since+"&select=allocation:extra_marketing_allocations!inner(post:extra_marketing_posts!inner(show_id))&order=referral_at.desc&limit=1",{signal:AbortSignal.timeout(1800)}) as Referral[];
   const showId=matched[0]?.allocation?.post?.show_id;
   return showId&&/^[a-z0-9-]{3,100}$/.test(showId)?{comment:"",post:"",firstReply:"",showId}:null;
  }
  return {comment:lead.body.slice(0,1500),post:lead.post_text.slice(0,2500),firstReply:lead.reply_body.slice(0,1000),showId:lead.show_id};
 }catch{return null;}
}

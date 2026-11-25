import "server-only";
import {createHash} from "node:crypto";
import {staffDb} from "./staff-auth";

type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:null;
const id=(value:unknown,max=40):value is string=>typeof value==="string"&&new RegExp("^[0-9]{5,"+max+"}$").test(value);
const sevenDays=7*24*60*60*1000;

export type MarketingMessengerReferral={
 pageId:string;psid:string;adId:string;referralAt:string;sourceEventId:string;
};

// Call only on the original Messenger event after the webhook has verified its
// HMAC. Customer message text, postback payloads and arbitrary `ref` strings are
// deliberately not referral evidence. SQL is the final account/ad allowlist.
export function extractMarketingMessengerReferral(pageId:string,value:unknown,now=Date.now()):MarketingMessengerReferral|null{
 const event=object(value),message=object(event?.message),postback=object(event?.postback);
 const psid=object(event?.sender)?.id,recipient=object(event?.recipient)?.id;
 if(!id(pageId)||!event||!id(psid,80)||psid===pageId||recipient!==pageId||message?.is_echo)return null;
 const timestamp=event.timestamp;
 if(typeof timestamp!=="number"||!Number.isSafeInteger(timestamp)||timestamp<now-sevenDays||timestamp>now+60_000)return null;
 // Meta can attach the ad referral to a message, a postback, or the standalone
 // messaging_referrals event. Conflicting ad IDs fail closed.
 const adIds=[event.referral,message?.referral,postback?.referral].flatMap(value=>{
  const referral=object(value);
  return referral?.source==="ADS"&&id(referral.ad_id)?[referral.ad_id]:[];
 });
 const unique=[...new Set(adIds)];
 if(unique.length!==1)return null;
 const adId=unique[0];
 const mid=[message?.mid,postback?.mid].find(value=>typeof value==="string"&&value.length>=4&&value.length<=200);
 const eventIdentity=typeof mid==="string"?"mid:"+mid:"time:"+timestamp;
 const digest=createHash("sha256").update(JSON.stringify([pageId,psid,adId,eventIdentity])).digest("hex");
 return {pageId,psid,adId,referralAt:new Date(timestamp).toISOString(),sourceEventId:"meta-ad-referral:v1:"+digest};
}

export async function recordMarketingMessengerReferral(referral:MarketingMessengerReferral):Promise<"recorded"|"duplicate"|"ignored">{
 const chats=await staffDb("extra_support_chats?channel=eq.messenger&messenger_page_id=eq."+encodeURIComponent(referral.pageId)+"&messenger_psid=eq."+encodeURIComponent(referral.psid)+"&select=id&limit=1") as {id:string}[];
 const chat=chats[0];
 // A standalone ad click never creates a conversation or triggers AI sales.
 if(!chat)return "ignored";
 const result=await staffDb("rpc/extra_marketing_record_referral",{method:"POST",body:JSON.stringify({
  p_chat_id:chat.id,p_ad_id:referral.adId,p_referral_at:referral.referralAt,p_source_event_id:referral.sourceEventId
 })}) as {outcome?:string};
 // The service-only RPC verifies this ad belongs to the configured marketing
 // account/Page and that the referral occurred within its actual delivery window.
 return result?.outcome==="recorded"?"recorded":result?.outcome==="duplicate"?"duplicate":"ignored";
}

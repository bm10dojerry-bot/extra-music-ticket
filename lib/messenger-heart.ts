import "server-only";
import {createHash} from "node:crypto";
import {staffDb} from "./staff-auth";
import {getMessengerGraphConfig} from "./facebook-messenger";
import {friendlyAcknowledgement,quietSalesTurn} from "./messenger-conversation-style";

type Turn={sender:string;body:string};
type Gate={verified_at:string|null;test_digest:string|null;test_until:string|null;attempted_at:string|null};
export async function maybeSendHeart(page:string,psid:string,mid:string,history:readonly Turn[],guard:()=>Promise<unknown>){
 const body=history.at(-1)?.body??"";
 if(page!=="1223940670813189" || !/^\d{5,80}$/.test(psid) || !/^m[_:A-Za-z0-9.=-]{4,239}$/.test(mid) ||
    history.at(-1)?.sender!=="customer" || !friendlyAcknowledgement(body)?.heart || history.slice(-3).some(m=>quietSalesTurn(m.body)))return;
 const path="extra_messenger_heart_verification?page_id=eq."+page;
 const [gate]=await staffDb(path+"&select=verified_at,test_digest,test_until,attempted_at&limit=1",{signal:AbortSignal.timeout(1300)}) as Gate[];
 if(!gate)return;
 const digest=createHash("sha256").update(body.normalize("NFC").trim()).digest("hex");
 const test=Boolean(!gate.verified_at && gate.test_digest===digest && !gate.attempted_at && Date.parse(gate.test_until??"")>Date.now());
 if(!gate.verified_at&&!test)return;
 const cfg=await getMessengerGraphConfig();if(cfg?.pageId!==page)return;
 await guard();
 if(test){
   const claim=await staffDb(path+"&test_digest=eq."+digest+"&attempted_at=is.null&test_until=gt."+new Date().toISOString()+"&select=page_id",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({attempted_at:new Date().toISOString()})}) as unknown[];
   if(!claim?.length)return;
 }
 const response=await fetch("https://graph.facebook.com/"+cfg.apiVersion+"/"+page+"/messages",{method:"POST",
  headers:{Authorization:"Bearer "+cfg.pageToken,"Content-Type":"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(2800),
  body:JSON.stringify({recipient:{id:psid},sender_action:"react",payload:{message_id:mid,reaction:"love"}})});
 const ack=await response.json().catch(()=>null) as {success?:boolean;recipient_id?:string;error?:{code?:number;error_subcode?:number}}|null;
 if(!response.ok||!ack||ack.error){
   if(gate.verified_at && (ack?.error?.code===190||ack?.error?.error_subcode===2018311))await staffDb(path,{method:"PATCH",body:JSON.stringify({verified_at:null})});
   return;
 }
 if(test && (ack.recipient_id===psid||ack.success===true)){
   await staffDb(path+"&test_digest=eq."+digest,{method:"PATCH",body:JSON.stringify({acknowledged_at:new Date().toISOString()})});
 }
}

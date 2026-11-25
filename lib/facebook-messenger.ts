import "server-only";
import {resolveFacebookPageCredential} from "./facebook-page-connection";

type Config={pageId:string;pageToken:string;appSecret:string;verifyToken:string;apiVersion:string};
export function getMessengerConfig():Config|null{
 const pageId=process.env.META_MESSENGER_PAGE_ID||"";
 const pageToken=process.env.META_MESSENGER_PAGE_ACCESS_TOKEN||"";
 const appSecret=process.env.META_MESSENGER_APP_SECRET||"";
 const verifyToken=process.env.META_MESSENGER_VERIFY_TOKEN||"";
 const apiVersion=process.env.META_MESSENGER_GRAPH_VERSION||"v24.0";
 if(!/^[0-9]{5,40}$/.test(pageId)||pageToken.length<20||appSecret.length<16||verifyToken.length<16||!/^v\d{1,3}\.\d{1,2}$/.test(apiVersion))return null;
 return {pageId,pageToken,appSecret,verifyToken,apiVersion};
}
/** Webhook verification stays synchronous; Graph calls use the managed Page grant. */
export async function getMessengerGraphConfig():Promise<Config|null>{
 const config=getMessengerConfig();
 if(!config)return null;
 try{
  const credential=await resolveFacebookPageCredential();
  if(!credential||credential.pageId!==config.pageId||credential.pageToken.length<20)return null;
  return {...config,pageToken:credential.pageToken};
 }catch{return null;}
}
type SendResponse={recipient_id?:string;message_id?:string;error?:{message?:string;code?:number}};
export class MessengerSendError extends Error {
 constructor(public readonly ambiguous:boolean,public readonly statusCode?:number,public readonly providerCode?:number){super(ambiguous?"Messenger delivery acknowledgement is unknown":"Messenger rejected the message");this.name="MessengerSendError";}
}
export async function sendMessengerPageMessage(psid:string,message:string):Promise<{messageId:string}>{
 const config=await getMessengerGraphConfig();
 if(!config||!/^[0-9]{5,80}$/.test(psid))throw new MessengerSendError(false);
 let res:Response;
 try{res=await fetch("https://graph.facebook.com/"+config.apiVersion+"/"+config.pageId+"/messages",{
  method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+config.pageToken},
  body:JSON.stringify({recipient:{id:psid},messaging_type:"RESPONSE",message:{text:message}}),
  cache:"no-store",redirect:"error",signal:AbortSignal.timeout(9500)
 });}catch{throw new MessengerSendError(true);}
 const data=await res.json().catch(()=>({})) as SendResponse;
 if(!res.ok||!data.message_id){
  console.warn("[messenger-api] Failed",res.status,typeof data.error?.code==="number"?data.error.code:"unknown");
  const knownRejected=!res.ok&&(typeof data.error?.code==="number"||(res.status>=400&&res.status<500&&res.status!==408));
  throw new MessengerSendError(!knownRejected,res.status,data.error?.code);
 }
 return {messageId:data.message_id};
}

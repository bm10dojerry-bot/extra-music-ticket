import "server-only";

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
type SendResponse={recipient_id?:string;message_id?:string;error?:{message?:string;code?:number}};
export class MessengerSendError extends Error {
 constructor(readonly deliveryUncertain:boolean){
  super("Facebook chưa xác nhận gửi tin. Kiểm tra quyền Page và cửa sổ trả lời.");
 }
}

export function messengerOutboundMetadata(kind:"ai"|"staff",token:string){
 return `extra-sale-2:${kind}:${token}`;
}

export async function sendMessengerPageMessage(psid:string,message:string,metadata?:string):Promise<{messageId:string}>{
 const config=getMessengerConfig();
 if(!config)throw Error("Messenger API chưa được cấp quyền Fanpage hoặc chưa cấu hình trong Vercel");
 if(!/^[0-9]{5,80}$/.test(psid))throw Error("Mã khách Messenger không hợp lệ");
 const res=await fetch("https://graph.facebook.com/"+config.apiVersion+"/"+config.pageId+"/messages",{
  method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+config.pageToken},
  body:JSON.stringify({recipient:{id:psid},messaging_type:"RESPONSE",message:{text:message,...(metadata?{metadata}:{})}}),
  cache:"no-store",signal:AbortSignal.timeout(9500)
 }).catch(()=>{throw new MessengerSendError(true)});
 const data=await res.json().catch(()=>({})) as SendResponse;
 if(!res.ok||!data.message_id){
  console.warn("[messenger-api] Failed",res.status,typeof data.error?.code==="number"?data.error.code:"unknown");
  throw new MessengerSendError(res.ok||res.status>=500||typeof data.error?.code!=="number");
 }
 return {messageId:data.message_id};
}

export async function getMessengerDisplayName(psid:string):Promise<string|undefined>{
 const config=getMessengerConfig();
 if(!config||!/^\d{5,80}$/.test(psid))return;
 try{
  const response=await fetch(`https://graph.facebook.com/${config.apiVersion}/${psid}?fields=first_name,last_name`,{
   headers:{Authorization:`Bearer ${config.pageToken}`},cache:"no-store",signal:AbortSignal.timeout(1500)
  });
  if(!response.ok)return;
  const profile=await response.json() as {first_name?:unknown;last_name?:unknown};
  return [profile.first_name,profile.last_name].filter((value):value is string=>typeof value==="string")
   .join(" ").replace(/[\p{Cc}\p{Cf}]/gu,"").replace(/\s+/g," ").trim().slice(0,60)||undefined;
 }catch{return undefined}
}

export async function sendMessengerTypingAction(psid:string,action:"typing_on"|"typing_off"){
 const config=getMessengerConfig();
 if(!config||!/^\d{5,80}$/.test(psid))return;
 await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.pageId}/messages`,{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${config.pageToken}`},
  body:JSON.stringify({recipient:{id:psid},sender_action:action}),cache:"no-store",signal:AbortSignal.timeout(1500)
 }).catch(()=>undefined);
}

/**
 * Send a previously hosted HTTPS audio file after explicit user consent.
 * The caller must use a short-lived, access-controlled audio URL and must
 * verify Meta accepts the attachment with a permitted test account first.
 * This helper does not itself imply user consent or enable voice delivery.
 */
export async function sendMessengerPageAudio(psid:string,audioUrl:string):Promise<{messageId:string}>{
 const config=getMessengerConfig();
 if(!config)throw Error("Messenger Page chưa được cấu hình");
 if(!/^[0-9]{5,80}$/.test(psid))throw Error("Mã khách Messenger không hợp lệ");
 const parsed=new URL(audioUrl);
 if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw Error("Audio URL phải là HTTPS hợp lệ");
 const res=await fetch("https://graph.facebook.com/"+config.apiVersion+"/"+config.pageId+"/messages",{
  method:"POST",
  headers:{"Content-Type":"application/json","Authorization":"Bearer "+config.pageToken},
  body:JSON.stringify({recipient:{id:psid},messaging_type:"RESPONSE",message:{attachment:{type:"audio",payload:{url:parsed.toString(),is_reusable:false}}}}),
  cache:"no-store",signal:AbortSignal.timeout(9500)
 });
 const data=await res.json().catch(()=>({})) as SendResponse;
 if(!res.ok||!data.message_id){
  console.warn("[messenger-api] Audio send failed",res.status,typeof data.error?.code==="number"?data.error.code:"unknown");
  throw Error("Facebook chưa chấp nhận gửi Voice; tiếp tục tư vấn bằng chữ.");
 }
 return {messageId:data.message_id};
}

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
export async function sendMessengerPageMessage(psid:string,message:string):Promise<{messageId:string}>{
 const config=getMessengerConfig();
 if(!config)throw Error("Messenger API chưa được cấp quyền Fanpage hoặc chưa cấu hình trong Vercel");
 if(!/^[0-9]{5,80}$/.test(psid))throw Error("Mã khách Messenger không hợp lệ");
 const res=await fetch("https://graph.facebook.com/"+config.apiVersion+"/"+config.pageId+"/messages",{
  method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+config.pageToken},
  body:JSON.stringify({recipient:{id:psid},messaging_type:"RESPONSE",message:{text:message}}),
  cache:"no-store",signal:AbortSignal.timeout(9500)
 });
 const data=await res.json().catch(()=>({})) as SendResponse;
 if(!res.ok||!data.message_id){
  console.warn("[messenger-api] Failed",res.status,typeof data.error?.code==="number"?data.error.code:"unknown");
  throw Error("Facebook không chấp nhận gửi tin. Kiểm tra quyền Page, giới hạn thời gian trả lời hoặc hộp thư khách.");
 }
 return {messageId:data.message_id};
}

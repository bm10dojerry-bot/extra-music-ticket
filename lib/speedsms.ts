import "server-only";
import {staffDb} from "./staff-auth";
import {paidOrder} from "./extra-ticketing";
import {ticketLinkUrl} from "./ticket-link";
type Delivery={status:string;attempts:number};
type SmsResponse={status?:string;code?:string;message?:string;data?:{tranId?:string|number;totalSMS?:number;totalPrice?:number;invalidPhone?:string[]}};
export function speedSmsConfigured(){
 const type=Number(process.env.SPEEDSMS_SMS_TYPE||"2");
 return Boolean(process.env.SPEEDSMS_ACCESS_TOKEN&&[2,3,4,6].includes(type)&&(type!==3||process.env.SPEEDSMS_SENDER));
}
export function speedSmsEnabled(){return process.env.SPEEDSMS_ENABLED==="true"&&speedSmsConfigured()}
function phoneVN(raw:string){let s=raw.replace(/\D/g,"");if(s.startsWith("0"))s="84"+s.slice(1);return /^84\d{9}$/.test(s)?s:null}
export async function sendSpeedSmsTicket(code:string):Promise<"accepted"|"failed"|"skipped">{
 if(!speedSmsEnabled())return "skipped";
 const order=await paidOrder(code);if(!order||order.status!=="paid")return "skipped";
 const phone=phoneVN(order.buyer_phone);if(!phone)return "skipped";
 const prior=await staffDb("extra_sms_delivery?order_code=eq."+encodeURIComponent(code)+"&select=status,attempts&limit=1") as Delivery[];
 if(prior[0]?.status==="accepted"||prior[0]?.status==="delivered"||prior[0]?.status==="unknown"||prior[0]?.status==="sending"||prior[0]?.attempts>=3)return "skipped";
 const claimed=await staffDb("rpc/extra_claim_sms_delivery",{method:"POST",body:JSON.stringify({p_code:code})});
 if(claimed!==true)return "skipped";
 let requested=false;
 try{
  const url=ticketLinkUrl(code,order.access_token);
  const message="EXTRA MUSIC SHOW: Ve "+code+" da xac nhan. Xem ve QR: "+url+" . Vui long giu kin link.";
  const type=Number(process.env.SPEEDSMS_SMS_TYPE||"2");
  const sender=process.env.SPEEDSMS_SENDER||"";
  const authorization=Buffer.from(process.env.SPEEDSMS_ACCESS_TOKEN+":x").toString("base64");
  requested=true;
  const response=await fetch("https://api.speedsms.vn/index.php/sms/send",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Basic "+authorization},body:JSON.stringify({to:[phone],content:message,sms_type:type,sender}),signal:AbortSignal.timeout(12000),cache:"no-store"});
  const data=await response.json() as SmsResponse;
  if(!response.ok||data.status!=="success"||data.code!=="00"||!data.data?.tranId)throw Error("SpeedSMS rejected: "+String(data.code||response.status));
  await staffDb("extra_sms_delivery?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({status:"accepted",accepted_at:new Date().toISOString(),provider_transaction_id:String(data.data.tranId),provider_sms_count:data.data.totalSMS||null,provider_price:data.data.totalPrice??null,last_error:null,updated_at:new Date().toISOString()})});
  return "accepted";
 }catch(e){
  const msg=e instanceof Error?e.message:"Unknown error";
  const ambiguous=requested&&(/timeout|abort|fetch failed|network|JSON/i.test(msg));
  console.warn("[speedsms] ticket delivery",code,ambiguous?"uncertain":"failed",msg);
  await staffDb("extra_sms_delivery?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({status:ambiguous?"unknown":"failed",last_error:msg.slice(0,150),updated_at:new Date().toISOString()})}).catch(()=>{});
  return "failed";
 }
}

import {staffDb} from "./staff-auth";
type Attribution={order_code:string;show_id:string;consent:boolean;fbp:string;fbc:string;capi_status:string};
type PaidOrder={code:string;show_id:string;status:string;amount_vnd:number;paid_at:string|null};
export const metaPurchaseEventId=(code:string)=>"extra_purchase_"+code;
export async function sendMetaPurchase(code:string):Promise<"sent"|"skipped"|"failed">{
 const token=process.env.META_CAPI_ACCESS_TOKEN;
 if(!token)return "skipped";
 const rows=await staffDb("extra_order_attribution?order_code=eq."+encodeURIComponent(code)+"&select=order_code,show_id,consent,fbp,fbc,capi_status&limit=1") as Attribution[];
 const a=rows[0];if(!a||!a.consent||a.capi_status==="sent")return "skipped";
 const orders=await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code)+"&select=code,show_id,status,amount_vnd,paid_at&limit=1") as PaidOrder[];
 const order=orders[0];if(!order||order.status!=="paid"||order.show_id!==a.show_id)return "skipped";
 const settings=await staffDb("show_landing_content?show_id=eq."+encodeURIComponent(a.show_id)+"&select=meta_pixel_id&limit=1") as {meta_pixel_id:string}[];
 const pixel=settings[0]?.meta_pixel_id||"";
 if(!/^[0-9]{8,25}$/.test(pixel))return "skipped";
 const claimed=await staffDb("rpc/extra_claim_capi_purchase",{method:"POST",body:JSON.stringify({p_code:code})});
 if(claimed!==true)return "skipped";
 const user_data:Record<string,string>={};if(/^fb\.1\.\d{10,16}\.\d+$/.test(a.fbp))user_data.fbp=a.fbp;if(/^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]+$/.test(a.fbc))user_data.fbc=a.fbc;
 try{
  const res=await fetch("https://graph.facebook.com/v24.0/"+pixel+"/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access_token:token,data:[{event_name:"Purchase",event_time:Math.floor(new Date(order.paid_at||Date.now()).getTime()/1000),event_id:metaPurchaseEventId(code),action_source:"website",event_source_url:"https://iextra.net/show/"+encodeURIComponent(a.show_id),user_data,custom_data:{currency:"VND",value:order.amount_vnd,content_ids:[a.show_id],content_type:"product",order_id:code}}]}),signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw Error("Meta CAPI HTTP "+res.status);
  const body=await res.json() as {events_received?:number};if(!body.events_received)throw Error("Meta did not acknowledge event");
  await staffDb("extra_order_attribution?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({capi_status:"sent",capi_sent_at:new Date().toISOString()})});
  return "sent";
 }catch(e){
  console.warn("[meta-capi] Delivery failed for",code,e instanceof Error?e.message:"unknown");
  await staffDb("extra_order_attribution?order_code=eq."+encodeURIComponent(code),{method:"PATCH",body:JSON.stringify({capi_status:"failed"})}).catch(()=>{});
  return "failed";
 }
}

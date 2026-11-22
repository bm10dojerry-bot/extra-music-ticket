import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {sendSpeedSmsTicket,speedSmsConfigured,speedSmsEnabled} from "../../../../lib/speedsms";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 try{
  const rows=await staffDb("extra_sms_delivery?select=order_code,status,attempts,accepted_at,provider_sms_count,provider_price&order=updated_at.desc&limit=50") as {order_code:string;status:string;attempts:number;accepted_at:string|null;provider_sms_count:number|null;provider_price:number|null}[];
  return NextResponse.json({configured:speedSmsConfigured(),enabled:speedSmsEnabled(),type:process.env.SPEEDSMS_SMS_TYPE||"2",senderConfigured:Boolean(process.env.SPEEDSMS_SENDER),rows},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không đọc được trạng thái SMS"},{status:503})}
}
export async function POST(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 if(!speedSmsEnabled())return NextResponse.json({error:"SpeedSMS chưa được kích hoạt."},{status:503});
 try{
  const rows=await staffDb("extra_sms_delivery?status=eq.failed&attempts=lt.3&select=order_code&order=updated_at.asc&limit=5") as {order_code:string}[];
  const summary={accepted:0,failed:0,skipped:0};
  for(const row of rows){const status=await sendSpeedSmsTicket(row.order_code);summary[status]++}
  return NextResponse.json({ok:true,processed:rows.length,...summary});
 }catch{return NextResponse.json({error:"Không gửi lại được SMS"},{status:503})}
}

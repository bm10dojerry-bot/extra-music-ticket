import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {sendZaloTicket,zaloConfigured} from "../../../../lib/zalo-zbs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 const keys=["ZALO_APP_ID","ZALO_APP_SECRET","ZALO_OA_REFRESH_TOKEN","ZALO_OA_ACCESS_TOKEN","ZALO_ZBS_TEMPLATE_ID","ZALO_ZBS_TEMPLATE_FIELDS"];
 const configured=Object.fromEntries(keys.map(k=>[k,Boolean(process.env[k])]));
 try{
  const rows=await staffDb("extra_zalo_delivery?select=order_code,status,attempts,accepted_at,last_error&order=updated_at.desc&limit=50") as {order_code:string;status:string;attempts:number;accepted_at:string|null;last_error:string|null}[];
  return NextResponse.json({ready:zaloConfigured(),configured,rows},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({ready:zaloConfigured(),configured,rows:[],error:"Không tải được nhật ký Zalo"},{headers:{"Cache-Control":"no-store"}})}
}
export async function POST(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 if(!zaloConfigured())return NextResponse.json({error:"Chưa cấu hình Zalo App, OA và template đã duyệt."},{status:503});
 try{
  const rows=await staffDb("extra_payment_orders?status=eq.paid&select=code&order=paid_at.desc&limit=100") as {code:string}[];
  const existing=await staffDb("extra_zalo_delivery?select=order_code,status,attempts&limit=1000") as {order_code:string;status:string;attempts:number}[];
  const byCode=new Map(existing.map(r=>[r.order_code,r]));
  const candidates=rows.filter(r=>!byCode.has(r.code)||["pending","failed"].includes(byCode.get(r.code)!.status)&&byCode.get(r.code)!.attempts<5).slice(0,5);
  const summary={accepted:0,failed:0,skipped:0};
  for(const r of candidates){const status=await sendZaloTicket(r.code);summary[status]++}
  return NextResponse.json({ok:true,processed:candidates.length,...summary});
 }catch{return NextResponse.json({error:"Không thể gửi lại Zalo lúc này"},{status:503})}
}

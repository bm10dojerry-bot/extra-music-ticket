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
  const rows=await staffDb("extra_zalo_delivery?status=in.(pending,failed)&attempts=lt.5&select=order_code&order=updated_at.asc&limit=5") as {order_code:string}[];
  const candidates=rows.map(r=>({code:r.order_code}));
  const summary={accepted:0,failed:0,skipped:0};
  for(const r of candidates){const status=await sendZaloTicket(r.code);summary[status]++}
  return NextResponse.json({ok:true,processed:candidates.length,...summary});
 }catch{return NextResponse.json({error:"Không thể gửi lại Zalo lúc này"},{status:503})}
}

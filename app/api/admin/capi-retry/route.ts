import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {sendMetaPurchase} from "../../../../lib/meta-capi";
export const runtime="nodejs";
export async function POST(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 if(!process.env.META_CAPI_ACCESS_TOKEN)return NextResponse.json({error:"Chưa cấu hình META_CAPI_ACCESS_TOKEN trên Vercel."},{status:503});
 try{
  const rows=await staffDb("extra_order_attribution?consent=eq.true&capi_status=in.(pending,failed)&select=order_code&order=created_at.asc&limit=5") as {order_code:string}[];
  const result={sent:0,failed:0,skipped:0};
  for(const r of rows){const outcome=await sendMetaPurchase(r.order_code);result[outcome]++}
  return NextResponse.json({ok:true,...result,processed:rows.length});
 }catch{return NextResponse.json({error:"Không thể gửi lại CAPI"},{status:503})}
}

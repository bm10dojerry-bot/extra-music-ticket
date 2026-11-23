import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function POST(){
 const actor=await requireRole(["sale"]);
 if(!actor)return NextResponse.json({error:"Không có quyền"},{status:403});
 try{
  await staffDb("extra_live_sales?on_conflict=staff_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({staff_id:actor.id,last_seen:new Date().toISOString()})});
  return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không cập nhật được hoạt động Sale"},{status:503})}
}

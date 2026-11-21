import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const actor=await requireRole(["admin","show_manager","sale","checkin"]);
 if(!actor)return NextResponse.json({error:"Vui lòng đăng nhập nhân viên có quyền check-in"},{status:403});
 const body=await req.json().catch(()=>null);
 const id=String(body?.ticket||""),secret=String(body?.secret||"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{48}$/.test(secret))return NextResponse.json({error:"Mã QR không hợp lệ"},{status:400});
 try{
 const result=await staffDb("rpc/extra_checkin_ticket",{method:"POST",body:JSON.stringify({p_id:id,p_secret:secret,p_staff:actor.display_name})});
 return NextResponse.json({result,success:result==="checked_in"},{status:result==="checked_in"?200:409});
 }catch{return NextResponse.json({error:"Không thể check-in. Kiểm tra SQL 013."},{status:503})}
}

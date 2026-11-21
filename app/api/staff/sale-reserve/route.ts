import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {POST as createPayment} from "../../payments/sepay/create/route";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const actor=await requireRole(["sale"]);
 if(!actor)return NextResponse.json({error:"Chỉ nhân viên Sale được giữ ghế tại đây."},{status:403});
 // Do not create an untracked hold when migration 015 has not been installed.
 try{await staffDb("extra_payment_orders?select=sale_staff_id&limit=1")}
 catch{return NextResponse.json({error:"Admin cần chạy SQL 015 để bật giữ ghế và theo dõi Sale."},{status:503})}
 const response=await createPayment(req);
 if(!response.ok)return response;
 const data=await response.json() as {code:string};
 try{
  await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(data.code),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({sale_staff_id:actor.id})});
 }catch{
  return NextResponse.json({error:"Đã tạo giữ ghế nhưng không gắn được nhân viên Sale. Báo Admin kiểm tra đơn và thử lại sau khi hết hạn giữ ghế."},{status:503});
 }
 return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
}

import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được xem dữ liệu khách và ghế Sale giữ."},{status:403});
 try{
  const [orders,staff,shows]=await Promise.all([
   staffDb("extra_payment_orders?select=code,show_id,seats,buyer_name,buyer_phone,amount_vnd,status,expires_at,created_at,sale_staff_id&sale_staff_id=not.is.null&order=created_at.desc&limit=1000"),
   staffDb("staff_accounts?select=id,display_name,username&limit=1000"),
   loadShows()
  ]);
  const names=new Map((staff as {id:string;display_name:string;username:string}[]).map(s=>[s.id,s.display_name||s.username]));
  const now=Date.now();
  const rows=(orders as {code:string;show_id:string;seats:string[];buyer_name:string;buyer_phone:string;amount_vnd:number;status:string;expires_at:string;created_at:string;sale_staff_id:string}[]).map(o=>({...o,show_name:shows.find(s=>s.id===o.show_id)?.artist||o.show_id,sale_name:names.get(o.sale_staff_id)||"Nhân viên đã nghỉ",effective_status:o.status==="pending"&&Date.parse(o.expires_at)<=now?"expired":o.status}));
  return NextResponse.json({rows,updated_at:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được đơn Sale. Kiểm tra migration 015."},{status:503})}
}

import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 if(!await requireRole(["admin","accountant","show_manager"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 const show=req.nextUrl.searchParams.get("show")||"";
 if(show&&!/^[a-z0-9-]{3,100}$/.test(show))return NextResponse.json({error:"Bộ lọc không hợp lệ"},{status:400});
 try{
 const f=show?"&show_id=eq."+encodeURIComponent(show):"";
 const [orders,tickets]=await Promise.all([
 staffDb("extra_payment_orders?select=code,show_id,seats,amount_vnd,buyer_name,buyer_email,status,paid_at,email_status&status=eq.paid"+f+"&order=paid_at.desc&limit=10000"),
 staffDb("extra_tickets?select=order_code,show_id,seat_id,checked_in_at"+f+"&limit=10000")]);
 const os=orders as {code:string;show_id:string;seats:string[];amount_vnd:number;buyer_name:string;buyer_email:string;status:string;paid_at:string;email_status:string}[];
 const ts=tickets as {order_code:string;show_id:string;seat_id:string;checked_in_at:string|null}[];
 return NextResponse.json({totals:{orders:os.length,revenue:os.reduce((n,o)=>n+Number(o.amount_vnd),0),tickets:ts.length,checkedIn:ts.filter(t=>t.checked_in_at).length},orders:os.map(o=>({...o,checkedIn:ts.filter(t=>t.order_code===o.code&&t.checked_in_at).length})),tickets:ts},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được báo cáo vé. Kiểm tra SQL 013."},{status:503})}
}

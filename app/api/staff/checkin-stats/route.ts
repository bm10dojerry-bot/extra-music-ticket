import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const actor=await requireRole(["admin","show_manager","sale","checkin"]);
 if(!actor)return NextResponse.json({error:"Không có quyền xem thống kê check-in"},{status:403});
 const showId=req.nextUrl.searchParams.get("show")||"";
 if(showId&&!/^[a-z0-9-]{3,100}$/.test(showId))return NextResponse.json({error:"Show không hợp lệ"},{status:400});
 try{
  const shows=await loadShows();
  const filter=showId?"&show_id=eq."+encodeURIComponent(showId):"";
  const [orders,tickets]=await Promise.all([
   staffDb("extra_payment_orders?select=code&status=eq.paid"+filter+"&limit=10000") as Promise<{code:string}[]>,
   staffDb("extra_tickets?select=order_code,checked_in_at"+filter+"&limit=10000") as Promise<{order_code:string;checked_in_at:string|null}[]>
  ]);
  const paidCodes=new Set(orders.map(o=>o.code));
  const valid=tickets.filter(t=>paidCodes.has(t.order_code));
  const checkedIn=valid.filter(t=>t.checked_in_at!==null).length;
  return NextResponse.json({shows:shows.map(s=>({id:s.id,artist:s.artist,date:s.date,venue:s.venue})),showId,total:valid.length,checkedIn,remaining:valid.length-checkedIn,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được thống kê check-in. Kiểm tra SQL 013."},{status:503})}
}

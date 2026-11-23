import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";

type Visitor={session_id:string;show_id:string;stage:"viewing"|"selecting"|"payment";last_seen:string};
type SalePresence={staff_id:string;last_seen:string};
type Staff={id:string;display_name:string;active:boolean};
type Order={show_id:string;seats:string[];expires_at:string};
type Lead={created_by:string;status:string};
export async function GET(){
 if(!await requireRole(["admin","show_manager"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 const now=new Date(),since=new Date(now.getTime()-75000).toISOString();
 try{
  const [visitors,salePresence,saleAccounts,orders,leads,shows]=await Promise.all([
   staffDb("extra_live_visitors?select=session_id,show_id,stage,last_seen&last_seen=gte."+encodeURIComponent(since)+"&limit=5000") as Promise<Visitor[]>,
   staffDb("extra_live_sales?select=staff_id,last_seen&last_seen=gte."+encodeURIComponent(since)+"&limit=1000") as Promise<SalePresence[]>,
   staffDb("staff_accounts?select=id,display_name,active&role=eq.sale&limit=1000") as Promise<Staff[]>,
   staffDb("extra_payment_orders?select=show_id,seats,expires_at&status=eq.pending&expires_at=gt."+encodeURIComponent(now.toISOString())+"&limit=1000") as Promise<Order[]>,
   staffDb("sale_requests?select=created_by,status&limit=10000") as Promise<Lead[]>,
   loadShows()
  ]);
  const lastSeen=new Map(salePresence.map(s=>[s.staff_id,s.last_seen]));
  const onlineSales=saleAccounts.filter(s=>s.active&&lastSeen.has(s.id)).map(s=>({
   name:s.display_name,id:s.id,lastSeen:lastSeen.get(s.id),
   openLeads:leads.filter(l=>l.created_by===s.id&&["new","contacted","awaiting_payment"].includes(l.status)).length
  }));
  const counts=(rows:Visitor[])=>({
   sessions:new Set(rows.map(v=>v.session_id)).size,
   viewing:rows.filter(v=>v.stage==="viewing").length,
   selecting:rows.filter(v=>v.stage==="selecting").length,
   payment:rows.filter(v=>v.stage==="payment").length
  });
  const byShow=shows.map(s=>{
   const rows=visitors.filter(v=>v.show_id===s.id),held=orders.filter(o=>o.show_id===s.id);
   return {showId:s.id,artist:s.artist,date:s.date,...counts(rows),heldOrders:held.length,heldSeats:held.reduce((n,o)=>n+(Array.isArray(o.seats)?o.seats.length:0),0)};
  });
  return NextResponse.json({
   checkedAt:now.toISOString(),
   totals:{...counts(visitors),saleOnline:onlineSales.length,saleEnabled:saleAccounts.filter(s=>s.active).length,heldOrders:orders.length,heldSeats:orders.reduce((n,o)=>n+(Array.isArray(o.seats)?o.seats.length:0),0)},
   shows:byShow,onlineSales,
   partial:visitors.length>=5000||orders.length>=1000||leads.length>=10000,
   note:"Số phiên trình duyệt đang hoạt động, không phải số người duy nhất. Phiên không gửi tín hiệu trong 75 giây không được tính. Ghế giữ chỗ chỉ tính đơn còn thời hạn."
  },{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được giám sát trực tuyến"},{status:503})}
}

import {NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["admin","accountant","show_manager"]))return NextResponse.json({error:"Không có quyền"},{status:403});
 try{
  const [shows,events,attributions,orders]=await Promise.all([
   loadShows(),
   staffDb("extra_landing_funnel?select=show_id,event_name&limit=10000") as Promise<{show_id:string;event_name:string}[]>,
   staffDb("extra_order_attribution?select=order_code,show_id,capi_status&limit=10000") as Promise<{order_code:string;show_id:string;capi_status:string}[]>,
   staffDb("extra_payment_orders?select=code,show_id,status,amount_vnd&limit=10000") as Promise<{code:string;show_id:string;status:string;amount_vnd:number}[]>
  ]);
  const byCode=new Map(orders.map(o=>[o.code,o]));
  const rows=shows.map(s=>{const e=events.filter(x=>x.show_id===s.id),a=attributions.filter(x=>x.show_id===s.id),paid=a.map(x=>byCode.get(x.order_code)).filter((o):o is NonNullable<typeof o>=>Boolean(o&&o.status==="paid"));const views=e.filter(x=>x.event_name==="view").length,checkouts=e.filter(x=>x.event_name==="checkout").length;return {showId:s.id,artist:s.artist,date:s.date,views,checkouts,paidOrders:paid.length,revenue:paid.reduce((n,o)=>n+o.amount_vnd,0),capiSent:a.filter(x=>x.capi_status==="sent").length,capiFailed:a.filter(x=>x.capi_status==="failed").length,conversionRate:views?Math.round(paid.length/views*10000)/100:null}});
  return NextResponse.json({rows,notice:"Chỉ tính phiên đã đồng ý đo lường và đơn landing page có attribution; giới hạn tối đa 10.000 bản ghi mỗi nguồn.",capiConfigured:Boolean(process.env.META_CAPI_ACCESS_TOKEN)},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được thống kê landing page"},{status:503})}
}

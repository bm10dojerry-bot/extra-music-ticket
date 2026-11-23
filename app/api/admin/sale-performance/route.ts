import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getSaleCommissionSettings} from "../../../../lib/sale-commission-db";
import {loadShows} from "../../../../lib/show-data";
import {
  buildSalePerformance,validateSalePerformanceFilters,
  type SalePerformanceAccount,type SalePerformanceOnlineOrder,type SalePerformanceLegacyOrder,
} from "../../../../lib/sale-performance";

export const dynamic="force-dynamic";
export const runtime="nodejs";

class ReportLimitError extends Error {}

/** Continue after a short page as PostgREST can cap it below the requested size.
 * Stop only at an empty page; never return incomplete commission totals.
 */
async function readAll<T>(path:string):Promise<T[]> {
  const rows:T[]=[];
  const maximum=50000;
  while(true){
    const page=await staffDb(path+"&limit=500&offset="+rows.length);
    if(!Array.isArray(page))throw Error("Invalid report data");
    if(page.length===0)return rows;
    if(rows.length+page.length>maximum)throw new ReportLimitError();
    rows.push(...page as T[]);
  }
}

export async function GET(req:NextRequest){
  if(!await requireRole(["admin"]))
    return NextResponse.json({error:"Chỉ quản trị viên được xem thống kê hiệu suất Sale."},{status:403});
  const filters={from:req.nextUrl.searchParams.get("from")||"",
    to:req.nextUrl.searchParams.get("to")||"",show:req.nextUrl.searchParams.get("show")||""};
  const error=validateSalePerformanceFilters(filters);
  if(error)return NextResponse.json({error},{status:400});
  // Fetch all statuses before deduplication. Filtering solely by paid_at here
  // could let a conflicting legacy row override the authoritative online order.
  const showFilter=filters.show?"&show_id=eq."+encodeURIComponent(filters.show):"";
  try{
    const [accounts,onlineOrders,legacyOrders,record,shows]=await Promise.all([
      readAll<SalePerformanceAccount>("staff_accounts?select=id,username,display_name,active,role&role=eq.sale&order=id.asc"),
      readAll<SalePerformanceOnlineOrder>("extra_payment_orders?select=code,show_id,seats,amount_vnd,paid_at,sale_staff_id,is_vip_invitation,status&order=code.asc"),
      readAll<SalePerformanceLegacyOrder>("ticket_sales?select=order_code,show_id,event_name,seats,amount_vnd,paid_at,payment_verified,seller_name&payment_verified=eq.true&order=id.asc"+showFilter),
      getSaleCommissionSettings(),loadShows(),
    ]);
    const settings={rate_1_10:record.rate_1_10,rate_11_30:record.rate_11_30,
      rate_31_50:record.rate_31_50,rate_51_plus:record.rate_51_plus};
    const result=buildSalePerformance({accounts,onlineOrders,legacyOrders,settings,filters,
      shows:shows.map(show=>({id:show.id,artist:show.artist,date:show.date})),
      updatedAt:new Date().toISOString()});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof ReportLimitError)
      return NextResponse.json({error:"Dữ liệu vượt giới hạn xử lý; chưa thể xuất báo cáo đầy đủ."},{status:503});
    console.error("[sale-performance] Report unavailable");
    return NextResponse.json({error:"Không tải được thống kê hiệu suất Sale. Vui lòng thử lại."},{status:503});
  }
}

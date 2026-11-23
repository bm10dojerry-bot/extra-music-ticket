import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getSaleCommissionPolicies} from "../../../../lib/sale-commission-db";
import {
  buildSalePerformance,validateSalePerformanceFilters,readAllSaleReportRows,SalePerformanceLimitError,SalePerformanceDataError,
  type SalePerformanceAccount,type SalePerformanceOnlineOrder,type SalePerformanceLegacyOrder,type SalePerformanceManagedShow,
} from "../../../../lib/sale-performance";

export const dynamic="force-dynamic";
export const runtime="nodejs";

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
    const [accounts,onlineOrders,legacyOrders,shows]=await Promise.all([
      readAllSaleReportRows<SalePerformanceAccount>(staffDb,"staff_accounts?select=id,username,display_name,active,role&role=eq.sale&order=id.asc"),
      readAllSaleReportRows<SalePerformanceOnlineOrder>(staffDb,"extra_payment_orders?select=code,show_id,seats,amount_vnd,paid_at,sale_staff_id,is_vip_invitation,status,commission_lines&order=code.asc"),
      readAllSaleReportRows<SalePerformanceLegacyOrder>(staffDb,"ticket_sales?select=order_code,show_id,event_name,seats,amount_vnd,paid_at,payment_verified,seller_name,commission_lines&payment_verified=eq.true&order=id.asc"+showFilter),
      readAllSaleReportRows<SalePerformanceManagedShow>(staffDb,"managed_shows?select=id,artist,show_date,status&order=id.asc"),
    ]);
    const policies=await getSaleCommissionPolicies(shows.map(show=>show.id));
    const result=buildSalePerformance({accounts,onlineOrders,legacyOrders,policies,filters,
      shows:shows.map(show=>({id:show.id,artist:show.artist,date:show.show_date,hidden:show.status==="hidden"})),
      updatedAt:new Date().toISOString()});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof SalePerformanceDataError)
      return NextResponse.json({error:error.message},{status:503});
    if(error instanceof SalePerformanceLimitError)
      return NextResponse.json({error:"Dữ liệu vượt giới hạn xử lý; chưa thể xuất báo cáo đầy đủ."},{status:503});
    console.error("[sale-performance] Report unavailable");
    return NextResponse.json({error:"Không tải được thống kê hiệu suất Sale. Vui lòng thử lại."},{status:503});
  }
}

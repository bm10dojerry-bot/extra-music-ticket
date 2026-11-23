import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getSaleCommissionPolicies} from "../../../../lib/sale-commission-db";
import {
  buildStaffSaleReport,readAllSaleReportRows,SalePerformanceLimitError,SalePerformanceDataError,validateSalePerformanceFilters,
  type SalePerformanceAccount,type SalePerformanceOnlineOrder,type SalePerformanceLegacyOrder,type SalePerformanceManagedShow,
} from "../../../../lib/sale-performance";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function GET(req:NextRequest){
  const actor=await requireRole(["admin","accountant","sale"]);
  if(!actor)return NextResponse.json({error:"Không có quyền xem báo cáo"},{status:403});
  const filters={from:req.nextUrl.searchParams.get("from")||"",
    to:req.nextUrl.searchParams.get("to")||"",show:req.nextUrl.searchParams.get("show")||""};
  const validation=validateSalePerformanceFilters(filters);
  if(validation)return NextResponse.json({error:validation},{status:400});
  const showFilter=filters.show?"&show_id=eq."+encodeURIComponent(filters.show):"";
  try{
    // Read every status and the complete relevant history. Date filtering happens
    // only after each Sale + show ticket has received its lifetime ordinal.
    const [shows,accounts,onlineOrders,legacyOrders]=await Promise.all([
      readAllSaleReportRows<SalePerformanceManagedShow>(staffDb,"managed_shows?select=id,artist,show_date,status&order=id.asc"),
      readAllSaleReportRows<SalePerformanceAccount>(staffDb,"staff_accounts?select=id,username,display_name,active,role&role=eq.sale&order=id.asc"),
      readAllSaleReportRows<SalePerformanceOnlineOrder>(staffDb,"extra_payment_orders?select=code,show_id,seats,amount_vnd,paid_at,sale_staff_id,is_vip_invitation,status,commission_lines&order=code.asc"),
      readAllSaleReportRows<SalePerformanceLegacyOrder>(staffDb,"ticket_sales?select=order_code,show_id,event_name,venue_name,seats,amount_vnd,payment_method,seller_name,paid_at,payment_verified,commission_lines&payment_verified=eq.true&order=id.asc"+showFilter),
    ]);
    const policies=await getSaleCommissionPolicies(shows.map(show=>show.id));
    const report=buildStaffSaleReport({
      accounts,onlineOrders,legacyOrders,policies,filters,
      shows:shows.map(show=>({id:show.id,artist:show.artist,date:show.show_date,hidden:show.status==="hidden"})),
      updatedAt:new Date().toISOString(),
    },actor.role==="sale"?actor.id:undefined);
    return NextResponse.json(report,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof SalePerformanceDataError)
      return NextResponse.json({error:error.message},{status:503});
    if(error instanceof SalePerformanceLimitError)
      return NextResponse.json({error:"Dữ liệu vượt giới hạn xử lý; chưa thể xuất báo cáo đầy đủ."},{status:503});
    console.error("[staff-reports] Report unavailable");
    return NextResponse.json({error:"Không thể tải báo cáo hoặc cấu hình hoa hồng theo show."},{status:503});
  }
}

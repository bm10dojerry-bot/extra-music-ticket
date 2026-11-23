import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {ticketLinkUrl} from "../../../../lib/ticket-link";
import {readAllSaleReportRows} from "../../../../lib/sale-performance";
import {
  canReadSaleOrder,hasCompleteIssuedTickets,ticketEmailStatus,
  type SaleTicketOrder,type SaleIssuedTicket,
} from "../../../../lib/sale-order-access";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Referrer-Policy":"no-referrer"};
const respond=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers});
const notFound=()=>respond({error:"Không tìm thấy đơn vé được phép truy cập."},404);
const notReady=()=>respond({error:"Vé đang được hoàn tất. Vui lòng thử lại sau."},409);
const fields="id,code,show_id,venue_id,seats,status,sale_staff_id";

export async function GET(req:NextRequest){
  const actor=await requireRole(["sale","admin"]);
  if(!actor)return respond({error:"Không có quyền truy cập vé."},403);
  const code=(req.nextUrl.searchParams.get("code")||"").trim().toUpperCase();
  if(!/^EX[0-9A-F]{16}$/.test(code))return notFound();
  try{
    const path="extra_payment_orders?code=eq."+encodeURIComponent(code);
    const rows=await staffDb(path+"&select="+fields+"&limit=1") as SaleTicketOrder[];
    const order=rows?.[0];
    if(!order||order.code!==code||!canReadSaleOrder(actor,order))return notFound();
    if(order.status!=="paid")return respond({error:"Đơn chưa ở trạng thái đã thanh toán. Chưa thể lấy liên kết vé."},409);
    const tickets=await readAllSaleReportRows<SaleIssuedTicket>(staffDb,
      "extra_tickets?order_id=eq."+encodeURIComponent(order.id)+"&order_code=eq."+encodeURIComponent(code)+
      "&select=order_id,order_code,show_id,venue_id,seat_id,issued_at&order=seat_id.asc");
    if(!hasCompleteIssuedTickets(order,tickets))return notReady();
    // Only retrieve the signing input after authorization and issuance checks.
    // Recheck current ownership, payment and seats before returning the capability.
    const currentRows=await staffDb(path+"&select="+fields+",access_token,email_status&limit=1") as Array<SaleTicketOrder&{
      access_token:string;email_status:unknown;
    }>;
    const current=currentRows?.[0];
    if(!current||current.code!==code||!canReadSaleOrder(actor,current))return notFound();
    if(current.status!=="paid")return respond({error:"Trạng thái đơn đã thay đổi. Vui lòng tải lại trước khi lấy liên kết vé."},409);
    if(!hasCompleteIssuedTickets(current,tickets))return notReady();
    const emailStatus=ticketEmailStatus(current.email_status);
    return respond({code,url:ticketLinkUrl(code,current.access_token),...(emailStatus?{emailStatus}:{})});
  }catch{
    return respond({error:"Chưa thể lấy liên kết vé. Vui lòng thử lại."},503);
  }
}

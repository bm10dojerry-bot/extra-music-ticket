import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {readAllSaleReportRows} from "../../../../lib/sale-performance";
import {canReadSaleOrder,ticketEmailStatus} from "../../../../lib/sale-order-access";
export const dynamic="force-dynamic";
const fail=(error:string,status:number)=>NextResponse.json({error},{status});
export async function GET(){
 const response=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer"}});
 const actor=await requireRole(["sale","admin"]);if(!actor)return response({error:"Không có quyền"},403);
 try{
  const filter=actor.role==="sale"?"created_by=eq."+encodeURIComponent(actor.id)+"&":"";
  const orderFilter=actor.role==="sale"?"&sale_staff_id=eq."+encodeURIComponent(actor.id):"&sale_staff_id=not.is.null";
  const [rows,paidOrders]=await Promise.all([
   staffDb("sale_requests?"+filter+"select=id,show_id,customer_name,customer_phone,requested_seats,note,status,status_confirmed,created_at,created_by&order=created_at.desc&limit=500") as Promise<Array<Record<string,unknown>>>,
   readAllSaleReportRows<{
    code:string;show_id:string;seats:string[];buyer_name:string;buyer_phone:string;buyer_email:string;
    amount_vnd:number;paid_at:string;sale_staff_id:string|null;status:string;email_status:unknown;
   }>(staffDb,"extra_payment_orders?status=eq.paid"+orderFilter+
    "&select=code,show_id,seats,buyer_name,buyer_phone,buyer_email,amount_vnd,paid_at,sale_staff_id,status,email_status&order=paid_at.desc,code.asc"),
  ]);
  if(!Array.isArray(rows))throw Error("Invalid customer request data");
  // Exact online assignment matches the financial report. Legacy name matches
  // cannot override another Sale's ID or grant access to an unassigned order.
  const paid=paidOrders.filter(order=>order.status==="paid"&&Boolean(order.sale_staff_id)&&canReadSaleOrder(actor,order))
   .map(order=>({...order,email_status:ticketEmailStatus(order.email_status)||null}));
  const requests=actor.role==="sale"?rows.filter(row=>row.created_by===actor.id):rows;
  return response({requests,paidCustomers:paid});
 }catch{return response({error:"Không tải được danh sách khách. Kiểm tra dữ liệu thanh toán và quyền Sale."},503);}
}
export async function POST(req:NextRequest){const actor=await requireRole(["sale","admin"]);if(!actor||actor.id==="owner")return fail("Chỉ nhân viên có tài khoản mới tạo yêu cầu bán vé.",403);let body:Record<string,unknown>;try{body=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
const show_id=String(body.show_id||""),customer_name=String(body.customer_name||"").trim(),customer_phone=String(body.customer_phone||"").trim(),note=String(body.note||"").trim();
if(!/^[a-z0-9-]{3,100}$/.test(show_id)||customer_name.length<2||customer_name.length>120||!/^[+0-9 .()-]{8,20}$/.test(customer_phone)||note.length>500)return fail("Vui lòng kiểm tra show, tên khách, số điện thoại.",400);
try{await staffDb("sale_requests",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({show_id,customer_name,customer_phone,note,created_by:actor.id})});return NextResponse.json({ok:true})}catch{return fail("Không lưu được yêu cầu",503)}}
export async function PATCH(req:NextRequest){const actor=await requireRole(["sale","admin"]);if(!actor)return fail("Không có quyền",403);let body:Record<string,unknown>;try{body=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
const id=String(body.id||""),status=String(body.status||"");if(!/^[0-9a-f-]{36}$/.test(id)||!["new","contacted","awaiting_payment","cancelled"].includes(status))return fail("Trạng thái không hợp lệ",400);
try{
 const result=await staffDb("rpc/extra_confirm_sale_request",{method:"POST",body:JSON.stringify({p_id:id,p_actor:actor.id,p_status:status,p_is_admin:actor.role==="admin"})});
 if(result!==true)return fail("Trạng thái đã xác nhận không thể sửa. Riêng đơn Hủy được phép chọn lại trạng thái.",409);
 return NextResponse.json({ok:true});
}catch{return fail("Không cập nhật được. Admin cần chạy SQL 016.",503)}}

export async function DELETE(req:NextRequest){
 const actor=await requireRole(["admin"]);
 if(!actor)return fail("Chỉ Admin được xóa yêu cầu đã hủy.",403);
 let input:unknown;try{input=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
 const id=String((input as {id?:unknown})?.id||"");
 if(!/^[0-9a-f-]{36}$/.test(id))return fail("Mã yêu cầu không hợp lệ",400);
 try{
  const existing=await staffDb("sale_requests?id=eq."+encodeURIComponent(id)+"&select=id,status&limit=1") as {id:string;status:string}[];
  if(!existing.length)return fail("Yêu cầu không tồn tại hoặc đã được xóa.",404);
  if(existing[0].status!=="cancelled")return fail("Chỉ được xóa yêu cầu có trạng thái Hủy.",409);
  const deleted=await staffDb("sale_requests?id=eq."+encodeURIComponent(id)+"&status=eq.cancelled&select=id",{method:"DELETE",headers:{Prefer:"return=representation"}}) as {id:string}[];
  if(!deleted?.length)return fail("Trạng thái đã thay đổi, vui lòng tải lại.",409);
  return NextResponse.json({ok:true,deletedId:id},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("Không xóa được yêu cầu. Vui lòng kiểm tra dữ liệu.",503)}
}

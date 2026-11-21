import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
const fail=(error:string,status:number)=>NextResponse.json({error},{status});
export async function GET(){const actor=await requireRole(["sale","admin"]);if(!actor)return fail("Không có quyền",403);
try{const filter=actor.role==="sale"?"created_by=eq."+encodeURIComponent(actor.id)+"&":"";const rows=await staffDb("sale_requests?"+filter+"select=id,show_id,customer_name,customer_phone,requested_seats,note,status,status_confirmed,created_at,created_by&order=created_at.desc&limit=500");
 // Match paid customers to the same verified orders used by the Sale revenue report.
 // Legacy ticket_sales orders may not have sale_staff_id on extra_payment_orders.
 const [paidOrders,sales]=await Promise.all([
  staffDb("extra_payment_orders?status=eq.paid&select=code,show_id,seats,buyer_name,buyer_phone,buyer_email,amount_vnd,paid_at,sale_staff_id&order=paid_at.desc&limit=10000") as Promise<{code:string;show_id:string;seats:string[];buyer_name:string;buyer_phone:string;buyer_email:string;amount_vnd:number;paid_at:string;sale_staff_id:string|null}[]>,
  staffDb("ticket_sales?payment_verified=eq.true&select=order_code,seller_name&limit=10000") as Promise<{order_code:string;seller_name:string|null}[]>
 ]);
 const attributed=new Set(sales.filter(x=>x.seller_name===actor.display_name||x.seller_name===actor.username).map(x=>x.order_code.toUpperCase()));
 const paid=paidOrders.filter(o=>actor.role==="admin"?Boolean(o.sale_staff_id):o.sale_staff_id===actor.id||attributed.has(o.code.toUpperCase()));
 return NextResponse.json({requests:rows,paidCustomers:paid},{headers:{"Cache-Control":"no-store"}})}catch{return fail("Không tải được danh sách khách. Kiểm tra dữ liệu thanh toán và quyền Sale.",503)}}
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

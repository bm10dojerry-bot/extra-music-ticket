import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../../lib/staff-auth";
import {deliverTickets,paidOrder} from "../../../../../lib/extra-ticketing";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","accountant"]))return NextResponse.json({error:"Không có quyền gửi vé"},{status:403});
 if(!process.env.RESEND_API_KEY||!process.env.TICKET_FROM_EMAIL)return NextResponse.json({error:"Chưa cấu hình RESEND_API_KEY và TICKET_FROM_EMAIL trên Vercel"},{status:503});
 const body=await req.json().catch(()=>null),code=String(body?.code||"");
 if(!/^EX[0-9A-F]{16}$/.test(code))return NextResponse.json({error:"Mã đơn không hợp lệ"},{status:400});
 try{const order=await paidOrder(code);if(!order||order.status!=="paid")return NextResponse.json({error:"Đơn chưa thanh toán"},{status:409});if(order.email_status==="sent")return NextResponse.json({error:"Email đã gửi; không gửi trùng"},{status:409});await deliverTickets(code);return NextResponse.json({ok:true})}catch{return NextResponse.json({error:"Không gửi được email. Xem Vercel Logs."},{status:503})}
}

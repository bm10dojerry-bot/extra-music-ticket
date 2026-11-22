import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
import {seatsFor,type VenueId} from "../../../../lib/venues";
import {deliverTickets} from "../../../../lib/extra-ticketing";
import {sendZaloTicket} from "../../../../lib/zalo-zbs";
import {sendSpeedSmsTicket} from "../../../../lib/speedsms";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được tạo vé mời VIP."},{status:403});
 const data=await req.json().catch(()=>null);
 const showId=String(data?.showId||""),seatId=String(data?.seatId||""),name=String(data?.name||"").trim(),phone=String(data?.phone||"").trim(),email=String(data?.email||"").trim().toLowerCase();
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||!/^[A-O][0-9]{2}$/.test(seatId)||name.length<2||name.length>120||!/^[0-9+(). -]{9,20}$/.test(phone)||phone.replace(/\D/g,"").length<9||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return NextResponse.json({error:"Vui lòng nhập đúng tên, số điện thoại và email khách mời."},{status:400});
 const show=(await loadShows()).find(s=>s.id===showId);
 if(!show||["ended","hidden"].includes(show.status))return NextResponse.json({error:"Show không tồn tại hoặc đã kết thúc."},{status:404});
 try{
  const counts=await staffDb("venue_seat_rows?venue_id=eq."+encodeURIComponent(show.venue)+"&select=row_code,seat_count") as {row_code:string;seat_count:number}[];
  const valid=seatsFor(show.venue as VenueId,Object.fromEntries(counts.map(x=>[x.row_code,x.seat_count]))).some(s=>s.id===seatId);
  if(!valid)return NextResponse.json({error:"Ghế không tồn tại trong sơ đồ."},{status:400});
  const code="EX"+randomBytes(8).toString("hex").toUpperCase(),token=randomBytes(24).toString("hex");
  await staffDb("rpc/extra_create_vip_invitation",{method:"POST",body:JSON.stringify({p_code:code,p_token:token,p_show:showId,p_venue:show.venue,p_seat:seatId,p_name:name,p_phone:phone,p_email:email})});
  let emailSent=false,emailError="";
  try{await deliverTickets(code);const rows=await staffDb("extra_payment_orders?code=eq."+code+"&select=email_status&limit=1") as {email_status:string}[];emailSent=rows[0]?.email_status==="sent";if(!emailSent)emailError="Email chưa được cấu hình hoặc chưa gửi thành công."}catch(e){emailError=e instanceof Error?e.message:"Email chưa gửi được"}
  const smsStatus=await sendSpeedSmsTicket(code).catch(()=>"failed" as const);
  const zaloStatus=await sendZaloTicket(code).catch(()=>"failed" as const);
  return NextResponse.json({ok:true,code,seatId,showId,emailSent,emailError,smsStatus,zaloStatus,ticketUrl:"https://iextra.net/ve?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(token)},{headers:{"Cache-Control":"no-store"}});
 }catch(e){
  const message=e instanceof Error?e.message:"";
  if(/Seat already sold or held|Seat blocked/.test(message))return NextResponse.json({error:"Ghế đã bán, đang được giữ hoặc đã khóa. Vui lòng chọn ghế khác."},{status:409});
  console.error("[vip-invite] Create failed",message);
  return NextResponse.json({error:"Chưa thể tạo vé mời VIP. Vui lòng thử lại."},{status:503});
 }
}

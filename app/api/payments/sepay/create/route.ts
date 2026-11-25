import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {loadShows} from "../../../../../lib/show-data";
import {seatsFor,venues,type VenueId} from "../../../../../lib/venues";
import {requireRole,staffDb} from "../../../../../lib/staff-auth";
import {allocateSaleCommissionLines} from "../../../../../lib/sale-commission";
import {seatFare,validChildSeats} from "../../../../../lib/show-family-policy";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 if(process.env.SEPAY_CHECKOUT_ENABLED!=="true")return NextResponse.json({error:"Thanh toán đang được cấu hình, chưa mở nhận tiền."},{status:503});
 if(!process.env.SEPAY_BANK_ACCOUNT||!process.env.SEPAY_BANK_CODE||!process.env.SEPAY_ACCOUNT_NAME||!process.env.SEPAY_WEBHOOK_KEY)return NextResponse.json({error:"Chưa cấu hình ngân hàng và webhook SePay."},{status:503});
 if((process.env.SEPAY_BANK_CODE||"").toUpperCase()!=="ACB")return NextResponse.json({error:"Ngân hàng nhận tiền phải được cấu hình là ACB trong Vercel."},{status:503});
 try{await staffDb("extra_tickets?select=id&limit=1")}catch{return NextResponse.json({error:"Hệ thống đang kích hoạt vé QR. Vui lòng thử lại sau khi quản trị hoàn tất SQL 013."},{status:503})}
 const body=await req.json().catch(()=>null);
 const showId=String(body?.showId||""),seats=body?.seats,name=String(body?.name||"").trim(),phone=String(body?.phone||"").trim(),email=String(body?.email||"").trim();
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||!Array.isArray(seats)||seats.length<1||seats.length>(body?.promotion&&body.promotion!=="none"?20:12)||seats.some((x:unknown)=>typeof x!=="string")||new Set(seats).size!==seats.length||name.length<2||name.length>120||!/^[0-9+(). -]{9,20}$/.test(phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:"Thông tin đặt vé không hợp lệ."},{status:400});
 const promotion=String(body?.promotion||"none");
 const childSeats=body?.childSeats===undefined?[]:body.childSeats;
 if(!validChildSeats(childSeats,seats))return NextResponse.json({error:"Ghế vé trẻ em phải thuộc các ghế mua và không được trùng."},{status:400});
 const giftSeats=body?.giftSeats??[];
 const giftCounts:Record<string,number>={none:0,couple5:0,buy5:1,buy10:2,buy20:3};
 if(!Object.prototype.hasOwnProperty.call(giftCounts,promotion)||!Array.isArray(giftSeats)||giftSeats.some((x:unknown)=>typeof x!=="string")||new Set(giftSeats).size!==giftSeats.length||giftSeats.some((x:string)=>seats.includes(x)))return NextResponse.json({error:"Ghế tặng hoặc chương trình khuyến mại không hợp lệ."},{status:400});
 if(giftSeats.length!==giftCounts[promotion]||promotion==="buy5"&&seats.length!==5||promotion==="buy10"&&seats.length!==10||promotion==="buy20"&&seats.length!==20||promotion==="none"&&giftSeats.length>0||promotion==="couple5"&&seats.length!==2)return NextResponse.json({error:"Số ghế mua và ghế tặng không đúng chương trình."},{status:400});
 if(promotion!=="none"&&!(await requireRole(["sale"])))return NextResponse.json({error:"Ưu đãi ghế tặng chỉ áp dụng qua tài khoản Sale."},{status:403});
 const show=(await loadShows()).find(x=>x.id===showId);
 if(!show||!venues.some(v=>v.id===show.venue)||["sold_out","ended","live","pending"].includes(show.status))return NextResponse.json({error:"Show không mở bán."},{status:400});
 const layoutRows=await staffDb("venue_seat_rows?venue_id=eq."+encodeURIComponent(show.venue)+"&select=row_code,seat_count") as {row_code:string;seat_count:number}[];
 const counts=Object.fromEntries(layoutRows.map(r=>[r.row_code,r.seat_count]));
 const valid=new Map(seatsFor(show.venue as VenueId,counts).map(s=>[s.id,s.zone]));
 let amount=0;for(const id of seats as string[]){const zone=valid.get(id),price=zone?show.prices[zone as "A"|"B"|"C"|"D"]:null;if(!zone||!Number.isSafeInteger(price)||!price||price<=0)return NextResponse.json({error:"Ghế hoặc giá vé không hợp lệ."},{status:400});amount+=seatFare(price,childSeats.includes(id))}
 if(promotion==="couple5")amount=Math.round(amount*95/100);
 if(giftSeats.length){
  const rank:Record<string,number>={A:0,B:1,C:2,D:3};
  const lowest=Math.max(...(seats as string[]).map(id=>rank[valid.get(id)!]));
  if(giftSeats.some((id:string)=>!valid.has(id)||rank[valid.get(id)!]<lowest))return NextResponse.json({error:"Ghế tặng phải cùng hạng hoặc thấp hơn hạng vé mua thấp nhất."},{status:400});
 }
 const allSeats=[...seats,...giftSeats];
 const code="EX"+randomBytes(8).toString("hex").toUpperCase(),token=randomBytes(24).toString("hex");
 try{
 const commissionLines=allocateSaleCommissionLines((seats as string[]).map(seat=>({seat,price:seatFare(show.prices[valid.get(seat)! as "A"|"B"|"C"|"D"]!,childSeats.includes(seat))})),giftSeats as string[],amount);
 const rows=await staffDb("rpc/extra_reserve_order_with_commission",{method:"POST",body:JSON.stringify({p_code:code,p_token:token,p_show:show.id,p_venue:show.venue,p_seats:allSeats,p_amount:amount,p_name:name,p_phone:phone,p_email:email,p_commission_lines:commissionLines})}) as {order_code:string;expires_at:string}[];
 if(!rows?.length)throw Error("Reservation failed");
 // Attribution is optional and must never prevent a successful seat reservation.
 if(body?.adsConsent===true&&body?.landingShowId===show.id){
  const fbp=typeof body.fbp==="string"&&/^fb\.1\.\d{10,16}\.\d+$/.test(body.fbp)?body.fbp:"";
  const fbc=typeof body.fbc==="string"&&/^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]+$/.test(body.fbc)?body.fbc:"";
  const utmSource=typeof body.utmSource==="string"?body.utmSource.slice(0,100):"";
  const utmCampaign=typeof body.utmCampaign==="string"?body.utmCampaign.slice(0,100):"";
  try{await staffDb("extra_order_attribution",{method:"POST",body:JSON.stringify({order_code:code,show_id:show.id,consent:true,fbp,fbc,landing_path:"/show/"+show.id,utm_source:utmSource,utm_campaign:utmCampaign})})}catch(e){console.warn("[ads] Attribution unavailable for",code)}
 }
 const account=process.env.SEPAY_BANK_ACCOUNT!,bank=(process.env.SEPAY_BANK_CODE||"").toUpperCase(),holder=process.env.SEPAY_ACCOUNT_NAME!;
 const qr="https://img.vietqr.io/image/"+encodeURIComponent(bank)+"-"+encodeURIComponent(account)+"-compact2.png?amount="+amount+"&addInfo="+encodeURIComponent(code)+"&accountName="+encodeURIComponent(holder);
 return NextResponse.json({code,token,amount,expiresAt:rows[0].expires_at,bank,account,holder,qr,status:"pending"},{headers:{"Cache-Control":"no-store"}});
 }catch(err){
  const detail=err instanceof Error?err.message:"Unknown reservation error";
  console.error("[sepay-reserve] Supabase reservation failed:",detail);
  const seatConflict=/Seats already reserved/i.test(detail);
  return NextResponse.json({error:seatConflict?"Ghế đã được khách khác giữ hoặc mua. Vui lòng chọn ghế khác.":"Hệ thống chưa thể giữ ghế. Vui lòng báo quản trị kiểm tra Vercel Runtime Logs.",errorCode:seatConflict?"SEAT_CONFLICT":"RESERVATION_FAILED"},{status:seatConflict?409:503,headers:{"Cache-Control":"no-store"}});
 }
}

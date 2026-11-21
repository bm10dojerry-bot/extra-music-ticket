import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {loadShows} from "../../../../../lib/show-data";
import {seatsFor,venues,type VenueId} from "../../../../../lib/venues";
import {staffDb} from "../../../../../lib/staff-auth";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 if(process.env.SEPAY_CHECKOUT_ENABLED!=="true")return NextResponse.json({error:"Thanh toán đang được cấu hình, chưa mở nhận tiền."},{status:503});
 if(!process.env.SEPAY_BANK_ACCOUNT||!process.env.SEPAY_BANK_CODE||!process.env.SEPAY_ACCOUNT_NAME||!process.env.SEPAY_WEBHOOK_KEY)return NextResponse.json({error:"Chưa cấu hình ngân hàng và webhook SePay."},{status:503});
 const body=await req.json().catch(()=>null);
 const showId=String(body?.showId||""),seats=body?.seats,name=String(body?.name||"").trim(),phone=String(body?.phone||"").trim(),email=String(body?.email||"").trim();
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||!Array.isArray(seats)||seats.length<1||seats.length>12||seats.some((x:unknown)=>typeof x!=="string")||new Set(seats).size!==seats.length||name.length<2||name.length>120||!/^[0-9+(). -]{9,20}$/.test(phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:"Thông tin đặt vé không hợp lệ."},{status:400});
 const show=(await loadShows()).find(x=>x.id===showId);
 if(!show||!venues.some(v=>v.id===show.venue)||["sold_out","ended","live","pending"].includes(show.status))return NextResponse.json({error:"Show không mở bán."},{status:400});
 const valid=new Map(seatsFor(show.venue as VenueId).map(s=>[s.id,s.zone]));
 let amount=0;for(const id of seats as string[]){const zone=valid.get(id),price=zone?show.prices[zone as "A"|"B"|"C"|"D"]:null;if(!zone||!Number.isSafeInteger(price)||!price||price<=0)return NextResponse.json({error:"Ghế hoặc giá vé không hợp lệ."},{status:400});amount+=price}
 const code="EX"+randomBytes(8).toString("hex").toUpperCase();
 try{
 const rows=await staffDb("rpc/extra_reserve_order",{method:"POST",body:JSON.stringify({p_code:code,p_show:show.id,p_venue:show.venue,p_seats:seats,p_amount:amount,p_name:name,p_phone:phone,p_email:email})}) as {order_code:string;expires_at:string}[];
 if(!rows?.length)throw Error("Reservation failed");
 const account=process.env.SEPAY_BANK_ACCOUNT!,bank=process.env.SEPAY_BANK_CODE!,holder=process.env.SEPAY_ACCOUNT_NAME!;
 const qr="https://img.vietqr.io/image/"+encodeURIComponent(bank)+"-"+encodeURIComponent(account)+"-compact2.png?amount="+amount+"&addInfo="+encodeURIComponent(code)+"&accountName="+encodeURIComponent(holder);
 return NextResponse.json({code,amount,expiresAt:rows[0].expires_at,bank,account,holder,qr,status:"pending"},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không thể giữ ghế. Có thể ghế đã được khách khác chọn hoặc chưa chạy SQL 012."},{status:409})}
}

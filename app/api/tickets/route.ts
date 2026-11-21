import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {paidOrder,ticketsFor} from "../../../lib/extra-ticketing";
import {loadShows} from "../../../lib/show-data";
import {venues} from "../../../lib/venues";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const code=req.nextUrl.searchParams.get("code")||"",token=req.nextUrl.searchParams.get("token")||"";
 if(!/^EX[0-9A-F]{16}$/.test(code)||!/^[a-f0-9]{48}$/.test(token))return NextResponse.json({error:"Thông tin vé không hợp lệ"},{status:400});
 try{
 const o=await paidOrder(code);if(!o)return NextResponse.json({error:"Không tìm thấy đơn"},{status:404});
 const a=Buffer.from(token),b=Buffer.from(o.access_token);
 if(a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({error:"Không có quyền xem vé"},{status:403});
 if(o.status!=="paid")return NextResponse.json({error:"Đơn hàng chưa được xác nhận thanh toán"},{status:409});
 const tickets=await ticketsFor(code);
 const shows=await loadShows();
 const show=shows.find(s=>s.id===o.show_id);
 const venueId=tickets[0]?.venue_id||show?.venue;
 const venue=venues.find(v=>v.id===venueId);
 return NextResponse.json({code:o.code,showId:o.show_id,showTitle:show?.title||o.show_id,artist:show?.artist||null,showDate:show?.date||null,showTime:show?.time||null,venueName:venue?.name||null,venueAddress:venue?.address||null,buyerName:o.buyer_name,amount:o.amount_vnd,tickets:tickets.map(t=>({id:t.id,seat:t.seat_id,checkedIn:Boolean(t.checked_in_at),qrValue:"https://iextra.net/checkin?ticket="+encodeURIComponent(t.id)+"&secret="+encodeURIComponent(t.qr_secret)}))},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch{return NextResponse.json({error:"Chưa tải được vé. Kiểm tra SQL 013."},{status:503})}
}

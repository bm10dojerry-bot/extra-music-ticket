import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
import {seatsFor,venues,type VenueId} from "../../../../lib/venues";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được sửa số lượng ghế"},{status:403});
 const input=await req.json().catch(()=>null) as {venue?:string;row?:string;count?:number}|null;
 const venue=input?.venue,row=input?.row,count=input?.count;
 if(!venue||!venues.some(v=>v.id===venue)||!row||!/^[A-M]$/.test(row)||!Number.isSafeInteger(count)||count!<2||count!>80)return NextResponse.json({error:"Số ghế phải từ 2 đến 80"},{status:400});
 const base=seatsFor(venue as VenueId),currentRows=new Set(base.map(s=>s.row));
 if(!currentRows.has(row))return NextResponse.json({error:"Hàng ghế không tồn tại"},{status:400});
 try{
  const [existing,shows]=await Promise.all([staffDb("venue_seat_rows?venue_id=eq."+encodeURIComponent(venue)+"&select=row_code,seat_count") as Promise<{row_code:string;seat_count:number}[]>,loadShows()]);
  const counts=Object.fromEntries(existing.map(x=>[x.row_code,x.seat_count]));
  const next={...counts,[row]:count};
  const valid=new Set(seatsFor(venue as VenueId,next).map(s=>s.id));
  const ids=shows.filter(s=>s.venue===venue).map(s=>s.id);
  for(const id of ids){
   const [sales,orders]=await Promise.all([
    staffDb("ticket_sales?show_id=eq."+encodeURIComponent(id)+"&payment_verified=eq.true&select=seats&limit=10000") as Promise<{seats:string[]}[]>,
    staffDb("extra_payment_orders?show_id=eq."+encodeURIComponent(id)+"&status=in.(paid,pending)&select=seats,status,expires_at&limit=10000") as Promise<{seats:string[];status:string;expires_at:string|null}[]>
   ]);
   const used=[...sales.flatMap(x=>x.seats||[]),...orders.filter(x=>x.status==="paid"||x.expires_at&&Date.parse(x.expires_at)>Date.now()).flatMap(x=>x.seats||[])];
   if(used.some(seat=>!valid.has(seat)))return NextResponse.json({error:"Không thể giảm hàng "+row+": có ghế đã bán hoặc đang giữ sẽ bị loại khỏi sơ đồ."},{status:409});
  }
  await staffDb("venue_seat_rows?on_conflict=venue_id,row_code",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({venue_id:venue,row_code:row,seat_count:count,updated_at:new Date().toISOString()})});
  return NextResponse.json({ok:true,venue,row,count,capacity:seatsFor(venue as VenueId,next).length});
 }catch{return NextResponse.json({error:"Không cập nhật được sơ đồ ghế. Vui lòng kiểm tra dữ liệu."},{status:503})}
}

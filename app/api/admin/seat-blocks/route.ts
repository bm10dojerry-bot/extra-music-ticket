import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
import {seatsFor,type VenueId} from "../../../../lib/venues";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const showId=req.nextUrl.searchParams.get("showId")||"";
 if(!/^[a-z0-9-]{3,100}$/.test(showId))return NextResponse.json({error:"Mã show không hợp lệ"},{status:400});
 const show=(await loadShows()).find(s=>s.id===showId);
 if(!show)return NextResponse.json({error:"Không tìm thấy show"},{status:404});
 try{
  const rows=await staffDb("extra_show_blocked_seats?show_id=eq."+encodeURIComponent(showId)+"&select=seat_id&limit=10000") as {seat_id:string}[];
  return NextResponse.json({showId,blockedSeats:rows.map(x=>x.seat_id)},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được ghế khóa"},{status:503})}
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được khóa hoặc mở bán ghế"},{status:403});
 const data=await req.json().catch(()=>null);const showId=String(data?.showId||""),seatId=String(data?.seatId||""),blocked=data?.blocked;
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||!/^[A-O][0-9]{2}$/.test(seatId)||typeof blocked!=="boolean")return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400});
 try{
  const show=(await loadShows()).find(s=>s.id===showId);if(!show)return NextResponse.json({error:"Không tìm thấy show"},{status:404});
  const counts=await staffDb("venue_seat_rows?venue_id=eq."+encodeURIComponent(show.venue)+"&select=row_code,seat_count") as {row_code:string;seat_count:number}[];
  if(!seatsFor(show.venue as VenueId,Object.fromEntries(counts.map(x=>[x.row_code,x.seat_count]))).some(s=>s.id===seatId))return NextResponse.json({error:"Ghế không tồn tại trong sơ đồ hiện tại"},{status:400});
  await staffDb("rpc/extra_set_show_seat_block",{method:"POST",body:JSON.stringify({p_show:showId,p_seat:seatId,p_block:blocked})});
  return NextResponse.json({ok:true,showId,seatId,blocked});
 }catch(e){const message=e instanceof Error?e.message:"";return NextResponse.json({error:message.includes("Seat already sold or held")?"Ghế đã bán hoặc đang được giữ, không thể khóa.":"Không cập nhật được trạng thái ghế."},{status:message.includes("Seat already sold or held")?409:503})}
}

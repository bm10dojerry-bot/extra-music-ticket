import {NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["sale","admin"]))return NextResponse.json({error:"Không có quyền xem danh sách show"},{status:403});
 try{
  const shows=await loadShows();
  return NextResponse.json({shows:shows.filter(s=>!["ended","sold_out"].includes(s.status)).map(s=>({id:s.id,artist:s.artist,date:s.date,time:s.time,venue:s.venue,status:s.status,prices:s.prices}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được danh sách show"},{status:503})}
}

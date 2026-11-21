import {NextResponse} from "next/server";
import {staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  const rows=await staffDb("venue_seat_rows?select=venue_id,row_code,seat_count&limit=1000") as {venue_id:string;row_code:string;seat_count:number}[];
  const counts:Record<string,Record<string,number>>={};
  for(const row of rows){(counts[row.venue_id]??={})[row.row_code]=row.seat_count}
  return NextResponse.json({counts},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Chưa tải được cấu hình sơ đồ ghế"},{status:503})}
}

import {NextResponse} from "next/server";
import sharp from "sharp";
import {staffDb} from "../../../../../lib/staff-auth";
import {renderSeatMapSvg} from "../../../../../lib/seat-map-image";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{venue:string}>}){
 const {venue}=await params;
 if(venue!=="ccc"&&venue!=="laocai")return NextResponse.json({error:"Unknown venue"},{status:404});
 try{
  const rows=await staffDb("venue_seat_rows?venue_id=eq."+venue+"&select=row_code,seat_count&limit=1000",{signal:AbortSignal.timeout(5000)}) as {row_code:string;seat_count:number}[];
  if(!Array.isArray(rows))throw Error("Layout unavailable");
  const counts:Record<string,number>={};
  for(const r of rows){if(!/^[A-O]$/.test(r.row_code)||!Number.isSafeInteger(r.seat_count)||r.seat_count<2||r.seat_count>80)throw Error("Invalid layout");counts[r.row_code]=r.seat_count;}
  const png=await sharp(Buffer.from(renderSeatMapSvg(venue,counts))).png().toBuffer();
  return new NextResponse(new Uint8Array(png),{headers:{"Content-Type":"image/png","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return NextResponse.json({error:"Layout unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}

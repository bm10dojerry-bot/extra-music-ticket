import {NextResponse} from "next/server";
import sharp from "sharp";
import {staffDb} from "../../../../../lib/staff-auth";
import {renderSeatMapSvg} from "../../../../../lib/seat-map-image";
import {getAiSeatSnapshot} from "../../../../../lib/ai-sales-checkout";
import {tierName} from "../../../../../lib/poster-offers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{venue:string}>}){
 const {venue}=await params;
 if(venue!=="ccc"&&venue!=="laocai")return NextResponse.json({error:"Unknown venue"},{status:404});
 try{
  const showId=new URL(request.url).searchParams.get("show");
  let svg:string;
  if(showId!==null){
   if(!/^[a-z0-9-]{3,100}$/.test(showId))return NextResponse.json({error:"Invalid show"},{status:400});
   const snapshot=await getAiSeatSnapshot(showId);
   if(snapshot.show.venueId!==venue)return NextResponse.json({error:"Show venue mismatch"},{status:404});
   svg=renderSeatMapSvg(venue,{}, {seats:snapshot.seats,taken:new Set([...snapshot.taken,...snapshot.seats.filter(s=>snapshot.show.prices[s.zone as "A"|"B"|"C"|"D"]===null).map(s=>s.id)]),title:snapshot.show.artist+" · "+snapshot.show.date,showId:snapshot.show.id,tierLabels:Object.fromEntries(["A","B","C","D"].map(z=>[z,tierName(snapshot.show.id,z)])),checkedAt:new Date().toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})});
  }else{
   const rows=await staffDb("venue_seat_rows?venue_id=eq."+venue+"&select=row_code,seat_count&limit=1000",{signal:AbortSignal.timeout(5000)}) as {row_code:string;seat_count:number}[];
   if(!Array.isArray(rows))throw Error("Layout unavailable");
   const counts:Record<string,number>={};
   for(const r of rows){if(!/^[A-O]$/.test(r.row_code)||!Number.isSafeInteger(r.seat_count)||r.seat_count<2||r.seat_count>80)throw Error("Invalid layout");counts[r.row_code]=r.seat_count;}
   svg=renderSeatMapSvg(venue,counts);
  }
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  return new NextResponse(new Uint8Array(png),{headers:{"Content-Type":"image/png","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return NextResponse.json({error:"Layout unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}

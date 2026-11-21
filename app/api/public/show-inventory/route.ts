import {NextResponse} from "next/server";
import {loadShows} from "../../../../lib/show-data";
import {seatsFor,type VenueId} from "../../../../lib/venues";
import {staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function GET(){
 const url=process.env.SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({available:false,reason:"not_configured"},{status:503});
 try{
 const endpoint=new URL("/rest/v1/ticket_sales",url);
 endpoint.searchParams.set("select","show_id,seats");
 endpoint.searchParams.set("payment_verified","eq.true");
 endpoint.searchParams.set("show_id","not.is.null");
 endpoint.searchParams.set("limit","10000");
 const res=await fetch(endpoint.toString(),{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!res.ok)throw new Error("inventory query failed");
 const rows=await res.json() as {show_id:string;seats:string[]}[];
 const counts=new Map<string,Set<string>>();
 for(const row of rows){if(!counts.has(row.show_id))counts.set(row.show_id,new Set());for(const seat of row.seats||[])counts.get(row.show_id)!.add(seat);}
 const ordersRes=await fetch(new URL("/rest/v1/extra_payment_orders?select=show_id,seats&status=eq.paid&limit=10000",url).toString(),{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});if(ordersRes.ok){const paidOrders=await ordersRes.json() as {show_id:string;seats:string[]}[];for(const row of paidOrders){if(!counts.has(row.show_id))counts.set(row.show_id,new Set());for(const seat of row.seats||[])counts.get(row.show_id)!.add(seat)}}
 const holds=new Map<string,Set<string>>();
 const heldRes=await fetch(new URL("/rest/v1/extra_payment_orders?select=show_id,seats&status=eq.pending&expires_at=gt."+encodeURIComponent(new Date().toISOString())+"&limit=10000",url).toString(),{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(heldRes.ok){const pending=await heldRes.json() as {show_id:string;seats:string[]}[];for(const row of pending){if(!holds.has(row.show_id))holds.set(row.show_id,new Set());for(const seat of row.seats||[])holds.get(row.show_id)!.add(seat)}}
 const layoutRows=await staffDb("venue_seat_rows?select=venue_id,row_code,seat_count&limit=1000") as {venue_id:string;row_code:string;seat_count:number}[];
 const seatRows:Record<string,Record<string,number>>={};for(const r of layoutRows)(seatRows[r.venue_id]??={})[r.row_code]=r.seat_count;
 const shows=await loadShows();const inventory=shows.map(show=>{const capacity=seatsFor(show.venue as VenueId,seatRows[show.venue]||{}).length;const sold=counts.get(show.id)?.size||0;return {showId:show.id,capacity,sold,remaining:Math.max(0,capacity-sold),soldOut:capacity>0&&sold>=capacity,soldSeats:[...(counts.get(show.id)||new Set<string>())],heldSeats:[...(holds.get(show.id)||new Set<string>())]};});
 return NextResponse.json({available:true,inventory,seatRows},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({available:false,reason:"inventory_unavailable"},{status:503});}
}

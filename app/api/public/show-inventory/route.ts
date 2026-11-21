import {NextResponse} from "next/server";
import {loadShows} from "../../../../lib/show-data";
import {venues} from "../../../../lib/venues";
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
 const shows=await loadShows();const inventory=shows.map(show=>{const capacity=venues.find(v=>v.id===show.venue)?.capacity||0;const sold=counts.get(show.id)?.size||0;return {showId:show.id,capacity,sold,remaining:Math.max(0,capacity-sold),soldOut:capacity>0&&sold>=capacity};});
 return NextResponse.json({available:true,inventory},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({available:false,reason:"inventory_unavailable"},{status:503});}
}

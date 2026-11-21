import {NextRequest,NextResponse} from "next/server";
import {staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const origin=req.headers.get("origin")||"";
 const host=req.headers.get("host")||"";
 let originHost="";try{originHost=new URL(origin).host}catch{}if(!originHost||originHost!==host)return NextResponse.json({error:"Origin not allowed"},{status:403});
 const data=await req.json().catch(()=>null);
 const showId=String(data?.showId||""),sessionId=String(data?.sessionId||""),eventName=String(data?.eventName||"");
 if(data?.consent!==true||!/^[a-z0-9-]{3,100}$/.test(showId)||!/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(sessionId)||!["view","checkout"].includes(eventName))return NextResponse.json({error:"Invalid event"},{status:400});
 const shows=await loadShows();if(!shows.some(s=>s.id===showId))return NextResponse.json({error:"Unknown show"},{status:404});
 try{await staffDb("extra_landing_funnel?on_conflict=show_id,session_id,event_name",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify({show_id:showId,session_id:sessionId,event_name:eventName})});return NextResponse.json({ok:true})}catch{return NextResponse.json({error:"Analytics unavailable"},{status:503})}
}

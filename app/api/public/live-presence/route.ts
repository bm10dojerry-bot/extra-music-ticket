import {NextRequest,NextResponse} from "next/server";
import {staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const origin=req.headers.get("origin")||"",host=req.headers.get("host")||"";
 let originHost="";try{originHost=new URL(origin).host}catch{}
 if(!originHost||originHost!==host)return NextResponse.json({error:"Origin not allowed"},{status:403});
 if(Number(req.headers.get("content-length")||0)>1024)return NextResponse.json({error:"Request too large"},{status:413});
 const data=await req.json().catch(()=>null);
 const sessionId=String(data?.sessionId||""),showId=String(data?.showId||""),stage=String(data?.stage||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)||!["viewing","selecting","payment"].includes(stage)||!(showId==="site"||/^[a-z0-9-]{3,100}$/.test(showId)))
  return NextResponse.json({error:"Invalid presence"},{status:400});
 try{
  if(showId!=="site"&&!(await loadShows()).some(s=>s.id===showId))return NextResponse.json({error:"Unknown show"},{status:404});
  await staffDb("extra_live_visitors?on_conflict=session_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({session_id:sessionId,show_id:showId,stage,last_seen:new Date().toISOString()})});
  return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Presence unavailable"},{status:503})}
}

import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get("showId")||"";
 if(!/^[a-z0-9-]{3,100}$/.test(id))return NextResponse.json({error:"Mã show không hợp lệ"},{status:400});
 try{
  const shows=await loadShows();if(!shows.some(s=>s.id===id))return NextResponse.json({error:"Không tìm thấy show"},{status:404});
  const rows=await staffDb("show_landing_content?show_id=eq."+encodeURIComponent(id)+"&select=introduction,setlist&limit=1") as {introduction:string;setlist:string}[];
  return NextResponse.json({content:rows[0]||{introduction:"",setlist:""}},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được nội dung landing page"},{status:503})}
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return NextResponse.json({error:"Không có quyền cập nhật"},{status:403});
 const data=await req.json().catch(()=>null);
 const showId=String(data?.showId||""),introduction=String(data?.introduction||"").trim(),setlist=String(data?.setlist||"").trim();
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||introduction.length>4000||setlist.length>8000)return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400});
 try{
  const shows=await loadShows();if(!shows.some(s=>s.id===showId))return NextResponse.json({error:"Show chưa tồn tại. Hãy lưu show trước."},{status:404});
  await staffDb("show_landing_content?on_conflict=show_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({show_id:showId,introduction,setlist,updated_at:new Date().toISOString()})});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:"Không lưu được nội dung landing page"},{status:503})}
}

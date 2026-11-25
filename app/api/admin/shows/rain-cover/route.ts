import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../../lib/staff-auth";
const allowed=()=>requireRole(["admin","show_manager"]);
const valid=(value:unknown):value is string=>typeof value==="string"&&/^[a-z0-9][a-z0-9-]{2,99}$/.test(value);
export async function GET(req:NextRequest){
  if(!await allowed())return NextResponse.json({error:"Bạn cần quyền quản lý show."},{status:403});
  const id=req.nextUrl.searchParams.get("show");
  if(!valid(id))return NextResponse.json({error:"Mã show không hợp lệ."},{status:400});
  const rows=await staffDb("managed_shows?id=eq."+id+"&select=show_date,venue_id,extra_show_reminder_settings(canopy_confirmed)&limit=1") as {show_date:string;venue_id:string;extra_show_reminder_settings:{canopy_confirmed:boolean}|{canopy_confirmed:boolean}[]|null}[];
  const show=rows[0];
  if(!show)return NextResponse.json({error:"Chưa tìm thấy show."},{status:404});
  const config=show.extra_show_reminder_settings;
  return NextResponse.json({date:show.show_date,venue:show.venue_id,confirmed:(Array.isArray(config)?config[0]:config)?.canopy_confirmed===true},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:NextRequest){
  if(!await allowed())return NextResponse.json({error:"Bạn cần quyền quản lý show."},{status:403});
  const input=await req.json().catch(()=>null);
  if(!valid(input?.show)||typeof input?.confirmed!=="boolean"||typeof input.date!=="string"||!/^\d{4}-\d\d-\d\d$/.test(input.date)||!["ccc","moana","laocai"].includes(input.venue))return NextResponse.json({error:"Thông tin show chưa hợp lệ."},{status:400});
  const saved=await staffDb("rpc/extra_set_show_canopy",{method:"POST",body:JSON.stringify({p_show:input.show,p_date:input.date,p_venue:input.venue,p_confirmed:input.confirmed})});
  return saved===true?NextResponse.json({ok:true}):NextResponse.json({error:"Lịch hoặc địa điểm đã thay đổi. Hãy tải lại show."},{status:409});
}

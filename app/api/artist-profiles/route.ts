import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../lib/staff-auth";
export const dynamic="force-dynamic";
const config=()=>({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY});
export async function GET(){
 const {url,key}=config();if(!url||!key)return NextResponse.json({profiles:{}},{status:503});
 const r=await fetch(url+"/rest/v1/artist_profiles?select=show_id,biography",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!r.ok)return NextResponse.json({profiles:{},error:"Chưa có bảng artist_profiles. Hãy chạy migration 008."},{status:503});
 const rows=await r.json() as {show_id:string;biography:string}[];
 return NextResponse.json({profiles:Object.fromEntries(rows.map(x=>[x.show_id,x.biography]))},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return NextResponse.json({error:"Không có quyền cập nhật."},{status:401});
 const {url,key}=config();if(!url||!key)return NextResponse.json({error:"Thiếu cấu hình Supabase."},{status:503});
 const body=await req.json().catch(()=>null);
 if(!body||typeof body.showId!=="string"||!/^[a-z0-9-]{2,100}$/.test(body.showId)||typeof body.biography!=="string"||body.biography.length>8000)return NextResponse.json({error:"Dữ liệu tiểu sử không hợp lệ (tối đa 8.000 ký tự)."},{status:400});
 const r=await fetch(url+"/rest/v1/artist_profiles?on_conflict=show_id",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({show_id:body.showId,biography:body.biography,updated_at:new Date().toISOString()})});
 if(!r.ok)return NextResponse.json({error:"Không lưu được tiểu sử: "+(await r.text()).slice(0,350)},{status:502});
 return NextResponse.json({ok:true});
}

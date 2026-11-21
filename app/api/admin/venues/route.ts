import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {venues} from "../../../../lib/venues";
export const dynamic="force-dynamic";
const cfg=()=>({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY});
export async function GET(){
 const {url,key}=cfg();if(!url||!key)return NextResponse.json({venues:[],error:"Thiếu cấu hình Supabase."},{status:503});
 const r=await fetch(url+"/rest/v1/custom_venues?select=*&order=created_at.asc",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!r.ok)return NextResponse.json({venues:[],error:"Chưa tạo bảng custom_venues. Hãy chạy SQL 009. "+(await r.text()).slice(0,250)},{status:503});
 return NextResponse.json({venues:await r.json()},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return NextResponse.json({error:"Không có quyền quản lý địa điểm."},{status:403});
 const {url,key}=cfg();if(!url||!key)return NextResponse.json({error:"Thiếu cấu hình Supabase."},{status:503});
 const input=await req.json().catch(()=>null);
 if(!input)return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400});
 const id=String(input.id||"").trim(),name=String(input.name||"").trim(),address=String(input.address||"").trim(),city=String(input.city||"").trim(),description=String(input.description||"").trim(),capacity=Number(input.capacity);
 if(!/^[a-z0-9][a-z0-9-]{2,59}$/.test(id)||venues.some(v=>v.id===id))return NextResponse.json({error:"Mã địa điểm không hợp lệ hoặc trùng địa điểm mặc định."},{status:400});
 if(!name||name.length>160||!address||address.length>300||city.length>100||description.length>1000||!Number.isSafeInteger(capacity)||capacity<1||capacity>20000)return NextResponse.json({error:"Vui lòng nhập tên, địa chỉ và sức chứa hợp lệ."},{status:400});
 const r=await fetch(url+"/rest/v1/custom_venues?on_conflict=id",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id,name,address,city,capacity,description,updated_at:new Date().toISOString()})});
 if(!r.ok)return NextResponse.json({error:"Không lưu được địa điểm: "+(await r.text()).slice(0,450)},{status:502});
 return NextResponse.json({ok:true});
}

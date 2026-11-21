import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
const valid=(x:string)=>["gioi-thieu","tuyen-dung","lien-he"].includes(x);
export async function GET(req:NextRequest){
 const slug=req.nextUrl.searchParams.get("slug")||"";
 if(!valid(slug))return NextResponse.json({error:"Trang không hợp lệ"},{status:400});
 try{const rows=await staffDb("site_information_pages?slug=eq."+encodeURIComponent(slug)+"&select=slug,title,body,updated_at&limit=1") as {slug:string;title:string;body:string;updated_at:string}[];return NextResponse.json({page:rows[0]||null},{headers:{"Cache-Control":"no-store"}})}
 catch{return NextResponse.json({error:"Chưa tải được nội dung"},{status:503})}
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được sửa nội dung"},{status:403});
 const d=await req.json().catch(()=>null);const slug=String(d?.slug||""),title=String(d?.title||"").trim(),body=String(d?.body||"").trim();
 if(!valid(slug)||title.length<2||title.length>180||body.length>12000)return NextResponse.json({error:"Tiêu đề hoặc nội dung không hợp lệ"},{status:400});
 try{await staffDb("site_information_pages?on_conflict=slug",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({slug,title,body,updated_at:new Date().toISOString()})});return NextResponse.json({ok:true})}
 catch{return NextResponse.json({error:"Không lưu được nội dung"},{status:503})}
}

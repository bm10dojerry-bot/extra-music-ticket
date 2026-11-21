import {requireRole} from "../../../../lib/staff-auth";
import {NextRequest,NextResponse} from "next/server";
import {validSlot,mediaPublicUrl} from "../../../../lib/media";
export const runtime="nodejs";
const fail=(message:string,status:number)=>NextResponse.json({error:message},{status});
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return fail("Chưa đăng nhập hoặc phiên đã hết hạn.",401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return fail("Thiếu cấu hình Supabase.",503);
 const form=await req.formData();
 const slot=form.get("slot"),file=form.get("file");
 if(typeof slot!=="string"||!validSlot(slot))return fail("Vị trí ảnh không hợp lệ. Hãy tải lại trang Admin.",400);
 if(!(file instanceof File))return fail("Vui lòng chọn ảnh.",400);
 if(!["image/jpeg","image/png","image/webp"].includes(file.type))return fail("Chỉ nhận JPG, PNG hoặc WebP.",400);
 if(file.size>5*1024*1024||file.size===0)return fail("Ảnh phải nhỏ hơn 5 MB.",400);
 const bytes=Buffer.from(await file.arrayBuffer());
 const signatures:Record<string,boolean>={
 "image/jpeg":bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,
 "image/png":bytes.length>8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
 "image/webp":bytes.length>12&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"
 };
 if(!signatures[file.type])return fail("Tệp ảnh không hợp lệ.",400);
 const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type];
 const path=slot+"/"+crypto.randomUUID()+"."+ext;
 const headers={apikey:key,Authorization:"Bearer "+key};
 const uploaded=await fetch(url+"/storage/v1/object/extra-media/"+path,{method:"POST",headers:{...headers,"Content-Type":file.type,"x-upsert":"false"},body:bytes});
 if(!uploaded.ok){const detail=(await uploaded.text()).slice(0,500);return fail("Supabase Storage lỗi "+uploaded.status+": "+detail,502);}
 const saved=await fetch(url+"/rest/v1/site_media?on_conflict=slot",{method:"POST",headers:{...headers,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({slot,image_path:path,updated_at:new Date().toISOString()})});
 if(!saved.ok){const detail=(await saved.text()).slice(0,500);return fail("Ảnh đã tải nhưng không lưu được vào site_media ("+saved.status+"): "+detail,502);}
 return NextResponse.json({ok:true,url:mediaPublicUrl(path)});
}

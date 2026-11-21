import {requireRole} from "../../../../lib/staff-auth";
import {NextRequest,NextResponse} from "next/server";
import {isAdminSecret} from "../../../../lib/admin-auth";
import {mediaPublicUrl} from "../../../../lib/media";
export const runtime="nodejs";
const error=(message:string,status:number)=>NextResponse.json({error:message},{status});
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return error("Mật khẩu quản trị không đúng.",401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return error("Thiếu cấu hình Supabase.",503);
 const form=await req.formData();const id=form.get("showId"),file=form.get("file");
 if(typeof id!=="string"||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))return error("Mã show không hợp lệ.",400);
 if(!(file instanceof File))return error("Chọn ảnh poster.",400);
 if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024||file.size===0)return error("Chỉ nhận ảnh JPG/PNG/WebP tối đa 5 MB.",400);
 const bytes=Buffer.from(await file.arrayBuffer());
 const valid=file.type==="image/jpeg"?bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.type==="image/png"?bytes.length>8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.length>12&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
 if(!valid)return error("Nội dung ảnh không hợp lệ.",400);
 const headers={apikey:key,Authorization:"Bearer "+key};
 const check=await fetch(url+"/rest/v1/managed_shows?id=eq."+encodeURIComponent(id)+"&select=id",{headers,cache:"no-store"});
 if(!check.ok)return error("Chưa tạo bảng managed_shows. Hãy chạy SQL 004.",503);
 const existing=await check.json() as {id:string}[];
 if(!existing.length)return error("Hãy lưu thông tin show trước khi tải poster.",400);
 const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type];
 const path="posters/"+id+"/"+crypto.randomUUID()+"."+ext;
 const uploaded=await fetch(url+"/storage/v1/object/extra-media/"+path,{method:"POST",headers:{...headers,"Content-Type":file.type,"x-upsert":"false"},body:bytes});
 if(!uploaded.ok){const detail=(await uploaded.text()).slice(0,450);return error("Supabase Storage lỗi "+uploaded.status+": "+detail,502);}
 const saved=await fetch(url+"/rest/v1/managed_shows?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{...headers,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({poster_path:path,updated_at:new Date().toISOString()})});
 if(!saved.ok){const detail=(await saved.text()).slice(0,450);return error("Ảnh đã tải nhưng Supabase không lưu poster vào show ("+saved.status+"): "+detail,502);}
 return NextResponse.json({ok:true,url:mediaPublicUrl(path)});
}

import {ADMIN_COOKIE,validAdminSession} from "../../../../lib/admin-session";
import {NextRequest,NextResponse} from "next/server";
import {isAdminSecret} from "../../../../lib/admin-auth";
import {loadAllShows} from "../../../../lib/show-data";
import {shows as initialShows} from "../../../../lib/shows";
import {venues} from "../../../../lib/venues";
export const runtime="nodejs";
const error=(msg:string,status:number)=>NextResponse.json({error:msg},{status});
const auth=(r:NextRequest)=>validAdminSession(r.cookies.get(ADMIN_COOKIE)?.value);
const cfg=()=>{const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Thiếu cấu hình Supabase");return {url,key}};
export async function GET(req:NextRequest){if(!auth(req))return error("Mật khẩu quản trị không đúng hoặc chưa cấu hình.",401);try{return NextResponse.json({shows:await loadAllShows(),defaults:initialShows})}catch(e){return error(e instanceof Error?e.message:"Không thể tải dữ liệu.",503)}}
export async function POST(req:NextRequest){
 if(!auth(req))return error("Mật khẩu quản trị không đúng hoặc chưa cấu hình.",401);
 let input:Record<string,unknown>;try{input=await req.json()}catch{return error("Dữ liệu không hợp lệ.",400)}
 const id=String(input.id||"").trim(),artist=String(input.artist||"").trim(),title=String(input.title||"").trim();
 const date=String(input.date||""),time=String(input.time||""),venue=String(input.venue||""),status=String(input.status||"announced");
 if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))return error("Mã show chỉ gồm chữ thường, số và dấu gạch ngang.",400);
 if(!artist||artist.length>150||!title||title.length>200)return error("Cần tên ca sĩ và tên show (tối đa 150/200 ký tự).",400);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return error("Ngày hoặc giờ biểu diễn không hợp lệ.",400);
 if(!venues.some(v=>v.id===venue)||!["announced","pending","hidden","sold_out"].includes(status))return error("Địa điểm hoặc trạng thái không hợp lệ.",400);
 const values=input.prices&&typeof input.prices==="object"?input.prices as Record<string,unknown>:{};
 const prices:Record<string,number|null>={};
 for(const z of ["A","B","C","D"]){const v=values[z];if(v===null||v===""||v===undefined){prices[z]=null;continue}if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||v>100000000)return error("Giá hạng "+z+" không hợp lệ.",400);prices[z]=v}
 try{
 const {url,key}=cfg();
 const existing=await fetch(url+"/rest/v1/managed_shows?id=eq."+encodeURIComponent(id)+"&select=poster_path",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!existing.ok)throw Error("Chưa tạo bảng managed_shows. Hãy chạy SQL 004.");
 const rows=await existing.json() as {poster_path:string|null}[];
 const body={id,artist,title,show_date:date,show_time:time,venue_id:venue,status,prices,poster_path:rows[0]?.poster_path||null,updated_at:new Date().toISOString()};
 const saved=await fetch(url+"/rest/v1/managed_shows?on_conflict=id",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(body)});
 if(!saved.ok)throw Error("Không lưu được show: "+saved.status);
 return NextResponse.json({ok:true});
 }catch(e){return error(e instanceof Error?e.message:"Lỗi lưu show.",503)}
}

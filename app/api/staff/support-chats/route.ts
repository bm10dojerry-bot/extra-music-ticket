import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(payload:Record<string,unknown>,status=200)=>NextResponse.json(payload,{status,headers:{"Cache-Control":"no-store"}});
const validId=(id:string)=>/^[a-f0-9-]{36}$/i.test(id);
const access=()=>requireRole(["admin","sale","show_manager"]);
type Chat={id:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:string;created_at:string;updated_at:string;last_customer_at:string|null;last_staff_at:string|null};
const chatsPath="extra_support_chats?select=id,show_id,customer_name,customer_phone,status,created_at,updated_at,last_customer_at,last_staff_at&order=updated_at.desc&limit=120";
export async function GET(req:NextRequest){
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const id=req.nextUrl.searchParams.get("chatId")||"";
 try{
  if(id){
   if(!validId(id))return reply({error:"Mã cuộc trò chuyện không hợp lệ"},400);
   const chats=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=id,show_id,customer_name,customer_phone,status,created_at,updated_at,last_customer_at,last_staff_at&limit=1") as Chat[];
   if(!chats.length)return reply({error:"Không tìm thấy khách hàng"},404);
   const messages=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&select=id,sender,body,staff_name,created_at&order=id.asc&limit=160");
   return reply({chat:chats[0],messages});
  }
  const chats=await staffDb(chatsPath) as Chat[];
  return reply({chats,openCount:chats.filter(c=>c.status==="open").length,needReplyCount:chats.filter(c=>c.status==="open"&&c.last_customer_at&&(!c.last_staff_at||new Date(c.last_customer_at)>new Date(c.last_staff_at))).length});
 }catch(e){console.warn("[support-chat] Staff read failed",e instanceof Error?e.message:"unknown");return reply({error:"Chưa tải được tin nhắn hỗ trợ"},503)}
}
export async function POST(req:NextRequest){
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const input=await req.json().catch(()=>null);
 const id=String(input?.chatId||""),body=typeof input?.message==="string"?input.message.trim():"";
 if(!validId(id)||body.length<2||body.length>1200)return reply({error:"Nội dung trả lời không hợp lệ"},400);
 try{
  const rows=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=id&limit=1") as {id:string}[];
  if(!rows.length)return reply({error:"Cuộc trò chuyện không tồn tại"},404);
  await staffDb("extra_support_messages",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({chat_id:id,sender:"staff",body,staff_name:actor.display_name.slice(0,100)})});
  await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({last_staff_at:new Date().toISOString(),updated_at:new Date().toISOString(),status:"open"})});
  const messages=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&select=id,sender,body,staff_name,created_at&order=id.asc&limit=160");
  return reply({ok:true,messages});
 }catch(e){console.warn("[support-chat] Staff send failed",e instanceof Error?e.message:"unknown");return reply({error:"Không gửi được phản hồi"},503)}
}
export async function PATCH(req:NextRequest){
 const actor=await access();if(!actor)return reply({error:"Cần đăng nhập tài khoản Sale hoặc Admin"},403);
 const input=await req.json().catch(()=>null);
 const id=String(input?.chatId||""),status=String(input?.status||"");
 if(!validId(id)||!["open","closed"].includes(status))return reply({error:"Yêu cầu không hợp lệ"},400);
 try{
  const rows=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=id",{
   method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status,updated_at:new Date().toISOString()})}) as {id:string}[];
  if(!rows.length)return reply({error:"Không tìm thấy cuộc trò chuyện"},404);
  return reply({ok:true,status});
 }catch{return reply({error:"Không cập nhật được trạng thái"},503)}
}

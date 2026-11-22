import {NextRequest,NextResponse} from "next/server";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const validId=(id:string)=>/^[a-f0-9-]{36}$/i.test(id);
const validToken=(token:string)=>/^[a-f0-9]{64}$/i.test(token);
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
const allowedOrigin=(req:NextRequest)=>{
 const origin=req.headers.get("origin");if(!origin)return false;
 try{return new URL(origin).host===req.headers.get("host")}catch{return false}
};
const rateIpHash=(req:NextRequest)=>{
 const secret=process.env.ADMIN_MEDIA_SECRET||"";
 const ip=(req.headers.get("x-forwarded-for")||req.headers.get("x-real-ip")||"").split(",")[0]?.trim()||"";
 return secret.length>=24&&ip?createHmac("sha256",secret).update(ip).digest("hex"):null;
};
type Chat={id:string;access_hash:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:string;last_customer_at:string|null;updated_at:string};
const getChat=async(id:string,token:string):Promise<Chat|null>=>{
 if(!validId(id)||!validToken(token))return null;
 const rows=await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id)+"&select=id,access_hash,show_id,customer_name,customer_phone,status,last_customer_at,updated_at&limit=1") as Chat[];
 const chat=rows?.[0];if(!chat)return null;
 const supplied=Buffer.from(sha(token),"hex"),stored=Buffer.from(chat.access_hash,"hex");
 return stored.length===supplied.length&&timingSafeEqual(stored,supplied)?chat:null;
};
const publicChat=(chat:Chat)=>({id:chat.id,showId:chat.show_id,customerName:chat.customer_name,status:chat.status});
const listMessages=async(id:string)=>await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&select=id,sender,body,staff_name,created_at&order=id.asc&limit=160");
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get("chatId")||"",token=req.headers.get("x-extra-chat-token")||"";
 if(!validId(id)||!validToken(token))return reply({error:"Phiên tư vấn không hợp lệ"},400);
 try{const chat=await getChat(id,token);if(!chat)return reply({error:"Không tìm thấy phiên tư vấn"},404);
 return reply({chat:publicChat(chat),messages:await listMessages(chat.id)});}catch{return reply({error:"Tạm thời chưa tải được tin nhắn"},503)}
}
export async function POST(req:NextRequest){
 if(!allowedOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ"},403);
 if(Number(req.headers.get("content-length")||0)>12000)return reply({error:"Tin nhắn quá lớn"},413);
 const input=await req.json().catch(()=>null);
 const body=typeof input?.message==="string"?input.message.trim():"";
 if(body.length<2||body.length>1200)return reply({error:"Tin nhắn cần từ 2 đến 1.200 ký tự"},400);
 let id=String(input?.chatId||""),token=String(input?.token||"");
 let chat:Chat|null=null;
 try{
  if(id||token){
   chat=await getChat(id,token);
   if(!chat)return reply({error:"Phiên tư vấn không còn hợp lệ. Hãy mở cuộc trò chuyện mới.",reset:true},401);
  }else{
   const showId=String(input?.showId||"");
   if(showId&&(!/^[a-z0-9-]{3,100}$/.test(showId)||!(await loadShows()).some(x=>x.id===showId)))return reply({error:"Chương trình không hợp lệ"},400);
   const name=String(input?.name||"").trim().slice(0,100)||"Khách truy cập";
   const phone=String(input?.phone||"").trim();
   if(phone&&!/^[+0-9 .()\-]{9,25}$/.test(phone))return reply({error:"Số điện thoại không hợp lệ"},400);
   const originHash=rateIpHash(req);
   if(originHash){
    const since=new Date(Date.now()-3600000).toISOString();
    const existing=await staffDb("extra_support_chats?origin_ip_hash=eq."+originHash+"&created_at=gte."+encodeURIComponent(since)+"&select=id&limit=4") as {id:string}[];
    if(existing.length>=4)return reply({error:"Đã tạo quá nhiều phiên tư vấn. Vui lòng dùng lại cuộc chat cũ hoặc gọi 094 865 02 59."},429);
   }
   token=randomBytes(32).toString("hex");
   const rows=await staffDb("extra_support_chats?select=id,access_hash,show_id,customer_name,customer_phone,status,last_customer_at,updated_at",
     {method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({access_hash:sha(token),show_id:showId||null,customer_name:name,customer_phone:phone||null,origin_ip_hash:originHash})}) as Chat[];
   chat=rows[0]||null;if(!chat)throw Error("No chat created");id=chat.id;
  }
  if(chat.last_customer_at&&Date.now()-new Date(chat.last_customer_at).getTime()<3500)return reply({error:"Vui lòng chờ vài giây trước khi gửi tiếp"},429);
  const recent=await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(id)+"&sender=eq.customer&created_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&select=id&limit=80") as {id:number}[];
  if(recent.length>=80)return reply({error:"Phiên trò chuyện đã đạt giới hạn tin nhắn trong ngày. Vui lòng gọi 094 865 02 59."},429);
  await staffDb("extra_support_messages",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({chat_id:id,sender:"customer",body})});
  await staffDb("extra_support_chats?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({updated_at:new Date().toISOString(),last_customer_at:new Date().toISOString(),status:"open"})});
  return reply({chat:publicChat({...chat,status:"open"}),token,messages:await listMessages(id)});
 }catch(e){console.warn("[support-chat] Customer send failed",e instanceof Error?e.message:"unknown");return reply({error:"Chưa gửi được tin nhắn. Vui lòng thử lại hoặc gọi 094 865 02 59."},503)}
}

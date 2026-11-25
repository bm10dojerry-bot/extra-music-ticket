import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {readTikTokCommentAdmin,tikTokCommentAdminRpc} from "../../../../lib/tiktok-comment-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
function sameOrigin(req:NextRequest):boolean{
  try{const origin=req.headers.get("origin"),target=new URL(req.url);return Boolean(origin&&new URL(origin).origin===target.origin&&target.host===req.headers.get("host"));}catch{return false;}
}
export async function GET(){
  if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được xem tư vấn bình luận TikTok."},403);
  try{return reply(await readTikTokCommentAdmin());}
  catch{console.warn("[tiktok-comments] Admin read unavailable");return reply({error:"Chưa tải được trạng thái bình luận TikTok. Chưa thể xác nhận tác vụ đang hoạt động."},503);}
}
export async function PATCH(req:NextRequest){
  if(!sameOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ."},403);
  if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được thay đổi tư vấn bình luận TikTok."},403);
  if(Number(req.headers.get("content-length")||0)>3000)return reply({error:"Yêu cầu quá dài."},413);
  const raw=await req.text().catch(()=>"");
  if(new TextEncoder().encode(raw).byteLength>3000)return reply({error:"Yêu cầu quá dài."},413);
  let input:unknown;try{input=JSON.parse(raw);}catch{return reply({error:"Yêu cầu không hợp lệ."},400);}
  if(!isObject(input)||input.action!=="set_enabled"||typeof input.enabled!=="boolean"||Object.keys(input).length!==2)return reply({error:"Yêu cầu không hợp lệ."},400);
  try{
    if(input.enabled){
      const current=await readTikTokCommentAdmin();
      // A paused task cannot refresh access. A resume request can be stored after
      // evidence ages out; the worker must verify read access before begin_run.
      if(!current.canEnable)return reply({error:current.readinessMessage||"Kết nối và lịch tự động TikTok chưa sẵn sàng."},503);
    }
    // The native task checks this stored flag before processing and immediately
    // before a send. This route never invokes TikTok or creates a schedule.
    const result=await tikTokCommentAdminRpc("configure",{p_patch:{enabled:input.enabled}});
    if(!isObject(result)||result.outcome!=="configured")return reply({error:"Chưa lưu được chế độ trả lời bình luận TikTok. Vui lòng thử lại."},409);
    return reply({ok:true,pausePending:!input.enabled&&result.in_flight===true});
  }catch{console.warn("[tiktok-comments] Admin change unavailable");return reply({error:"Chưa cập nhật được chế độ trả lời bình luận TikTok. Vui lòng thử lại."},503);}
}

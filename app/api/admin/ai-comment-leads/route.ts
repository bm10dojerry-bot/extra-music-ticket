import {after,NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {commentRpc,refreshCommentAccess,runCommentQueue} from "../../../../lib/ai-comment-leads";
import {aiSalesConfigurationReady,getAiSalesSettings} from "../../../../lib/ai-sales";
import {commentLeadsAdminView,safeCommentAdminReason} from "../../../../lib/ai-comment-leads-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const sameOrigin=(req:NextRequest)=>{try{const origin=req.headers.get("origin");return Boolean(origin&&new URL(origin).host===req.headers.get("host"));}catch{return false;}};
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
async function view(){
  const [contract,master]=await Promise.all([commentRpc("read_contract"),getAiSalesSettings()]);
  if(!isObject(contract)||!isObject(contract.settings)||contract.settings.page_id!=="1223940670813189")throw Error("Comment lead settings unavailable");
  return commentLeadsAdminView(contract,{settings:master,configured:aiSalesConfigurationReady()});
}

export async function GET(){
  if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được xem khách hỏi vé từ bình luận."},403);
  try{return reply(await view());}
  catch{console.warn("[comment-leads] Admin read unavailable");return reply({error:"Chưa tải được báo cáo bình luận. Vui lòng thử lại."},503);}
}

export async function PATCH(req:NextRequest){
  if(!sameOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ."},403);
  if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được thay đổi tư vấn bình luận."},403);
  if(Number(req.headers.get("content-length")||0)>3000)return reply({error:"Yêu cầu quá dài."},413);
  const body=await req.text().catch(()=>"");
  if(new TextEncoder().encode(body).byteLength>3000)return reply({error:"Yêu cầu quá dài."},413);
  let input:unknown;try{input=JSON.parse(body);}catch{return reply({error:"Yêu cầu không hợp lệ."},400);}
  if(!isObject(input))return reply({error:"Yêu cầu không hợp lệ."},400);
  const enableAction=input.action==="set_enabled"&&typeof input.enabled==="boolean"&&Object.keys(input).every(key=>["action","enabled"].includes(key));
  const checkAction=input.action==="check_connection"&&Object.keys(input).length===1;
  if(!enableAction&&!checkAction)return reply({error:"Yêu cầu không hợp lệ."},400);
  try{
    if(checkAction){
      const checked=await refreshCommentAccess();
      const current=await view();
      return reply({ok:true,ready:checked.ready&&current.ready,readinessMessage:checked.ready?current.readinessMessage:safeCommentAdminReason(checked.message,current.readinessMessage||"Kết nối Facebook chưa sẵn sàng.")});
    }
    if(input.enabled===true){
      const checked=await refreshCommentAccess();
      if(!checked.ready)return reply({error:safeCommentAdminReason(checked.message,"Kết nối Facebook chưa sẵn sàng; chưa bật tư vấn bình luận.")},503);
      const current=await view();
      if(!current.ready)return reply({error:current.readinessMessage||"AI và kết nối Facebook chưa sẵn sàng; chưa bật tư vấn bình luận."},503);
    }
    // Browser input never controls permission flags, rate limits, IDs or message content.
    const result=await commentRpc("configure",{p_patch:{enabled:input.enabled===true}});
    if(result.outcome!=="configured")return reply({error:"Chưa lưu được chế độ tư vấn bình luận. Vui lòng thử lại."},409);
    if(input.enabled===true)after(async()=>{try{await runCommentQueue({maxJobs:2,scan:false});}catch{console.warn("[comment-leads] Admin follow-up deferred");}});
    return reply({ok:true,pausePending:input.enabled===false&&result.in_flight===true});
  }catch{console.warn("[comment-leads] Admin change unavailable");return reply({error:"Chưa cập nhật được tư vấn bình luận. Vui lòng thử lại."},503);}
}

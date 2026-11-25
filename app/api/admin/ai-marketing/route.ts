import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {marketingAdminView,marketingRpc} from "../../../../lib/ai-marketing";
import {marketingSettingsPatch} from "../../../../lib/ai-marketing-policy";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
const sameOrigin=(req:NextRequest)=>{try{const origin=req.headers.get("origin");return Boolean(origin&&new URL(origin).host===req.headers.get("host"))}catch{return false}};

export async function GET(){
 if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được xem lịch đăng bài và ngân sách quảng cáo."},403);
 try{
  const contract=await marketingRpc("read_contract");
  if(!contract.settings)return reply({error:"Chưa khởi tạo quản lý AI đăng bài và quảng cáo."},503);
  return reply(marketingAdminView(contract));
 }catch{return reply({error:"Chưa tải được báo cáo đăng bài và quảng cáo. Vui lòng thử lại."},503);}
}

export async function PATCH(req:NextRequest){
 if(!sameOrigin(req))return reply({error:"Nguồn yêu cầu không hợp lệ."},403);
 if(!await requireRole(["admin"]))return reply({error:"Chỉ Admin được thay đổi cài đặt quảng cáo."},403);
 if(Number(req.headers.get("content-length")||0)>3000)return reply({error:"Yêu cầu quá dài."},413);
 const parsed=marketingSettingsPatch(await req.json().catch(()=>null));
 if("error" in parsed)return reply({error:parsed.error},400);
 try{
  const result=await marketingRpc("configure",{p_patch:parsed.patch});
  if(result.outcome!=="configured"){
   const message=result.outcome==="cap_below_reserved"?"Hạn mức mới thấp hơn ngân sách đã giữ hoặc đã chi hôm nay. Không thể giảm phần đã cam kết.":result.outcome==="account_has_open_allocations"?"Cần hoàn tất lượt quảng cáo đang mở trước khi đổi tài khoản.":"Chưa lưu được cài đặt. Vui lòng kiểm tra và thử lại.";
   return reply({error:message},409);
  }
  return reply({ok:true,pausePending:result.pause_pending===true});
 }catch{return reply({error:"Chưa lưu được cài đặt quảng cáo. Vui lòng thử lại."},503);}
}

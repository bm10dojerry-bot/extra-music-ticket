import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getSaleCommissionSettings} from "../../../../lib/sale-commission-db";
import type {SaleCommissionSettings} from "../../../../lib/sale-commission";
export const dynamic="force-dynamic";
const keys=["rate_1_10","rate_11_30","rate_31_50","rate_51_plus"] as const;
const deny=()=>NextResponse.json({error:"Chỉ quản trị viên được điều chỉnh tỷ lệ thưởng Sale."},{status:403});

export async function GET(){
 if(!await requireRole(["admin"]))return deny();
 try{return NextResponse.json({settings:await getSaleCommissionSettings()},{headers:{"Cache-Control":"no-store"}})}
 catch(e){console.error("[sale-commission:get]",e);return NextResponse.json({error:"Không tải được cấu hình thưởng Sale."},{status:503})}
}
export async function PATCH(req:NextRequest){
 const actor=await requireRole(["admin"]);if(!actor)return deny();
 if(!req.headers.get("content-type")?.includes("application/json"))return NextResponse.json({error:"Yêu cầu JSON hợp lệ."},{status:415});
 let data:Record<string,unknown>;
 try{const body:unknown=await req.json();if(!body||typeof body!=="object"||Array.isArray(body))throw Error();data=body as Record<string,unknown>}
 catch{return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400})}
 const change={} as SaleCommissionSettings;
 for(const key of keys){
  const v=data[key];
  if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>100||Math.abs(v*100-Math.round(v*100))>0.000001)
   return NextResponse.json({error:"Mỗi tỷ lệ phải là số từ 0 đến 100%, tối đa 2 chữ số thập phân."},{status:400});
  change[key]=v;
 }
 if(typeof data.updated_at!=="string"||!data.updated_at||data.updated_at.length>64)
  return NextResponse.json({error:"Thiếu phiên bản cấu hình. Hãy tải lại trang."},{status:400});
 try{
  const current=await getSaleCommissionSettings();
  if(current.updated_at!==data.updated_at)return NextResponse.json({error:"Cấu hình đã được người khác cập nhật. Vui lòng tải lại trước khi lưu."},{status:409});
  const updated=await staffDb("sale_commission_settings?id=eq.default&updated_at=eq."+encodeURIComponent(current.updated_at),{
   method:"PATCH",headers:{"Prefer":"return=representation"},
   body:JSON.stringify({...change,updated_at:new Date().toISOString(),updated_by:actor.display_name})
  }) as Array<{id:string}>;
  if(updated?.length!==1)return NextResponse.json({error:"Cấu hình thay đổi trong lúc lưu. Hãy tải lại."},{status:409});
  const settings=await getSaleCommissionSettings();
  return NextResponse.json({ok:true,settings},{headers:{"Cache-Control":"no-store"}});
 }catch(e){
  console.error("[sale-commission:patch]",e);
  return NextResponse.json({error:"Không lưu được bảng thưởng Sale. Vui lòng thử lại."},{status:503})
 }
}

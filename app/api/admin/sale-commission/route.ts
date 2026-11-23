import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {getSaleCommissionPolicy,saveSaleCommissionPolicy} from "../../../../lib/sale-commission-db";
import {validateSaleCommissionTiers,type SaleCommissionTier} from "../../../../lib/sale-commission";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const showIdValid=(value:unknown):value is string=>typeof value==="string"&&/^[a-z0-9-]{3,100}$/.test(value);
async function hasShow(showId:string){const rows=await staffDb("managed_shows?id=eq."+encodeURIComponent(showId)+"&select=id&limit=1");return Array.isArray(rows)&&rows.length===1;}
export async function GET(req:NextRequest){
 if(!await requireRole(["admin"]))return json({error:"Chỉ quản trị viên được xem cấu hình hoa hồng."},403);
 const showId=req.nextUrl.searchParams.get("showId");if(!showIdValid(showId))return json({error:"Hãy chọn show cần xem hoa hồng."},400);
 try{if(!await hasShow(showId))return json({error:"Show không tồn tại hoặc chưa được lưu."},404);return json({policy:await getSaleCommissionPolicy(showId)});}
 catch{console.error("[sale-commission:get] Policy unavailable");return json({error:"Không tải được cấu hình hoa hồng của show."},503);}
}
export async function PATCH(req:NextRequest){
 const actor=await requireRole(["admin"]);if(!actor)return json({error:"Chỉ quản trị viên được điều chỉnh hoa hồng."},403);
 if(req.headers.get("origin")!==req.nextUrl.origin)return json({error:"Yêu cầu cập nhật phải xuất phát từ trang Admin."},403);
 if(!req.headers.get("content-type")?.includes("application/json"))return json({error:"Yêu cầu JSON hợp lệ."},415);
 let data:Record<string,unknown>;
 try{const body:unknown=await req.json();if(!body||typeof body!=="object"||Array.isArray(body))throw Error();data=body as Record<string,unknown>;}catch{return json({error:"Dữ liệu không hợp lệ."},400);}
 if(!showIdValid(data.showId))return json({error:"Hãy chọn show cần thay đổi hoa hồng."},400);
 const error=validateSaleCommissionTiers(data.tiers);if(error)return json({error},400);
 if(data.version!==null&&(typeof data.version!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.version)))return json({error:"Thiếu phiên bản cấu hình hợp lệ. Hãy tải lại."},400);
 try{
  if(!await hasShow(data.showId))return json({error:"Show không tồn tại hoặc chưa được lưu."},404);
  const policy=await saveSaleCommissionPolicy(data.showId,(data.tiers as SaleCommissionTier[]).map(t=>({maxTickets:t.maxTickets,rate:t.rate})),data.version as string|null,actor.display_name.slice(0,200));
  if(!policy)return json({error:"Cấu hình đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu."},409);
  return json({ok:true,policy});
 }catch{console.error("[sale-commission:patch] Policy update failed");return json({error:"Không lưu được cấu hình hoa hồng của show. Vui lòng thử lại."},503);}
}

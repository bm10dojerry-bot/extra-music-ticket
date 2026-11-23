import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../../lib/staff-auth";
import {isAnalyticsAdminOrigin} from "../../../../../lib/google-analytics-security";
import {startAnalyticsAuthorization} from "../../../../../lib/google-analytics-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const actor=await requireRole(["admin"]);
 if(!actor||!isAnalyticsAdminOrigin(req.url,req.headers))return NextResponse.json({error:"Chỉ Admin được kết nối Google Analytics từ cổng quản trị."},{status:403,headers:{"Cache-Control":"no-store"}});
 return startAnalyticsAuthorization(actor.id);
}

import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../../lib/staff-auth";
import {analyticsErrorStatus,analyticsSafeError,getAnalyticsConnection,listAnalyticsProperties,listAnalyticsStreams} from "../../../../../lib/google-analytics";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được chọn kết nối Google Analytics."},{status:403,headers});
 try{
  const connection=await getAnalyticsConnection(),propertyId=req.nextUrl.searchParams.get("propertyId");
  return NextResponse.json(propertyId!==null?{streams:await listAnalyticsStreams(connection,propertyId)}:{properties:await listAnalyticsProperties(connection)},{headers});
 }catch(error){return NextResponse.json({error:analyticsSafeError(error)},{status:analyticsErrorStatus(error),headers});}
}

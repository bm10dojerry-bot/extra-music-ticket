import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {analyticsConnectAvailable,analyticsErrorStatus,analyticsRealtime,analyticsSafeError,clearAnalyticsCache,
 getAnalyticsConnection,selectAnalyticsStream,selectedAnalyticsProperty} from "../../../../lib/google-analytics";
import {isAnalyticsAdminOrigin} from "../../../../lib/google-analytics-security";
import type {GoogleAnalyticsResponse} from "../../../../lib/google-analytics-types";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const denied=()=>NextResponse.json({error:"Không có quyền truy cập Google Analytics."},{status:403,headers});

export async function GET(){
 const actor=await requireRole(["admin","show_manager"]);if(!actor)return denied();
 const base:Pick<GoogleAnalyticsResponse,"canManage"|"connectAvailable"|"property">={canManage:actor.role==="admin",connectAvailable:analyticsConnectAvailable(),property:null};
 try{
  const connection=await getAnalyticsConnection();
  if(!connection.refresh_token_cipher)return NextResponse.json({...base,status:"not_connected"} satisfies GoogleAnalyticsResponse,{headers});
  const property=selectedAnalyticsProperty(connection);
  if(!property)return NextResponse.json({...base,status:"select_property"} satisfies GoogleAnalyticsResponse,{headers});
  try{
   const report=await analyticsRealtime(connection,property);
   return NextResponse.json({...base,status:"ready",property,report} satisfies GoogleAnalyticsResponse,{headers});
  }catch(error){return NextResponse.json({...base,status:"error",property,error:analyticsSafeError(error)} satisfies GoogleAnalyticsResponse,{headers});}
 }catch(error){return NextResponse.json({...base,status:"error",error:analyticsSafeError(error)} satisfies GoogleAnalyticsResponse,{status:503,headers});}
}
export async function PUT(req:NextRequest){
 if(!await requireRole(["admin"])||!isAnalyticsAdminOrigin(req.url,req.headers))return denied();
 if(Number(req.headers.get("content-length")||0)>2048)return NextResponse.json({error:"Dữ liệu quá lớn."},{status:413,headers});
 const raw=await req.text();if(raw.length>2048)return NextResponse.json({error:"Dữ liệu quá lớn."},{status:413,headers});
 let body:{propertyId?:unknown;streamId?:unknown};try{body=JSON.parse(raw);}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400,headers});}
 if(!body||typeof body.propertyId!=="string"||typeof body.streamId!=="string")return NextResponse.json({error:"Chọn tài sản và luồng dữ liệu Web."},{status:400,headers});
 try{await selectAnalyticsStream(await getAnalyticsConnection(),body.propertyId,body.streamId);return NextResponse.json({ok:true},{headers});}
 catch(error){return NextResponse.json({error:analyticsSafeError(error)},{status:analyticsErrorStatus(error),headers});}
}
export async function DELETE(req:NextRequest){
 if(!await requireRole(["admin"])||!isAnalyticsAdminOrigin(req.url,req.headers))return denied();
 try{
  const result=await staffDb("rpc/extra_disconnect_google_analytics",{method:"POST",body:"{}"});
  if(result!==true)throw Error("Disconnect failed");
  clearAnalyticsCache();return NextResponse.json({ok:true},{headers});
 }catch(error){return NextResponse.json({error:analyticsSafeError(error)},{status:503,headers});}
}

import {NextResponse} from "next/server";
import {staffDb} from "../../../../lib/staff-auth";
import {validAnalyticsId,validMeasurementId} from "../../../../lib/google-analytics-security";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  const rows=await staffDb("extra_google_analytics_connection?id=eq.default&select=measurement_id,property_id,stream_id,connected_at&limit=1") as Array<{measurement_id:string;property_id:string|null;stream_id:string|null;connected_at:string|null}>;
  const row=rows?.[0];
  const measurementId=row?.connected_at&&validAnalyticsId(row.property_id||"")&&validAnalyticsId(row.stream_id||"")&&validMeasurementId(row.measurement_id)?row.measurement_id:"";
  return NextResponse.json({measurementId},{headers:{"Cache-Control":"public, max-age=0, s-maxage=60"}});
 }catch{return NextResponse.json({measurementId:""},{headers:{"Cache-Control":"no-store"}});}
}

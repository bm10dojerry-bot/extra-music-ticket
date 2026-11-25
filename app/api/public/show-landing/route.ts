import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
import {loadShows} from "../../../../lib/show-data";
import {marketingPixelForShow} from "../../../../lib/marketing-pixel";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get("showId")||"";
 if(!/^[a-z0-9-]{3,100}$/.test(id))return NextResponse.json({error:"Mã show không hợp lệ"},{status:400});
 try{
  const shows=await loadShows();if(!shows.some(s=>s.id===id))return NextResponse.json({error:"Không tìm thấy show"},{status:404});
  const [rows,marketingPixelId]=await Promise.all([
   staffDb("show_landing_content?show_id=eq."+encodeURIComponent(id)+"&select=introduction,setlist,meta_pixel_id,ga4_measurement_id,google_ads_id,google_ads_conversion_label&limit=1") as Promise<{introduction:string;setlist:string;meta_pixel_id:string;ga4_measurement_id:string;google_ads_id:string;google_ads_conversion_label:string}[]>,
   marketingPixelForShow(id),
  ]);
  return NextResponse.json({content:{...(rows[0]||{introduction:"",setlist:"",meta_pixel_id:"",ga4_measurement_id:"",google_ads_id:"",google_ads_conversion_label:""}),marketing_pixel_id:marketingPixelId}},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không tải được nội dung landing page"},{status:503})}
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","show_manager"]))return NextResponse.json({error:"Không có quyền cập nhật"},{status:403});
 const data=await req.json().catch(()=>null);
 const showId=String(data?.showId||""),introduction=String(data?.introduction||"").trim(),setlist=String(data?.setlist||"").trim(),metaPixelId=String(data?.metaPixelId||"").trim(),ga4MeasurementId=String(data?.ga4MeasurementId||"").trim().toUpperCase(),googleAdsId=String(data?.googleAdsId||"").trim().toUpperCase(),googleAdsConversionLabel=String(data?.googleAdsConversionLabel||"").trim();
 if(!/^[a-z0-9-]{3,100}$/.test(showId)||introduction.length>4000||setlist.length>8000||(metaPixelId!==""&&!/^[0-9]{8,25}$/.test(metaPixelId))||(ga4MeasurementId!==""&&!/^G-[A-Z0-9]{6,20}$/.test(ga4MeasurementId))||(googleAdsId!==""&&!/^AW-[0-9]{6,20}$/.test(googleAdsId))||(googleAdsConversionLabel!==""&&!/^[A-Za-z0-9_-]{4,100}$/.test(googleAdsConversionLabel))||Boolean(googleAdsId)!==Boolean(googleAdsConversionLabel))return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400});
 try{
  const shows=await loadShows();if(!shows.some(s=>s.id===showId))return NextResponse.json({error:"Show chưa tồn tại. Hãy lưu show trước."},{status:404});
  await staffDb("show_landing_content?on_conflict=show_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({show_id:showId,introduction,setlist,meta_pixel_id:metaPixelId,ga4_measurement_id:ga4MeasurementId,google_ads_id:googleAdsId,google_ads_conversion_label:googleAdsConversionLabel,updated_at:new Date().toISOString()})});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:"Không lưu được nội dung landing page"},{status:503})}
}

import {NextResponse} from "next/server";
import {mediaPublicUrl,validSlot} from "../../../../lib/media";
export const dynamic="force-dynamic";
export async function GET(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({images:{}});
 try{
 const res=await fetch(url+"/rest/v1/site_media?select=slot,image_path",{headers:{apikey:key,Authorization:"Bearer "+key},cache:"no-store"});
 if(!res.ok)throw Error("read failed");
 const rows:unknown=await res.json();
 if(!Array.isArray(rows))throw Error("invalid media response");
 return NextResponse.json({images:Object.fromEntries(rows.filter((r):r is {slot:string;image_path:string}=>r&&typeof r.slot==="string"&&validSlot(r.slot)&&typeof r.image_path==="string").map(r=>[r.slot,mediaPublicUrl(r.image_path)]))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({images:{}},{status:503})}
}

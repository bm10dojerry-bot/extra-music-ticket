import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {staffDb} from "../../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const code=req.nextUrl.searchParams.get("code")||"";
 const token=req.nextUrl.searchParams.get("token")||"";
 if(!/^EX[0-9A-F]{16}$/.test(code)||!token||token.length>256)return NextResponse.json({error:"Thông tin đơn hàng không hợp lệ."},{status:400});
 try{
 const rows=await staffDb("extra_payment_orders?code=eq."+code+"&select=code,status,amount_vnd,expires_at,access_token&limit=1") as {code:string;status:string;amount_vnd:number;expires_at:string;access_token:string}[];
 const o=rows[0];if(!o)return NextResponse.json({error:"Không tìm thấy đơn hàng."},{status:404});
 const provided=Buffer.from(token),expected=Buffer.from(o.access_token);
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return NextResponse.json({error:"Không có quyền xem đơn hàng."},{status:403});
 return NextResponse.json({code:o.code,status:o.status==="pending"&&new Date(o.expires_at).getTime()<Date.now()?"expired":o.status,amount:o.amount_vnd,expiresAt:o.expires_at},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Không đọc được đơn hàng."},{status:503})}
}

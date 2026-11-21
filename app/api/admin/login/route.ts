import {NextRequest,NextResponse} from "next/server";
import {isAdminSecret} from "../../../../lib/admin-auth";
import {ADMIN_COOKIE,createAdminSession} from "../../../../lib/admin-session";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 let data:{password?:string};try{data=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400})}
 if(!isAdminSecret(data.password||""))return NextResponse.json({error:"Mật khẩu quản trị không đúng."},{status:401});
 const res=NextResponse.json({ok:true});
 res.cookies.set(ADMIN_COOKIE,createAdminSession(),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/admin",maxAge:60*60*8});
 return res;
}

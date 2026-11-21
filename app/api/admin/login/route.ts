import {NextRequest,NextResponse} from "next/server";
import {checkOwnerPassword} from "../../../../lib/password-recovery";
import {ADMIN_COOKIE,createAdminSession} from "../../../../lib/admin-session";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 let data:{password?:string};try{data=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400})}
 let valid=false;try{valid=await checkOwnerPassword(data.password||"")}catch{return NextResponse.json({error:"Chưa kết nối được cơ sở dữ liệu đăng nhập. Hãy chạy SQL 006."},{status:503})}if(!valid)return NextResponse.json({error:"Mật khẩu quản trị không đúng."},{status:401});
 const res=NextResponse.json({ok:true});
 res.cookies.set(ADMIN_COOKIE,createAdminSession(),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:60*60*8});
 return res;
}

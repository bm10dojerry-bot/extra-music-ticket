import {NextRequest,NextResponse} from "next/server";
import {createStaffSession,makePasswordHash,staffDb,verifyPassword,STAFF_COOKIE,type Staff} from "../../../../lib/staff-auth";
export const runtime="nodejs";
export async function POST(req:NextRequest){let body:{username?:string;password?:string};try{body=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400})}
 const username=String(body.username||"").trim().toLowerCase(),password=String(body.password||"");
 if(!/^[a-z0-9._-]{3,40}$/.test(username)||!password||password.length>256)return NextResponse.json({error:"Tài khoản hoặc mật khẩu không đúng"},{status:401});
 try{const rows=await staffDb("staff_accounts?username=eq."+encodeURIComponent(username)+"&select=*&limit=1") as (Staff&{password_hash:string})[];
 const account=rows[0];if(!account||!account.active||!verifyPassword(password,account.password_hash))return NextResponse.json({error:"Tài khoản hoặc mật khẩu không đúng"},{status:401});
 const response=NextResponse.json({ok:true,role:account.role});response.cookies.set(STAFF_COOKIE,createStaffSession(account),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:8*3600});return response;
 }catch{return NextResponse.json({error:"Không thể kết nối dữ liệu nhân viên. Kiểm tra SQL 005."},{status:503})}}

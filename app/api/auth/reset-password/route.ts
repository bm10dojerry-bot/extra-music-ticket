import {NextRequest,NextResponse} from "next/server";
import {applyReset} from "../../../../lib/password-recovery";
export const runtime="nodejs";
export async function POST(req:NextRequest){let data:{token?:string;password?:string};try{data=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400})}
 const token=String(data.token||""),password=String(data.password||"");
 if(!/^[a-f0-9]{64}$/.test(token)||password.length<12||password.length>128)return NextResponse.json({error:"Liên kết hoặc mật khẩu không hợp lệ. Mật khẩu cần 12–128 ký tự."},{status:400});
 try{if(!await applyReset(token,password))return NextResponse.json({error:"Liên kết đã hết hạn hoặc đã được sử dụng."},{status:400});return NextResponse.json({ok:true})}catch{return NextResponse.json({error:"Không đặt lại được mật khẩu. Kiểm tra SQL 006."},{status:503})}}

import {NextRequest,NextResponse} from "next/server";
import {isEmail,sendResetEmail} from "../../../../lib/password-recovery";
import {staffDb} from "../../../../lib/staff-auth";
export const runtime="nodejs";
export async function POST(req:NextRequest){let input:{email?:string};try{input=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400})}
 const email=String(input.email||"").trim().toLowerCase();if(!isEmail(email))return NextResponse.json({error:"Email không hợp lệ"},{status:400});
 const ok=()=>NextResponse.json({message:"Nếu email đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu trong vài phút."});
 try{const ownerEmail=(process.env.REPORT_TO_EMAIL||"").trim().toLowerCase();if(ownerEmail&&email===ownerEmail){await sendResetEmail(email,"owner","owner");return ok()}
 const rows=await staffDb("staff_accounts?email=eq."+encodeURIComponent(email)+"&active=eq.true&select=id&limit=1") as {id:string}[];if(rows[0])await sendResetEmail(email,"staff",rows[0].id);return ok()}catch{return NextResponse.json({error:"Dịch vụ khôi phục chưa sẵn sàng. Kiểm tra SQL 006 và cấu hình email."},{status:503})}}

import {NextRequest,NextResponse} from "next/server";
import {isEmail,requestPasswordResetCode} from "../../../../lib/password-recovery";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 let input:{email?:string};
 try{input=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400})}
 const email=String(input.email||"").trim().toLowerCase();
 if(!isEmail(email))return NextResponse.json({error:"Email không hợp lệ"},{status:400});
 try{
  await requestPasswordResetCode(email);
  return NextResponse.json({message:"Nếu email đã đăng ký, mã xác nhận 6 số sẽ được gửi trong ít phút. Kiểm tra cả thư mục Spam. Bạn có thể yêu cầu mã mới sau 60 giây."});
 }catch(e){
  console.error("[password-code-request]",e instanceof Error?e.message:"unknown");
  return NextResponse.json({error:"Không gửi được mã xác nhận. Vui lòng thử lại sau hoặc liên hệ quản trị."},{status:503});
 }
}

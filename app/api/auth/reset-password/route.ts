import {NextRequest,NextResponse} from "next/server";
import {applyPasswordResetCode,applyReset,isEmail} from "../../../../lib/password-recovery";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 let data:{token?:string;email?:string;code?:string;password?:string};
 try{data=await req.json()}catch{return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400})}
 const password=String(data.password||"");
 if(password.length<12||password.length>128)return NextResponse.json({error:"Mật khẩu mới phải dài 12–128 ký tự."},{status:400});
 const legacyToken=String(data.token||"");
 const email=String(data.email||"").trim().toLowerCase(),code=String(data.code||"").trim();
 if(legacyToken&&!/^[a-f0-9]{64}$/.test(legacyToken))return NextResponse.json({error:"Liên kết không hợp lệ."},{status:400});
 if(!legacyToken&&(!isEmail(email)||!/^\d{6}$/.test(code)))return NextResponse.json({error:"Cần email và mã xác nhận 6 số hợp lệ."},{status:400});
 try{
  const ok=legacyToken?await applyReset(legacyToken,password):await applyPasswordResetCode(email,code,password);
  if(!ok)return NextResponse.json({error:"Mã sai, đã hết hạn, đã dùng hoặc vượt quá số lần thử. Hãy yêu cầu mã mới."},{status:400});
  return NextResponse.json({ok:true,message:"Mật khẩu đã được cập nhật. Hãy đăng nhập lại."});
 }catch(e){
  console.error("[password-code-apply]",e instanceof Error?e.message:"unknown");
  return NextResponse.json({error:"Không thể cập nhật mật khẩu. Vui lòng thử lại sau."},{status:503});
 }
}

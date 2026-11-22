import {NextRequest,NextResponse} from "next/server";
import {createHash,randomBytes} from "node:crypto";
import {requireRole,staffDb} from "../../../../../../lib/staff-auth";
export const runtime="nodejs";
const callback="https://iextra.net/api/zalo/oauth/callback";
export async function GET(req:NextRequest){
 if(!await requireRole(["admin"]))return NextResponse.json({error:"Chỉ Admin được liên kết Zalo OA"},{status:403});
 const appId=process.env.ZALO_APP_ID||"4502345524689201342";
 if(!/^\d{10,25}$/.test(appId)||!process.env.ZALO_APP_SECRET)return NextResponse.json({error:"Chưa cấu hình ZALO_APP_SECRET trên Vercel"},{status:503});
 const state=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
 const digest=(s:string)=>createHash("sha256").update(s).digest();
 const challenge=digest(verifier).toString("base64url");
 await staffDb("extra_zalo_oauth_attempts",{method:"POST",body:JSON.stringify({state_hash:digest(state).toString("hex"),code_verifier:verifier,expires_at:new Date(Date.now()+10*60*1000).toISOString()})});
 const url=new URL("https://oauth.zaloapp.com/v4/oa/permission");
 url.searchParams.set("app_id",appId);url.searchParams.set("redirect_uri",callback);
 url.searchParams.set("code_challenge",challenge);url.searchParams.set("code_challenge_method","S256");url.searchParams.set("state",state);
 return NextResponse.redirect(url.toString(),302);
}

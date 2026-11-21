import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
export const runtime="nodejs";
export async function GET(req:NextRequest){
 const clientId=process.env.GOOGLE_CLIENT_ID;
 if(!clientId)return NextResponse.redirect(new URL("/staff?login_error=google_not_configured",req.url));
 const state=randomBytes(32).toString("hex"),origin="https://iextra.net";
 const dest=req.nextUrl.searchParams.get("from")==="admin"?"admin":"staff";
 const params=new URLSearchParams({client_id:clientId,redirect_uri:origin+"/api/auth/google/callback",response_type:"code",scope:"openid email profile",state,access_type:"online",prompt:"select_account"});
 const res=NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+params.toString());
 res.cookies.set("extra_google_oauth",state+"."+dest,{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth/google",maxAge:600});
 return res;
}

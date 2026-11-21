import {NextRequest,NextResponse} from "next/server";
import {ADMIN_COOKIE} from "../../../../lib/admin-session";
export async function POST(req:NextRequest){const res=NextResponse.redirect(new URL("/admin",req.url),303);res.cookies.set(ADMIN_COOKIE,"",{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:0});return res}

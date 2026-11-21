import {NextRequest,NextResponse} from "next/server";
import {STAFF_COOKIE} from "../../../../lib/staff-auth";
export async function POST(req:NextRequest){const res=NextResponse.redirect(new URL("/staff",req.url),303);res.cookies.set(STAFF_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});return res}

import {NextResponse} from "next/server";
import {ADMIN_COOKIE} from "../../../../lib/admin-session";
export async function POST(){const res=NextResponse.redirect(new URL("/admin",process.env.VERCEL_PROJECT_PRODUCTION_URL?"https://"+process.env.VERCEL_PROJECT_PRODUCTION_URL:"https://iextra.net"),303);res.cookies.set(ADMIN_COOKIE,"",{httpOnly:true,secure:true,sameSite:"strict",path:"/admin",maxAge:0});return res}

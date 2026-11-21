import {NextRequest,NextResponse} from "next/server";
export function middleware(request:NextRequest){
 const host=(request.headers.get("host")||"").split(":")[0].toLowerCase();
 if(host!=="checkin.iextra.net")return NextResponse.next();
 const pathname=request.nextUrl.pathname;
 if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname.startsWith("/api/staff/login")||pathname.startsWith("/api/staff/logout")||pathname.startsWith("/api/staff/checkin")||pathname.startsWith("/api/admin/login"))return NextResponse.next();
 if(pathname==="/checkin"||pathname.startsWith("/checkin/"))return NextResponse.next();
 if(pathname.startsWith("/api/"))return NextResponse.json({error:"Không có quyền truy cập API này từ cổng soát vé"},{status:403});
 const url=request.nextUrl.clone();url.pathname="/checkin";url.search="";return NextResponse.rewrite(url);
}
export const config={matcher:["/((?!_next/static|_next/image).*)"]};

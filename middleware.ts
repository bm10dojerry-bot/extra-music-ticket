import {NextRequest,NextResponse} from "next/server";
export function middleware(request:NextRequest){
 const host=(request.headers.get("host")||"").split(":")[0].toLowerCase();
 const pathname=request.nextUrl.pathname;
 if(host==="checkin.iextra.net"){
  if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname.startsWith("/api/staff/login")||pathname.startsWith("/api/staff/logout")||pathname.startsWith("/api/staff/checkin")||pathname.startsWith("/api/admin/login"))return NextResponse.next();
  if(pathname==="/checkin"||pathname.startsWith("/checkin/"))return NextResponse.next();
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"Không có quyền truy cập API này từ cổng soát vé"},{status:403});
  const url=request.nextUrl.clone();url.pathname="/checkin";url.search="";return NextResponse.rewrite(url);
 }
 if(host==="sale.iextra.net"){
  if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname==="/api/staff/login"||pathname==="/api/staff/logout"||pathname==="/api/staff/sale-requests"||pathname==="/api/staff/sale-shows"||pathname==="/api/staff/reports")return NextResponse.next();
  if(pathname==="/sale"||pathname.startsWith("/sale/"))return NextResponse.next();
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"Cổng Sale không có quyền truy cập API này"},{status:403});
  const url=request.nextUrl.clone();url.pathname="/sale";url.search="";return NextResponse.rewrite(url);
 }
 return NextResponse.next();
}
export const config={matcher:["/((?!_next/static|_next/image).*)"]};

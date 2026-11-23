import {NextRequest,NextResponse} from "next/server";
export function middleware(request:NextRequest){
 const host=(request.headers.get("host")||"").split(":")[0].toLowerCase();
 const pathname=request.nextUrl.pathname;
 if(host==="admin.iextra.net"){
  // The admin portal is isolated from the public storefront and staff subdomains.
  if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname.startsWith("/api/admin/")||pathname.startsWith("/api/staff/")||pathname.startsWith("/api/public/")||pathname.startsWith("/api/auth/google/")||pathname.startsWith("/api/artist-profiles")||pathname.startsWith("/api/venue-profiles")||(pathname==="/reset-password"||pathname==="/api/auth/forgot-password"||pathname==="/api/auth/reset-password")||pathname.startsWith("/api/password/")||pathname.startsWith("/api/media/")||pathname.startsWith("/api/venues/"))return NextResponse.next();
  if(pathname==="/admin"||pathname.startsWith("/admin/")||pathname==="/staff"||pathname.startsWith("/staff/"))return NextResponse.next();
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"API này không khả dụng trên cổng Admin"},{status:403});
  const url=request.nextUrl.clone();url.pathname="/admin";url.search="";return NextResponse.rewrite(url);
 }
 if(host==="iextra.net"||host==="www.iextra.net"){
  if(pathname==="/admin"||pathname.startsWith("/admin/")){
   const url=request.nextUrl.clone();url.hostname="admin.iextra.net";url.protocol="https:";return NextResponse.redirect(url,308);
  }
 }
 if(host==="checkin.iextra.net"){
  if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname.startsWith("/api/staff/login")||pathname.startsWith("/api/staff/logout")||pathname.startsWith("/api/staff/checkin")||pathname.startsWith("/api/admin/login")||pathname==="/reset-password"||pathname==="/api/auth/forgot-password"||pathname==="/api/auth/reset-password")return NextResponse.next();
  if(pathname==="/checkin"||pathname.startsWith("/checkin/"))return NextResponse.next();
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"Không có quyền truy cập API này từ cổng soát vé"},{status:403});
  const url=request.nextUrl.clone();url.pathname="/checkin";url.search="";return NextResponse.rewrite(url);
 }
 if(host==="sale.iextra.net"){
  if(pathname.startsWith("/_next/")||pathname==="/favicon.ico"||pathname==="/api/staff/login"||pathname==="/api/staff/logout"||pathname==="/api/staff/sale-requests"||pathname.startsWith("/api/staff/support-chats")||pathname==="/api/staff/sale-shows"||pathname==="/api/staff/reports"||pathname==="/api/public/show-inventory"||pathname==="/api/payments/sepay/status"||pathname==="/api/staff/sale-reserve"||pathname==="/api/staff/live-presence"||pathname==="/reset-password"||pathname==="/api/auth/forgot-password"||pathname==="/api/auth/reset-password")return NextResponse.next();
  if(pathname==="/sale"||pathname.startsWith("/sale/"))return NextResponse.next();
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"Cổng Sale không có quyền truy cập API này"},{status:403});
  const url=request.nextUrl.clone();url.pathname="/sale";url.search="";return NextResponse.rewrite(url);
 }
 return NextResponse.next();
}
export const config={matcher:["/((?!_next/static|_next/image).*)"]};

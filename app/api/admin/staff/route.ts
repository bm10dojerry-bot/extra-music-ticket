import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb,makePasswordHash,type Role} from "../../../../lib/staff-auth";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status});
export async function GET(){if(!await requireRole(["admin"]))return fail("Không có quyền quản lý nhân viên",403);try{return NextResponse.json({staff:await staffDb("staff_accounts?select=id,username,display_name,email,role,active,created_at&order=created_at.desc&limit=300")})}catch{return fail("Không tải được nhân viên. Kiểm tra SQL 005.",503)}}
export async function POST(req:NextRequest){if(!await requireRole(["admin"]))return fail("Không có quyền tạo tài khoản",403);let data:Record<string,unknown>;try{data=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
 const username=String(data.username||"").trim().toLowerCase(),display_name=String(data.display_name||"").trim(),email=String(data.email||"").trim().toLowerCase(),role=String(data.role||""),password=String(data.password||"");
 if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||email.length>254||!/^[a-z0-9._-]{3,40}$/.test(username)||display_name.length<2||display_name.length>100||!["admin","sale","show_manager","accountant"].includes(role)||password.length<12||password.length>128)return fail("Kiểm tra tài khoản (3–40 ký tự), tên, vai trò và mật khẩu tối thiểu 12 ký tự.",400);
 try{await staffDb("staff_accounts",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({username,display_name,email,role:role as Role,password_hash:makePasswordHash(password)})});return NextResponse.json({ok:true})}catch{return fail("Không tạo được tài khoản. Có thể tên đăng nhập đã tồn tại hoặc chưa chạy SQL 005.",409)}}
export async function PATCH(req:NextRequest){if(!await requireRole(["admin"]))return fail("Không có quyền sửa nhân viên",403);let data:Record<string,unknown>;try{data=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
 const id=String(data.id||""),active=data.active,role=data.role,password=data.password;
 if(!/^[0-9a-f-]{36}$/.test(id)||typeof active!=="boolean"||!["admin","sale","show_manager","accountant"].includes(String(role)))return fail("Dữ liệu không hợp lệ",400);
 const update:Record<string,unknown>={active,role};if(typeof password==="string"&&password.length){if(password.length<12||password.length>128)return fail("Mật khẩu cần 12–128 ký tự",400);update.password_hash=makePasswordHash(password)}
 try{await staffDb("staff_accounts?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(update)});return NextResponse.json({ok:true})}catch{return fail("Không cập nhật được nhân viên",503)}}

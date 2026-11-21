import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb,makePasswordHash,type Role} from "../../../../lib/staff-auth";
export const runtime="nodejs";
const fail=(error:string,status:number)=>NextResponse.json({error},{status});
export async function GET(){if(!await requireRole(["admin"]))return fail("Không có quyền quản lý nhân viên",403);try{return NextResponse.json({staff:await staffDb("staff_accounts?select=id,username,display_name,email,role,active,created_at&order=created_at.desc&limit=300")})}catch{return fail("Không tải được nhân viên. Kiểm tra SQL 005.",503)}}
export async function POST(req:NextRequest){if(!await requireRole(["admin"]))return fail("Không có quyền tạo tài khoản",403);let data:Record<string,unknown>;try{data=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
 const username=String(data.username||"").trim().toLowerCase(),display_name=String(data.display_name||"").trim(),email=String(data.email||"").trim().toLowerCase(),role=String(data.role||""),password=String(data.password||"");
 if(!/^[a-z0-9._-]{3,40}$/.test(username))return fail("Tên đăng nhập chỉ dùng chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang (3–40 ký tự).",400);
 if(display_name.length<2||display_name.length>100)return fail("Tên nhân viên phải có 2–100 ký tự.",400);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return fail("Email không hợp lệ.",400);
 if(!["admin","sale","show_manager","accountant","checkin"].includes(role))return fail("Vai trò nhân viên không hợp lệ. Hãy tải lại trang.",400);
 if(password.length<12||password.length>128)return fail("Mật khẩu phải có từ 12 đến 128 ký tự. Hiện tại có "+password.length+" ký tự.",400);
 try{await staffDb("staff_accounts",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({username,display_name,email,role:role as Role,password_hash:makePasswordHash(password)})});return NextResponse.json({ok:true})}catch(err){const detail=err instanceof Error?err.message:"";console.error("[staff-create]",detail);if(detail.includes("23505"))return fail("Tên đăng nhập hoặc email đã tồn tại. Hãy chọn tên khác.",409);if(detail.includes("23514"))return fail("Supabase chưa cho phép vai trò checkin. Hãy chạy SQL 014 trong Supabase SQL Editor.",409);return fail("Không tạo được tài khoản. Kiểm tra SQL 005/014 và Vercel Logs [staff-create].",503)}}
export async function PATCH(req:NextRequest){if(!await requireRole(["admin"]))return fail("Không có quyền sửa nhân viên",403);let data:Record<string,unknown>;try{data=await req.json()}catch{return fail("Dữ liệu không hợp lệ",400)}
 const id=String(data.id||""),active=data.active,role=data.role,password=data.password,email=data.email;
 if(!/^[0-9a-f-]{36}$/.test(id)||typeof active!=="boolean"||!["admin","sale","show_manager","accountant","checkin"].includes(String(role)))return fail("Dữ liệu không hợp lệ",400);
 const update:Record<string,unknown>={active,role};if(typeof email==="string"){const normalized=email.trim().toLowerCase();if(normalized&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))return fail("Email không hợp lệ",400);update.email=normalized||null}if(typeof password==="string"&&password.length){if(password.length<12||password.length>128)return fail("Mật khẩu cần 12–128 ký tự",400);update.password_hash=makePasswordHash(password)}
 try{await staffDb("staff_accounts?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(update)});return NextResponse.json({ok:true})}catch{return fail("Không cập nhật được nhân viên",503)}}

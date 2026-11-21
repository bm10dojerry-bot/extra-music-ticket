import {cookies} from "next/headers";
import {ADMIN_COOKIE,validAdminSession} from "../../lib/admin-session";
import AdminLogin from "./login-form";
import AdminDashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function AdminPage(){const cookieStore=await cookies();const authorized=validAdminSession(cookieStore.get(ADMIN_COOKIE)?.value);return authorized?<AdminDashboard/>:<AdminLogin/>}

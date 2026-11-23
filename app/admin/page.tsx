import {getActor} from "../../lib/staff-auth";

import AdminLogin from "./login-form";
import AdminDashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function AdminPage({searchParams}:{searchParams:Promise<{section?:string|string[]}>}){const [actor,params]=await Promise.all([getActor(),searchParams]);const initialSection=typeof params.section==="string"?params.section:undefined;return actor&&["admin","show_manager"].includes(actor.role)?<AdminDashboard actor={actor} initialSection={initialSection}/>:<AdminLogin/>}

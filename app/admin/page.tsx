import {getActor} from "../../lib/staff-auth";

import AdminLogin from "./login-form";
import AdminDashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function AdminPage(){const actor=await getActor();return actor&&["admin","show_manager"].includes(actor.role)?<AdminDashboard/>:<AdminLogin/>}

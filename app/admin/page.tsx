import {getActor} from "../../lib/staff-auth";

import AdminLogin from "./login-form";
import AdminDashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function AdminPage({searchParams}:{searchParams:Promise<{section?:string|string[];chatId?:string|string[];orderCode?:string|string[]}>}){const [actor,params]=await Promise.all([getActor(),searchParams]);const initialSection=typeof params.section==="string"?params.section:undefined;const initialChatId=typeof params.chatId==="string"&&/^[a-f0-9-]{36}$/i.test(params.chatId)?params.chatId:undefined;const initialOrderCode=typeof params.orderCode==="string"&&/^EX[A-Z0-9]{6,40}$/i.test(params.orderCode)?params.orderCode:undefined;return actor&&["admin","show_manager"].includes(actor.role)?<AdminDashboard actor={actor} initialSection={initialSection} initialChatId={initialChatId} initialOrderCode={initialOrderCode}/>:<AdminLogin/>}

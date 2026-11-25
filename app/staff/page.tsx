import {redirect} from "next/navigation";
import {getActor} from "../../lib/staff-auth";
import StaffWorkspace from "./workspace";
import StaffLogin from "./staff-login";
export const dynamic="force-dynamic";
export default async function StaffPage(){let actor=null;try{actor=await getActor()}catch{}if(actor?.role==="extra_os")redirect("/admin/ai-marketing");if(actor?.role==="checkin")redirect("/checkin");if(actor?.role==="admin"||actor?.role==="show_manager"){const section="staff-overview";redirect("/admin?section="+section)}return actor?<StaffWorkspace actor={actor}/>:<StaffLogin/>}

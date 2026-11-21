import {getActor} from "../../lib/staff-auth";
import StaffWorkspace from "./workspace";
import StaffLogin from "./staff-login";
export const dynamic="force-dynamic";
export default async function StaffPage(){let actor=null;try{actor=await getActor()}catch{}return actor?<StaffWorkspace actor={actor}/>:<StaffLogin/>}

import {getActor} from "../../lib/staff-auth";
import Scanner from "./scanner-client";
import GateLogin from "./gate-login";
export const dynamic="force-dynamic";
export default async function CheckinPage(){
 const actor=await getActor();
 if(!actor||!["admin","show_manager","sale","checkin"].includes(actor.role))return <GateLogin/>;
 return <Scanner/>;
}

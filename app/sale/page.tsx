import {getActor} from "../../lib/staff-auth";
import SaleLogin from "./sale-login";
import SaleWorkspace from "./sale-workspace";
export const dynamic="force-dynamic";
export default async function SalePage(){const actor=await getActor();return actor?.role==="sale"?<SaleWorkspace name={actor.display_name}/>:<SaleLogin/>}

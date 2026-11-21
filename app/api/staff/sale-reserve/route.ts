import {NextRequest,NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {POST as createPayment} from "../../payments/sepay/create/route";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const actor=await requireRole(["sale"]);
 if(!actor)return NextResponse.json({error:"Chỉ nhân viên Sale được giữ ghế tại đây."},{status:403});
 return createPayment(req);
}

import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {staffDb} from "../../../../../lib/staff-auth";
import {deliverTickets,paidOrder} from "../../../../../lib/extra-ticketing";
import {sendMetaPurchase} from "../../../../../lib/meta-capi";
import {sendZaloTicket} from "../../../../../lib/zalo-zbs";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const secret=process.env.SEPAY_WEBHOOK_KEY;
 if(!secret||secret.length<24)return NextResponse.json({success:false},{status:503});
 const authorization=req.headers.get("authorization")||"";
 const supplied=authorization.startsWith("Apikey ")?authorization.slice(7):"";
 const a=Buffer.from(supplied),b=Buffer.from(secret);
 if(a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({success:false},{status:401});
 const payload=await req.json().catch(()=>null);
 const id=Number(payload?.id),amount=Number(payload?.transferAmount),content=String(payload?.content||"");
 if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(amount)||amount<=0||payload?.transferType!=="in")return NextResponse.json({success:false},{status:400});
 if(process.env.SEPAY_BANK_ACCOUNT&&String(payload?.accountNumber||"")!==process.env.SEPAY_BANK_ACCOUNT)return NextResponse.json({success:false},{status:400});
 const matches=content.toUpperCase().match(/EX[0-9A-F]{16}/g)||[];
 const code=matches.length===1?matches[0]:"";
 try{
 const outcome=await staffDb("rpc/extra_confirm_payment",{method:"POST",body:JSON.stringify({p_tx:id,p_code:code,p_amount:amount,p_payload:payload})});
 const order=code?await paidOrder(code):null;
 if(order?.status==="paid"){let emailFailure:unknown=null;try{await deliverTickets(code)}catch(e){emailFailure=e;console.error("[sepay-webhook] ticket email issue",e instanceof Error?e.message:"unknown")}try{await sendZaloTicket(code)}catch(e){console.error("[sepay-webhook] Zalo issue",e instanceof Error?e.message:"unknown")}try{await sendMetaPurchase(code)}catch(e){console.error("[sepay-webhook] CAPI issue",e instanceof Error?e.message:"unknown")}if(emailFailure)throw emailFailure}
 if(outcome!=="paid"&&outcome!=="already_paid")console.warn("[sepay-webhook] Payment requires review:",outcome,"transaction",id);
 return NextResponse.json({success:true});
 }catch(err){console.error("[sepay-webhook] payment confirmation failed:",err instanceof Error?err.message:"Unknown database error");return NextResponse.json({success:false},{status:503})}
}

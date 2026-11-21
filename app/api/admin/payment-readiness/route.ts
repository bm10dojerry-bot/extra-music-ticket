import {NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
export async function GET(){
 if(!await requireRole(["admin","accountant"]))return NextResponse.json({error:"Không có quyền."},{status:403});
 const config={bank:Boolean(process.env.SEPAY_BANK_ACCOUNT&&process.env.SEPAY_BANK_CODE&&process.env.SEPAY_ACCOUNT_NAME),webhook:Boolean(process.env.SEPAY_WEBHOOK_KEY),checkout:process.env.SEPAY_CHECKOUT_ENABLED==="true"};
 let database=false,ticketsDatabase=false;
 try{await staffDb("extra_payment_orders?select=id&limit=1");database=true}catch{}
 try{await staffDb("extra_tickets?select=id&limit=1");ticketsDatabase=true}catch{}
 const emailConfigured=Boolean(process.env.RESEND_API_KEY&&process.env.TICKET_FROM_EMAIL);
 return NextResponse.json({config,database,ticketsDatabase,emailConfigured,webhookUrl:"https://iextra.net/api/payments/sepay/webhook",ready:config.bank&&config.webhook&&config.checkout&&database},{headers:{"Cache-Control":"no-store"}});
}

import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {runAiSalesQueue} from "../../../../lib/ai-sales";
import {sendAiSalesOwnerNotifications} from "../../../../lib/ai-sales-notifications";
import {runDayBefore} from "../../../../lib/messenger-day-before";
import {runAiSalesFollowup} from "../../../../lib/ai-sales-followup";
import {runAiSalesManualTimeout} from "../../../../lib/ai-sales-manual-timeout";
import {runCommentQueue} from "../../../../lib/ai-comment-leads";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET||"",given=req.headers.get("authorization")||"";
 const expected="Bearer "+secret;
 if(secret.length<24||given.length!==expected.length||!timingSafeEqual(Buffer.from(given),Buffer.from(expected)))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const [worker,comments,manualTimeout]=await Promise.all([runAiSalesQueue({maxJobs:4}),runCommentQueue({maxJobs:1,scan:true}),runAiSalesManualTimeout()]);
  const dayBefore=worker.enabled&&worker.ready?await runDayBefore():{sent:0};
  const notifications=await sendAiSalesOwnerNotifications();
  const followup=worker.enabled&&worker.ready?await runAiSalesFollowup():{enabled:false,sent:0};
  return NextResponse.json({...worker,comments,dayBefore,notifications,followup,manualTimeout},{headers:{"Cache-Control":"no-store"}});
 }catch{console.warn("[ai-sales] Scheduled run unavailable");return NextResponse.json({error:"AI sales processing temporarily unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}

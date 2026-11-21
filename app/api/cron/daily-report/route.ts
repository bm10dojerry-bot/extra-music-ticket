import { NextRequest,NextResponse } from "next/server";
import {sendDailyReport} from "../../../../lib/reporting";
export const runtime="nodejs";
export async function GET(req:NextRequest){if(!process.env.CRON_SECRET||req.headers.get("authorization")!=="Bearer "+process.env.CRON_SECRET)return NextResponse.json({error:"Unauthorized"},{status:401});try{return NextResponse.json(await sendDailyReport());}catch(e){console.error("Daily report error",e);return NextResponse.json({error:"Report delivery failed"},{status:500});}}

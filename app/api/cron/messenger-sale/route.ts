import { NextRequest, NextResponse } from "next/server";
import { getMessengerConfig } from "../../../../lib/facebook-messenger";
import { checkMessengerWorkerAuth, getMessengerSalePilot } from "../../../../lib/messenger-sale-pilot";
import { messengerSaleRpc, processMessengerSaleChats } from "../../../../lib/messenger-sale-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
 const config = getMessengerConfig();
 const pilot = config && getMessengerSalePilot(config.pageId);
 if (!pilot || !checkMessengerWorkerAuth(request.headers.get("authorization"), pilot.workerSecret)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 }
 try {
  const due = await messengerSaleRpc<{ chat_id: string; psid: string }[]>("extra_messenger_ai_due", {
   p_page_id: pilot.pageId, p_limit: 8, p_allowed_psids: [...pilot.testers]
  });
  const sent = await processMessengerSaleChats(due, pilot);
  return NextResponse.json({ selected: due.length, sent });
 } catch {
  console.warn("[messenger-ai] Could not process scheduled Messenger work");
  return NextResponse.json({ error: "Temporary worker failure" }, { status: 503 });
 }
}

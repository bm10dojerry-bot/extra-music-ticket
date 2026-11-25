import {timingSafeEqual} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {deploymentAllowsExtraOs} from "../../../../lib/extra-os/db";
import {runExtraOs} from "../../../../lib/extra-os/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const token = process.env.EXTRA_OS_CRON_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from("Bearer " + token);
  if (!token || token.length < 24 || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({error: "Unauthorized"}, {status: 401});
  }
  if (!deploymentAllowsExtraOs()) return NextResponse.json({error: "Preview database required"}, {status: 503});
  try {
    return NextResponse.json(await runExtraOs(70_000));
  } catch {
    console.error("[extra-os] Scheduled queue run failed.");
    return NextResponse.json({error: "Queue temporarily unavailable"}, {status: 503});
  }
}

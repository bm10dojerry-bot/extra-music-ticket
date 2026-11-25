import { timingSafeEqual } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const secret = process.env.EXTRA_OS_SALE_LINK_TOKEN || "";
  const provided = req.headers.get("authorization") || "";
  const expected = "Bearer " + secret;
  if (process.env.EXTRA_OS_SALE_LINK_MODE !== "staging" || secret.length < 48 || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return Response.json({error:"unauthorized"}, {status:401});
  }
  let job;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 1024) return Response.json({error:"too_large"}, {status:413});
    job = JSON.parse(raw);
  } catch { return Response.json({error:"invalid"}, {status:400}); }
  if (!job || job.kind !== "connection_check" || job.mode !== "dry_run" || typeof job.id !== "string" || !/^[a-f0-9-]{36}$/i.test(job.id)) return Response.json({error:"unsupported"}, {status:400});
  return Response.json({id:job.id, agent:"Sale", version:"2.3", kind:"connection_check", status:"succeeded", mode:"dry_run", report:{message:"AI Sale V 2.3 received Director connection check.", liveSales:false, messengerConnected:false, sapoConnected:false, ordersCreated:0}, returnedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
}

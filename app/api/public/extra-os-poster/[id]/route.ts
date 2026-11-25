import {rpc} from "../../../../../lib/extra-os/db";
import {readDriveMedia, scopedDriveFile} from "../../../../../lib/extra-os/drive";
import type {OsAsset} from "../../../../../lib/extra-os/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^extra-os-[0-9a-f-]{36}$/.test(id)) return new Response(null, {status: 404});
  try {
    const asset = await rpc<OsAsset | null>("public_poster", {p_id: id});
    if (!asset?.version) return new Response(null, {status: 404});
    const file = await scopedDriveFile(asset.drive_id);
    if (file.version !== asset.version || file.mimeType !== "image/jpeg") return new Response(null, {status: 404});
    const source = await readDriveMedia(asset.drive_id);
    return new Response(source.body, {headers: {"Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60, s-maxage=300"}});
  } catch {
    return new Response(null, {status: 503});
  }
}

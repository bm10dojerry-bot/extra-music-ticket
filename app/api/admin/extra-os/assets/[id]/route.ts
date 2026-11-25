import {getActor} from "../../../../../../lib/staff-auth";
import {rpc, validUuid} from "../../../../../../lib/extra-os/db";
import {readDriveMedia, scopedDriveFile} from "../../../../../../lib/extra-os/drive";
import type {OsAsset} from "../../../../../../lib/extra-os/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const actor = await getActor();
  if (!actor) return new Response(null, {status: 401});
  if (!validUuid(id)) return new Response(null, {status: 404});
  try {
    const asset = await rpc<OsAsset | null>("read_asset", {p_actor: actor.id, p_asset: id});
    if (!asset || !["image/jpeg", "image/png", "video/mp4", "text/plain", "application/json"].includes(asset.mime_type)) {
      return new Response(null, {status: 404});
    }
    const file = await scopedDriveFile(asset.drive_id);
    if (file.mimeType !== asset.mime_type) return new Response(null, {status: 404});
    const source = await readDriveMedia(asset.drive_id);
    return new Response(source.body, {headers: {
      "Content-Type": asset.mime_type, "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(asset.name),
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    }});
  } catch {
    return new Response("Không tải được tệp Drive.", {status: 503});
  }
}

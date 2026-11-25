import "server-only";
import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import type { SeatMapVenue } from "./messenger-sale-media";

const files = {
  ccc: { path: "messenger/ccc-sa-pa-550.png", type: "image/png", size: 556716, sha256: "c9345bad5d11c967bac4d1ec01d48f8a504fe8170f5f6ac5166703168a4891ba" },
  laocai: { path: "messenger/lao-cai-600.jpg", type: "image/jpeg", size: 469708, sha256: "87050bd9a9776f250eb6c1b656a616bbb58dd65d0a1f89f7c66db8e8c024f21a" },
} as const;

export async function readMessengerSeatMap(venue: SeatMapVenue): Promise<File | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const file = files[venue];
  try {
    const result = await get(file.path, { access: "private", abortSignal: AbortSignal.timeout(3500) });
    if (result?.statusCode !== 200) return null;
    if (result.blob.size !== file.size || result.blob.contentType !== file.type) {
      await result.stream.cancel();
      return null;
    }
    const bytes = await new Response(result.stream).arrayBuffer();
    if (createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== file.sha256) return null;
    return new File([bytes], file.path.split("/").pop()!, { type: file.type });
  } catch {
    return null;
  }
}

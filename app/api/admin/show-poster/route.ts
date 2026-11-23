import {NextRequest, NextResponse} from "next/server";
import {requireRole} from "../../../../lib/staff-auth";
import {mediaPublicUrl} from "../../../../lib/media";
import {MAX_POSTER_UPLOAD_BYTES, MAX_POSTER_UPLOAD_MB, POSTER_HEIGHT, POSTER_WIDTH} from "../../../../lib/poster";
import {normalizeShowPoster} from "../../../../lib/poster-processing";

export const runtime = "nodejs";
const error = (message: string, status: number) => NextResponse.json({error: message}, {status});
const showIdPattern = /^[a-z0-9][a-z0-9-]{2,99}$/;

export async function POST(req: NextRequest) {
  let transportError = "Không thể xử lý poster lúc này. Vui lòng thử lại.";
  try {
    if (!await requireRole(["admin", "show_manager"])) {
      return error("Chưa đăng nhập hoặc phiên đã hết hạn.", 401);
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return error("Thiếu cấu hình Supabase.", 503);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return error("Dữ liệu tải poster không hợp lệ. Vui lòng chọn lại ảnh.", 400);
    }
    const id = form.get("showId");
    const file = form.get("file");
    // A complete match rejects the trailing newline accepted by JavaScript's $ anchor.
    if (typeof id !== "string" || showIdPattern.exec(id)?.[0] !== id) {
      return error("Mã show không hợp lệ.", 400);
    }
    if (!(file instanceof File)) return error("Chọn ảnh poster.", 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return error("Chỉ nhận poster JPG, PNG hoặc WebP.", 400);
    }
    if (file.size === 0 || file.size > MAX_POSTER_UPLOAD_BYTES) {
      return error(`Poster phải có dung lượng lớn hơn 0 và tối đa ${MAX_POSTER_UPLOAD_MB} MB.`, 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const signatures: Record<string, boolean> = {
      "image/jpeg": bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/png": bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/webp": bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
    };
    if (!signatures[file.type]) return error("Nội dung ảnh poster không hợp lệ.", 400);

    const headers = {apikey: key, Authorization: "Bearer " + key};
    transportError = "Không thể kiểm tra show lúc này. Vui lòng thử lại.";
    const check = await fetch(url + "/rest/v1/managed_shows?id=eq." + encodeURIComponent(id) + "&select=id", {
      headers,
      cache: "no-store",
    });
    if (!check.ok) return error(transportError, 503);
    const existing: unknown = await check.json();
    if (!Array.isArray(existing) || existing.some(row => !row || typeof row !== "object" || typeof row.id !== "string")) {
      return error(transportError, 503);
    }
    if (!existing.some(row => row.id === id)) {
      return error("Hãy lưu thông tin show trước khi tải poster.", 400);
    }

    let poster: Buffer;
    try {
      poster = await normalizeShowPoster(bytes);
    } catch {
      return error("Không thể chuẩn hóa poster. Vui lòng chọn ảnh hợp lệ không quá 40 triệu điểm ảnh và thử lại.", 400);
    }

    const path = "posters/" + id + "/" + crypto.randomUUID() + ".webp";
    transportError = "Không thể tải poster lên kho lưu trữ lúc này. Vui lòng thử lại.";
    const uploaded = await fetch(url + "/storage/v1/object/extra-media/" + path, {
      method: "POST",
      headers: {...headers, "Content-Type": "image/webp", "x-upsert": "false"},
      body: new Uint8Array(poster),
    });
    if (!uploaded.ok) {
      return error(`Không tải được poster lên kho lưu trữ (HTTP ${uploaded.status}). Vui lòng thử lại.`, 502);
    }

    transportError = "Poster đã tải nhưng chưa lưu được vào show. Vui lòng thử lại.";
    const saved = await fetch(url + "/rest/v1/managed_shows?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: {...headers, "Content-Type": "application/json", Prefer: "return=minimal"},
      body: JSON.stringify({poster_path: path, updated_at: new Date().toISOString()}),
    });
    if (!saved.ok) {
      return error(`Poster đã tải nhưng không lưu được vào show (HTTP ${saved.status}). Vui lòng thử lại.`, 502);
    }

    return NextResponse.json({ok: true, url: mediaPublicUrl(path), width: POSTER_WIDTH, height: POSTER_HEIGHT});
  } catch {
    return error(transportError, 503);
  }
}

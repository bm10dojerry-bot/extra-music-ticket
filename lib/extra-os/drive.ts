import "server-only";
import {randomUUID} from "node:crypto";
import {osDb, WorkBlocked} from "./db";
import type {Department} from "../marketing-workspace";
import type {OsAsset} from "./types";

const api = "https://www.googleapis.com/drive/v3/";
const uploadApi = "https://www.googleapis.com/upload/drive/v3/";
const folder = "application/vnd.google-apps.folder";
const fields = "id,name,mimeType,parents,webViewLink,version,size,trashed";
const imageMimes = ["image/jpeg", "image/png", "image/webp"];
const maxSourceBytes = 12_000_000;
const maxClipBytes = 24_000_000;

type DriveFile = {
  id: string; name: string; mimeType: string; parents?: string[]; webViewLink?: string;
  version?: string; size?: string; trashed?: boolean;
};

export function hasDrive() {
  if (process.env.VERCEL_ENV === "preview"
    && process.env.EXTRA_OS_DRIVE_ROOT_ID !== process.env.EXTRA_OS_PREVIEW_DRIVE_ROOT_ID) return false;
  return Boolean(process.env.EXTRA_OS_DRIVE_ROOT_ID && process.env.EXTRA_OS_DRIVE_CLIENT_ID
    && process.env.EXTRA_OS_DRIVE_CLIENT_SECRET && process.env.EXTRA_OS_DRIVE_REFRESH_TOKEN);
}

let cachedToken: {value: string; until: number} | null = null;
async function accessToken() {
  if (!hasDrive()) throw new WorkBlocked("Cần cấp OAuth Google Drive và thư mục gốc cho ứng dụng EXTRA OS.");
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: process.env.EXTRA_OS_DRIVE_CLIENT_ID!,
      client_secret: process.env.EXTRA_OS_DRIVE_CLIENT_SECRET!, refresh_token: process.env.EXTRA_OS_DRIVE_REFRESH_TOKEN!,
    }),
  });
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new WorkBlocked("Google Drive từ chối OAuth của ứng dụng.");
  }
  if (!response.ok) throw Error("OAuth Google Drive tạm thời lỗi.");
  const payload = await response.json() as {access_token: string; expires_in: number};
  if (!payload.access_token) throw Error("Google Drive chưa trả mã truy cập.");
  cachedToken = {value: payload.access_token, until: Date.now() + Math.max(0, payload.expires_in - 60) * 1000};
  return cachedToken.value;
}

async function driveRequest(base: string, path: string, init?: RequestInit) {
  const token = await accessToken();
  return fetch(base + path, {
    ...init, headers: {...init?.headers, Authorization: "Bearer " + token},
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(14_000),
  });
}

async function driveJson<T>(path: string, init?: RequestInit, base = api) {
  const response = await driveRequest(base, path, init);
  if ([401, 403, 404].includes(response.status)) throw new WorkBlocked("Không đủ quyền với tệp hoặc thư mục Google Drive.");
  if (!response.ok) throw Error("Google Drive trả HTTP " + response.status + ".");
  return await response.json() as T;
}

async function metadata(id: string) {
  return driveJson<DriveFile>("files/" + encodeURIComponent(id) + "?supportsAllDrives=true&fields=" + fields);
}

export async function scopedDriveFile(id: string) {
  const root = process.env.EXTRA_OS_DRIVE_ROOT_ID;
  const source = await metadata(id);
  let current = source;
  for (let depth = 0; depth < 10; depth++) {
    if (current.trashed) break;
    if (current.id === root) return source;
    if (current.parents?.length !== 1) break;
    current = await metadata(current.parents[0]);
  }
  throw new WorkBlocked("Tư liệu phải nằm trong thư mục Google Drive của EXTRA OS.");
}

async function childFiles(id: string) {
  const params = new URLSearchParams({
    q: "'" + id + "' in parents and trashed = false",
    pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    orderBy: "name", fields: "files(" + fields + ")",
  });
  return (await driveJson<{files?: DriveFile[]}>("files?" + params)).files ?? [];
}

export async function findArtistMedia(id: string) {
  const source = await scopedDriveFile(id);
  const candidates = source.mimeType === folder ? await childFiles(source.id) : [source];
  const accepted = (file: DriveFile, max: number) => Boolean(file.version && Number(file.size) > 0 && Number(file.size) <= max);
  const image = candidates.find(file => imageMimes.includes(file.mimeType) && accepted(file, maxSourceBytes));
  const clip = candidates.find(file => file.mimeType === "video/mp4" && accepted(file, maxClipBytes));
  if (!image && !clip) throw new WorkBlocked("Cần ảnh JPEG, PNG, WebP tối đa 12 MB hoặc MP4 tối đa 24 MB trong thư mục tư liệu.");
  return {
    image: image?.version ? {id:image.id, version:image.version} : null,
    clip: clip?.version ? {id:clip.id, version:clip.version} : null,
  };
}

export async function readDriveMedia(id: string) {
  const response = await driveRequest(api, "files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true");
  if ([401, 403, 404].includes(response.status)) throw new WorkBlocked("EXTRA OS không còn quyền đọc tệp Drive.");
  if (!response.ok || !response.body) throw Error("Không tải được tệp Drive.");
  return response;
}

export type ArtistMedia = Awaited<ReturnType<typeof findArtistMedia>>;
type ArtistFile = NonNullable<ArtistMedia["image"]>;

export async function downloadArtistFile(asset: ArtistFile, kind: "image" | "clip") {
  const file = await scopedDriveFile(asset.id);
  const accepted = kind === "image" ? imageMimes.includes(file.mimeType) : file.mimeType === "video/mp4";
  const max = kind === "image" ? maxSourceBytes : maxClipBytes;
  if (!accepted || file.version !== asset.version || !(Number(file.size) > 0) || Number(file.size) > max) {
    throw new WorkBlocked("Tư liệu Drive đã đổi phiên bản, định dạng hoặc dung lượng.");
  }
  const response = await readDriveMedia(file.id);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > max) throw new WorkBlocked("Tư liệu Drive vượt dung lượng.");
  return bytes;
}

export async function saveDriveAsset(
  showId: string, key: string, name: string, mime: string, parentId: string,
  departments: Department[], bytes?: Buffer,
) {
  const query = "extra_os_assets?show_id=eq." + showId + "&key=eq." + encodeURIComponent(key);
  let [asset] = await osDb<OsAsset[]>(query);
  if (!asset) {
    const generated = await driveJson<{ids: string[]}>("files/generateIds?count=1&space=drive");
    if (!generated.ids[0]) throw Error("Google Drive chưa giữ được ID tệp.");
    await osDb("extra_os_assets?on_conflict=show_id,key", {
      method: "POST", headers: {Prefer: "resolution=ignore-duplicates,return=minimal"},
      body: JSON.stringify({show_id: showId, key, drive_id: generated.ids[0], name, mime_type: mime, departments}),
    });
    [asset] = await osDb<OsAsset[]>(query);
  }
  if (asset.ready) return asset;
  const meta = JSON.stringify({id: asset.drive_id, name, mimeType: mime, parents: [parentId]});
  const boundary = "extra-os-" + randomUUID();
  const multipart = bytes && Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
      "\r\n--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n"),
    bytes, Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const response = await driveRequest(bytes ? uploadApi : api,
    "files?supportsAllDrives=true&fields=" + fields + (bytes ? "&uploadType=multipart" : ""), {
      method: "POST",
      headers: {"Content-Type": bytes ? "multipart/related; boundary=" + boundary : "application/json; charset=UTF-8"},
      body: multipart ? new Uint8Array(multipart) : meta,
    });
  if ([401, 403, 404].includes(response.status)) throw new WorkBlocked("Google Drive chưa cấp quyền ghi tư liệu show.");
  // Drive reserves the file ID before upload. A retry after a lost response recovers this exact file.
  const saved = response.status === 409 ? await metadata(asset.drive_id)
    : response.ok ? await response.json() as DriveFile : null;
  if (!saved || saved.mimeType !== mime || !saved.parents?.includes(parentId) || saved.trashed) {
    throw Error("Google Drive chưa xác nhận tệp đúng thư mục.");
  }
  const [updated] = await osDb<OsAsset[]>(query, {
    method: "PATCH", headers: {Prefer: "return=representation"},
    body: JSON.stringify({ready: true, web_url: saved.webViewLink ?? null, version: saved.version ?? null, updated_at: new Date().toISOString()}),
  });
  return updated;
}

export async function showDriveFolder(showId: string, artist: string, section: "04" | "05" | "06" | "07") {
  const root = await scopedDriveFile(process.env.EXTRA_OS_DRIVE_ROOT_ID!);
  const parent = (await childFiles(root.id)).filter(item => item.mimeType === folder && item.name.startsWith(section + " "));
  if (parent.length !== 1) throw new WorkBlocked("Cần đúng một thư mục Google Drive có tiền tố " + section + ".");
  return saveDriveAsset(showId, "folder-" + section, artist + " · " + showId.slice(0, 8), folder, parent[0].id, []);
}

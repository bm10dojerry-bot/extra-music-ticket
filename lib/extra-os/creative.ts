import "server-only";
import {execFile} from "node:child_process";
import {readFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import sharp, {type OverlayOptions} from "sharp";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import {osDb, rpc, WorkBlocked} from "./db";
import {downloadArtistArtwork, readDriveMedia, saveDriveAsset, showDriveFolder} from "./drive";
import type {OsAsset, OsShow} from "./types";

export const displayDate = (value: string) => new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "full", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date(value));

function escapeText(value: string) {
  return value.replace(/[<>&]/g, char => ({"<": "&lt;", ">": "&gt;", "&": "&amp;"})[char]!);
}

async function artwork(source: Buffer, show: OsShow, wide: boolean) {
  const width = 1600;
  const height = wide ? 900 : 2400;
  const illustrationHeight = wide ? 565 : 1620;
  const picture = await sharp(source, {limitInputPixels: 35_000_000}).rotate()
    .resize(width, illustrationHeight, {fit: "cover", position: sharp.strategy.attention}).toBuffer();
  const lines = [
    {value: "+1 EXTRA MUSIC SHOW", color: "#e12a37", font:  wide ? 36 : 48, bold:true,
      top: wide ? 590 : 1680, box: wide ? 44 : 62},
    {value: show.artist, color: "#ffffff", font: wide ? 75 : 120, bold:true,
      top: wide ? 643 : 1770, box: wide ? 89 : 232},
    {value: displayDate(show.starts_at) + " · " + show.venue, color: "#dddddd", font: wide ? 32 : 53, bold:false,
      top: wide ? 744 : 2046, box: wide ? 79 : 145},
    {value: "Vé từ " + show.intake.startingPriceVnd.toLocaleString("vi-VN") + " đ", color: "#ffffff",
      font: wide ? 31 : 58, bold:true, top: wide ? 837 : 2240, box: wide ? 42 : 85},
  ];
  const fontfile = join(process.cwd(), "lib", "extra-os", "fonts", "NotoSans.ttf");
  const innerWidth = width - 120;
  const layers: OverlayOptions[] = [{input: picture, top: 0, left: 0}];
  for (const line of lines) {
    const text = await sharp({text: {
      text: '<span foreground="' + line.color + '">' + escapeText(line.value) + "</span>",
      font: "Noto Sans " + (line.bold ? "Bold " : "") + line.font,
      fontfile, width: innerWidth, rgba: true, dpi: 72,
    }}).png().toBuffer();
    const input = await sharp(text).resize({width: innerWidth, height: line.box, fit: "inside", withoutEnlargement: true}).png().toBuffer();
    layers.push({input, top: line.top, left: 58});
  }
  return sharp({create: {width, height, channels: 3, background: "#101012"}})
    .composite(layers).withMetadata({density: 300}).jpeg({quality: 89}).toBuffer();
}

export async function createPosters(show: OsShow, sourceId: string) {
  const original = await downloadArtistArtwork(sourceId);
  const folder = await showDriveFolder(show.id, show.artist, "04");
  const [poster, banner] = await Promise.all([
    artwork(original, show, false).then(bytes =>
      saveDriveAsset(show.id, "poster", "Poster +1 EXTRA.jpg", "image/jpeg", folder.drive_id, ["operations","media"], bytes)),
    artwork(original, show, true).then(bytes =>
      saveDriveAsset(show.id, "banner", "Banner +1 EXTRA.jpg", "image/jpeg", folder.drive_id, ["operations","media"], bytes)),
  ]);
  await osDb("extra_os_tasks?show_id=eq." + show.id + "&key=eq.print", {
    method: "PATCH", body: JSON.stringify({drive_links: [assetLink(poster), assetLink(banner)]}),
  });
  await rpc("attach_poster", {p_show:show.id});
  return {posterId: poster.id, bannerId: banner.id, posterVersion: poster.version, bannerVersion: banner.version};
}

export function assetLink(asset: Pick<OsAsset, "id">) {
  return "/api/admin/extra-os/assets/" + asset.id;
}

export async function produceVideo(show: OsShow) {
  const [poster] = await osDb<OsAsset[]>("extra_os_assets?show_id=eq." + show.id + "&key=eq.poster&ready=eq.true");
  if (!poster) throw new WorkBlocked("Chưa có poster được cấp quyền để sản xuất video.");
  const source = await readDriveMedia(poster.drive_id);
  const bytes = Buffer.from(await source.arrayBuffer());
  if (bytes.length > 12_000_000) throw new WorkBlocked("Poster vượt dung lượng xử lý video.");
  const dir = await mkdtemp(join(tmpdir(), "extra-os-video-"));
  try {
    const image = join(dir, "poster.jpg");
    const video = join(dir, "show.mp4");
    await writeFile(image, bytes);
    await promisify(execFile)(ffmpeg.path, [
      "-hide_banner", "-loglevel", "error", "-threads", "2", "-loop", "1", "-framerate", "25", "-i", image,
      "-t", "8", "-vf", "scale=720:1080,pad=720:1280:0:100:color=0x101012,fade=t=in:st=0:d=0.4,fade=t=out:st=7.5:d=0.5",
      "-an", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video,
    ], {timeout: 22_000});
    const folder = await showDriveFolder(show.id, show.artist, "06");
    return saveDriveAsset(show.id, "video", "Video +1 EXTRA.mp4", "video/mp4", folder.drive_id, ["tiktok","media"], await readFile(video));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

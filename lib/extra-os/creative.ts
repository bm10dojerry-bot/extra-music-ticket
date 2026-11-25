import "server-only";
import {execFile} from "node:child_process";
import {readFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import sharp, {type OverlayOptions} from "sharp";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import {osDb, rpc, WorkBlocked} from "./db";
import {downloadArtistFile, readDriveMedia, saveDriveAsset, showDriveFolder, type ArtistMedia} from "./drive";
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

const transcode = (args: string[]) => promisify(execFile)(ffmpeg.path,
  ["-hide_banner", "-loglevel", "error", "-threads", "2", ...args], {timeout:22_000});

async function extractStill(media: NonNullable<ArtistMedia["clip"]>) {
  const bytes = await downloadArtistFile(media, "clip");
  const dir = await mkdtemp(join(tmpdir(), "extra-os-still-"));
  try {
    const clip = join(dir, "source.mp4");
    const frame = join(dir, "frame.jpg");
    await writeFile(clip, bytes);
    await transcode(["-protocol_whitelist","file,pipe", "-f","mov", "-i",clip, "-frames:v","1",
      "-vf","scale=1600:1600:force_original_aspect_ratio=decrease", "-q:v","3",frame]);
    return await readFile(frame);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
}

export async function createPosters(show: OsShow, media: ArtistMedia) {
  const original = media.image ? await downloadArtistFile(media.image,"image") : await extractStill(media.clip!);
  const folder = await showDriveFolder(show.id, show.artist, "05");
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

export async function produceVideo(show: OsShow, original: ArtistMedia["clip"]) {
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
    const filter = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x101012,setsar=1,fps=25,format=yuv420p";
    const encode = ["-an","-c:v","libx264","-threads","2","-preset","fast","-pix_fmt","yuv420p","-movflags","+faststart",video];
    if (original) {
      const clip = join(dir, "source.mp4");
      await writeFile(clip, await downloadArtistFile(original,"clip"));
      await transcode(["-loop","1","-framerate","25","-i",image,"-stream_loop","-1","-protocol_whitelist","file,pipe",
        "-f","mov","-i",clip,"-filter_complex_threads","1","-filter_complex",
        "[0:v]" + filter + ",trim=duration=2,setpts=PTS-STARTPTS[p];[1:v]" + filter +
        ",trim=duration=6,setpts=PTS-STARTPTS[c];[p][c]concat=n=2:v=1:a=0,fade=t=in:st=0:d=0.4,fade=t=out:st=7.5:d=0.5",
        "-t","8",...encode]);
    } else {
      await transcode(["-loop","1","-framerate","25","-i",image,"-t","8",
        "-vf",filter + ",fade=t=in:st=0:d=0.4,fade=t=out:st=7.5:d=0.5",...encode]);
    }
    const folder = await showDriveFolder(show.id, show.artist, "06");
    return saveDriveAsset(show.id, "video", "Video +1 EXTRA.mp4", "video/mp4", folder.drive_id, ["tiktok","media"], await readFile(video));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

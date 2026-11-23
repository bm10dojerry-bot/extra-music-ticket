import "server-only";
import sharp from "sharp";
import {POSTER_HEIGHT, POSTER_WIDTH} from "./poster";

const MAX_POSTER_INPUT_PIXELS = 40_000_000;
const MAX_POSTER_OUTPUT_BYTES = 5 * 1024 * 1024;

export async function normalizeShowPoster(bytes: Buffer): Promise<Buffer> {
  const {data, info} = await sharp(bytes, {
    limitInputPixels: MAX_POSTER_INPUT_PIXELS,
    failOn: "warning",
  })
    .autoOrient()
    .resize(POSTER_WIDTH, POSTER_HEIGHT, {fit: "cover", position: "centre"})
    .webp({quality: 90, effort: 4})
    .toBuffer({resolveWithObject: true});

  if (
    info.format !== "webp" ||
    info.width !== POSTER_WIDTH ||
    info.height !== POSTER_HEIGHT ||
    data.length === 0 ||
    data.length > MAX_POSTER_OUTPUT_BYTES
  ) {
    throw new Error("Poster output does not meet the required dimensions or size.");
  }

  return data;
}

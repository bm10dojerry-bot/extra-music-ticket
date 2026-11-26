import "server-only";
import sharp from "sharp";
import { zoneColors, type Seat } from "../venues";

const escapeXml = (text: string) => text.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
}[char]!));

export type SeatSnapshot = {
  show: { id: string; artist: string; date: string; venueId: string; venueName: string; prices: Record<string, number | null> };
  seats: readonly Seat[];
  taken: ReadonlySet<string>;
};

export function canonicalSeatCodes(text: string, seats: readonly Seat[]): { valid: string[]; unknown: string[] } {
  const requested = [...new Set(Array.from(
    text.normalize("NFKC").toUpperCase().matchAll(/(?<![\p{L}\p{N}])([A-Z])\s*([0-9]{1,3})(?![\p{L}\p{N}])/gu),
    match => match[1] + match[2].padStart(2, "0"),
  ))];
  const inventory = new Set(seats.map(seat => seat.id));
  return { valid: requested.filter(id => inventory.has(id)), unknown: requested.filter(id => !inventory.has(id)) };
}

export function isExactSeatInquiry(text: string): boolean {
  if (text.length > 150 || text.includes("@")) return false;
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
  if (/\b(dat|chot|mua|giu|thanh toan|chuyen khoan|email|dien thoai)\b/.test(plain)) return false;
  return canonicalSeatCodes(text, []).unknown.length > 0 &&
    (/\b(ghe|cho|vi tri|hang|con trong)\b/.test(plain) || /^[a-z0-9,;\s]+$/i.test(plain) &&
      /^(?:[a-z]\s*\d{1,3}[,;\s]*)+$/i.test(plain));
}

export function verifySeats(snapshot: SeatSnapshot, ids: readonly string[]): void {
  const seats = new Map(snapshot.seats.map(seat => [seat.id, seat]));
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => {
    const seat = seats.get(id);
    return !seat || snapshot.taken.has(id) || typeof snapshot.show.prices[seat.zone] !== "number";
  })) throw Error("Seat selection no longer available");
}

export function showSeatSvg(snapshot: SeatSnapshot, at: Date): string {
  const { show, seats, taken } = snapshot;
  if (!seats.length || seats.length > 1_500 || new Set(seats.map(seat => seat.id)).size !== seats.length ||
    seats.some(seat => !Number.isFinite(seat.x) || !Number.isFinite(seat.y))) throw Error("Invalid show seat layout");

  const xMin = Math.min(...seats.map(seat => seat.x));
  const xMax = Math.max(...seats.map(seat => seat.x));
  const yMin = Math.min(...seats.map(seat => seat.y));
  const yMax = Math.max(...seats.map(seat => seat.y));
  let scale = 21;
  for (let index = 0; index < seats.length; index++) {
    const left = seats[index];
    for (let other = index + 1; other < seats.length; other++) {
      const right = seats[other];
      const separation = Math.max(Math.abs(left.x - right.x) / 43, Math.abs(left.y - right.y) / 26);
      if (separation === 0) throw Error("Overlapping seat coordinates");
      scale = Math.max(scale, 1 / separation);
    }
  }
  const width = Math.max(1_600, Math.ceil((xMax - xMin) * scale) + 240);
  const height = Math.max(1_300, Math.ceil((yMax - yMin) * scale) + 400);
  if (width > 8_000 || height > 8_000 || width * height > 44_000_000) throw Error("Show map exceeds renderer limits");

  const title = escapeXml(show.artist);
  const meta = escapeXml(show.date + " · " + show.venueName + " · " + show.id);
  const clock = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
  }).format(at);
  const horizontalCenter = (width - (xMax - xMin) * scale) / 2;
  const places = seats.map(seat => {
    const x = horizontalCenter + (seat.x - xMin) * scale;
    const y = 220 + (seat.y - yMin) * scale;
    const unavailable = taken.has(seat.id) || typeof show.prices[seat.zone] !== "number";
    const fill = unavailable ? "#777982" : zoneColors[seat.zone] ?? "#ced8e2";
    const ink = unavailable || seat.zone === "A" ? "#fff" : "#152035";
    return `<g><rect x="${x - 20}" y="${y - 12}" width="40" height="24" rx="4" fill="${fill}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="${ink}">${escapeXml(seat.id)}</text></g>`;
  }).join("");
  let stage: string;
  if (show.venueId === "ccc") {
    stage = `<text x="${width - 48}" y="${height / 2}" text-anchor="middle" font-size="26" transform="rotate(90 ${width - 48} ${height / 2})">SÂN KHẤU</text>`;
  } else {
    stage = `<text x="${width / 2}" y="174" text-anchor="middle" font-size="26">SÂN KHẤU</text>`;
  }
  const legend = ["A", "B", "C", "D", "X"].map((tier, index) => {
    const x = 50 + index * 275;
    const fill = tier === "X" ? "#777982" : zoneColors[tier];
    const label = tier === "X" ? "Không khả dụng" : "Hạng " + tier;
    return `<rect x="${x}" y="${height - 117}" rx="4" width="38" height="26" fill="${fill}"/><text x="${x + 50}" y="${height - 96}" font-size="24">${label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="DejaVu Sans, Arial, sans-serif">
  <rect width="100%" height="100%" fill="#f7f8fb"/>
  <rect width="100%" height="137" fill="#151c31"/>
  <g fill="#fff"><text x="44" y="61" font-size="48" font-weight="700">${title}</text><text x="44" y="112" font-size="28">${meta}</text></g>
  <g fill="#202c42">${stage}${places}${legend}<text x="50" y="${height - 53}" font-size="24">Ảnh chụp trạng thái lúc ${escapeXml(clock)} · Kiểm tra lại trước khi giữ ghế</text></g>
</svg>`;
}

export async function showSeatAttachment(snapshot: SeatSnapshot, at: Date): Promise<Uint8Array<ArrayBuffer>> {
  const png = await sharp(Buffer.from(showSeatSvg(snapshot, at))).png({ palette: true, quality: 95 }).toBuffer();
  if (png.length > 8_000_000) throw Error("Show seat map attachment too large");
  return new Uint8Array(png);
}

export function imageAttachment(psid: string, png: Uint8Array<ArrayBuffer>): FormData {
  const form = new FormData();
  form.set("recipient", JSON.stringify({ id: psid }));
  form.set("messaging_type", "RESPONSE");
  form.set("message", JSON.stringify({ attachment: { type: "image", payload: { is_reusable: false } } }));
  form.set("filedata", new Blob([png], { type: "image/png" }), "so-do-ghe.png");
  return form;
}

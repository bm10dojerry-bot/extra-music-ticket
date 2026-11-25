/**
 * Pure, testable decisions for Messenger attachments in the isolated AI Sale pilot.
 * Venue posters describe layout, never live inventory or a seat-specific guarantee.
 */
export type SeatMapVenue = "ccc" | "laocai";
export type VoiceChoice = "yes" | "no" | "none";

const normalize = (raw: string) => raw.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d")
  .toLowerCase().replace(/\s+/g, " ").trim();

export function requestedSeatMaps(message: string, currentVenue?: string | null): SeatMapVenue[] {
  const text = normalize(message);
  // Do not throw a poster at a person who merely mentions a seat or a stage.
  const asksToShow = /\b(?:xem|gui|cho|xin|dua|can|muon|co)\b/.test(text);
  const map = /\b(?:so do|ban do|xem vi tri|khu ghe)\b/.test(text);
  // Preserve the accent: the Vietnamese pronoun “anh” is not a request for an image.
  const asksImage = /(?:ảnh|hình)/iu.test(message) || /\b(?:gui|xem|xin) (?:anh|hinh)\b/.test(text);
  const photoSession = /\bchup (?:anh|hinh)\b/.test(text);
  const otherImage = /\b(?:ca si|nghe si|poster|hoa don|chuyen khoan|ma qr|ve dien tu)\b/.test(text);
  if ((!map && (!asksImage || photoSession || otherImage)) || (!asksToShow && !map)) return [];
  const wantsBoth = /\b(?:ca hai|hai so do|2 so do|ca 2|hai anh|2 anh|hai hinh|2 hinh)\b/.test(text);
  const ccc = /\bccc\b/.test(text);
  // Lào Cai can be the province in the full address of CCC Sa Pa.
  const separateLaoCai = /\b(?:va|voi|cung|them) (?:o |tai |so do )*lao cai\b/.test(text);
  const laocai = /\b(?:lao cai|laocai)\b/.test(text);
  if (wantsBoth || (ccc && laocai && (separateLaoCai || /lao cai.*(?:va|voi).*ccc|ccc[^,]*\s[&+/]\s*lao cai/.test(text)))) return ["ccc", "laocai"];
  if (ccc) return ["ccc"];
  if (/\bmoana\b/.test(text)) return [];
  if (/\bsa pa\b/.test(text)) return currentVenue === "ccc" ? ["ccc"] : [];
  if (laocai) return ["laocai"];
  return currentVenue === "ccc" || currentVenue === "laocai" ? [currentVenue] : [];
}

export function checkedMediaUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password
        || url.hash || url.hostname === "localhost" || url.hostname.endsWith(".localhost")
        || url.hostname === "127.0.0.1" || url.hostname.endsWith(".invalid")) return null;
    return url.toString();
  } catch { return null; }
}

export function voiceOfferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Explicit pilot-only switch. The asset must be a genuine recorded/synthesized Vietnamese audio.
  return env.MESSENGER_SALE_VOICE_PILOT_ENABLED === "1"
    && Boolean(checkedMediaUrl(env.MESSENGER_SALE_VOICE_AUDIO_URL));
}

export function requestedVoiceChoice(message: string, wasOffered: boolean): VoiceChoice {
  const text = normalize(message);
  if (/\b(?:khong|ko|k|thoi|chua)\b.*\b(?:voice|thoai|giong noi|audio)\b|\b(?:nhan tin|chat|tra loi|viet)\b.*\b(?:bang chu|tin nhan chu)\b/.test(text)) return "no";
  if (/\b(?:xin|cho|gui|muon|thich|can|tu van|tra loi|noi chuyen)\b.*\b(?:voice|tin nhan thoai|giong noi|bang giong noi)\b/.test(text)) return "yes";
  if (!wasOffered) return "none";
  if (/^(?:da )?(?:co|duoc|dong y|ok|oke|yes|vang|uh|um)(?: (?:em|nhe|a|nha|chi|anh))?[.!?]*$/.test(text)) return "yes";
  if (/^(?:da )?(?:khong|ko|k|thoi|de sau|chua can)(?: (?:em|nhe|a|nha))?[.!?]*$/.test(text)) return "no";
  return "none";
}

export function shouldOfferVoice(params: {
  enabled: boolean; offered?: boolean; consent?: "yes" | "no";
  humanRequested?: boolean; intents: readonly string[]; message: string;
}): boolean {
  if (!params.enabled || params.offered || params.consent || params.humanRequested) return false;
  if (requestedVoiceChoice(params.message, false) !== "none") return false;
  return params.intents.some(intent => ["seat_view", "price", "interaction", "booking", "show"].includes(intent));
}

export const voiceOfferMessage = "Mình có muốn em tư vấn thêm bằng tin nhắn thoại (voice) không ạ? Nếu đồng ý, mình nhắn 'Có, gửi voice' nhé. Không thì em tiếp tục tư vấn bằng chữ ạ.";

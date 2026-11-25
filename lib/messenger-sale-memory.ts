import {normalizePosterTiers} from "./poster-offers";
import type {SeatView} from "./extra-sale-text-script";

export type SaleIntent = "price" | "seat_view" | "interaction" | "promotion" | "booking" | "payment" | "show" | "general";
type SeatZone = "A" | "B" | "C" | "D";
type Clarification = "quantity" | "zone" | "budget" | "budget_per_ticket";
type MessageId = number | string;

export type MessengerSaleMemory = {
  showId?: string;
  showDate?: string;
  showSelectionUnresolved?: boolean;
  quantity?: number;
  seatView?: SeatView;
  zone?: SeatZone;
  budgetVnd?: number;
  budgetBasis?: "per_ticket" | "total" | "unspecified";
  lastQuestion?: string;
  unansweredQuestion?: string;
  greeted: boolean;
  aiDisclosed: boolean;
  bookingStatus?: "held" | "expired" | "cancelled" | "confirmed";
  paymentStatus?: "pending" | "paid" | "expired" | "cancelled";
  intents: SaleIntent[];
  humanRequested: boolean;
  lastMessageId?: MessageId;
  clarification?: Clarification;
};

type SaleShow = {id: string; artist: string; title: string; date: string};
type SaleMessage = {id?: MessageId; sender: "customer" | "staff" | "ai"; body: string};
export type MessengerSaleReferral = {ref?: string; adId?: string};
type VerifiedBooking = Pick<MessengerSaleMemory, "bookingStatus" | "paymentStatus"> & {showId: string};
type MemoryInput = {
  messages: readonly SaleMessage[];
  shows: readonly SaleShow[];
  previous?: Partial<MessengerSaleMemory> | null;
  referral?: MessengerSaleReferral | null;
  referralShows?: Readonly<Record<string, string>>;
  booking?: VerifiedBooking | null;
};

function normalized(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}

function words(text: string): string {
  return normalized(text).replace(/[^a-z0-9]+/g, " ").trim();
}

const human = String.raw`(?:nguoi that|nhan vien|tu van vien|sale)`;
const speakToHuman = new RegExp(String.raw`\b(?:gap |noi chuyen (?:truc tiep )?(?:voi )?|nhan tin (?:voi )?|chat (?:voi )?|ket noi (?:voi )?|chuyen(?: (?:em|minh|anh|chi|toi))? (?:qua |cho |sang )?|cho (?:em|minh|anh|chi|toi) (?:gap |noi chuyen voi )?)${human}\b`);
const askForHuman = new RegExp(String.raw`\b(?:co ${human} (?:khong|ko|k)|${human} (?:oi|tu van(?: (?:giup|minh|em|toi))?|ho tro (?:giup|minh|em|toi)))\b`);

export function customerRequestsHuman(text: string): boolean {
  const content = words(text);
  if (/\b(?:khong|ko|k) (?:can|muon|xin) (?:phai )?(?:gap |noi chuyen (?:voi )?)?(?:nguoi that|nhan vien|tu van vien|sale)\b/.test(content)) return false;
  return /\b(?:khong|ko|k) (?:muon|can) (?:noi chuyen (?:voi )?|chat (?:voi )?|dung )?(?:ai|bot|chatbot)\b/.test(content)
    || speakToHuman.test(content) || askForHuman.test(content);
}

function referredShow(shows: readonly SaleShow[], referral?: MessengerSaleReferral | null, mapping?: Readonly<Record<string, string>>): SaleShow | undefined {
  const ref = referral?.ref?.trim();
  const adId = referral?.adId;
  const lookup = (key: string | undefined) => key && mapping && Object.hasOwn(mapping, key) ? mapping[key] : undefined;
  const slug = ref?.match(/^(?:(?:show[:=])|(?:https:\/\/(?:www\.)?iextra\.net)?\/show\/)?([a-z0-9-]+)$/i)?.[1];
  const showId = lookup(adId) ?? lookup(ref) ?? slug?.toLowerCase();
  return shows.find(show => show.id === showId);
}

function mentionedDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d\d)-(\d{2})-(\d{2})\b/);
  const vietnamese = [...text.matchAll(/\b(\d{1,2})\s*(?:\/|\bthang\b)\s*(\d{1,2})(?:(?:\s*\/\s*|\s+nam\s+)(20\d\d))?(?!\d)/g)].pop();
  if (!iso && !vietnamese) return undefined;
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : [vietnamese?.[3], vietnamese?.[2], vietnamese?.[1]];
  const date = `${year ?? "2000"}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
  const timestamp = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return undefined;
  return year ? date : `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function sameDate(iso: string, requested: string): boolean {
  return iso === requested || `${iso.slice(8, 10)}/${iso.slice(5, 7)}` === requested;
}

function recordShow(memory: MessengerSaleMemory, showId: string | undefined, showDate?: string) {
  if (memory.showId && memory.showId !== showId) {
    delete memory.zone;
    delete memory.bookingStatus;
    delete memory.paymentStatus;
  }
  memory.showId = showId;
  memory.showDate = showDate;
  if (showId) delete memory.showSelectionUnresolved;
  else memory.showSelectionUnresolved = true;
}

function selectShow(memory: MessengerSaleMemory, text: string, shows: readonly SaleShow[]) {
  const switchTarget = text.match(/\b(?:doi|chuyen) (?:show )?(?:sang|qua) (?:show|dem nhac|suat dien)\s+(.+)/)?.[1];
  const explicitSwitch = Boolean(switchTarget && !/^(?:nay|do|ay)\b/.test(switchTarget));
  const target = explicitSwitch && switchTarget ? switchTarget : text;
  const date = mentionedDate(target);
  const content = ` ${words(target)} `;
  const mentioned = shows.filter(show => [show.id, show.title, ...show.artist.split(/\s+(?:\+|&|và)\s+/i)]
    .map(words).some(name => name.length >= 4 && content.includes(` ${name} `)));
  if (explicitSwitch && !mentioned.length && (!date || !/^(?:ngay\s+|hom\s+)?\d/.test(target))) {
    recordShow(memory, undefined, date);
    return;
  }
  if (!mentioned.length && !date) return;
  if (!mentioned.length && /\b(?:chuyen khoan|chuyen tien|thanh toan|tra tien)\b/.test(text) && !/\b(?:show|dem nhac|bieu dien)\b/.test(text)) return;
  const choices = (mentioned.length ? mentioned : shows).filter(show => !date || sameDate(show.date, date));
  const selected = choices.length === 1 ? choices[0] : choices.find(show => show.id === memory.showId);
  if (selected) recordShow(memory, selected.id, selected.date);
  else recordShow(memory, undefined, date);
}

const countWords = ["", "mot", "hai", "ba", "bon", "nam", "sau", "bay", "tam", "chin", "muoi"];
const countPattern = String.raw`[1-9]\d{0,2}|${countWords.slice(1).join("|")}`;
const ticketCount = new RegExp(String.raw`\b(?:(them|bot)\s+)?(${countPattern})\s*(?:ve|nguoi|ghe|cho)\b`, "g");
const quantityAnswer = new RegExp(String.raw`^(${countPattern})(?: (?:a|nhe|nha))?[.!]?$`);

function ticketQuantity(text: string, memory: MessengerSaleMemory): number | undefined {
  const explicit = [...text.matchAll(ticketCount)].filter(match => !/\b\d+\s*(?:k|trieu|tr|nghin|ngan|vnd|d)\s+$/.test(text.slice(0, match.index))).pop();
  const answer = memory.clarification === "quantity" ? text.match(quantityAnswer)?.[1] : undefined;
  const quantity = explicit?.[2] ?? answer;
  if (!quantity || /\b(?:bao nhieu|may) (?:ve|ghe|nguoi)\b/.test(text) || /\b(?:neu|gia su) mua\b/.test(text)) return undefined;
  const count = /^\d+$/.test(quantity) ? Number(quantity) : countWords.indexOf(quantity);
  if (!explicit?.[1]) return count;
  if (memory.quantity === undefined) return undefined;
  const updated = memory.quantity + (explicit[1] === "them" ? count : -count);
  return updated > 0 && updated <= 999 ? updated : undefined;
}

function seatPreference(text: string): SeatView | undefined {
  const matches = [...text.matchAll(/\b(trai|phai|chinh dien|trung tam|o giua|chinh giua|khu giua|giua san khau)\b/g)]
    .filter(match => !/^(?:trai|phai)$/.test(match[1]) || /\b(?:ben|goc|sang|ve|chuyen|thich|chon|lay|ngoi|khu)\s*$/.test(text.slice(0, match.index)) || /^(?:trai|phai)(?: (?:a|nhe|nha|di))?[.!]?$/.test(text))
    .filter(match => !/\b(?:khong|ko|k) (?:thich |muon |chon |lay |ngoi )?(?:ben |goc )?$/.test(text.slice(0, match.index)));
  const last = matches.at(-1)?.[1];
  if (!last || (matches.length > 1 && /\b(?:hay|hoac)\b/.test(text))) return undefined;
  return last === "trai" ? "left" : last === "phai" ? "right" : "center";
}

function seatZone(body: string, clarification?: Clarification): SeatZone | undefined {
  // The accent distinguishes price rank "hạng A" from seat row "hàng A".
  const text = normalized(normalizePosterTiers(body.normalize("NFC")).replace(/\bhạng(?=\s+[a-d](?![\p{L}\p{N}]))/giu, "hạng vé"));
  const explicit = [...text.matchAll(/\b(?:khu(?: vuc)?|hang ve|zone) ([abcd])\b/g)].pop()?.[1];
  const answer = clarification === "zone" ? text.match(/^([abcd])(?: (?:a|nhe|nha))?[.!]?$/)?.[1] : undefined;
  return (explicit ?? answer)?.toUpperCase() as SeatZone | undefined;
}

function recordBudget(memory: MessengerSaleMemory, text: string) {
  const basis = /\b(?:tong(?: cong)?|tat ca|ca nhom|ca hai|ca \d+ (?:ve|nguoi))\b/.test(text) ? "total"
    : /\b(?:moi|mot|1) (?:ve|nguoi)\b|\/\s*(?:ve|nguoi)\b/.test(text) ? "per_ticket" : "unspecified";
  const followsBudget = memory.clarification === "budget" || memory.clarification === "budget_per_ticket";
  const basisOnly = /^(?:la |cho )?(?:tong(?: cong)?|ca nhom|ca hai|(?:moi|mot) (?:ve|nguoi))(?: (?:a|nhe|nha))?[.!]?$/.test(text);
  if (basisOnly && followsBudget && memory.budgetVnd !== undefined) {
    memory.budgetBasis = basis;
    return;
  }
  const bareAmount = /^(?:(?:duoi|tam) )?\d+(?:[.,]\d+)?\s*(?:k|trieu|tr|nghin|ngan|vnd|d)\b.*$/.test(text);
  const isBudget = /\b(?:ngan sach|tam|toi da|toi thieu|khoang|duoi|tra duoc|co the chi|vet tui|khong qua|tong)\b/.test(text)
    || bareAmount || (followsBudget && /^\d{1,3}(?:[.,]\d{3})+\b|^\d{5,9}\b/.test(text));
  if (!isBudget) return;
  const matches = [...text.matchAll(/\b(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(trieu|tr|nghin|ngan|vnd|k|d)?\b/g)];
  const tagged = matches.filter(match => match[2]);
  const amount = (tagged.length ? tagged : matches).map(([, value, unit]) => {
    const multiplier = unit === "trieu" || unit === "tr" ? 1_000_000 : unit === "nghin" || unit === "ngan" || unit === "k" ? 1000 : 1;
    const number = multiplier > 1 && !/^\d{1,3}(?:[.,]\d{3})+$/.test(value) ? Number(value.replace(",", ".")) : Number(value.replace(/[.,]/g, ""));
    return number * multiplier;
  }).filter(value => Number.isSafeInteger(value) && value >= 10_000 && value <= 500_000_000).pop();
  if (amount === undefined) return;
  memory.budgetVnd = amount;
  memory.budgetBasis = basis !== "unspecified" ? basis : memory.clarification === "budget_per_ticket" ? "per_ticket" : memory.budgetBasis ?? basis;
}

function classify(text: string): SaleIntent[] {
  const intents: SaleIntent[] = [];
  if (/\b(?:gia(?: ve)?|bao nhieu tien|bao nhieu|chi phi|ngan sach)\b/.test(text)) intents.push("price");
  if (/\b(?:ghe|khu|cho ngoi|goc nhin|ben trai|ben phai|chinh dien|trung tam)\b/.test(text)) intents.push("seat_view");
  if (/\b(?:giao luu|gap ca si|gan ca si|loi di)\b/.test(text)) intents.push("interaction");
  if (/\b(?:khuyen ma[ij]|uu dai|giam gia|tang ve|ma giam)\b/.test(text)) intents.push("promotion");
  if (/\b(?:dat ve|mua ve|giu cho|giu ghe|chot ve|lay ve)\b/.test(text)) intents.push("booking");
  if (/\b(?:thanh toan|chuyen khoan|chuyen tien|tra tien|quet qr|da tra|da ck|xac nhan tien)\b/.test(text)) intents.push("payment");
  if (/\b(?:show|dem nhac|chuong trinh|ngay nao|may gio|o dau|dia diem)\b/.test(text)) intents.push("show");
  return intents;
}

function question(body: string, text: string): string | undefined {
  if (!body.includes("?") && !/\b(?:bao nhieu|co .* khong|o dau|may gio|ngay nao|the nao|nhu the nao|lam sao)\b/.test(text)) return undefined;
  return body.replace(/(?:https?:\/\/|www\.)\S+/gi, "[liên kết]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[ .()-]*){8,}\d/g, "[số riêng tư]")
    .replace(/\b(?=[A-Z0-9]{8,}\b)(?=[A-Z]*\d)[A-Z0-9]{8,}\b/g, "[mã riêng tư]")
    .trim().slice(0, 240);
}

function assistantClarification(text: string): Clarification | undefined {
  if (/\b(?:bao nhieu|may) (?:ve|ghe|nguoi)\b/.test(text)) return "quantity";
  if (/\b(?:khu nao|khu vuc nao|hang ve nao)\b/.test(text)) return "zone";
  if (/\b(?:du tinh|ngan sach|muc gia mong muon|tam gia|khoang gia)\b.*\bmoi ve\b/.test(text) && !/\btong\b/.test(text)) return "budget_per_ticket";
  if (/\b(?:ngan sach|muc gia mong muon|tam gia|khoang gia)\b/.test(text)) return "budget";
  return undefined;
}

function alreadyRead(id: MessageId | undefined, cursor: MessageId | undefined): boolean {
  if (id === undefined || cursor === undefined) return false;
  if (String(id) === String(cursor)) return true;
  return /^\d+$/.test(String(id)) && /^\d+$/.test(String(cursor)) && BigInt(id) < BigInt(cursor);
}

/** Project ordered inbox history into preferences. Only pass authenticated booking facts in booking. */
export function deriveMessengerSaleMemory(input: MemoryInput): MessengerSaleMemory {
  const memory: MessengerSaleMemory = {
    greeted: false, aiDisclosed: false, intents: [], humanRequested: false, ...input.previous,
  };
  if (!memory.showId && !memory.showDate && !memory.showSelectionUnresolved) {
    const referred = referredShow(input.shows, input.referral, input.referralShows);
    if (referred) recordShow(memory, referred.id, referred.date);
  }
  for (const message of input.messages) {
    if (alreadyRead(message.id, input.previous?.lastMessageId)) continue;
    const text = normalized(message.body);
    if (message.id !== undefined) memory.lastMessageId = message.id;
    if (!text) continue;
    if (message.sender !== "customer") {
      memory.greeted = true;
      if (message.sender === "ai" && /\b(?:su dung|dung) (?:cong nghe )?ai\b/.test(text)) memory.aiDisclosed = true;
      if (message.sender === "staff") memory.humanRequested = false;
      delete memory.unansweredQuestion;
      memory.intents = [];
      memory.clarification = assistantClarification(text);
      continue;
    }
    const {showId, showDate, quantity, seatView, zone, budgetVnd, budgetBasis} = memory;
    selectShow(memory, text, input.shows);
    memory.quantity = ticketQuantity(text, memory) ?? memory.quantity;
    memory.seatView = /\b(?:goc nhin nao cung duoc|ben nao cung duoc|khong quan trong goc nhin)\b/.test(text)
      ? undefined : seatPreference(text) ?? memory.seatView;
    memory.zone = /\b(?:khu nao cung duoc|hang nao cung duoc|khong can khu)\b/.test(text)
      ? undefined : seatZone(message.body, memory.clarification) ?? memory.zone;
    if (/\b(?:ngan sach khong gioi han|khong gioi han ngan sach)\b/.test(text)) {
      delete memory.budgetVnd;
      delete memory.budgetBasis;
    } else recordBudget(memory, text);
    const currentQuestion = question(message.body, text);
    if (currentQuestion) memory.lastQuestion = memory.unansweredQuestion = currentQuestion;
    if (customerRequestsHuman(text)) memory.humanRequested = true;
    const intents = classify(text);
    if (!intents.length) {
      if (memory.showId !== showId || memory.showDate !== showDate) intents.push("show");
      if (memory.quantity !== quantity || memory.seatView !== seatView || memory.zone !== zone) intents.push("seat_view");
      if (memory.budgetVnd !== budgetVnd || memory.budgetBasis !== budgetBasis) intents.push(memory.seatView || memory.zone ? "seat_view" : "price");
    }
    memory.intents = [...new Set([...memory.intents.filter(intent => intent !== "general"), ...intents])];
    if (!memory.intents.length) memory.intents = ["general"];
  }
  if (input.booking !== undefined) {
    const booking = input.booking?.showId === memory.showId ? input.booking : null;
    memory.bookingStatus = booking?.bookingStatus;
    memory.paymentStatus = booking?.paymentStatus;
  }
  return memory;
}

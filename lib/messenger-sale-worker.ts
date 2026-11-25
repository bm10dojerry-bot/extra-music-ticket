import "server-only";
import { getMessengerDisplayName, MessengerSendError, messengerOutboundMetadata, sendMessengerPageMessage, sendMessengerPageImage, sendMessengerPageAudio, sendMessengerTypingAction } from "./facebook-messenger";
import { checkedMediaUrl, requestedSeatMaps, requestedVoiceChoice, shouldOfferVoice, voiceOfferEnabled, voiceOfferMessage } from "./messenger-sale-media";
import { readMessengerSeatMap } from "./messenger-seatmap-files";
import { seatMapNames } from "./ai-sale-extra-2-1";
import { voiceReplyAllowed } from "./messenger-voice";
import { loadMessengerSaleInventory, loadMessengerSalePromotions, loadMessengerSaleShows } from "./messenger-sale-data";
import { deriveMessengerSaleMemory, type MessengerSaleMemory } from "./messenger-sale-memory";
import type { MessengerAdReferral, MessengerSalePilot } from "./messenger-sale-pilot";
import { composeMessengerSaleReply, messengerShowOpen } from "./messenger-sale-reply";
import { staffDb } from "./staff-auth";

type Id = number | string;
type Message = { id: Id; sender: "customer" | "staff" | "ai"; body: string };
type Outcome = { outcome: string };
type Claim = Outcome & {
 chat_id: string; psid: string; page_id: string; token: string;
 through_message_id: Id; context: Partial<MessengerSaleMemory> | null; greeted: boolean; ai_disclosed: boolean;
 referral: MessengerAdReferral | null; last_human_at: string | null;
};

export async function messengerSaleRpc<T>(name: string, input: object): Promise<T> {
 return staffDb(`rpc/${name}`, { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
}

function referralShowMap(): Record<string, string> | undefined {
 try {
  const value: unknown = JSON.parse(process.env.MESSENGER_SALE_REFERRAL_SHOWS_JSON || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
 } catch { return undefined; }
}

async function loadMessageHistory(claim: Claim): Promise<Message[]> {
 const messages: Message[] = [];
 const pageSize = 250;
 let cursor = String(claim.context?.lastMessageId || 0);
 const through = String(claim.through_message_id);
 if (!/^\d+$/.test(cursor) || !/^\d+$/.test(through)) throw new Error("Invalid Messenger message cursor");
 for (;;) {
  const query = new URLSearchParams({ chat_id: `eq.${claim.chat_id}`, and: `(id.gt.${cursor},id.lte.${through})`,
   select: "id,sender,body", order: "id.asc", limit: String(pageSize) });
  const chunk: Message[] = await staffDb(`extra_support_messages?${query}`, { signal: AbortSignal.timeout(5000) });
  messages.push(...chunk);
  if (chunk.length < pageSize) return messages;
  cursor = String(chunk.at(-1)!.id);
 }
}

export async function processMessengerSaleChat(chatId: string, psid: string, pilot: MessengerSalePilot): Promise<boolean> {
 if (!pilot.testers.has(psid)) return false;
 const claim = await messengerSaleRpc<Claim>("extra_messenger_ai_claim", { p_chat_id: chatId });
 if (claim.outcome !== "claimed") return false;
 const lease = { p_chat_id: chatId, p_token: claim.token };
 const finish = (status: "sent" | "unknown" | "retry" | "rejected", mid?: string) => messengerSaleRpc<Outcome>(
  "extra_messenger_ai_finish", { ...lease, p_status: status, p_meta_mid: mid ?? null }
 );
 if (claim.psid !== psid || claim.page_id !== pilot.pageId) {
  await finish("retry");
  return false;
 }

 const typing = sendMessengerTypingAction(psid, "typing_on");
 let prepared = false;
 let confirmed = false;
 try {
  const showLookup = loadMessengerSaleShows();
  const [catalog, messages, displayName] = await Promise.all([
   showLookup, loadMessageHistory(claim), claim.greeted || claim.last_human_at ? undefined : getMessengerDisplayName(psid)
  ]);
  const context = deriveMessengerSaleMemory({
   messages, shows: catalog ?? [], previous: claim.context, referral: claim.referral, referralShows: referralShowMap()
  });
  if (!catalog) context.lastMessageId = claim.context?.lastMessageId;
  context.greeted ||= claim.greeted;
  context.aiDisclosed ||= claim.ai_disclosed;
  const message = messages.find(row => String(row.id) === String(claim.through_message_id) && row.sender === "customer");
  if (!message) throw new Error("Missing pending Messenger customer message");
  const show = catalog?.find(candidate => candidate.id === context.showId);
  const now = new Date();
  const needsInventory = context.intents.includes("seat_view") ||
   (context.intents.includes("price") && Boolean(context.seatView || context.zone));
  const inventory = show && needsInventory && messengerShowOpen(show, now) ? await loadMessengerSaleInventory(show, now) : null;
  const result = composeMessengerSaleReply({ memory: context, message: message.body, displayName, now, show, checkoutOrigin: pilot.checkoutOrigin,
   showDataAvailable: Boolean(catalog), inventory, promotions: loadMessengerSalePromotions(), resumedAfterHuman: Boolean(claim.last_human_at) });
  // This whole worker is restricted to the configured pilot testers.
  // Never infer that a static venue poster represents live availability or pricing.
  const wantedMaps = requestedSeatMaps(message.body, show?.venue);
  const images = await Promise.all(wantedMaps.map(async venue => ({venue, file: await readMessengerSeatMap(venue)})));
  const voiceReady = voiceOfferEnabled();
  const voiceChoice = requestedVoiceChoice(message.body, Boolean(context.voiceOffered));
  const voiceAccepted = voiceChoice === "yes" && voiceReady;
  const voiceUrl = checkedMediaUrl(process.env.MESSENGER_SALE_VOICE_AUDIO_URL);
  const extras: string[] = [];
  if (wantedMaps.length) {
    const missing = images.filter(item => !item.file);
    if (images.some(item => item.file)) extras.push("Sơ đồ minh họa bố trí ghế. Khi mình chọn chỗ, em sẽ kiểm tra ghế còn trống theo đúng show ạ.");
    if (missing.length) extras.push("Ảnh sơ đồ " + missing.map(item => seatMapNames[item.venue]).join(" và ")
      + " hiện chưa sẵn sàng. Mình có thể xem ghế trên trang đặt vé ạ.");
  }
  if (voiceChoice === "no") {
    context.voiceConsent = "no";
    context.voiceOffered = true;
    extras.push("Dạ, em tiếp tục tư vấn bằng tin nhắn chữ cho mình nhé.");
  } else if (voiceChoice === "yes") {
    context.voiceConsent = "yes";
    context.voiceOffered = true;
    extras.push(voiceAccepted
      ? "Dạ, em gửi mình một tin nhắn thoại tư vấn thử nghiệm. Giá và ghế còn bán em vẫn xác nhận bằng chữ để mình dễ kiểm tra nhé."
      : "Em đã nhận yêu cầu tư vấn bằng voice, nhưng kênh gửi âm thanh chưa được xác nhận hoạt động. Em vẫn tư vấn mình bằng tin nhắn chữ nhé.");
  } else if (shouldOfferVoice({enabled:voiceReady, offered:context.voiceOffered, consent:context.voiceConsent,
      humanRequested:context.humanRequested, intents:context.intents, message:message.body})) {
    context.voiceOffered = true;
    extras.push(voiceOfferMessage);
  }
  let replyText = result.text;
  for (const extra of extras) {
    if (replyText.length + 1 + extra.length <= 1200) replyText += "\n" + extra;
  }
  await typing;
  const begin = await messengerSaleRpc<Outcome>("extra_messenger_ai_begin_send", {
   ...lease, p_through_message_id: claim.through_message_id, p_body: replyText,
   p_context: context, p_greeted: result.greeted, p_ai_disclosed: result.aiDisclosed
  });
  if (begin.outcome !== "ready") return false;
  prepared = true;
  let delivery: { messageId: string };
  try {
   delivery = await sendMessengerPageMessage(psid, replyText, messengerOutboundMetadata("ai", claim.token));
  } catch (error) {
   await finish(error instanceof MessengerSendError && !error.deliveryUncertain ? "rejected" : "unknown");
   if (!(error instanceof MessengerSendError)) console.warn("[messenger-ai] Outbound delivery could not be verified");
   return false;
  }
  confirmed = true;
  // Text has an independent outbox MID. Never retry the text merely because a
  // secondary attachment failed; that would duplicate a sale conversation.
  await finish("sent", delivery.messageId);
  for (const item of images) {
    if (!item.file) continue;
    try {
      const accepted = await sendMessengerPageImage(psid, item.file, messengerOutboundMetadata("ai", claim.token));
      console.info("[messenger-ai-media] Seat-map delivery accepted", item.venue, accepted.messageId);
    } catch {
      console.warn("[messenger-ai-media] Seat-map delivery not confirmed", item.venue);
    }
  }
  // Consent is attached to the customer's current message, not guessed from
  // a greeting, seat inquiry, prior unrelated "yes", or a general preference.
  if (voiceReplyAllowed(voiceAccepted ? "yes" : "unknown", voiceReady) && voiceUrl) {
    try {
      await sendMessengerPageAudio(psid, voiceUrl);
      console.info("[messenger-ai-media] Opted-in voice delivery accepted");
    } catch {
      console.warn("[messenger-ai-media] Opted-in voice delivery not confirmed");
    }
  }
  return true;
 } catch {
  // A send recorded as started is reconciled by Meta echo or staff. Retrying it could duplicate delivery.
  if (!prepared) await finish("retry").catch(() => undefined);
  console.warn("[messenger-ai] Could not complete conversation processing");
  return false;
 } finally {
  if (!confirmed) {
   await typing;
   await sendMessengerTypingAction(psid, "typing_off");
  }
 }
}

export async function processMessengerSaleChats(chats: { chat_id: string; psid: string }[], pilot: MessengerSalePilot) {
 let sent = 0;
 for (let start = 0; start < chats.length; start += 4) {
  const results = await Promise.allSettled(chats.slice(start, start + 4).map(chat =>
   processMessengerSaleChat(chat.chat_id, chat.psid, pilot)));
  sent += results.filter(result => result.status === "fulfilled" && result.value).length;
  if (results.some(result => result.status === "rejected")) console.warn("[messenger-ai] Could not claim some Messenger work");
 }
 return sent;
}

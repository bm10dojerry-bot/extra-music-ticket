/** Messenger voice attachment parsing. Not wired into production webhook. */
export type MessengerAttachment = {
  type?: string;
  payload?: { url?: string };
};
export type MessengerInboundMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  attachments?: MessengerAttachment[];
};
export function extractMessengerAudioUrl(message: MessengerInboundMessage | undefined): string | null {
  if (!message || message.is_echo) return null;
  for (const attachment of message.attachments ?? []) {
    if (attachment.type !== "audio") continue;
    const url = attachment.payload?.url;
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") continue;
      return parsed.toString();
    } catch {
      continue;
    }
  }
  return null;
}
export function voiceReplyAllowed(consent: "yes" | "no" | "unknown", voiceTransportVerified: boolean): boolean {
  return consent === "yes" && voiceTransportVerified;
}

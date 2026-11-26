import "server-only";
import { staffDb } from "../staff-auth";
import type { HandoffReason } from "./policy";

export type DispatchPurpose = "reply" | "checkout" | "ticket" | "followup" | "before_show_paid" | "manual_timeout" | "seat_map" | "comment_reply";
export type RuntimeMode = "legacy" | "pro";

export function proRuntimeMode(): RuntimeMode {
  // The DB flag independently selects which release can acquire a send slot.
  return process.env.AI_SALE_2_4_PRO_ENABLED === "true" ? "pro" : "legacy";
}

export function proRpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  return staffDb("rpc/extra_sale_pro_" + name, {
    method: "POST",
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(5_000),
  }) as Promise<T>;
}

export async function proEscalate(chatId: string, reason: HandoffReason, source: string) {
  return proRpc<{ outcome: string; handoff_id?: string }>("lock", {
    p_chat_id: chatId, p_reason: reason, p_source: source,
  });
}

export async function proStatus(pageId: string) {
  return proRpc<{ enabled: boolean }>("mode", { p_page_id: pageId });
}

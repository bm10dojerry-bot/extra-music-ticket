import "server-only";
import { proRpc } from "./database";
import { isResolutionCommand } from "./policy";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type HandoffStatus = {
  id?: string;
  opened_at?: string;
  resolved_at?: string | null;
  reason?: string;
  in_flight?: boolean;
  payment?: "paid" | "unpaid";
};

export async function resolveHandoff(input: Record<string, unknown>, actor: { id: string; active: boolean } | null) {
  if (!actor?.active || !uuid.test(actor.id)) return { outcome: "forbidden" };
  const { chatId, handoffId, eventId, issuedAt, command } = input;
  if (typeof chatId !== "string" || !uuid.test(chatId) ||
    typeof handoffId !== "string" || !uuid.test(handoffId) ||
    typeof eventId !== "string" || !uuid.test(eventId) ||
    typeof issuedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt)) ||
    !isResolutionCommand(command)) return { outcome: "invalid" };
  return proRpc<{ outcome: string }>("resolve", {
    p_chat_id: chatId, p_handoff_id: handoffId, p_actor_id: actor.id, p_event_id: eventId,
    p_issued_at: new Date(issuedAt).toISOString(), p_command: "Đã xử lý xong",
  });
}

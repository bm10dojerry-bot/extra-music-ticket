import "server-only";
import { proRpc, proRuntimeMode, type DispatchPurpose } from "./database";

type Identity = {
  chatId: string | null;
  pageId: string;
  recipient: string;
  key: string;
  purpose: DispatchPurpose;
};

export class DispatchBlocked extends Error {
  constructor(public readonly outcome: string) {
    super("Automated Messenger dispatch blocked");
    this.name = "DispatchBlocked";
  }
}

export async function dispatchForChat<T extends { messageId: string }>(
  identity: Identity,
  send: (recheck: () => Promise<void>) => Promise<T>,
  knownRejected: (error: unknown) => boolean,
): Promise<T> {
  const claimed = await proRpc<{ outcome: string; token?: string }>("begin", {
    p_chat_id: identity.chatId,
    p_page_id: identity.pageId,
    p_recipient: identity.recipient,
    p_key: identity.key,
    p_purpose: identity.purpose,
    p_mode: proRuntimeMode(),
  }).catch(() => { throw new DispatchBlocked("database_unavailable"); });
  if (claimed?.outcome !== "send" || !claimed.token) throw new DispatchBlocked(claimed?.outcome ?? "invalid");
  const token = claimed.token;

  const finish = (state: string, receipt: string | null) => proRpc<{ outcome: string }>("finish", {
    p_token: token, p_status: state, p_receipt: receipt,
  });
  const recheck = async () => {
    const current = await proRpc<{ outcome: string }>("recheck", { p_token: token })
      .catch(() => { throw new DispatchBlocked("database_unavailable"); });
    if (current?.outcome !== "ok") throw new DispatchBlocked(current?.outcome ?? "invalid");
  };

  let receipt: T;
  try {
    await recheck();
    receipt = await send(recheck);
    if (!receipt || typeof receipt.messageId !== "string" || receipt.messageId.length < 4 || receipt.messageId.length > 200) {
      throw Error("Invalid Messenger acknowledgement");
    }
  } catch (error) {
    const state = error instanceof DispatchBlocked ? "skipped" : knownRejected(error) ? "failed" : "uncertain";
    await finish(state, null).catch(() => {});
    throw error;
  }
  // If acknowledging the provider fails, leave the durable slot in-flight.
  // The recovery job escalates it and the same delivery key remains reserved.
  if ((await finish("sent", receipt.messageId))?.outcome !== "sent") throw Error("Messenger acknowledgement not persisted");
  return receipt;
}

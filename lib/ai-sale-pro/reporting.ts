import "server-only";
import { proRpc, proRuntimeMode } from "./database";
import { reasonLabels, type HandoffReason } from "./policy";

type Attention = { chat_id: string; name: string; status: string; reason: string; happened_at: string };
type Metrics = {
  chats: number;
  closed: number;
  conversion: number | null;
  revenue: string | null;
  unclosed: number;
  unknown: number;
  handoffs: number;
  pending_handoffs: number;
  errors: number;
  missing_receipts: number;
};
type Audience = "trang" | "owner";
export type InternalSender = (message: { audience: Audience; key: string; text: string }) => Promise<{ id: string }>;
type DeliveryBase = { id: string; key: string; token: string };
type Delivery = DeliveryBase & (
  | { kind: "handoff"; audience: "trang"; payload: Attention }
  | { kind: "hourly"; audience: "trang"; period_end: string; payload: { items: Attention[]; part: number; parts: number } }
  | { kind: "hourly"; audience: "owner"; period_end: string; payload: { hour: Metrics; day: Metrics; day_start: string } }
);

const timezone = "Asia/Ho_Chi_Minh";
const formatTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: timezone });
const number = new Intl.NumberFormat("vi-VN");

const statusLabels: Record<string, string> = {
  handoff: "Chờ Trang tiếp quản",
  payment_unknown: "Chưa xác định thanh toán",
  unclosed: "Chưa chốt vé",
};

function conversationText(item: Attention, adminOrigin: string) {
  const url = new URL("/admin", adminOrigin);
  url.searchParams.set("section", "support-chats");
  url.searchParams.set("chatId", item.chat_id);
  const title = item.name?.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/https?:\/\/\S+/gi, "").trim().slice(0, 100);
  const reason = Object.hasOwn(reasonLabels, item.reason)
    ? reasonLabels[item.reason as HandoffReason]
    : statusLabels[item.reason] || "Cần kiểm tra";
  return [
    title || "Khách Messenger",
    statusLabels[item.status] || "Cần kiểm tra",
    reason,
    formatTime.format(new Date(item.happened_at)),
    url.toString(),
  ].join("\n");
}

function ownerPeriod(title: string, stats: Metrics): string {
  const conversion = stats.conversion === null ? "Chưa có mẫu" : number.format(stats.conversion) + "%";
  const revenue = stats.revenue === null
    ? "Chưa đủ xác nhận (" + stats.missing_receipts + " đơn thiếu biên nhận)"
    : number.format(BigInt(stats.revenue)) + " đ";
  return [
    title,
    `Tổng chat ${stats.chats} · Đã chốt ${stats.closed} · Tỷ lệ ${conversion}`,
    "Doanh thu đã đối soát " + revenue,
    `Chưa chốt ${stats.unclosed} · Chưa rõ thanh toán ${stats.unknown}`,
    `Chuyển Trang ${stats.handoffs} · Đang chờ ${stats.pending_handoffs} · Lỗi tồn ${stats.errors}`,
  ].join("\n");
}

function render(delivery: Delivery, adminOrigin: string): string {
  if (delivery.kind === "handoff") return "AI Sale cần Trang tiếp quản\n\n" + conversationText(delivery.payload, adminOrigin);
  const periodEnd = formatTime.format(new Date(delivery.period_end));
  if (delivery.audience === "owner") {
    const { hour, day, day_start } = delivery.payload;
    return [
      "Báo cáo AI Sale · giờ Việt Nam",
      ownerPeriod("60 phút đến " + periodEnd, hour),
      ownerPeriod("Trong ngày từ " + formatTime.format(new Date(day_start)), day),
    ].join("\n\n");
  }
  const { items, part, parts } = delivery.payload;
  return [
    `Hàng chờ AI Sale · ${periodEnd} · ${part}/${parts}`,
    ...items.map(item => conversationText(item, adminOrigin)),
    ...(!items.length ? ["Hàng chờ trống."] : []),
  ].join("\n\n");
}

export class InternalDeliveryRejected extends Error {}

export async function drainInternal(
  pageId: string,
  kind: Delivery["kind"],
  adminOrigin: string,
  sender?: InternalSender,
  limit = 12,
) {
  if (!sender) return { sent: 0, transport: "unverified" as const };
  let sent = 0;
  for (let index = 0; index < limit; index++) {
    const delivery = await proRpc<Delivery | null>("claim_delivery", { p_page_id: pageId, p_kind: kind });
    if (!delivery) break;
    const finish = (state: string, receipt: string | null) => proRpc<boolean>("finish_delivery", {
      p_id: delivery.id, p_token: delivery.token, p_state: state, p_external_id: receipt,
    });
    let result: { id: string };
    let body: string;
    try {
      body = render(delivery, adminOrigin);
    } catch {
      await finish("failed", null);
      continue;
    }
    try {
      result = await sender({ audience: delivery.audience, key: delivery.key, text: body });
      if (!result || typeof result.id !== "string" || result.id.length < 4 || result.id.length > 200) {
        throw Error("Unknown delivery acknowledgement");
      }
    } catch (error) {
      await finish(error instanceof InternalDeliveryRejected ? "failed" : "uncertain", null);
      continue;
    }
    if (await finish("sent", result.id)) sent++;
  }
  return { sent, transport: "configured" as const };
}

export async function runProTasks(
  pageId: string,
  options: { clock: () => Date; adminOrigin: string; sender?: InternalSender },
) {
  const now = options.clock();
  // Ho Chi Minh City uses UTC+07:00. UTC hour boundaries align with local hours.
  const periodEnd = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  await proRpc<number>("recover_dispatches", { p_page_id: pageId });
  const handoffs = await drainInternal(pageId, "handoff", options.adminOrigin, options.sender, 8);
  if (proRuntimeMode() !== "pro") return { handoffs, hourly: { outcome: "legacy" } };
  const hourly = await proRpc<{ outcome: string }>("enqueue_hour", { p_page_id: pageId, p_end: periodEnd.toISOString() });
  if (hourly.outcome === "disabled") return { handoffs, hourly };
  const deliveries = await drainInternal(pageId, "hourly", options.adminOrigin, options.sender);
  return { handoffs, hourly, deliveries };
}

import "server-only";

import type { Promotion } from "./extra-sale-text-script";
import type { MessengerSaleInventory } from "./messenger-sale-reply";
import { defaultShows, loadAllShows, type ManagedShow } from "./show-data";
import { staffDb } from "./staff-auth";

export async function loadMessengerSaleShows(): Promise<ManagedShow[] | null> {
  try {
    const rows = await loadAllShows(AbortSignal.timeout(4_000));
    const managedIds = new Set(rows.map(show => show.id));
    return [
      ...defaultShows().filter(show => !managedIds.has(show.id)),
      ...rows.filter(show => show.rawStatus !== "hidden"),
    ].sort((first, second) => first.date.localeCompare(second.date));
  } catch {
    // A failed catalog read may hide a changed price or closed sale.
    return null;
  }
}

async function inventoryRows<T>(path: string, order: string, signal: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 200;
  while (true) {
    const page = await staffDb(`${path}&order=${order}.asc&limit=${pageSize}&offset=${rows.length}`, { signal }) as T[];
    if (!Array.isArray(page)) throw new Error("Invalid inventory response");
    if (!page.length) return rows;
    rows.push(...page);
  }
}

export async function loadMessengerSaleInventory(show: ManagedShow, now = new Date()): Promise<MessengerSaleInventory | null> {
  const showId = encodeURIComponent(show.id);
  const venueId = encodeURIComponent(show.venue);
  const asOf = encodeURIComponent(now.toISOString());
  const signal = AbortSignal.timeout(4_000);
  try {
    const [sales, orders, blocked, layout] = await Promise.all([
      inventoryRows<{ seats: string[] }>(`ticket_sales?show_id=eq.${showId}&payment_verified=eq.true&select=seats`, "id", signal),
      inventoryRows<{ seats: string[] }>(`extra_payment_orders?show_id=eq.${showId}&or=(status.eq.paid,and(status.eq.pending,expires_at.gt.${asOf}))&select=seats`, "id", signal),
      inventoryRows<{ seat_id: string }>(`extra_show_blocked_seats?show_id=eq.${showId}&select=seat_id`, "seat_id", signal),
      inventoryRows<{ row_code: string; seat_count: number }>(`venue_seat_rows?venue_id=eq.${venueId}&select=row_code,seat_count`, "row_code", signal),
    ]);
    return {
      showId: show.id,
      rowCounts: Object.fromEntries(layout.map(row => [row.row_code, row.seat_count])),
      unavailable: new Set([
        ...sales.flatMap(sale => sale.seats),
        ...orders.flatMap(order => order.seats),
        ...blocked.map(row => row.seat_id),
      ]),
    };
  } catch {
    // Inventory with a missing source cannot support a specific availability claim.
    return null;
  }
}

const salePrograms = {
  couple5: { quantity: 2, title: "Vé cặp đôi giảm 5%", terms: "Áp dụng cho 2 ghế qua nhân viên Sale Extra ạ." },
  buy5: { quantity: 5, title: "Mua 5 vé, tặng 1 ghế" },
  buy10: { quantity: 10, title: "Mua 10 vé, tặng 2 ghế" },
  buy20: { quantity: 20, title: "Mua 20 vé, tặng 3 ghế" },
} as const;

const configTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function loadMessengerSalePromotions(raw = process.env.MESSENGER_SALE_PROMOTIONS_JSON): Promotion[] {
  if (!raw) return [];
  let configured: unknown;
  try {
    configured = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(configured)) return [];
  return configured.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const { program, showId, startsAt, expiresAt } = value as Record<string, unknown>;
    if (typeof program !== "string" || !Object.hasOwn(salePrograms, program) ||
        typeof showId !== "string" || !/^[a-z0-9-]{3,100}$/.test(showId) ||
        typeof startsAt !== "string" || typeof expiresAt !== "string" ||
        !configTimestamp.test(startsAt) || !configTimestamp.test(expiresAt) ||
        !(Date.parse(startsAt) < Date.parse(expiresAt))) return [];
    const details = salePrograms[program as keyof typeof salePrograms];
    return [{
      showId, startsAt, expiresAt, active: true, quantity: details.quantity, title: details.title,
      terms: "terms" in details ? details.terms
        : "Áp dụng qua nhân viên Sale Extra. Ghế tặng cùng hạng hoặc thấp hơn hạng vé mua thấp nhất và tùy ghế còn trống ạ.",
    }];
  });
}

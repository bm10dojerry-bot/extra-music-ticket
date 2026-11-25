export const showPermissions = ["website", "facebook", "ads"] as const;
export type ShowPermission = typeof showPermissions[number];
export type TicketZone = "A" | "B" | "C" | "D";

export type ShowIntake = {
  artist: string;
  startsAt: string;
  venue: string;
  venueId: string;
  capacity: number;
  bookingVnd: number;
  productionVnd: number;
  adsVnd: number;
  printingVnd: number;
  otherVnd: number;
  startingPriceVnd: number;
  targetProfitVnd: number;
  mediaDriveUrl: string;
  setlist: string;
  artistConfirmed: boolean;
  mediaRightsConfirmed: boolean;
  permissions: ShowPermission[];
};

export function driveFileId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://drive.google.com" || url.username || url.password) return null;
    const id = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/)?.[1]
      ?? url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/view)?\/?$/)?.[1]
      ?? (url.pathname === "/open" ? url.searchParams.get("id") : null);
    return id && /^[\w-]{1,160}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function isDriveLink(value: string): boolean {
  return driveFileId(value) !== null;
}

export function parseShowIntake(body: unknown): ShowIntake {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Dữ liệu show không hợp lệ.");
  const data = body as Record<string, unknown>;
  const text = (key: string, max: number, optional = false) => {
    const value = typeof data[key] === "string" ? data[key].trim() : "";
    if ((!optional && !value) || value.length > max) throw Error("Kiểm tra các thông tin bắt buộc của show.");
    return value;
  };
  const amount = (key: string, min: number, max: number) => {
    const value = data[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
      throw Error("Sức chứa, giá vé và chi phí phải là số nguyên trong phạm vi hợp lệ.");
    }
    return value;
  };
  const date = text("startsAt", 16);
  const startsAt = new Date(date + ":00Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date) || !Number.isFinite(startsAt.getTime())
      || startsAt.toISOString().slice(0, 16) !== date) throw Error("Ngày giờ biểu diễn không hợp lệ.");
  const permissions = data.permissions;
  if (!Array.isArray(permissions) || permissions.some(permission => !showPermissions.includes(permission))) {
    throw Error("Phạm vi vận hành không hợp lệ.");
  }
  if ((permissions.includes("facebook") || permissions.includes("ads")) && !permissions.includes("website")) {
    throw Error("Cấp quyền mở bán trên website trước khi bật Facebook hoặc quảng cáo.");
  }
  const venueId = text("venueId", 30, true);
  if (venueId && !["moana", "ccc", "laocai"].includes(venueId)) throw Error("Sơ đồ ghế không hợp lệ.");
  return {
    artist: text("artist", 150),
    startsAt: date + ":00+07:00",
    venue: text("venue", 150),
    venueId,
    capacity: amount("capacity", 1, 100_000),
    bookingVnd: amount("bookingVnd", 0, 100_000_000_000),
    productionVnd: amount("productionVnd", 0, 100_000_000_000),
    adsVnd: amount("adsVnd", 0, 100_000_000_000),
    printingVnd: amount("printingVnd", 0, 100_000_000_000),
    otherVnd: amount("otherVnd", 0, 100_000_000_000),
    startingPriceVnd: amount("startingPriceVnd", 1, 100_000_000),
    targetProfitVnd: amount("targetProfitVnd", 0, 100_000_000_000),
    mediaDriveUrl: text("mediaDriveUrl", 600),
    setlist: text("setlist", 6000),
    artistConfirmed: data.artistConfirmed === true,
    mediaRightsConfirmed: data.mediaRightsConfirmed === true,
    permissions: showPermissions.filter(permission => permissions.includes(permission)),
  };
}

export function prepareShow(input: ShowIntake, now = new Date(), inventory?: Record<TicketZone, number>) {
  const driveId = driveFileId(input.mediaDriveUrl);
  if (!input.artistConfirmed || !input.mediaRightsConfirmed) throw Error("Xác nhận nghệ sĩ và quyền sử dụng tư liệu.");
  if (!driveId) throw Error("Dùng đường dẫn tệp hoặc thư mục Google Drive hợp lệ.");
  if (Date.parse(input.startsAt) <= now.getTime()) throw Error("Ngày diễn phải ở trong tương lai.");
  const fixedCostVnd = input.bookingVnd + input.productionVnd + input.printingVnd + input.otherVnd;
  const plannedCostVnd = fixedCostVnd + input.adsVnd;
  const targetRevenueVnd = plannedCostVnd + input.targetProfitVnd;
  const tierPrice = (multiplier: number) => Math.min(100_000_000, Math.ceil(input.startingPriceVnd * multiplier));
  const prices = { A: tierPrice(1.8), B: tierPrice(1.5), C: tierPrice(1.25), D: input.startingPriceVnd };
  const mappedCapacity = inventory ? Object.values(inventory).reduce((sum, count) => sum + count, 0) : null;
  const layoutMatches = mappedCapacity === input.capacity;
  const maximumRevenueVnd = inventory && layoutMatches
    ? (Object.keys(prices) as TicketZone[]).reduce((sum, zone) => sum + inventory[zone] * prices[zone], 0)
    : input.capacity * input.startingPriceVnd;
  const projectedRevenueVnd = Math.floor(maximumRevenueVnd * 0.7);
  const minimumAverageAtFullCapacityVnd = Math.ceil(targetRevenueVnd / input.capacity);
  const feasibility: "loss" | "below_target" | "at_risk" | "feasible" = maximumRevenueVnd < plannedCostVnd ? "loss"
    : maximumRevenueVnd < targetRevenueVnd ? "below_target"
    : projectedRevenueVnd < targetRevenueVnd ? "at_risk" : "feasible";
  return {
    driveId, fixedCostVnd, plannedCostVnd, targetRevenueVnd, prices, mappedCapacity, layoutMatches,
    maximumRevenueVnd, projectedRevenueVnd, minimumAverageAtFullCapacityVnd, feasibility,
    breakEvenTicketsAtStartingPrice: Math.ceil(plannedCostVnd / input.startingPriceVnd),
    requiredOccupancy: maximumRevenueVnd === 0 ? null : Math.ceil(100 * targetRevenueVnd / maximumRevenueVnd),
    adjustmentVnd: Math.max(0, targetRevenueVnd - maximumRevenueVnd),
  };
}

export type ShowFinancialPlan = ReturnType<typeof prepareShow>;

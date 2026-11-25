// Intake contract; no publication, spend or database mutation in this module.
export const staffRoutes = {
  venue: "Trang", printing: "Trang", production: "Trang",
  ticketDispute: "Diệu", customerCallback: "Diệu", salesException: "Diệu",
  finance: "Hải", reconciliation: "Hải",
  media: "Bình Media", tiktokManual: "Yến"
} as const;
export type ManualWork = keyof typeof staffRoutes;
export function manualHandoff(kind: ManualWork, description: string, dueAt: string, budgetVnd: number, files: string[], acceptance: string) {
  if (!description.trim() || !acceptance.trim() || !Number.isFinite(Date.parse(dueAt)) || !Number.isSafeInteger(budgetVnd) || budgetVnd < 0) throw new Error("Invalid handoff");
  return { assignee: staffRoutes[kind], kind, description, dueAt, budgetVnd, files, acceptance, status: "pending" as const };
}
export type ShowIntake = { artist: string; startsAt: string; venue: string; capacity: number; bookingVnd: number; adsVnd: number; printingVnd: number; otherVnd: number; startingPriceVnd: number; targetProfitVnd: number; mediaDriveUrl: string; setlist: string; artistConfirmed: boolean; mediaRightsConfirmed: boolean };
export function isDriveLink(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "drive.google.com" && !u.username && !u.password && (/^\/drive\/(?:u\/\d+\/)?folders\/[\w-]+\/?$/.test(u.pathname) || /^\/file\/d\/[\w-]+(?:\/view)?\/?$/.test(u.pathname) || (u.pathname === "/open" && /^[\w-]+$/.test(u.searchParams.get("id") || ""))); } catch { return false; }
}
export function prepareShow(input: ShowIntake, now = new Date()) {
  if (!input.artist.trim() || !input.venue.trim() || !input.setlist.trim() || !input.artistConfirmed || !input.mediaRightsConfirmed || !isDriveLink(input.mediaDriveUrl) || !Number.isFinite(Date.parse(input.startsAt)) || Date.parse(input.startsAt) <= now.getTime()) throw new Error("Incomplete show or invalid Drive link");
  const amounts = [input.capacity,input.bookingVnd,input.adsVnd,input.printingVnd,input.otherVnd,input.startingPriceVnd,input.targetProfitVnd];
  if (amounts.some(n => !Number.isSafeInteger(n) || n < 0) || input.capacity < 1 || input.startingPriceVnd < 1) throw new Error("Invalid financial input");
  const plannedCostVnd = input.bookingVnd + input.adsVnd + input.printingVnd + input.otherVnd;
  const targetRevenueVnd = plannedCostVnd + input.targetProfitVnd;
  if (!Number.isSafeInteger(targetRevenueVnd)) throw new Error("Invalid total");
  return { ...input, plannedCostVnd, targetRevenueVnd, minimumAverageAtFullCapacityVnd: Math.ceil(targetRevenueVnd/input.capacity), status: "draft" as const, mediaStorage: "drive-reference" as const, financialNote: "Estimate before any tax, commission or other costs not included in inputs" };
}

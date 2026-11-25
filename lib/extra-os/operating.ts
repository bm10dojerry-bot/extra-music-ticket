import "server-only";
import {planStaffWork, type ManualWork} from "../marketing-director";
import {prepareShow} from "../marketing-show-intake";
import {shows as defaultShows} from "../shows";
import {getSeatInventory, osDb, rpc, WorkBlocked} from "./db";
import type {OsJob, OsShow, PaidSnapshot} from "./types";

export function ticketingReady() {
  return process.env.SEPAY_CHECKOUT_ENABLED === "true"
    && Boolean(process.env.SEPAY_BANK_ACCOUNT && process.env.SEPAY_ACCOUNT_NAME && process.env.SEPAY_WEBHOOK_KEY)
    && process.env.SEPAY_BANK_CODE?.toUpperCase() === "ACB";
}

export function storefrontOrigin() {
  const origin = process.env.EXTRA_OS_STOREFRONT_ORIGIN || "https://iextra.net";
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new WorkBlocked("Địa chỉ website bán vé không hợp lệ.");
  return origin;
}

export async function assignTask(show: OsShow, task: ManualWork) {
  await osDb("extra_os_tasks?on_conflict=show_id,key", {
    method: "POST", headers: {Prefer:"resolution=ignore-duplicates,return=minimal"},
    body: JSON.stringify({show_id: show.id, ...task}),
  });
}

export function readPaid(show: OsShow, adKey: string | null = null) {
  return rpc<PaidSnapshot>("paid", {p_show: show.id, p_ad_key: adKey});
}

export async function getSalesReadiness(show: OsShow) {
  const id = show.intake.venueId;
  if (!id) return {layoutReady: false, checkoutReady: false, reason: "Địa điểm cần sơ đồ ghế tương thích."};
  const {seats, inventory} = await getSeatInventory(id);
  const layoutReady = seats.length === show.capacity;
  const sales = ticketingReady();
  return {
    layoutReady, checkoutReady: layoutReady && sales,
    seatCapacity: seats.length, inventory,
    reason: !layoutReady ? "Sức chứa không khớp sơ đồ ghế." : !sales ? "Thanh toán SePay chưa sẵn sàng." : "",
  };
}

export async function publishWebsite(show: OsShow, job: OsJob) {
  if (!show.intake.permissions.includes("website")) throw new WorkBlocked("Show chưa cấp quyền đăng website.");
  if (show.website_id) return {websiteId: show.website_id};
  const sale = await getSalesReadiness(show);
  if (!sale.checkoutReady) throw new WorkBlocked(sale.reason);
  const current = prepareShow(show.intake, new Date(), sale.inventory);
  if (current.feasibility === "loss" || current.feasibility === "below_target") {
    throw new WorkBlocked("Cơ cấu giá hoặc chi phí chưa đạt mục tiêu đã cấp.");
  }
  const local = show.intake.startsAt;
  if (defaultShows.some(existing => existing.venue === show.intake.venueId
    && existing.date === local.slice(0, 10) && existing.time.slice(0, 5) === local.slice(11, 16))) {
    throw new WorkBlocked("Lịch website đã có show trùng địa điểm và giờ diễn.");
  }
  const id = "extra-os-" + show.id;
  try {
    const published = await rpc<string>("publish_site", {p_job: job.id, p_lease: job.lease_token, p_id: id, p_prices: current.prices});
    return {websiteId: published};
  } catch (error) {
    if (error instanceof Error && error.message.includes("23505")) throw new WorkBlocked("Lịch website đã có show trùng địa điểm và giờ diễn.");
    throw error;
  }
}

export async function reviewBudget(show: OsShow) {
  const {finances} = show;
  const viable = finances.feasibility !== "loss" && finances.feasibility !== "below_target";
  if (!viable) {
    const correction = planStaffWork(show.intake, finances, new Date()).find(task => task.key === "viability");
    if (correction) await assignTask(show, correction);
  }
  return {
    viable, verifiedArtist: show.intake.artistConfirmed, verifiedMediaRights: show.intake.mediaRightsConfirmed,
    permissions: show.intake.permissions, adLimitVnd: show.ad_limit_vnd,
    adjustmentVnd: finances.adjustmentVnd, requiredOccupancy: finances.requiredOccupancy,
  };
}

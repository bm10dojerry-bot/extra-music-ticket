import "server-only";
import {osDb, rpc, WorkBlocked} from "./db";
import {displayDate} from "./creative";
import {readDriveMedia, scopedDriveFile} from "./drive";
import {readPaid, storefrontOrigin} from "./operating";
import type {AdAllocation, OsAsset, OsJob, OsShow} from "./types";

const graphId = (value: unknown): value is string => typeof value === "string" && /^[0-9_]{5,90}$/.test(value);
const DAY = 86_400_000;
const HOUR = DAY / 24;
class MetaRejected extends WorkBlocked {}

export const metaLive = () => process.env.EXTRA_OS_MARKETING_LIVE === "true" && process.env.VERCEL_ENV !== "preview";

function metaConfig(ads: boolean) {
  const version = process.env.EXTRA_OS_META_VERSION;
  const pageId = process.env.EXTRA_OS_META_PAGE_ID;
  const token = ads ? process.env.EXTRA_OS_META_ADS_TOKEN : process.env.EXTRA_OS_META_PAGE_TOKEN;
  if (!version || !/^v[0-9]{2}\.0$/.test(version) || !graphId(pageId) || !token) {
    throw new WorkBlocked(ads ? "Cần cấu hình Meta Ads API." : "Cần quyền quản lý trang Facebook.");
  }
  return {base: "https://graph.facebook.com/" + version + "/", pageId, token};
}

async function graph<T>(config: ReturnType<typeof metaConfig>, path: string, payload?: Record<string, unknown> | FormData) {
  const body = payload instanceof FormData ? payload : payload && new URLSearchParams(Object.entries(payload)
    .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
  const response = await fetch(config.base + path, {
    method: payload ? "POST" : "GET", body,
    headers: {Authorization: "Bearer " + config.token},
    signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as T & {error?: {code?: number}};
  if (response.status >= 400 && response.status < 500 && response.status !== 429 && data.error?.code) {
    throw new MetaRejected("Meta từ chối yêu cầu (" + data.error.code + "). Kiểm tra quyền và cấu hình.");
  }
  if (!response.ok || data.error) throw Error("Meta chưa xác nhận yêu cầu.");
  return data;
}

export async function onceAtMeta(show: OsShow, job: OsJob, key: string, send: () => Promise<string>) {
  const available = await rpc<boolean>("lease_valid", {p_id: job.id, p_lease: job.lease_token});
  if (!available || !metaLive() || Date.parse(show.starts_at) <= Date.now()) {
    throw new WorkBlocked("Hết quyền thực thi trên Meta cho show.");
  }
  if (key.startsWith("ads-")) {
    const paused = await osDb<{scope:string}[]>("extra_os_controls?paused=eq.true&scope=in.(system,Ads)&select=scope");
    if (paused.length) throw new MetaRejected("AI Ads đang tạm dừng.");
  }
  const query = "extra_os_effects?show_id=eq." + show.id + "&key=eq." + encodeURIComponent(key);
  const fresh = await osDb<{key: string}[]>("extra_os_effects?on_conflict=show_id,key", {
    method: "POST", headers: {Prefer: "resolution=ignore-duplicates,return=representation"},
    body: JSON.stringify({show_id: show.id, key}),
  });
  if (!fresh.length) {
    const [previous] = await osDb<{provider_id: string | null}[]>(query + "&select=provider_id");
    if (previous?.provider_id) return previous.provider_id;
    throw new WorkBlocked("Meta chưa xác nhận kết quả " + key + ". Cần đối soát ID trên Meta trước khi tiếp tục.");
  }
  try {
    const id = await send();
    if (!id) throw Error("Meta chưa trả ID.");
    await osDb(query, {method: "PATCH", body: JSON.stringify({provider_id: id})});
    return id;
  } catch (error) {
    if (error instanceof MetaRejected) {
      await osDb(query, {method:"DELETE"});
      throw error;
    }
    throw new WorkBlocked("Chưa thể xác định kết quả " + key + " trên Meta. Đã giữ chỗ để tránh lặp thao tác.");
  }
}

export function publicShowLink(show: OsShow, channel: string, adKey?: string) {
  if (!show.website_id) throw new WorkBlocked("Show chưa mở bán trên website.");
  const link = new URL("/show/" + show.website_id, storefrontOrigin());
  link.searchParams.set("utm_source", "facebook");
  link.searchParams.set("utm_medium", channel);
  link.searchParams.set("utm_campaign", "extra-os-" + show.id + "-" + (adKey || "social"));
  return link.href;
}

function verifiedCopy(show: OsShow) {
  return ["+1 EXTRA MUSIC SHOW · " + show.artist, displayDate(show.starts_at), show.venue,
    "Vé từ " + show.intake.startingPriceVnd.toLocaleString("vi-VN") + " đ."].join("\n");
}

export async function postFacebook(show: OsShow, job: OsJob) {
  if (!metaLive()) throw new WorkBlocked("Đăng Facebook đang tắt ở môi trường này.");
  if (!show.intake.permissions.includes("facebook")) throw new WorkBlocked("Show chưa cấp quyền đăng Facebook.");
  const config = metaConfig(false);
  const link = publicShowLink(show, "organic");
  const id = await onceAtMeta(show, job, "facebook-feed", async () => {
    const post = await graph<{id?: string}>(config, config.pageId + "/feed", {message: verifiedCopy(show), link, published: true});
    return post.id ?? "";
  });
  return {postId: id, link};
}

function adSettings() {
  const id = process.env.EXTRA_OS_META_AD_ACCOUNT_ID?.replace(/^act_/, "");
  const pixel = process.env.EXTRA_OS_META_PIXEL_ID;
  const cities = (process.env.EXTRA_OS_META_CITY_KEYS || "").split(",").map(item => item.trim()).filter(Boolean);
  const surchargePercent = Number(process.env.EXTRA_OS_META_SURCHARGE_PERCENT ?? "20");
  const minLifetime = Number(process.env.EXTRA_OS_META_MIN_LIFETIME_VND ?? "150000");
  if (!graphId(id) || !graphId(pixel) || !cities.length || cities.some(city => !graphId(city))
    || !Number.isSafeInteger(surchargePercent) || surchargePercent < 0 || surchargePercent > 100
    || !Number.isSafeInteger(minLifetime) || minLifetime < 10_000 || minLifetime > 10_000_000) {
    throw new WorkBlocked("Cần tài khoản quảng cáo, pixel, vùng địa lý và cấu hình chi phí Meta.");
  }
  if (!process.env.META_CAPI_ACCESS_TOKEN) throw new WorkBlocked("Cần token CAPI cho luồng SePay hiện có.");
  return {account: "act_" + id, pixel, cities, surchargePercent, minLifetime};
}

async function configureTracking(show: OsShow, pixel: string) {
  if (!show.website_id) throw new WorkBlocked("Show chưa mở bán.");
  const [existing] = await osDb<{meta_pixel_id: string}[]>(
    "show_landing_content?select=meta_pixel_id&show_id=eq." + show.website_id,
  );
  if (existing?.meta_pixel_id) {
    if (existing.meta_pixel_id !== pixel) throw new WorkBlocked("Pixel của show khác pixel đã cấp cho EXTRA OS.");
    return;
  }
  await osDb("rpc/extra_os_set_pixel", {method: "POST", body: JSON.stringify({p_show: show.id, p_pixel: pixel})});
}

async function updateAllocation(id: string, values: Partial<AdAllocation>) {
  await osDb("extra_os_ad_allocations?id=eq." + id, {method: "PATCH", body: JSON.stringify(values)});
}

function adObject(response: {id?: string}) {
  if (!graphId(response.id)) throw Error("Meta chưa trả ID quảng cáo.");
  return response.id;
}

async function queryAllocations(show: OsShow) {
  return osDb<AdAllocation[]>("extra_os_ad_allocations?show_id=eq." + show.id + "&order=created_at");
}

export async function launchAds(show: OsShow, job: OsJob, key: "initial" | "growth") {
  if (!metaLive()) throw new WorkBlocked("Quảng cáo Meta đang tắt ở môi trường này.");
  if (!show.intake.permissions.includes("ads") || !show.finances.layoutMatches || !show.website_id
    || ["loss","below_target"].includes(show.finances.feasibility)) throw new WorkBlocked("Show chưa đáp ứng phạm vi chạy quảng cáo.");
  const config = metaConfig(true);
  const settings = adSettings();
  const [poster] = await osDb<OsAsset[]>("extra_os_assets?show_id=eq." + show.id + "&key=eq.poster&ready=eq.true");
  if (!poster) throw new WorkBlocked("Cần poster đã xác minh cho quảng cáo.");
  const end = Math.min(Date.parse(show.starts_at) - HOUR, Date.now() + 3 * DAY);
  if (end - Date.now() < 25 * HOUR) throw new WorkBlocked("Thời gian còn lại quá ngắn để mở nhóm quảng cáo trọn đời.");
  const account = await graph<{currency?: string; account_status?: number}>(config, settings.account + "?fields=currency,account_status");
  if (account.currency !== "VND" || account.account_status !== 1) throw new WorkBlocked("Cần tài khoản Meta đang hoạt động, dùng VND.");
  await configureTracking(show, settings.pixel);

  const limit = key === "initial" ? Math.floor(show.ad_limit_vnd * 0.5) : Math.ceil(show.ad_limit_vnd * 0.5);
  const delivery = Math.floor(limit * 100 / (100 + settings.surchargePercent));
  if (delivery < settings.minLifetime) throw new WorkBlocked("Phần ngân sách thử nghiệm dưới mức tối thiểu đã cấu hình.");
  const allocation = await rpc<AdAllocation | null>("reserve_ads", {
    p_job: job.id, p_lease: job.lease_token, p_key: key, p_amount: limit, p_delivery: delivery,
  });
  if (!allocation) throw new WorkBlocked("Ngân sách khả dụng không đủ.");
  if (allocation.status === "active" || allocation.status === "paused") return {campaignId: allocation.campaign_id, status: allocation.status};
  if (allocation.status === "uncertain") throw new WorkBlocked("Cần đối soát trạng thái nhóm quảng cáo trên Meta.");
  const name = "EXTRA OS " + show.id + " " + key;
  const create = async (part: string, path: string, body: Record<string, unknown>) => onceAtMeta(show, job, "ads-" + key + "-" + part,
    async () => adObject(await graph<{id?: string}>(config, path, body)));
  const campaignId = await create("campaign", settings.account + "/campaigns", {
    name, objective: "OUTCOME_SALES", buying_type: "AUCTION", special_ad_categories: [], status: "PAUSED", is_adset_budget_sharing_enabled: false,
  });
  await updateAllocation(allocation.id, {campaign_id: campaignId});
  const imageHash = await onceAtMeta(show, job, "ads-" + key + "-image", async () => {
    const file = await scopedDriveFile(poster.drive_id);
    if (file.version !== poster.version || file.mimeType !== "image/jpeg") throw new MetaRejected("Poster đã thay đổi phiên bản.");
    const media = await readDriveMedia(file.id);
    const form = new FormData();
    form.set("filename", new Blob([await media.arrayBuffer()], {type:"image/jpeg"}), "extra-os.jpg");
    const result = await graph<{images?: Record<string, {hash?: string}>}>(config, settings.account + "/adimages", form);
    return Object.values(result.images ?? {})[0]?.hash ?? "";
  });
  const adsetId = await create("set", settings.account + "/adsets", {
    name, campaign_id: campaignId, lifetime_budget: allocation.delivery_limit_vnd,
    end_time: new Date(end).toISOString(), status: "PAUSED",
    billing_event:"IMPRESSIONS", optimization_goal:"OFFSITE_CONVERSIONS", bid_strategy:"LOWEST_COST_WITHOUT_CAP",
    promoted_object: {pixel_id: settings.pixel, custom_event_type: "PURCHASE"},
    targeting: {geo_locations: {cities: settings.cities.map(city => ({key: city}))}, targeting_automation: {advantage_audience: 0}},
    destination_type: "WEBSITE",
  });
  await updateAllocation(allocation.id, {adset_id: adsetId});
  const link = publicShowLink(show, "paid", key);
  const creativeId = await create("creative", settings.account + "/adcreatives", {
    name, object_story_spec: {page_id: config.pageId, link_data: {
      image_hash: imageHash, link, message: verifiedCopy(show),
      call_to_action: {type: "SHOP_NOW", value: {link}},
    }},
  });
  await create("ad", settings.account + "/ads", {
    name, adset_id: adsetId, creative: {creative_id: creativeId}, status: "ACTIVE",
  });
  await onceAtMeta(show, job, "ads-" + key + "-activate-set", async () => {
    const result = await graph<{success?: boolean}>(config, adsetId, {status:"ACTIVE"});
    return result.success === true ? adsetId : "";
  });
  // The campaign is still paused until both the budget and ad set are recorded.
  await updateAllocation(allocation.id, {status: "uncertain", started_at: new Date().toISOString()});
  try {
    await onceAtMeta(show, job, "ads-" + key + "-activate-campaign", async () => {
      const result = await graph<{success?: boolean}>(config, campaignId, {status:"ACTIVE"});
      return result.success === true ? campaignId : "";
    });
  } catch (error) {
    if (error instanceof MetaRejected) await updateAllocation(allocation.id, {status:"reserved", started_at: null});
    throw error;
  }
  await updateAllocation(allocation.id, {status: "active"});
  return {campaignId, adsetId, status: "active", limitVnd: allocation.limit_vnd};
}

export async function monitorAds(show: OsShow, job: OsJob) {
  const allocations = await queryAllocations(show);
  if (!allocations.length) return {active: 0, metrics: []};
  const config = metaConfig(true);
  const controls = await osDb<{scope:string}[]>("extra_os_controls?paused=eq.true&scope=in.(system,Ads)&select=scope");
  const paid = await readPaid(show);
  const disabled = controls.length > 0 || !metaLive() || paid.seatsTaken >= show.capacity || Date.parse(show.starts_at) <= Date.now();
  const metrics = [];
  let active = 0;
  for (const allocation of allocations) {
    if (!allocation.campaign_id) continue;
    const campaignId = allocation.campaign_id;
    if (allocation.status === "uncertain" && !disabled && allocation.started_at
      && Date.now() - Date.parse(allocation.started_at) < 4 * 60_000) continue;
    if (allocation.status === "uncertain" || (allocation.status === "active" && disabled)) {
      const result = await graph<{success?: boolean}>(config, campaignId, {status:"PAUSED"});
      if (result.success !== true) throw Error("Meta chưa xác nhận dừng quảng cáo.");
      await updateAllocation(allocation.id, {status:"paused"});
      continue;
    }
    if (allocation.status === "reserved" || allocation.billed_vnd !== null) continue;
    const record = await graph<{data?: {spend: string}[]}>(config, campaignId + "/insights?fields=spend&date_preset=maximum");
    const amount = record.data?.[0]?.spend;
    if (amount !== undefined && (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) > Number.MAX_SAFE_INTEGER)) {
      throw Error("Meta trả chi phí không hợp lệ.");
    }
    const spent = Math.max(allocation.spent_vnd, Math.ceil(Number(amount ?? 0)));
    await updateAllocation(allocation.id, {spent_vnd: spent});
    const attributed = await readPaid(show, allocation.allocation_key);
    const tickets = attributed.adAttributedTickets;
    const revenue = attributed.adAttributedRevenueVnd;
    const cpaVnd = tickets > 0 ? Math.ceil(spent / tickets) : null;
    const observedHours = allocation.started_at ? (Date.now() - Date.parse(allocation.started_at)) / HOUR : 0;
    const requiredNet = Math.max(1, Math.ceil(show.finances.targetRevenueVnd / show.capacity));
    const maxCpa = Math.min(Math.floor(show.intake.startingPriceVnd * 0.25), Math.floor(show.ad_limit_vnd / Math.max(1, Math.ceil(show.capacity * 0.35))));
    const poor = observedHours >= 24 && (tickets === 0 && spent >= Math.min(allocation.delivery_limit_vnd * 0.3, requiredNet)
      || tickets >= 3 && (cpaVnd! > maxCpa || revenue <= spent));
    if (allocation.status === "active" && (poor || spent >= allocation.delivery_limit_vnd)) {
      const result = await graph<{success?: boolean}>(config, campaignId, {status:"PAUSED"});
      if (result.success !== true) throw Error("Meta chưa xác nhận dừng quảng cáo.");
      await updateAllocation(allocation.id, {status:"paused"});
    } else if (allocation.status === "active") {
      active++;
    }
    metrics.push({key: allocation.allocation_key, spentVnd: spent, tickets, revenueVnd: revenue, cpaVnd, pausedForPerformance: poor});
    const profitable = allocation.allocation_key === "initial" && observedHours >= 24 && maxCpa > 0 && tickets >= 3
      && cpaVnd! <= maxCpa && revenue >= spent * 3;
    if (!disabled && profitable && paid.revenueVnd < show.finances.targetRevenueVnd
      && !allocations.some(item => item.allocation_key === "growth") && Date.parse(show.starts_at) - Date.now() >= 26 * HOUR) {
      try { await launchAds(show, job, "growth"); }
      catch (error) {
        if (!(error instanceof WorkBlocked)) throw error;
        metrics.push({key:"growth", message:error.message});
      }
    }
  }
  return {active, metrics, observedAt: new Date().toISOString()};
}

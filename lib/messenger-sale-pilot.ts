import { timingSafeEqual } from "node:crypto";

const idPattern = /^\d{5,40}$/;
const psidPattern = /^\d{5,80}$/;
const metadataPattern = /^extra-sale-2:(ai|staff):([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
// Live Messenger and ticketing destinations documented in the project handoff.
const livePage = "1223940670813189";
const liveApp = "2447629075989535";
const liveDatabase = "fokntdvgzfldxbaglrdc.supabase.co";
const liveWebHosts = new Set(["iextra.net", "www.iextra.net", "admin.iextra.net", "sale.iextra.net", "checkin.iextra.net"]);

export function requiresMessengerSaleIsolation(env: NodeJS.ProcessEnv = process.env) {
 return env.META_MESSENGER_AI_MODE === "test" || env.VERCEL_ENV === "preview";
}

function testOrigin(value: string | undefined, isPreview: boolean) {
 if (!value) return null;
 try {
  const url = new URL(value);
  const host = url.hostname.replace(/\.$/, "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      liveWebHosts.has(host) || host === liveDatabase ||
      (isPreview && loopback) || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) return null;
  return url.origin;
 } catch { return null; }
}

export function getMessengerSalePilot(pageId: string, env: NodeJS.ProcessEnv = process.env) {
 const appId = env.META_MESSENGER_AI_APP_ID || "";
 const workerSecret = env.META_MESSENGER_AI_WORKER_SECRET || "";
 const testers = new Set((env.META_MESSENGER_AI_TEST_PSIDS || "").split(",").map(id => id.trim()).filter(id => psidPattern.test(id)));
 const isPreview = env.VERCEL_ENV === "preview";
 const checkoutOrigin = testOrigin(env.META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN, isPreview);
 const databaseOrigin = testOrigin(env.META_MESSENGER_AI_TEST_SUPABASE_URL, isPreview);
 if (env.META_MESSENGER_AI_MODE !== "test" || env.VERCEL_ENV === "production" || !idPattern.test(pageId) ||
     pageId === livePage || pageId !== env.META_MESSENGER_AI_TEST_PAGE_ID || !idPattern.test(appId) || appId === liveApp ||
     workerSecret.length < 24 || !testers.size || !checkoutOrigin || !databaseOrigin ||
     databaseOrigin !== testOrigin(env.SUPABASE_URL, isPreview) || env.SEPAY_CHECKOUT_ENABLED === "true") return null;
 const humanAppIds = new Set((env.META_MESSENGER_AI_HUMAN_ECHO_APP_IDS || "").split(",")
  .map(id => id.trim()).filter(id => idPattern.test(id) && id !== appId));
 return { pageId, appId, checkoutOrigin, workerSecret, testers, humanAppIds, nativeHumanEcho: env.META_MESSENGER_AI_NATIVE_HUMAN_ECHO === "1" };
}

export type MessengerSalePilot = NonNullable<ReturnType<typeof getMessengerSalePilot>>;

export function checkMessengerWorkerAuth(header: string | null, secret: string) {
 const supplied = Buffer.from(header || "");
 const expected = Buffer.from(`Bearer ${secret}`);
 return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function classifyMessengerEcho(app: unknown, metadata: unknown, pilot: MessengerSalePilot):
 { kind: "ai" | "staff"; token: string } | { kind: "human" } | { kind: "unknown" } {
 const appId = typeof app === "string" ? app : typeof app === "number" && Number.isSafeInteger(app) ? String(app) : "";
 const marker = typeof metadata === "string" ? metadata.match(metadataPattern) : null;
 if (marker && appId === pilot.appId) {
  return { kind: marker[1]!.toLowerCase() as "ai" | "staff", token: marker[2]!.toLowerCase() };
 }
 if (!marker && ((!appId && app == null && pilot.nativeHumanEcho) || pilot.humanAppIds.has(appId))) return { kind: "human" };
 return { kind: "unknown" };
}

export type MessengerAdReferral = { ref?: string; adId?: string };

export function readMessengerAdReferral(value: unknown): MessengerAdReferral | null {
 if (!value || typeof value !== "object") return null;
 const { ref, ad_id } = value as { ref?: unknown; ad_id?: unknown };
 const cleanRef = typeof ref === "string" && /^[\p{L}\p{N}._:/=-]{1,180}$/u.test(ref) ? ref : undefined;
 const candidateId = typeof ad_id === "number" && Number.isSafeInteger(ad_id) ? String(ad_id) : ad_id;
 const adId = typeof candidateId === "string" && idPattern.test(candidateId) ? candidateId : undefined;
 return cleanRef || adId ? { ref: cleanRef, adId } : null;
}

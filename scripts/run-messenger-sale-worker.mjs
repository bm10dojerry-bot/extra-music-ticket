import { setTimeout as delay } from "node:timers/promises";

const endpoint = new URL(process.env.META_MESSENGER_AI_WORKER_URL || "http://localhost:3000/api/cron/messenger-sale");
const secret = process.env.META_MESSENGER_AI_WORKER_SECRET || "";
const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
if (endpoint.pathname !== "/api/cron/messenger-sale" || endpoint.username || endpoint.password || endpoint.search ||
    (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) || secret.length < 24) {
  throw new Error("Configure the Messenger test worker URL and worker secret");
}

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort());

while (!stop.signal.aborted) {
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { authorization: `Bearer ${secret}` }, redirect: "error",
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(60_000)]),
    });
    if (response.status === 401 || response.status === 403) {
      console.error("Messenger test worker rejected the configured request");
      process.exitCode = 1;
      break;
    }
    if (!response.ok) console.warn("Messenger test worker returned HTTP", response.status);
    await response.body?.cancel();
  } catch {
    if (!stop.signal.aborted) console.warn("Messenger test worker is unavailable");
  }
  await delay(1000, undefined, { signal: stop.signal }).catch(() => {});
}

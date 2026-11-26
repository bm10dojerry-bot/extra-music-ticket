"use strict";

const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { createHmac, randomUUID } = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const sharp = require("sharp");

const repo = resolve(__dirname, "../..");
const compiled = process.env.EXTRA_SALE_PRO_SOURCE;
const rollback = process.env.EXTRA_SALE_ROLLBACK_SOURCE;
const container = process.env.EXTRA_SALE_TEST_CONTAINER;
const page = "99001";
const reportPage = "99002";
const legacyPage = "99003";
const staff = randomUUID();
const other = randomUUID();
const fixedEnd = "2031-02-01T17:00:00.000Z";
const adminOrigin = "https://admin.example.invalid";

function evaluate(file, mocks = new Map(), cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const contents = readFileSync(file, "utf8");
  const source = ts.transpileModule(contents, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = id => {
    if (id === "server-only") return {};
    if (mocks.has(id)) return mocks.get(id);
    if (id.startsWith(".")) {
      const target = resolve(dirname(file), id + ".ts");
      if (mocks.has(target)) return mocks.get(target);
      if (existsSync(target)) return evaluate(target, mocks, cache);
      throw Error("Provide a synthetic dependency for " + id);
    }
    return require(id);
  };
  new Function("require", "module", "exports", source)(localRequire, module, module.exports);
  return module.exports;
}

const typeSource = name => resolve(repo, "lib", "ai-sale-pro", name + ".ts");
const policy = evaluate(typeSource("policy"));
const seats = evaluate(typeSource("seats"));
const { seatsFor } = evaluate(resolve(repo, "lib", "venues.ts"));

function psql(command, role) {
  return new Promise((done, fail) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1",
      "-U", "extra_sale_test", "-d", "extra_sale_pro_test"], { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", data => { stdout += data; });
    child.stderr.setEncoding("utf8").on("data", data => { stderr += data; });
    child.on("error", fail);
    child.on("close", code => code ? fail(Error(stderr.trim() || "Isolated PostgreSQL command failed")) : done(stdout.trim()));
    child.stdin.end((role ? "set role " + role + ";\n" : "") + command + "\n");
  });
}

const literal = value => value === null ? "null" :
  typeof value === "string" ? "'" + value.replaceAll("'", "''") + "'" :
    typeof value === "number" || typeof value === "boolean" ? String(value) : literal(JSON.stringify(value));
const result = output => output ? JSON.parse(output) : null;
async function rpc(name, args, role = "service_role") {
  assert.match(name, /^extra_(?:sale_pro_|support_ingest_messenger|messenger_ai_followup_)[a-z_]*$/);
  for (const key of Object.keys(args)) assert.match(key, /^p_[a-z_]+$/);
  const parameters = Object.entries(args).map(([key, value]) => key + "=>" + literal(value)).join(",");
  const expression = "public." + name + "(" + parameters + ")";
  const query = name.endsWith("_due")
    ? "select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from " + expression + " r;"
    : "select to_jsonb(" + expression + ");";
  return result(await psql(query, role));
}

const snapshot = (id, venue = "ccc", blocked = []) => ({
  show: { id, artist: "Nghệ sĩ " + id + " <mẫu>", date: "2031-02-11", venueId: venue, venueName: "Sân khấu mẫu",
    prices: { A: 600_000, B: 400_000, C: 200_000, D: null } },
  seats: seatsFor(venue),
  taken: new Set(blocked),
});

test("staff command accepts case, Unicode composition and excess whitespace; quotations are rejected", () => {
  for (const command of ["Đã xử lý xong", "  ĐÃ    XỬ\nLÝ XONG  ", "Đã xử lý xong".normalize("NFD")]) {
    assert.equal(policy.isResolutionCommand(command), true);
  }
  for (const command of ['"Đã xử lý xong"', "> Đã xử lý xong", "Khách nói Đã xử lý xong", "Da xu ly xong", null]) {
    assert.equal(policy.isResolutionCommand(command), false);
  }
});

test("complaint, out-of-scope, staff request and repeated content stop the worker", () => {
  const customer = (id, body) => ({ id, sender: "customer", body });
  const asksForStaff = body => body.includes("nhân viên");
  assert.equal(policy.inboundHandoff([customer(1, "Tôi muốn khiếu nại về vé")], asksForStaff), "complaint");
  assert.equal(policy.inboundHandoff([customer(1, "Viết code cho tôi")], asksForStaff), "out_of_scope");
  assert.equal(policy.inboundHandoff([customer(1, "Gặp nhân viên")], asksForStaff), "human_requested");
  const duplicate = [customer(1, "Cho hỏi giá vé"), customer(3, "  CHO HỎI GIÁ VÉ ")];
  assert.equal(policy.inboundHandoff(duplicate, asksForStaff), "repeated");
  assert.equal(policy.inboundHandoff([duplicate[0], { id: 2, sender: "staff", body: "Đã kiểm tra", staff_name: "Sale" },
    duplicate[1]], asksForStaff), null);
  assert.equal(policy.repeatsLastAnswer("Vé ở đâu", [{ sender: "staff", staff_name: "EXTRA AI", body: "Vé ở đâu" }]), true);
});

test("canonical seat codes recognize row letters, mixed digits, NFKC and invalid labels", () => {
  assert.deepEqual(seats.canonicalSeatCodes("c1, C 02 và Ａ１, Z01, A00", seatsFor("ccc")),
    { valid: ["C01", "C02", "A01"], unknown: ["Z01", "A00"] });
  assert.equal(seats.isExactSeatInquiry("Ghế Z01 có không?"), true);
  assert.equal(seats.isExactSeatInquiry("Chốt ghế C01"), false);
  assert.throws(() => seats.verifySeats(snapshot("show-a", "ccc", ["A01"]), ["A01"]), /no longer/);
  assert.throws(() => seats.verifySeats(snapshot("show-a"), ["Z01"]), /no longer/);
  assert.throws(() => seats.verifySeats(snapshot("show-a"), ["A01", "A01"]), /no longer/);
  assert.doesNotThrow(() => seats.verifySeats(snapshot("show-a"), ["A01", "B02"]));
});

test("raster maps contain exact labels at all three venue layouts and vary by show", async () => {
  const at = new Date(fixedEnd);
  for (const venue of ["ccc", "laocai", "moana"]) {
    const data = snapshot("show-a", venue, ["A01"]);
    const svg = seats.showSeatSvg(data, at);
    for (const seat of data.seats) assert.ok(svg.includes(">" + seat.id + "</text>"), venue + " " + seat.id);
    assert.match(svg, /&lt;mẫu&gt;/);
    assert.match(svg, /#777982/);
    const png = await seats.showSeatAttachment(data, at);
    const { format, width, height } = await sharp(png).metadata();
    assert.equal(format, "png");
    assert.ok(width >= 1600 && height >= 1300);
  }
  const first = await seats.showSeatAttachment(snapshot("show-a"), at);
  const second = await seats.showSeatAttachment(snapshot("show-b", "ccc", ["A03"]), at);
  assert.notDeepEqual(first, second);
  const form = seats.imageAttachment("999910", first);
  assert.equal(form.get("filedata").type, "image/png");
  assert.deepEqual(JSON.parse(form.get("message")), { attachment: { type: "image", payload: { is_reusable: false } } });
  assert.equal(form.get("text"), null);
  if (process.env.EXTRA_SALE_TEST_PNG) {
    const { writeFileSync } = require("node:fs");
    writeFileSync(process.env.EXTRA_SALE_TEST_PNG, first);
  }
});

test("the assembled Messenger sender uploads bytes, checks the lock before fetch and rejects missing receipts", {
  skip: !compiled,
}, async () => {
  const cfg = { pageId: page, pageToken: "synthetic-page-token-for-test", apiVersion: "v24.0" };
  const fb = evaluate(resolve(compiled, "lib/facebook-messenger.ts"), new Map([
    ["./facebook-page-connection", { resolveFacebookPageCredential: async () => cfg }],
  ]));
  const orig = globalThis.fetch;
  const previous = Object.fromEntries(["PAGE_ID", "PAGE_ACCESS_TOKEN", "APP_SECRET", "VERIFY_TOKEN"].map(k =>
    ["META_MESSENGER_" + k, process.env["META_MESSENGER_" + k]]));
  Object.assign(process.env, {
    META_MESSENGER_PAGE_ID: page,
    META_MESSENGER_PAGE_ACCESS_TOKEN: cfg.pageToken,
    META_MESSENGER_APP_SECRET: "synthetic-app-secret-00000",
    META_MESSENGER_VERIFY_TOKEN: "synthetic-verify-token-000",
  });
  let network = 0;
  let ack = { recipient_id: "999911", message_id: "synthetic-mid" };
  globalThis.fetch = async (url, { body }) => {
    assert.equal(new URL(url).hostname, "graph.facebook.com");
    assert.equal(body.get("filedata").type, "image/png");
    assert.equal(JSON.parse(body.get("message")).attachment.payload.url, undefined);
    network++;
    return Response.json(ack);
  };
  try {
    const png = await seats.showSeatAttachment(snapshot("show-upload"), new Date(fixedEnd));
    await assert.rejects(fb.sendMessengerSeatMap("999911", png, async () => { throw Error("locked"); }), /locked/);
    assert.equal(network, 0);
    assert.equal((await fb.sendMessengerSeatMap("999911", png, async () => {})).messageId, "synthetic-mid");
    ack = {};
    await assert.rejects(fb.sendMessengerSeatMap("999911", png, async () => {}), { ambiguous: true });
    assert.equal(network, 2);
  } finally {
    globalThis.fetch = orig;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("the staff route is reachable from Admin and Sale and stays closed to Check-in", { skip: !compiled }, () => {
  const { middleware } = evaluate(resolve(compiled, "middleware.ts"), new Map([
    ["next/server", { NextResponse: { next: () => ({ status: 200 }), json: (_value, options) => options } }],
  ]));
  const status = host => middleware({
    headers: new Headers({ host }),
    nextUrl: new URL("https://" + host + "/api/staff/ai-sale-pro"),
  }).status;
  assert.equal(status("admin.iextra.net"), 200);
  assert.equal(status("sale.iextra.net"), 200);
  assert.equal(status("checkin.iextra.net"), 403);
});

test("isolated PostgreSQL, Messenger and Zalo", { skip: !container }, async t => {
  assert.match(container, /^extra-sale-pro-[a-z0-9-]+$/);
  const mode = execFileSync("docker", ["inspect", "--format",
    "{{.HostConfig.NetworkMode}} {{index .Config.Labels \"purpose\"}}", container], { encoding: "utf8" }).trim();
  assert.equal(mode, "none ai-sale-pro-synthetic-test");
  assert.equal(await psql("select current_database();"), "extra_sale_pro_test");

  const proRpc = (name, args) => rpc("extra_sale_pro_" + name, args);
  const makeChat = async (group, { phone = "", showId = "synthetic-pro-show", at, name = "Khách mô phỏng" } = {}) => {
    const id = randomUUID();
    const digits = BigInt("0x" + id.slice(0, 8)).toString().padStart(10, "0");
    const psid = "99" + digits;
    const stamp = at ? literal(at) : "clock_timestamp()";
    await psql("insert into extra_support_chats (id,access_hash,show_id,customer_name,customer_phone,channel,messenger_page_id,messenger_psid,status,created_at,last_customer_at) values (" +
      [id, id.replaceAll("-", "").repeat(2), showId, name, phone, "messenger", group, psid, "open"].map(literal).join(",") +
      "," + stamp + "," + stamp + ");");
    return { id, psid, group };
  };
  const modeFor = async (group, enabled) => psql("insert into extra_sale_pro_config values (" + literal(group) + "," + enabled +
    ") on conflict (page_id) do update set enabled = excluded.enabled;");
  const lock = async (chat, reason = "complaint") => proRpc("lock", { p_chat_id: chat.id, p_reason: reason, p_source: "fixture" });
  const begin = async (chat, key, purpose = "reply", mode = "pro") => proRpc("begin", {
    p_chat_id: chat.id, p_page_id: chat.group, p_recipient: chat.psid, p_key: key, p_purpose: purpose, p_mode: mode,
  });
  const finish = (token, state, receipt = null) => proRpc("finish", { p_token: token, p_status: state, p_receipt: receipt });
  const command = (chat, handoff, options = {}) => proRpc("resolve", {
    p_chat_id: chat.id, p_handoff_id: handoff, p_actor_id: options.actor ?? staff,
    p_event_id: options.event ?? randomUUID(), p_issued_at: options.issued ?? new Date().toISOString(),
    p_command: options.text ?? "Đã xử lý xong",
  });

  await psql("insert into managed_shows(id,artist,title,show_date,show_time,venue_id,status,prices) values " +
    "('synthetic-pro-show','Nghệ sĩ mẫu','Show mô phỏng',current_date+31,'20:00','ccc','announced','{\"A\":600000,\"B\":400000,\"C\":200000}');" +
    "insert into staff_accounts (id,username,display_name,role,password_hash,active) values " +
    "(" + literal(staff) + ",'synthetic-trang','Trang mô phỏng','sale','unused',true)," +
    "(" + literal(other) + ",'synthetic-unauthorized','Sale mô phỏng','sale','unused',true);" +
    "insert into extra_sale_pro_operators values (" + literal(staff) + ",true);");

  let paidSeat = 1;
  async function insertPaid(chat, { at = "2031-02-01T16:14:00.000Z", receipts = true, amount = 630000 } = {}) {
    const suffix = randomUUID().replaceAll("-", "").toUpperCase().slice(0, 16);
    const code = "EX" + suffix;
    const tx = Number(BigInt("0x" + suffix.slice(0, 10)));
    const seat = "A" + String(paidSeat++).padStart(2, "0");
    const q = literal(chat.id);
    const stamp = literal(at);
    await psql("begin;" +
      "insert into extra_payment_orders (code,access_token,show_id,venue_id,seats,amount_vnd,buyer_name,buyer_phone,buyer_email,status,created_at,expires_at,paid_at,sepay_transaction_id) values " +
      "(" + literal(code) + "," + literal(suffix.repeat(4)) + ",'synthetic-pro-show','ccc',array[" + literal(seat) +
      "],600000,'Buyer mock','0000000000','mock@example.invalid','paid'," + stamp + "," + stamp + "," + stamp + "," + tx + ");" +
      "with source as (insert into extra_support_messages(chat_id,sender,body,created_at) values (" + q +
      ",'customer','Chốt ghế mô phỏng'," + stamp + ") returning id), job as (" +
      "insert into extra_messenger_ai_jobs(chat_id,kind,dedupe_key,state,source_message_id) select " +
      q + ",'inbound'," + literal("paid-fixture:" + code) + ",'done',id from source returning id,source_message_id), quote as (" +
      "insert into extra_messenger_ai_quotes(chat_id,job_id,quote,fingerprint,source_message_id,expires_at,created_at) " +
      "select " + q + ",id,'{\"showId\":\"synthetic-pro-show\"}'," + literal(code) + ",source_message_id," +
      stamp + "," + stamp + " from job returning id) " +
      "insert into extra_messenger_ai_orders(order_code,chat_id,quote_id) select " + literal(code) + "," + q + ",id from quote;" +
      (receipts ? "insert into extra_payment_events (transaction_id,order_code,amount_vnd,payload,outcome) values (" +
        tx + "," + literal(code) + "," + amount + ",'{}','paid');" : "") + "commit;");
  }

  await t.test("release flag defaults to 2.3 and privileged RPCs deny public roles", async () => {
    assert.deepEqual(await proRpc("mode", { p_page_id: page }), { enabled: false });
    const chat = await makeChat(page);
    assert.equal((await begin(chat, "flag-default")).outcome, "wrong_release");
    const legacy = await begin(chat, "legacy-default", "reply", "legacy");
    assert.equal(legacy.outcome, "send");
    await finish(legacy.token, "sent", "legacy-receipt");
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(rpc("extra_sale_pro_mode", { p_page_id: page }, role), /permission denied/);
    }
    await modeFor(page, true);
    assert.equal((await begin(chat, "legacy-fenced", "reply", "legacy")).outcome, "wrong_release");
  });

  await t.test("lock drains in-flight delivery and blocks every automated purpose and both releases", async () => {
    const chat = await makeChat(page);
    const claims = await Promise.all([begin(chat, "concurrent-a"), begin(chat, "concurrent-b", "followup")]);
    assert.deepEqual(claims.map(x => x.outcome).sort(), ["in_flight", "send"]);
    const sent = claims.find(x => x.token);
    const { handoff_id } = await lock(chat);
    assert.equal((await proRpc("recheck", { p_token: sent.token })).outcome, "locked");
    assert.equal((await command(chat, handoff_id)).outcome, "in_flight");
    await finish(sent.token, "skipped");
    for (const purpose of ["reply", "checkout", "ticket", "followup", "before_show_paid", "manual_timeout", "seat_map", "comment_reply"]) {
      assert.equal((await begin(chat, "held-" + purpose, purpose)).outcome, "locked");
    }
    await modeFor(page, false);
    assert.equal((await begin(chat, "rollback-still-locked", "followup", "legacy")).outcome, "locked");
    assert.equal((await lock(chat)).handoff_id, handoff_id);
    await modeFor(page, true);
  });

  await t.test("signed webhook replay is deduplicated by the real Messenger ingest RPC", { skip: !compiled }, async () => {
    const chat = await makeChat(page);
    const testSecret = "synthetic-webhook-secret-" + randomUUID();
    let afterCount = 0;
    let hookMode = "legacy";
    const stub = new Map([
      ["next/server", { NextResponse: Response, after: () => { afterCount++; } }],
      ["../../../../../lib/ai-sales-24", { asksForStaff: text => text.includes("nhân viên") }],
      ["../../../../../lib/ai-sale-pro/database", {
        proRuntimeMode: () => hookMode,
        proStatus: async () => ({ enabled: true }),
        proEscalate: async (chatId, reason) => lock({ id: chatId }, reason),
      }],
      ["../../../../../lib/staff-auth", { staffDb: async (path, options) => {
        if (path === "rpc/extra_support_ingest_messenger") return rpc("extra_support_ingest_messenger", JSON.parse(options.body));
        const filter = path.match(/^extra_support_messages\?chat_id=eq\.([a-f0-9-]{36})&/);
        if (filter) return result(await psql("select coalesce(jsonb_agg(to_jsonb(m) order by m.id desc),'[]') " +
          "from extra_support_messages m where chat_id=" + literal(filter[1]) + ";"));
        return { outcome: "queued" };
      } }],
      ["../../../../../lib/facebook-messenger", { getMessengerConfig: () => ({ pageId: page, appSecret: testSecret }) }],
      ["../../../../../lib/messenger-show-signals", { recordSignedBatch: async () => {} }],
      ["../../../../../lib/messenger-recognize-inquiry", { simplePriceQuestion: () => true }],
      ["../../../../../lib/ai-sales", { runAiSalesQueue: async () => {} }],
      ["../../../../../lib/ai-sales-notifications", { sendAiSalesOwnerNotifications: async () => {} }],
      ["../../../../../lib/ai-sales-policy", { incomingMessengerText: ({ text }) => text }],
      ["../../../../../lib/marketing-referral", { extractMarketingMessengerReferral: () => null, recordMarketingMessengerReferral: async () => {} }],
      ["../../../../../lib/ai-comment-policy", { extractCommentEvents: () => [] }],
      ["../../../../../lib/ai-comment-leads", { ingestCommentEvent: async () => ({}), runCommentQueue: async () => ({}) }],
      ["../../../../../lib/ai-comment-context", { recordCommentMessengerInbound: async () => {} }],
      ["../../../../../lib/ai-sales-manual-timeout", { runAiSalesManualTimeout: async () => ({}) }],
    ]);
    const route = evaluate(resolve(compiled, "app/api/meta/messenger/webhook/route.ts"), stub);
    const mid = "synthetic-" + randomUUID();
    const body = JSON.stringify({ object: "page", entry: [{ id: page, messaging: [
      { sender: { id: chat.psid }, recipient: { id: page }, message: { mid, text: "Cho hỏi giá vé" } },
    ] }] });
    const signature = "sha256=" + createHmac("sha256", testSecret).update(body).digest("hex");
    const request = sig => new Request("http://127.0.0.1/api/meta/messenger/webhook", {
      method: "POST", body, headers: { "x-hub-signature-256": sig },
    });
    assert.equal((await route.POST(request("sha256=" + "0".repeat(64)))).status, 403);
    const responses = await Promise.all([route.POST(request(signature)), route.POST(request(signature))]);
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(await psql("select count(*) from extra_support_messages where external_message_id = " + literal(mid) + ";"), "1");
    assert.equal(afterCount, 1);
    hookMode = "pro";
    const complaint = body.replace(mid, "synthetic-complaint-" + randomUUID()).replace("Cho hỏi giá vé", "Tôi muốn khiếu nại");
    const signedComplaint = "sha256=" + createHmac("sha256", testSecret).update(complaint).digest("hex");
    assert.equal((await route.POST(new Request("http://127.0.0.1/api/meta/messenger/webhook", {
      method: "POST", body: complaint, headers: { "x-hub-signature-256": signedComplaint },
    }))).status, 200);
    assert.equal((await proRpc("status", { p_chat_id: chat.id, p_page_id: page })).reason, "complaint");
    assert.equal(afterCount, 1);
  });

  await t.test("staff API uses authenticated individual staff and rejects cross-origin commands", { skip: !compiled }, async () => {
    let verified = null;
    const chat = await makeChat(page, { phone: "0900000005" });
    const { handoff_id } = await lock(chat);
    const known = new Map([
      ["next/server", { NextResponse: Response }],
      ["next/headers", { cookies: async () => ({ get: () => ({ value: "synthetic-staff-cookie" }) }) }],
      ["../../../../lib/staff-auth", {
        STAFF_COOKIE: "extra_staff_session",
        getActor: async () => ({ id: "owner", role: "admin", active: true }),
        getStaff: async () => verified,
        staffDb: async path => path.startsWith("extra_support_chats") ? [{ id: chat.id, assigned_staff_id: null }] : [],
      }],
      ["../../../../lib/facebook-messenger", { getMessengerConfig: () => ({ pageId: page }) }],
      ["../../../../lib/ai-sale-pro/database", { proRpc, proStatus: async () => ({ enabled: true }) }],
      ["../staff-auth", { staffDb: async (path, { body }) => rpc(path.slice(4), JSON.parse(body)) }],
    ]);
    const route = evaluate(resolve(compiled, "app/api/staff/ai-sale-pro/route.ts"), known);
    const local = "https://sale.example.invalid";
    const api = local + "/api/staff/ai-sale-pro";
    const submit = (origin, text) => {
      const req = new Request(api, { method: "POST", headers: { origin },
        body: JSON.stringify({ chatId: chat.id, handoffId: handoff_id, eventId: randomUUID(),
          issuedAt: new Date().toISOString(), command: text }) });
      Object.defineProperty(req, "nextUrl", { value: new URL(api) });
      return route.POST(req);
    };
    assert.equal((await submit(local, "Đã xử lý xong")).status, 403);
    verified = { id: staff, role: "sale", active: true };
    assert.equal((await submit("https://external.example.invalid", "Đã xử lý xong")).status, 403);
    assert.equal((await submit(local, '"Đã xử lý xong"')).status, 400);
    const resolved = await submit(local, "  ĐÃ   XỬ LÝ XONG ");
    assert.equal(resolved.status, 200);
    assert.equal((await resolved.json()).outcome, "unpaid");
  });

  await t.test("legacy checkout reservation enforces seat conflict under concurrent holds", async () => {
    const hold = () => psql("select order_code from public.extra_reserve_order(" +
      ["EX" + randomUUID().replaceAll("-", "").toUpperCase().slice(0, 16), randomUUID().repeat(3),
        "synthetic-pro-show","ccc"].map(literal).join(",") +
      ",array['C03'],200000,'Synthetic Buyer','0000000000','x@example.invalid');");
    const results = await Promise.allSettled([hold(), hold()]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
    assert.match(results.find(item => item.status === "rejected").reason.message, /SEAT|seat/i);
    assert.equal(await psql("select count(*) from extra_payment_orders where 'C03'=any(seats) and status='pending';"), "1");
  });

  await t.test("authorization, stale events, replay and paid/unpaid/unknown are enforced by PostgreSQL", async () => {
    const unpaid = await makeChat(page, { phone: "0900000001" });
    const paid = await makeChat(page);
    const unknown = await makeChat(page, { showId: null });
    await insertPaid(paid, { at: new Date().toISOString() });
    const unpaidHandoff = (await lock(unpaid)).handoff_id;
    const paidHandoff = (await lock(paid)).handoff_id;
    const unknownHandoff = (await lock(unknown)).handoff_id;
    assert.equal((await command(unpaid, unpaidHandoff, { actor: other })).outcome, "forbidden");
    assert.equal((await command(unpaid, unpaidHandoff, { text: '"Đã xử lý xong"' })).outcome, "invalid");
    assert.equal((await command(unpaid, randomUUID())).outcome, "stale");
    assert.equal((await command(unpaid, unpaidHandoff, { issued: "2020-01-01T00:00:00Z" })).outcome, "invalid");
    const event = randomUUID();
    assert.equal((await command(unpaid, unpaidHandoff, { event })).outcome, "unpaid");
    assert.equal((await command(unpaid, unpaidHandoff, { event })).outcome, "replay");
    assert.equal((await command(paid, paidHandoff)).outcome, "paid");
    assert.equal((await command(unknown, unknownHandoff)).outcome, "payment_unknown");
    assert.equal((await begin(paid, "blocked-solicitation", "followup")).outcome, "paid");
    const ticket = await begin(paid, "paid-ticket-send", "ticket");
    assert.equal(ticket.outcome, "send");
    await finish(ticket.token, "sent", "paid-ticket-receipt");
    assert.equal((await begin(unknown, "unknown-payment-safe")).outcome, "locked");
    assert.equal(await psql("select count(*) from extra_sale_pro_resolution_audit where staff_id=" +
      literal(staff) + " and handoff_id in (" + [unpaidHandoff, paidHandoff, unknownHandoff].map(literal).join(",") + ");"), "3");
  });

  let unavailable = false;
  let customerSends = 0;
  const serviceMocks = new Map([
    ["../staff-auth", { staffDb: async (path, options) => {
      if (unavailable) throw Error("Synthetic Supabase outage");
      return rpc(path.slice(4), JSON.parse(options.body));
    } }],
  ]);
  const { dispatchForChat, DispatchBlocked } = evaluate(typeSource("dispatch"), serviceMocks);
  const { runProTasks, drainInternal, InternalDeliveryRejected } = evaluate(typeSource("reporting"), serviceMocks);
  const modeEnv = process.env.AI_SALE_2_4_PRO_ENABLED;
  process.env.AI_SALE_2_4_PRO_ENABLED = "true";
  t.after(() => {
    if (modeEnv === undefined) delete process.env.AI_SALE_2_4_PRO_ENABLED;
    else process.env.AI_SALE_2_4_PRO_ENABLED = modeEnv;
  });
  const sendIdentity = (chat, key, purpose = "reply") => ({
    chatId: chat.id, pageId: chat.group, recipient: chat.psid, key, purpose,
  });
  const knownRejected = error => error.code === "rejected";
  const mockCustomer = async () => { customerSends++; return { messageId: "mock-recipient-" + customerSends }; };

  await t.test("provider rejection and timeout lock the chat; database outage fails closed", async () => {
    const rejected = await makeChat(page);
    await assert.rejects(dispatchForChat(sendIdentity(rejected, "image-failed", "seat_map"), async () => {
      throw Object.assign(Error("Meta rejected"), { code: "rejected" });
    }, knownRejected), /Meta rejected/);
    assert.equal((await proRpc("status", { p_chat_id: rejected.id, p_page_id: page })).reason, "send_failed");
    const timedOut = await makeChat(page);
    await assert.rejects(dispatchForChat(sendIdentity(timedOut, "lost-ack"), async () => {
      customerSends++;
      throw Error("Synthetic timeout");
    }, knownRejected), /Synthetic timeout/);
    await assert.rejects(dispatchForChat(sendIdentity(timedOut, "lost-ack"), mockCustomer, knownRejected), { outcome: "locked" });
    assert.equal((await proRpc("status", { p_chat_id: timedOut.id, p_page_id: page })).reason, "delivery_unconfirmed");
    unavailable = true;
    const before = customerSends;
    await assert.rejects(dispatchForChat(sendIdentity(timedOut, "db-missing"), mockCustomer, knownRejected),
      error => error instanceof DispatchBlocked && error.outcome === "database_unavailable");
    assert.equal(customerSends, before);
    unavailable = false;
  });

  await t.test("send key is durable and an abandoned permit never resends", async () => {
    const chat = await makeChat(page);
    await dispatchForChat(sendIdentity(chat, "unique-reply"), mockCustomer, knownRejected);
    await assert.rejects(dispatchForChat(sendIdentity(chat, "unique-reply"), mockCustomer, knownRejected), { outcome: "duplicate" });
    const abandoned = await begin(chat, "abandoned");
    await psql("update extra_sale_pro_dispatches set expires_at=clock_timestamp()-interval '1s' where token=" +
      literal(abandoned.token) + ";");
    assert.equal(await proRpc("recover_dispatches", { p_page_id: page }), 1);
    assert.equal((await begin(chat, "next-work")).outcome, "locked");
    assert.equal((await finish(abandoned.token, "sent", "late-provider-id")).outcome, "stale");
  });

  await t.test("hourly scanner routes Trang and owner, dedupes and closes the previous day at midnight", async () => {
    await modeFor(reportPage, true);
    const first = await makeChat(reportPage, { at: "2031-02-01T15:29:00Z", phone: "0900000002" });
    const unclosed = await makeChat(reportPage, { at: "2031-02-01T16:00:00Z", phone: "0900000003" });
    const paid = await makeChat(reportPage, { at: "2031-02-01T16:03:00Z" });
    const atBoundary = await makeChat(reportPage, { at: fixedEnd });
    await insertPaid(first, { at: "2031-02-01T15:38:00Z", amount: 620000 });
    await insertPaid(paid, { amount: 630000 });
    await insertPaid(paid, { at: "2031-02-01T16:30:00Z", amount: 610000 });
    await insertPaid(atBoundary, { at: fixedEnd, amount: 640000 });
    for (const [chat, at] of [[first, "2031-02-01T15:29:00Z"], [unclosed, "2031-02-01T16:00:00Z"],
      [unclosed, "2031-02-01T16:01:00Z"], [paid, "2031-02-01T16:03:00Z"], [atBoundary, fixedEnd]]) {
      await psql("insert into extra_support_messages (chat_id,sender,body,created_at) values (" +
        literal(chat.id) + ",'customer','Khách giả lập hỏi vé'," + literal(at) + ");");
    }
    const before = customerSends;
    const deliveries = [];
    const now = () => new Date("2031-02-01T17:01:30Z");
    const sender = async data => { deliveries.push(data); return { id: "mock-zalo-" + deliveries.length }; };
    await Promise.all([runProTasks(reportPage, { clock: now, adminOrigin, sender }),
      runProTasks(reportPage, { clock: now, adminOrigin, sender })]);
    await runProTasks(reportPage, { clock: now, adminOrigin, sender });
    const owner = deliveries.find(x => x.audience === "owner");
    const trang = deliveries.find(x => x.audience === "trang");
    assert.equal(deliveries.length, 2);
    assert.match(owner.text, /Tổng chat 2 · Đã chốt 1 · Tỷ lệ 50%/);
    assert.match(owner.text, /1\.240\.000 đ/);
    assert.match(owner.text, /1\.860\.000 đ/);
    assert.match(owner.text, /Tổng chat 3 · Đã chốt 2/);
    assert.match(trang.text, /Chưa chốt vé/);
    assert.ok(trang.text.includes(unclosed.id));
    assert.ok(!trang.text.includes(atBoundary.id));
    assert.equal(customerSends, before);
  });

  await t.test("revenue without bank receipt remains unknown and refusal/timeout never auto-repeat", async () => {
    const group = "99004";
    await modeFor(group, true);
    const chat = await makeChat(group, { at: "2031-02-01T16:06:00Z" });
    await insertPaid(chat, { receipts: false });
    await lock(chat, "out_of_scope");
    const noAdapter = await runProTasks(group, { clock: () => new Date(fixedEnd), adminOrigin });
    assert.equal(noAdapter.deliveries.transport, "unverified");
    const outcomes = [];
    const sender = async item => {
      outcomes.push(item);
      if (item.audience === "owner") {
        assert.match(item.text, /Chưa đủ xác nhận \(1 đơn thiếu biên nhận\)/);
        throw new InternalDeliveryRejected("Simulated Zalo rejection");
      }
      throw Error("Simulated Zalo timeout");
    };
    await drainInternal(group, "handoff", adminOrigin, sender);
    await drainInternal(group, "hourly", adminOrigin, sender);
    await drainInternal(group, "handoff", adminOrigin, sender);
    await drainInternal(group, "hourly", adminOrigin, sender);
    assert.equal(outcomes.length, 3);
    const states = await psql("select string_agg(state,',' order by state) from extra_sale_pro_delivery where page_id=" + literal(group) + ";");
    assert.equal(states, "failed,uncertain,uncertain");
  });

  await t.test("guarded 2.3 retains the real 3/60-minute scanner and resumes an eligible unpaid conversation", { skip: !rollback }, async () => {
    await modeFor(legacyPage, false);
    process.env.AI_SALE_2_4_PRO_ENABLED = "false";
    try {
      const chat = await makeChat(legacyPage, { phone: "0900000004" });
      await psql("insert into extra_messenger_ai_settings (page_id,enabled,model,provider_checked_at) values (" +
        literal(legacyPage) + ",true,'synthetic-model',now());" +
        "update extra_messenger_ai_followup_control set enabled=true, enabled_at=now()-interval '2h' where singleton;" +
        "insert into extra_messenger_ai_state(chat_id,status) values (" + literal(chat.id) + ",'in_progress');" +
        "insert into extra_support_messages(chat_id,sender,body,created_at) values (" + literal(chat.id) +
        ",'customer','Cho mình xin giá vé',now()-interval '5 minutes');" +
        "insert into extra_support_messages(chat_id,sender,body,staff_name,created_at,external_message_id) values (" +
        literal(chat.id) + ",'staff','Giá vé mô phỏng','EXTRA AI',now()-interval '4 minutes','synthetic-anchor');" +
        "update extra_support_chats set last_customer_at=now()-interval '5 minutes', last_staff_at=now()-interval '4 minutes' where id=" +
        literal(chat.id) + ";");
      const messages = [];
      const scanner = evaluate(resolve(rollback, "lib/ai-sales-followup.ts"), new Map([
        ["./facebook-messenger", {
          getMessengerConfig: () => ({ pageId: legacyPage }),
          sendMessengerPageMessage: async (_psid, body, _quote, fence) => {
            await fence();
            messages.push(body);
            return { messageId: "test-legacy-mid-" + messages.length };
          },
          MessengerSendError: class extends Error {},
        }],
        ["./staff-auth", { staffDb: async (path, options) => {
          if (path.startsWith("extra_messenger_ai_followup_control")) return [{ enabled: true }];
          if (path.startsWith("extra_messenger_day_before")) return [];
          return rpc(path.slice(4), JSON.parse(options.body));
        } }],
        ["../staff-auth", serviceMocks.get("../staff-auth")],
      ]));
      const locked = await lock(chat, "human_requested");
      assert.equal((await scanner.runAiSalesFollowup()).sent, 0);
      assert.equal((await command(chat, locked.handoff_id)).outcome, "unpaid");
      const stages3 = await Promise.all([scanner.runAiSalesFollowup(), scanner.runAiSalesFollowup()]);
      assert.equal(stages3.reduce((sum, x) => sum + x.sent, 0), 1);
      assert.equal(messages.length, 1);
      const scope = " where chat_id=" + literal(chat.id);
      await psql("update extra_support_messages set created_at=created_at-interval '57 minutes'" + scope +
        "; update extra_support_chats set last_customer_at=last_customer_at-interval '57 min',last_staff_at=last_staff_at-interval '57 min' where id=" + literal(chat.id) +
        "; update extra_messenger_ai_followup_ledger set created_at=created_at-interval '57 min',sent_at=(select created_at+interval '3 min' from extra_support_messages where external_message_id='synthetic-anchor')" + scope + ";");
      const stages60 = await Promise.all([scanner.runAiSalesFollowup(), scanner.runAiSalesFollowup()]);
      assert.equal(stages60.reduce((sum, x) => sum + x.sent, 0), 1);
      assert.match(messages[1], /synthetic-pro-show/);
      assert.equal((await scanner.runAiSalesFollowup()).sent, 0);
    } finally {
      process.env.AI_SALE_2_4_PRO_ENABLED = "true";
    }
  });
});

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load(relativePath, dependencies = {}, globals = {}) {
  const file = resolve(__dirname, "..", relativePath);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  new Function("exports", "module", "require", ...Object.keys(globals), output.outputText)(module.exports, module, localRequire, ...Object.values(globals));
  return module.exports;
}

const pilotModule = load("lib/messenger-sale-pilot.ts");
const pageId = "110001";
const psid = "220002";
const appId = "330003";
const appSecret = "synthetic Meta signing secret";
const pilotEnv = {
  META_MESSENGER_AI_MODE: "test", META_MESSENGER_AI_TEST_PAGE_ID: pageId,
  META_MESSENGER_AI_TEST_PSIDS: psid, META_MESSENGER_AI_APP_ID: appId,
  META_MESSENGER_AI_WORKER_SECRET: "synthetic durable worker secret",
  META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: "https://store-pilot.example.invalid",
  META_MESSENGER_AI_TEST_SUPABASE_URL: "https://db-pilot.example.invalid", SUPABASE_URL: "https://db-pilot.example.invalid",
};
const pilot = pilotModule.getMessengerSalePilot(pageId, pilotEnv);
const token = "fd88af9a-00ee-49f9-906e-8e1e8e243830";

test("pilot only accepts explicitly configured tester conversations outside production", () => {
  assert.equal(pilotModule.getMessengerSalePilot(pageId, {}), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, VERCEL_ENV: "production" }), null);
  assert.equal(pilotModule.getMessengerSalePilot("110002", pilotEnv), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_TEST_PSIDS: "" }), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: "https://iExtra.net./" }), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: "" }), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, SEPAY_CHECKOUT_ENABLED: "true" }), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_APP_ID: "2447629075989535" }), null);
  assert.equal(pilotModule.getMessengerSalePilot("1223940670813189", { ...pilotEnv, META_MESSENGER_AI_TEST_PAGE_ID: "1223940670813189" }), null);
  const liveDatabase = "https://fokntdvgzfldxbaglrdc.supabase.co";
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_TEST_SUPABASE_URL: liveDatabase, SUPABASE_URL: liveDatabase }), null);
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, SUPABASE_URL: "https://different.example.invalid" }), null);
  const local = { ...pilotEnv, META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: "http://127.0.0.1:3000" };
  assert.ok(pilotModule.getMessengerSalePilot(pageId, local));
  assert.equal(pilotModule.getMessengerSalePilot(pageId, { ...local, VERCEL_ENV: "preview" }), null);
  assert.equal(pilot.testers.has("999999"), false);
  assert.equal(pilotModule.checkMessengerWorkerAuth(null, pilot.workerSecret), false);
  assert.equal(pilotModule.checkMessengerWorkerAuth(`Bearer ${pilot.workerSecret}`, pilot.workerSecret), true);
});

test("echo attribution requires the matching App and marker or an explicitly verified human source", () => {
  const metadata = `extra-sale-2:ai:${token}`;
  assert.deepEqual(pilotModule.classifyMessengerEcho(Number(appId), metadata, pilot), { kind: "ai", token });
  assert.deepEqual(pilotModule.classifyMessengerEcho(appId, `extra-sale-2:staff:${token}`, pilot), { kind: "staff", token });
  assert.deepEqual(pilotModule.classifyMessengerEcho(appId, undefined, pilot), { kind: "unknown" });
  assert.deepEqual(pilotModule.classifyMessengerEcho("404004", metadata, pilot), { kind: "unknown" });
  assert.deepEqual(pilotModule.classifyMessengerEcho(undefined, undefined, pilot), { kind: "unknown" });
  const verified = pilotModule.getMessengerSalePilot(pageId, { ...pilotEnv, META_MESSENGER_AI_NATIVE_HUMAN_ECHO: "1" });
  assert.deepEqual(pilotModule.classifyMessengerEcho(undefined, undefined, verified), { kind: "human" });
  assert.deepEqual(pilotModule.classifyMessengerEcho(undefined, metadata, verified), { kind: "unknown" });
});

test("Graph transport checks the cohort before sending, profile lookup, typing or audio", async () => {
  const calls = [];
  const transport = load("lib/facebook-messenger.ts", { "server-only": {}, "./messenger-sale-media": load("lib/messenger-sale-media.ts"), "./messenger-sale-pilot": {
    requiresMessengerSaleIsolation: () => true,
    getMessengerSalePilot: page => pilotModule.getMessengerSalePilot(page, pilotEnv),
  } }, {
    process: { env: { META_MESSENGER_PAGE_ID: pageId, META_MESSENGER_PAGE_ACCESS_TOKEN: "synthetic page token for testing",
      META_MESSENGER_APP_SECRET: appSecret, META_MESSENGER_VERIFY_TOKEN: "synthetic verification token" } },
    fetch: async (_url, init) => { calls.push(init.body); return Response.json({ message_id: "fake-graph-mid" }); },
  });
  await assert.rejects(transport.sendMessengerPageMessage("220099", "Chào"), reason => reason.deliveryUncertain === false);
  await transport.sendMessengerTypingAction("220099", "typing_on");
  assert.equal(await transport.getMessengerDisplayName("220099"), undefined);
  await assert.rejects(transport.sendMessengerPageAudio(psid, "https://audio.example.invalid/fixture.mp3"));
  assert.deepEqual(calls, []);
  assert.equal((await transport.sendMessengerPageMessage(psid, "Chào")).messageId, "fake-graph-mid");
  assert.equal(calls.length, 1);
  const file = new File(["fixture"], "ccc-sa-pa-550.png", {type:"image/png"});
  await assert.rejects(transport.sendMessengerPageImage("220099", file));
  assert.equal(calls.length, 1);
  assert.equal((await transport.sendMessengerPageImage(psid, file)).messageId, "fake-graph-mid");
  const form = calls[1];
  assert.equal(JSON.parse(form.get("recipient")).id, psid);
  assert.equal(JSON.parse(form.get("message")).attachment.type, "image");
  assert.equal(form.get("filedata").name, file.name);
  assert.equal(await form.get("filedata").text(), "fixture");
});

function webhookHarness(testPilot, isolation = Boolean(testPilot)) {
  const calls = [];
  const after = [];
  const route = load("app/api/meta/messenger/webhook/route.ts", {
    "next/server": { NextResponse: Response, after: callback => after.push(callback) },
    "../../../../../lib/staff-auth": {
      staffDb: async path => (calls.push(path), { outcome: "received", chat_id: "legacy-chat" }),
    },
    "../../../../../lib/facebook-messenger": { getMessengerConfig: () => ({ pageId, appSecret }) },
    "../../../../../lib/messenger-sale-memory": { customerRequestsHuman: body => body.includes("nhân viên") },
    "../../../../../lib/messenger-sale-pilot": { ...pilotModule, getMessengerSalePilot: () => testPilot, requiresMessengerSaleIsolation: () => isolation },
    "../../../../../lib/messenger-sale-worker": {
      messengerSaleRpc: async (name, params) => (calls.push([name, params]), { outcome: "received", chat_id: "tester-chat" }),
      processMessengerSaleChats: async work => calls.push(["work", work]),
    },
  });
  return { calls, after, route };
}

function signedRequest(events, valid = true) {
  const body = JSON.stringify({ object: "page", entry: [{ id: pageId, messaging: events }] });
  const signature = createHmac("sha256", valid ? appSecret : "invalid").update(body).digest("hex");
  return new Request("http://localhost/api/meta/messenger/webhook", {
    method: "POST", headers: { "x-hub-signature-256": `sha256=${signature}` }, body,
  });
}

test("signed webhook persists every event before waking one AI job and preserves the legacy route", async () => {
  const { calls, after, route } = webhookHarness(pilot);
  const first = { sender: { id: psid }, recipient: { id: pageId }, message: { mid: "test-1", text: "2 vé" } };
  const second = { ...first, message: { mid: "test-2", text: "gặp nhân viên", referral: { ad_id: "880000" } } };
  assert.equal((await route.POST(signedRequest([first, second], false))).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await route.POST(signedRequest([first, second]))).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "extra_messenger_ai_ingest");
  assert.deepEqual(calls[1][1].p_referral, { ref: undefined, adId: "880000" });
  assert.equal(calls[1][1].p_request_human, true);
  assert.equal(after.length, 1);
  await after[0]();
  assert.equal(calls[2][0], "extra_support_dispatch_queue");
  assert.deepEqual(calls[3], ["work", [{ chat_id: "tester-chat", psid }]]);

  const legacy = webhookHarness(null);
  await legacy.route.POST(signedRequest([first]));
  assert.deepEqual(legacy.calls, ["rpc/extra_support_ingest_messenger", "rpc/extra_support_assign_chat"]);
  assert.deepEqual(legacy.after, []);
});

test("signed AI echoes only reconcile their own attempt and unknown echoes do not trigger staff intervention", async () => {
  const { calls, after, route } = webhookHarness(pilot);
  const reply = { sender: { id: pageId }, recipient: { id: psid }, message: {
    is_echo: true, mid: "echo-ai", app_id: appId, metadata: `extra-sale-2:ai:${token}`, text: "Giá vé",
  } };
  await route.POST(signedRequest([reply, { ...reply, message: { ...reply.message, mid: "echo-other", app_id: "404004" } }]));
  assert.deepEqual(calls, [["extra_messenger_ai_confirm_echo", {
    p_page_id: pageId, p_psid: psid, p_token: token, p_meta_mid: "echo-ai", p_sender: "ai", p_sent_at: null,
  }]]);
  assert.equal(after.length, 0);
});

test("isolated callbacks never fall back to the legacy inbox, including incomplete setup", async () => {
  const blocked = webhookHarness(null, true);
  assert.equal((await blocked.route.GET(new Request("http://localhost/api/meta/messenger/webhook"))).status, 503);
  const first = { sender: { id: psid }, recipient: { id: pageId }, message: { mid: "test-3", text: "2 vé" } };
  assert.equal((await blocked.route.POST(signedRequest([first]))).status, 503);
  assert.deepEqual(blocked.calls, []);
  const valid = webhookHarness(pilot);
  const nonTester = { ...first, sender: { id: "220099" }, message: { ...first.message, mid: "test-4" } };
  const wrongPage = { ...first, recipient: { id: "110099" }, message: { ...first.message, mid: "test-5" } };
  assert.equal((await valid.route.POST(signedRequest([nonTester, wrongPage, first]))).status, 200);
  assert.equal(valid.calls.length, 1);
  assert.equal(valid.calls[0][0], "extra_messenger_ai_ingest");
  assert.equal(valid.calls[0][1].p_mid, "test-3");
});

test("worker revalidates ownership before Graph and retains uncertain delivery for echo reconciliation", async () => {
  for (const beginOutcome of ["blocked", "ready"]) {
    const calls = [];
    class SendError extends Error { deliveryUncertain = true; }
    const worker = load("lib/messenger-sale-worker.ts", {
      "./ai-sale-extra-2-1": load("lib/ai-sale-extra-2-1.ts"),
      "./messenger-sale-media": load("lib/messenger-sale-media.ts"),
      "./messenger-voice": load("lib/messenger-voice.ts"),
      "./messenger-seatmap-files": {readMessengerSeatMap: async () => null},
      "server-only": {},
      "./facebook-messenger": {
        getMessengerDisplayName: async () => "Ngọc", MessengerSendError: SendError,
        messengerOutboundMetadata: (kind, attempt) => `${kind}:${attempt}`,
        sendMessengerPageMessage: async (...args) => { calls.push(["send", ...args]); throw new SendError(); },
        sendMessengerTypingAction: async (_psid, action) => calls.push([action]),
      },
      "./messenger-sale-data": { loadMessengerSaleShows: async () => [], loadMessengerSalePromotions: () => [] },
      "./messenger-sale-memory": load("lib/messenger-sale-memory.ts"),
      "./messenger-sale-reply": { composeMessengerSaleReply: () => ({ text: "Em chào Ngọc", greeted: true, aiDisclosed: true }) },
      "./staff-auth": { staffDb: async (path, init) => {
        if (path.startsWith("extra_support_messages?")) return [{ id: 1, sender: "customer", body: "Chào" }];
        calls.push([path, JSON.parse(init.body)]);
        if (path.endsWith("claim")) return { outcome: "claimed", chat_id: "chat", psid, page_id: pageId, token, through_message_id: 1, context: {} };
        return { outcome: beginOutcome };
      } },
    });
    assert.equal(await worker.processMessengerSaleChat("chat", psid, pilot), false);
    const names = calls.map(([name]) => name);
    assert.deepEqual(names.slice(0, 3), ["rpc/extra_messenger_ai_claim", "typing_on", "rpc/extra_messenger_ai_begin_send"]);
    if (beginOutcome === "blocked") assert.equal(names.includes("send"), false);
    else {
      assert.equal(calls[3][3], `ai:${token}`);
      assert.equal(calls[4][1].p_status, "unknown");
    }
    assert.equal(names.at(-1), "typing_off");
  }
});

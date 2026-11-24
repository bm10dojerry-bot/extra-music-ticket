const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { NextRequest } = require("next/server");
const ts = require("typescript");

const chatId = "1bdd211e-4a92-46f1-be68-97384949f656";
const staffId = "394775f2-e825-403a-a6bf-764d2cfe4948";
const requestId = "268c901a-658f-494b-8b99-1f0229d8f4aa";
const leaseId = "75389dc3-f3c3-4fb4-9af2-e647ba3fdeea";
const body = "Phản hồi kiểm thử";
const source = readFileSync(join(__dirname, "../app/api/staff/support-chats/route.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class SyntheticSendError extends Error {
  constructor(deliveryUncertain) {
    super("Synthetic Messenger transport failure");
    this.deliveryUncertain = deliveryUncertain;
  }
}

function fixture({ managed = true, assigned = true, oldSchema = false, begin = "ready", failedTransport = false, owner = false } = {}) {
  const calls = [];
  const chat = {
    id: chatId, channel: "messenger", status: "open", customer_name: "Khách thử",
    assigned_staff_id: assigned ? staffId : null, last_customer_at: new Date().toISOString(),
    ...(oldSchema ? {} : { messenger_ai_managed: managed, messenger_last_human_at: null, messenger_human_requested: false, messenger_last_ai_at: null }),
  };
  const fakeStaff = { id: owner ? "owner" : staffId, display_name: "Sale thử", role: owner ? "admin" : "sale" };
  const fakeDb = async (path, init) => {
    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      const params = JSON.parse(init.body);
      calls.push([name, params]);
      if (name === "extra_support_dispatch_queue") return { assigned: 0 };
      if (name === "extra_support_staff_reply") return { outcome: "sent" };
      if (name === "extra_messenger_ai_begin_staff_send") return { outcome: begin, token: begin === "ready" ? leaseId : undefined };
      if (name === "extra_messenger_ai_finish_staff_send") return { outcome: params.p_status };
      if (name === "extra_messenger_ai_takeover") return { outcome: "taken_over" };
      if (name === "extra_messenger_ai_release_human") return { outcome: "human_requested" };
      throw Error("Unexpected RPC " + name);
    }
    if (path.startsWith("staff_accounts?")) return [{ id: staffId, display_name: fakeStaff.display_name }];
    if (path.startsWith("extra_support_messages?")) return [{ id: 7, sender: "staff", body }];
    if (path.includes("select=messenger_page_id,messenger_psid")) return [{ messenger_page_id: "12345", messenger_psid: "123456" }];
    if (path.startsWith("extra_support_chats?")) {
      if (oldSchema && path.includes("messenger_ai_managed")) {
        throw Error('Database 400 {"code":"42703","message":"column does not exist"}');
      }
      return [chat];
    }
    throw Error("Unexpected query " + path);
  };
  const providers = {
    "next/server": require("next/server"),
    "../../../../lib/staff-auth": { requireRole: async () => fakeStaff, staffDb: fakeDb },
    "../../../../lib/messenger-ai-ownership": { HUMAN_IDLE_MS: 180_000 },
    "../../../../lib/facebook-messenger": {
      getMessengerConfig: () => ({ pageId: "12345" }),
      MessengerSendError: SyntheticSendError,
      messengerOutboundMetadata: (kind, token) => `${kind}:${token}`,
      sendMessengerPageMessage: async (...args) => {
        calls.push(["meta", ...args]);
        if (failedTransport) throw new SyntheticSendError(failedTransport !== "rejected");
        return { messageId: "synthetic-outbound-mid" };
      },
    },
  };
  const routes = {};
  runInNewContext(compiled, { exports: routes, Error, URL, console: { warn() {} }, require: name => {
    assert(name in providers, "unexpected module " + name);
    return providers[name];
  } });
  const request = (method, params, query = "") => new NextRequest("https://sale.example.invalid/api/staff/support-chats" + query, {
    method, headers: { origin: "https://sale.example.invalid", host: "sale.example.invalid" },
    ...(params && { body: JSON.stringify(params) }),
  });
  return {
    chat, calls, get: () => routes.GET(request("GET")), getThread: () => routes.GET(request("GET", null, "?chatId=" + chatId)),
    post: () => routes.POST(request("POST", { chatId, message: body, requestId, seenMessageId: 7 })),
    patch: action => routes.PATCH(request("PATCH", { chatId, action })),
  };
}

test("AI-managed chats stay out of automatic dispatch until the customer asks for a human", async () => {
  const f = fixture({ assigned: false });
  const idle = await (await f.get()).json();
  assert.equal(idle.waitingCount, 0);
  assert.deepEqual(f.calls, []);
  f.chat.messenger_human_requested = true;
  const requested = await (await f.get()).json();
  assert.equal(requested.waitingCount, 1);
  assert.equal(requested.needReplyCount, 1);
  assert.deepEqual(f.calls.map(([name]) => name), ["extra_support_dispatch_queue"]);
});

test("a managed staff send claims ownership before Graph and records the acknowledged MID", async () => {
  const f = fixture();
  assert.equal((await f.post()).status, 200);
  assert.deepEqual(f.calls.map(([name]) => name), ["extra_messenger_ai_begin_staff_send", "meta", "extra_messenger_ai_finish_staff_send"]);
  assert.equal(f.calls[0][1].p_request_id, requestId);
  assert.equal(f.calls[0][1].p_seen_message_id, 7);
  assert.deepEqual(f.calls[1], ["meta", "123456", body, "staff:" + leaseId]);
  assert.deepEqual(f.calls[2][1], { p_chat_id: chatId, p_token: leaseId, p_status: "sent", p_meta_mid: "synthetic-outbound-mid" });
});

test("a busy lease, fresher AI reply or replay never triggers another Meta send", async () => {
  for (const [begin, status] of [["busy", 409], ["conversation_changed", 409], ["sent", 200], ["unknown", 202], ["rejected", 502]]) {
    const f = fixture({ begin });
    assert.equal((await f.post()).status, status);
    assert.deepEqual(f.calls.map(([name]) => name), ["extra_messenger_ai_begin_staff_send"]);
  }
});

test("uncertain transport is recorded as unknown and the response directs staff to verify delivery", async () => {
  const f = fixture({ failedTransport: true });
  const response = await f.post();
  assert.equal(response.status, 202);
  assert.match((await response.json()).notice, /kiểm tra Messenger/);
  assert.deepEqual(f.calls[2][1], { p_chat_id: chatId, p_token: leaseId, p_status: "unknown", p_meta_mid: null });
});

test("definitive Messenger rejection is recorded and returns a retryable staff error without losing the draft", async () => {
  const f = fixture({ failedTransport: "rejected" });
  const response = await f.post();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Facebook đã từ chối gửi/);
  assert.deepEqual(f.calls[2][1], { p_chat_id: chatId, p_token: leaseId, p_status: "rejected", p_meta_mid: null });
});

test("legacy Messenger staff replies retain the original send path with the former schema", async () => {
  const f = fixture({ oldSchema: true });
  assert.equal((await f.post()).status, 200);
  assert.deepEqual(f.calls.map(([name]) => name), ["meta", "extra_support_staff_reply"]);
  assert.deepEqual(f.calls[0], ["meta", "123456", body]);
});

test("staff can explicitly take over, and a waiting customer's human request blocks release", async () => {
  const f = fixture();
  assert.equal((await f.patch("takeover")).status, 200);
  const release = await f.patch("release-ai");
  assert.equal(release.status, 409);
  assert.equal((await release.json()).outcome, "human_requested");
  assert.deepEqual(f.calls.map(([name]) => name), ["extra_messenger_ai_takeover", "extra_messenger_ai_release_human"]);
});

test("owner can open and take over an unassigned conversation before replying; Sale must claim first", async () => {
  const unassigned = fixture({ assigned: false });
  assert.equal((await unassigned.getThread()).status, 403);
  assert.equal((await unassigned.post()).status, 403);
  const manager = fixture({ assigned: false, owner: true });
  const transcript = await manager.getThread();
  assert.equal(transcript.status, 200);
  assert.equal((await transcript.json()).messages.length, 1);
  assert.equal((await manager.patch("takeover")).status, 200);
  assert.deepEqual(manager.calls[0][1], { p_chat_id: chatId, p_actor_id: null, p_is_manager: true });
});

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const source = readFileSync(resolve(__dirname, "../lib/messenger-sale-data.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadData({ staffDb = async () => [], loadAllShows = async () => [], defaultShows = () => [] } = {}) {
  const dependencies = { "server-only": {}, "./staff-auth": { staffDb }, "./show-data": { loadAllShows, defaultShows } };
  const exports = {};
  new Function("exports", "require", compiled)(exports, name => dependencies[name]);
  return exports;
}

const date = new Date("2026-11-25T00:00:00Z");
const show = { id: "show-test", venue: "ccc", date: "2026-12-20" };

test("inventory excludes active holds, paid orders, verified sales and blocked seats using read-only queries", async () => {
  const calls = [];
  const table = {
    ticket_sales: [{ seats: ["A01"] }, { seats: ["A08"] }],
    extra_payment_orders: [{ seats: ["A02", "A03"] }],
    extra_show_blocked_seats: [{ seat_id: "A04" }],
    venue_seat_rows: [{ row_code: "A", seat_count: 30 }],
  };
  const { loadMessengerSaleInventory } = loadData({ staffDb: async (path, { method, signal }) => {
    assert.equal(method, undefined);
    assert.ok(signal instanceof AbortSignal);
    const request = new URL("https://database.invalid/" + path);
    const name = request.pathname.slice(1);
    const filters = request.searchParams;
    const offset = Number(filters.get("offset"));
    calls.push({ name, filters, offset });
    // Simulate a database response limit smaller than the requested page size.
    return table[name].slice(offset, offset + 1);
  } });
  const inventory = await loadMessengerSaleInventory(show, date);
  assert.deepEqual(inventory, { showId: show.id, rowCounts: { A: 30 }, unavailable: new Set(["A01", "A08", "A02", "A03", "A04"]) });
  assert.deepEqual(calls.filter(call => call.name === "ticket_sales").map(call => call.offset), [0, 1, 2]);
  assert.equal(calls.find(call => call.name === "ticket_sales").filters.get("payment_verified"), "eq.true");
  assert.equal(calls.find(call => call.name === "extra_payment_orders").filters.get("or"),
    "(status.eq.paid,and(status.eq.pending,expires_at.gt.2026-11-25T00:00:00.000Z))");
  assert.ok(calls.every(call => /^(seats|seat_id|row_code,seat_count)$/.test(call.filters.get("select"))));
});

test("a timeout on any inventory source prevents partially verified availability", async () => {
  const { loadMessengerSaleInventory } = loadData({ staffDb: async (path, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (path.startsWith("extra_payment_orders?")) throw new DOMException("Synthetic timeout", "TimeoutError");
    return [];
  } });
  assert.equal(await loadMessengerSaleInventory(show, date), null);
});

test("the managed catalog preserves canonical fallback shows only after a successful refresh", async () => {
  const older = { ...show, id: "older-show", date: "2026-12-01" };
  const hidden = { ...show, rawStatus: "hidden" };
  const verified = { ...show, id: "verified-show", date: "2026-12-12", prices: { D: 345_000 } };
  const { loadMessengerSaleShows } = loadData({
    defaultShows: () => [older, show],
    loadAllShows: async signal => {
      assert.ok(signal instanceof AbortSignal);
      return [verified, hidden];
    },
  });
  assert.deepEqual(await loadMessengerSaleShows(), [older, verified]);

  const fail = loadData({ defaultShows: () => { throw new Error("Fallback must never be used"); },
    loadAllShows: async () => { throw new DOMException("Synthetic timeout", "TimeoutError"); } });
  assert.equal(await fail.loadMessengerSaleShows(), null);
});

test("optional promotion schedules accept approved checkout programs with explicit UTC date bounds", () => {
  const { loadMessengerSalePromotions } = loadData();
  const valid = { showId: show.id, program: "buy5", startsAt: "2026-11-24T00:00:00Z", expiresAt: "2026-12-31T00:00:00Z" };
  const schedules = [
    valid, { ...valid, program: "invented" }, { ...valid, showId: "bad id" },
    { ...valid, startsAt: undefined }, { ...valid, expiresAt: valid.startsAt },
  ];
  const promotions = loadMessengerSalePromotions(JSON.stringify(schedules));
  assert.equal(promotions.length, 1);
  assert.equal(promotions[0].title, "Mua 5 vé, tặng 1 ghế");
  assert.equal(promotions[0].quantity, 5);
  assert.match(promotions[0].terms, /qua nhân viên Sale.*tùy ghế còn trống/);
  assert.deepEqual(loadMessengerSalePromotions("invalid JSON"), []);
});

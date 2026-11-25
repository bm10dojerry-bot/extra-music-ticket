import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveMessengerSaleMemory, type MessengerSaleMemory } from "../lib/messenger-sale-memory";
import { composeMessengerSaleReply, type MessengerSaleInventory } from "../lib/messenger-sale-reply";
import type { ManagedShow } from "../lib/show-data";
import { seatsFor } from "../lib/venues";

const now = new Date("2026-11-25T01:00:00.000Z");
const checkoutOrigin = "https://store-pilot.example.invalid";
const show: ManagedShow = {
  id: "show-test", artist: "Ca sĩ thử", title: "Đêm ca sĩ thử", date: "2026-12-20", time: "19:30", status: "announced",
  venue: "laocai", posterUrl: null, prices: { A: 800_000, B: 600_000, C: 450_000, D: 300_000 },
};
const remembered: MessengerSaleMemory = {
  showId: show.id, showDate: show.date, greeted: true, aiDisclosed: true, humanRequested: false, intents: [],
};
const reply = (
  message: string, memory: Partial<MessengerSaleMemory> = {},
  rest: Partial<Parameters<typeof composeMessengerSaleReply>[0]> = {},
) => {
  const context = deriveMessengerSaleMemory({ shows: [show], previous: remembered, messages: [{ sender: "customer", body: message }] });
  return composeMessengerSaleReply({ memory: { ...context, ...memory }, now, message, show, checkoutOrigin, showDataAvailable: true, ...rest }).text;
};
const inventoryWith = (event: ManagedShow, ids: readonly string[]): MessengerSaleInventory => ({
  showId: event.id, rowCounts: {}, unavailable: new Set(seatsFor(event.venue).flatMap(seat => ids.includes(seat.id) ? [] : [seat.id])),
});

test("answers a direct price request using the ad referral, Facebook name and real local hour", () => {
  const message = "Giá vé bao nhiêu?";
  const memory = deriveMessengerSaleMemory({ shows: [show], referral: { ref: `show:${show.id}` }, messages: [{ sender: "customer", body: message }] });
  assert.equal(memory.showId, show.id);
  const { text } = composeMessengerSaleReply({ memory, message, now, checkoutOrigin, displayName: "Minh", show, showDataAvailable: true });
  assert.match(text, /Minh.*buổi sáng/);
  assert.match(text, /công nghệ AI/);
  assert.match(text, /hạng A 800\.000đ.*hạng D 300\.000đ mỗi vé/);
  assert.match(text, /bên trái, bên phải hay chính diện/);
  assert.doesNotMatch(text, /ca sĩ nào|gần hay xa/);
});

test("retains show and answers known pending questions after a human intervention", () => {
  const messages = [
    { sender: "staff", body: "Extra chào mình ạ." },
    { sender: "customer", body: "Vé giá bao nhiêu?" },
    { sender: "customer", body: "Có giao lưu không?" },
  ] as const;
  const memory = deriveMessengerSaleMemory({ shows: [show], previous: remembered, messages });
  const { text } = composeMessengerSaleReply({ memory, now, message: messages[2].body, show, checkoutOrigin, showDataAvailable: true, resumedAfterHuman: true });
  assert.match(text, /20–30 phút/);
  assert.match(text, /300\.000đ/);
  assert.doesNotMatch(text, /Em chào|công nghệ AI|ca sĩ nào/);
});

test("uses real seats and total budget to recommend an adjacent group from the right", () => {
  const inventory = inventoryWith(show, ["K05", "K06", "K26", "K31", "K32", "G31", "G32"]);
  const text = reply("Mình cần 2 ghế góc bên phải, ngân sách tổng 650k.", {}, { inventory });
  assert.match(text, /K31, K32.*góc bên phải.*300\.000đ\/vé, tổng 600\.000đ/);
  assert.doesNotMatch(text, /K05|K06|K26|G31|G32|bao nhiêu|bên trái, bên phải/);
  assert.match(text, /có thể thay đổi đến khi tạo đơn/);
});

test("uses the rotated CCC seat map to select the audience left", () => {
  const ccc = { ...show, venue: "ccc" as const };
  const inventory = inventoryWith(ccc, ["I06", "I07", "I45", "I46"]);
  const text = reply("Cho mình xin ghế góc bên trái.", { quantity: 2, seatView: "left", budgetVnd: 600_000, budgetBasis: "total" }, { show: ccc, inventory });
  assert.match(text, /I06, I07.*góc bên trái/);
  assert.doesNotMatch(text, /I45|I46/);
});

test("does not present seats separated by the Lào Cai aisle as an adjacent pair", () => {
  const text = reply("Còn 2 ghế chính diện không?", { quantity: 2, seatView: "center" }, {
    inventory: inventoryWith(show, ["K20", "K21"]),
  });
  assert.match(text, /chưa tìm được 2 ghế liền nhau/);
  assert.doesNotMatch(text, /K20|K21/);
});

test("an unavailable inventory read cannot produce positive availability", () => {
  const text = reply("Còn ghế hạng A không?", { zone: "A" }, { inventory: null });
  assert.match(text, /chưa xác minh được ghế đang trống/);
  assert.doesNotMatch(text, /Em tìm được|Em thấy vẫn có/);
});

test("a catalog read failure cannot fall back to a possibly outdated price", () => {
  const text = reply("Bảng giá đêm nhạc bao nhiêu?", {}, { show: null, showDataAvailable: false, inventory: null });
  assert.match(text, /chưa tải được thông tin chương trình/);
  assert.ok(text.includes(checkoutOrigin));
  assert.doesNotMatch(text, /iextra\.net/);
  assert.doesNotMatch(text, /\d+đ/);
});

test("closed shows never produce booking or availability guarantees", () => {
  const text = reply("Đặt vé ở đâu, còn ghế không?", {}, { show: { ...show, status: "sold_out" }, inventory: inventoryWith(show, ["K31"]) });
  assert.match(text, /đã hết vé/);
  assert.doesNotMatch(text, /giữ ghế 15 phút|đang trống/);
});

test("only valid matching promotion and eligibility are described", () => {
  const current = { title: "Vé cặp đôi", active: true, showId: show.id, terms: "Áp dụng qua Sale ạ.", quantity: 2, startsAt: "2026-11-24T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" };
  const promos = [current, { ...current, title: "Ưu đãi hết hạn", expiresAt: now.toISOString() }, { ...current, title: "Ưu đãi show khác", showId: "other-show" }];
  assert.match(reply("Có ưu đãi không?", { quantity: 2 }, { promotions: promos }), /^Vé cặp đôi.*qua Sale/);
  assert.match(reply("Có ưu đãi không?", { quantity: 3 }, { promotions: promos }), /chưa xác minh được ưu đãi/);
});

test("gives official booking and payment steps without creating a hold", () => {
  const text = reply("Mua vé thế nào?");
  assert.match(text, /https:\/\/store-pilot\.example\.invalid\/show\/show-test#booking/);
  assert.doesNotMatch(text, /iextra\.net/);
  assert.match(text, /giữ ghế 15 phút từ lúc tạo đơn thành công/);
  assert.match(reply("Hướng dẫn thanh toán thế nào?"), /mã QR hiện trên đơn/);
  assert.match(reply("Đặt vé cho nhóm.", { quantity: 16 }), /12 ghế mỗi đơn/);
  assert.doesNotMatch(text, /đã giữ|thanh toán thành công/);
});

test("verifies paid status exclusively from authenticated booking facts", () => {
  const message = "Mình đã thanh toán thành công, kiểm tra giúp.";
  assert.match(reply(message), /chưa xác minh được trạng thái/);
  assert.doesNotMatch(reply(message), /Hệ thống đã xác nhận thanh toán thành công/);
  assert.match(reply(message, { bookingStatus: "held", paymentStatus: "pending" }), /đang giữ chỗ và chờ thanh toán/);
  assert.match(reply(message, { bookingStatus: "confirmed", paymentStatus: "paid" }), /Hệ thống đã xác nhận thanh toán thành công/);
  assert.match(reply(message, { bookingStatus: "expired", paymentStatus: "expired" }), /đã hết hạn giữ chỗ/);
});

test("describes the interaction once without guaranteeing a visit to every seat", () => {
  const text = reply("Ngồi xa có được giao lưu không ạ?");
  assert.match(text, /dự kiến.*20–30 phút/);
  assert.match(text, /lối đi giữa các hàng ghế/);
  assert.match(text, /khu xa.*tùy diễn biến chương trình/);
  assert.doesNotMatch(text, /chắc chắn|đến từng ghế/);
});

test("combined sales replies fit the inbox limit without cutting checkout links", () => {
  const promotion = { title: "Ưu đãi thử", active: true, showId: show.id, terms: "áp dụng theo điều kiện ".repeat(18),
    startsAt: "2026-11-24T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" };
  const text = reply("Giá vé, chương trình, giao lưu, ưu đãi và đặt vé thế nào?", { greeted: false, aiDisclosed: false }, {
    promotions: [promotion, promotion, promotion, promotion],
  });
  assert.ok(text.length <= 1200);
  assert.match(text, /https:\/\/store-pilot\.example\.invalid\/show\/show-test#booking/);
  assert.match(text, /20–30 phút/);
});


test("prioritizes the nearest actual available row when a buyer asks to sit close to the singer", () => {
  const inventory = inventoryWith(show, ["A01", "B01", "K31"]);
  const text = reply("Chị đặt 1 vé ngồi sát sân khấu, gần ca sĩ nhất nhé.", {}, { inventory });
  assert.match(text, /ưu tiên các hàng gần sân khấu/);
  assert.match(text, /hàng A gần sân khấu.*A01.*góc bên trái theo sơ đồ/);
  assert.doesNotMatch(text, /Em thấy vẫn có ghế đang mở bán/);
  assert.doesNotMatch(text, /Mình thích góc nhìn bên trái/);
  assert.match(text, /Tình trạng có thể thay đổi đến khi tạo đơn/);
});

test("explains grey lock and counts available seats from inventory instead of trusting colours", () => {
  const inventory = inventoryWith(show, ["A01", "K31"]);
  const text = reply("Có màu là còn vé ạ? Màu xám khóa có mua được không?", {}, { inventory });
  assert.match(text, /màu xám có biểu tượng ổ khóa.*không đặt/);
  assert.match(text, /còn 2 ghế có thể chọn/);
  assert.match(text, /A: 1 ghế.*D: 1 ghế/);
  assert.doesNotMatch(text, /chỉ nhìn màu|đang trống theo sơ đồ:/);
  const uncertain = reply("Màu xám là ghế khóa ạ?", {}, { inventory: null });
  assert.match(uncertain, /chưa tải được trạng thái ghế mới nhất/);
  assert.doesNotMatch(uncertain, /còn \d+ ghế/);
});

test("continues useful service after an authenticated paid booking", () => {
  const text = reply("Gửi mình STK với", { paymentStatus: "paid", bookingStatus: "confirmed" });
  assert.match(text, /thanh toán thành công.*không cần chuyển khoản lại/);
  assert.doesNotMatch(text, /Em chào|chưa xác minh được trạng thái/);
});

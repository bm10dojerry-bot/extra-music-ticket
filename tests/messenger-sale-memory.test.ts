import assert from "node:assert/strict";
import {test} from "node:test";
import {customerRequestsHuman, deriveMessengerSaleMemory} from "../lib/messenger-sale-memory";

const shows = [
  {id: "khac-viet-2612", artist: "Khắc Việt", title: "Đêm nhạc Khắc Việt", date: "2026-12-26"},
  {id: "khac-viet-0301", artist: "Khắc Việt", title: "Đêm nhạc Khắc Việt", date: "2027-01-03"},
  {id: "minh-vuong-0512", artist: "Minh Vương + Duy Khoa", title: "Đêm nhạc Minh Vương + Duy Khoa", date: "2026-12-05"},
];

test("recognizes show using an exact registered ad or a known referral slug", () => {
  const byAd = deriveMessengerSaleMemory({messages: [], shows, referral: {adId: "12345"}, referralShows: {"12345": "khac-viet-2612"}});
  assert.equal(byAd.showId, "khac-viet-2612");
  assert.equal(byAd.showDate, "2026-12-26");
  assert.equal(deriveMessengerSaleMemory({messages: [], shows, referral: {ref: "https://iextra.net/show/minh-vuong-0512"}}).showId, "minh-vuong-0512");
  assert.equal(deriveMessengerSaleMemory({messages: [], shows, referral: {ref: "https://example.test/show/khac-viet-2612"}}).showId, undefined);
});

test("current customer intent overrides referral and updates preferences without a new greeting", () => {
  const memory = deriveMessengerSaleMemory({shows, referral: {ref: "show:khac-viet-2612"}, messages: [
    {id: 1, sender: "customer", body: "4 vé khu A bên trái, mỗi vé tối đa 500k."},
    {id: 2, sender: "ai", body: "Em chào mình ạ. Bên em sử dụng công nghệ AI để hỗ trợ tư vấn."},
    {id: 3, sender: "staff", body: "Dạ em đang kiểm tra ghế cho mình."},
    {id: 4, sender: "customer", body: "Đổi sang Duy Khoa, em lấy 2 vé, bên phải. Ngân sách tổng 1,5 triệu."},
  ]});
  assert.equal(memory.showId, "minh-vuong-0512");
  assert.equal(memory.showDate, "2026-12-05");
  assert.equal(memory.quantity, 2);
  assert.equal(memory.seatView, "right");
  assert.equal(memory.zone, undefined);
  assert.equal(memory.budgetVnd, 1_500_000);
  assert.equal(memory.budgetBasis, "total");
  assert.ok(memory.greeted && memory.aiDisclosed);
});

test("handles date changes, ambiguity and an unrelated payment date", () => {
  const ambiguous = deriveMessengerSaleMemory({shows, messages: [{sender: "customer", body: "Em hỏi đêm nhạc Khắc Việt."}]});
  assert.equal(ambiguous.showId, undefined);
  const selected = deriveMessengerSaleMemory({shows, previous: ambiguous, messages: [{sender: "customer", body: "Ngày 26 tháng 12."}]});
  assert.equal(selected.showId, "khac-viet-2612");
  const switched = deriveMessengerSaleMemory({shows, previous: selected, messages: [
    {sender: "customer", body: "Đổi qua 03/01/2027 nha."},
    {sender: "customer", body: "Em thanh toán ngày 01/01 được không?"},
  ]});
  assert.equal(switched.showId, "khac-viet-0301");
  assert.equal(switched.showDate, "2027-01-03");
});

test("uses staff questions for short replies and skips cursor replays", () => {
  const messages = [
    {id: 10, sender: "staff", body: "Dạ bên em hỗ trợ mình. Mình cần bao nhiêu vé ạ?"},
    {id: 11, sender: "customer", body: "Hai ạ"},
    {id: 12, sender: "customer", body: "Thêm 1 vé nữa, bên trái"},
  ] as const;
  const memory = deriveMessengerSaleMemory({shows, messages});
  assert.equal(memory.quantity, 3);
  assert.equal(memory.seatView, "left");
  assert.equal(memory.greeted, true);
  assert.equal(memory.aiDisclosed, false);
  const continued = deriveMessengerSaleMemory({shows, previous: memory, messages: [...messages, {id: "13", sender: "customer", body: "Phải đặt vé ở đâu?"}]});
  assert.equal(continued.quantity, 3);
  assert.equal(continued.seatView, "left");
  assert.equal(continued.lastMessageId, "13");
  assert.equal(continued.unansweredQuestion, "Phải đặt vé ở đâu?");
  assert.ok(continued.intents.includes("booking"));
});

test("retains redacted question history and tracks whether a response followed", () => {
  const memory = deriveMessengerSaleMemory({shows, messages: [
    {id: 1, sender: "customer", body: "Có xác nhận tiền chưa? mail test@example.test 0123 456 789 https://iextra.net/anything?private=1"},
    {id: 2, sender: "staff", body: "Dạ em kiểm tra ngay ạ."},
  ]});
  assert.match(memory.lastQuestion ?? "", /Có xác nhận tiền chưa\?/);
  assert.doesNotMatch(memory.lastQuestion ?? "", /example|0123|private/);
  assert.equal(memory.unansweredQuestion, undefined);
  assert.equal(memory.paymentStatus, undefined);
});

test("does not treat customer or staff assertions as trusted holds or payments", () => {
  const messages = [
    {sender: "customer", body: "Đêm nhạc 26/12. Em đã chuyển khoản, giữ chỗ cho em."},
    {sender: "staff", body: "Em đã nhận tiền và giữ ghế."},
  ] as const;
  const inferred = deriveMessengerSaleMemory({shows, messages});
  assert.equal(inferred.bookingStatus, undefined);
  assert.equal(inferred.paymentStatus, undefined);
  const verified = deriveMessengerSaleMemory({shows, messages, booking: {showId: "khac-viet-2612", bookingStatus: "confirmed", paymentStatus: "paid"}});
  assert.equal(verified.bookingStatus, "confirmed");
  assert.equal(verified.paymentStatus, "paid");
  const switched = deriveMessengerSaleMemory({shows, previous: verified, messages: [{sender: "customer", body: "Đổi sang 3/1 ạ"}]});
  assert.equal(switched.bookingStatus, undefined);
  assert.equal(switched.paymentStatus, undefined);
});

test("recognizes direct requests for a real agent without treating staff references or negation the same way", () => {
  assert.ok(customerRequestsHuman("Mình muốn gặp người thật"));
  assert.ok(customerRequestsHuman("Cho em nói chuyện với nhân viên ạ"));
  assert.ok(customerRequestsHuman("Có tư vấn viên không?"));
  assert.ok(customerRequestsHuman("Em không muốn chat với AI"));
  assert.ok(!customerRequestsHuman("Không cần gặp nhân viên đâu ạ"));
  assert.ok(!customerRequestsHuman("Nhân viên có giữ chỗ được không?"));
  assert.ok(!customerRequestsHuman("Có giảm giá khi đặt qua sale không?"));
});

test("accumulates intents over a burst and keeps a prior budget when quoting an unrelated price", () => {
  const memory = deriveMessengerSaleMemory({shows, messages: [
    {sender: "customer", body: "Ngân sách 500k/vé, SĐT 012.345.678."},
    {sender: "customer", body: "Ghế khu B có giá 650.000đ đúng không?"},
    {sender: "customer", body: "Có khuyến mãi hoặc giao lưu với ca sĩ không?"},
  ]});
  assert.equal(memory.budgetVnd, 500_000);
  assert.equal(memory.budgetBasis, "per_ticket");
  assert.equal(memory.zone, "B");
  assert.deepEqual(memory.intents, ["price", "seat_view", "interaction", "promotion"]);
});

test("uses an assistant budget question to understand shorthand and budget basis corrections", () => {
  const memory = deriveMessengerSaleMemory({shows, messages: [
    {sender: "customer", body: "Em mua 3 vé."},
    {sender: "ai", body: "Mình dự tính khoảng bao nhiêu cho mỗi vé ạ?"},
    {sender: "customer", body: "500k một vé ạ."},
  ]});
  assert.equal(memory.quantity, 3);
  assert.equal(memory.budgetVnd, 500_000);
  assert.equal(memory.budgetBasis, "per_ticket");
  const corrected = deriveMessengerSaleMemory({shows, previous: memory, messages: [
    {sender: "ai", body: "Ngân sách này là tổng cho cả nhóm hay cho mỗi vé ạ?"},
    {sender: "customer", body: "Tổng ạ."},
  ]});
  assert.equal(corrected.budgetVnd, 500_000);
  assert.equal(corrected.budgetBasis, "total");
});

test("can remove seat constraints and keeps the row letter distinct from a price zone", () => {
  const initial = deriveMessengerSaleMemory({shows, messages: [{sender: "customer", body: "Cho em 2 vé khu B chính diện."}]});
  const relaxed = deriveMessengerSaleMemory({shows, previous: initial, messages: [
    {sender: "customer", body: "Bên nào cũng được, hàng A còn ghế không?"},
  ]});
  assert.equal(relaxed.seatView, undefined);
  assert.equal(relaxed.zone, "B");
  const flexible = deriveMessengerSaleMemory({shows, previous: relaxed, messages: [{sender: "customer", body: "Khu nào cũng được."}]});
  assert.equal(flexible.zone, undefined);
});

test("short preference answers continue seat consultation", () => {
  const memory = deriveMessengerSaleMemory({shows, messages: [
    {sender: "ai", body: "Mình thích bên trái, bên phải hay chính diện ạ?"},
    {sender: "customer", body: "Trái ạ."},
  ]});
  assert.equal(memory.seatView, "left");
  assert.deepEqual(memory.intents, ["seat_view"]);
});

test("an explicit switch to an unknown show drops old pricing scope and outlives the old referral", () => {
  const referral = {ref: "show:khac-viet-2612"};
  const initial = deriveMessengerSaleMemory({shows, referral, previous: {}, messages: [
    {id: 10, sender: "customer", body: "Show này khu B giá bao nhiêu?"},
  ]});
  assert.equal(initial.showId, "khac-viet-2612");
  assert.equal(initial.zone, "B");
  const switched = deriveMessengerSaleMemory({shows, referral, previous: initial, messages: [
    {id: 11, sender: "customer", body: "Không xem Khắc Việt nữa, đổi sang show Mỹ Tâm, giá bao nhiêu?"},
  ]});
  assert.equal(switched.showId, undefined);
  assert.equal(switched.zone, undefined);
  assert.equal(switched.showSelectionUnresolved, true);
  assert.ok(switched.intents.includes("price"));
  const pending = deriveMessengerSaleMemory({shows, referral, previous: switched, messages: [
    {id: 12, sender: "customer", body: "Còn vé không ạ?"},
  ]});
  assert.equal(pending.showId, undefined);
  const resolved = deriveMessengerSaleMemory({shows, referral, previous: pending, messages: [
    {id: 13, sender: "customer", body: "Đổi sang show Duy Khoa nha."},
  ]});
  assert.equal(resolved.showId, "minh-vuong-0512");
  assert.equal(resolved.showSelectionUnresolved, undefined);
});

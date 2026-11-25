import assert from "node:assert/strict";
import { test } from "node:test";
import { initial21, daysToShow, simulateExtra21 } from "../lib/ai-sale-extra-2-1.ts";

const check = (scenario, changes = {}) => simulateExtra21({ ...initial21, scenario, ...changes });
test("D-1 compares Vietnam calendar dates", () => {
  assert.equal(daysToShow("2026-11-27", "2026-11-28"), 1);
  assert.equal(daysToShow("2026-11-28", "2026-11-28"), 0);
  assert.equal(check("day_before").eligible, true);
  assert.equal(check("day_before", { today: "2026-11-25" }).eligible, false);
});
test("paid customer receives support rather than new purchase pitch", () => {
  const value = check("day_before");
  assert.match(value.message, /cần bên em hỗ trợ/);
  assert.match(value.message, /đặt thêm vé/);
  assert.doesNotMatch(value.message, /đã sắp xếp được thời gian chưa/);
});
test("unpaid customer requires allowed marketing response", () => {
  const blocked = check("day_before", { ticketState: "not_purchased", paymentVerified: false, withinMessengerWindow: false });
  assert.equal(blocked.eligible, false);
  const allowed = check("day_before", { ticketState: "not_purchased", paymentVerified: false, withinMessengerWindow: false, marketingOptIn: true });
  assert.match(allowed.message, /hỗ trợ đặt vé/);
});
test("pending payment never asks to pay twice", () => {
  const value = check("day_before", { ticketState: "pending", paymentVerified: false });
  assert.match(value.message, /đối soát/);
  assert.doesNotMatch(value.message, /mua thêm vé/);
});
test("three-minute follow-up only occurs once for an unanswered AI sales reply", () => {
  const base = { ticketState: "not_purchased", paymentVerified: false };
  assert.equal(check("three_min", { ...base, minutesSilent: 2 }).eligible, false);
  assert.equal(check("three_min", { ...base, minutesSilent: 3 }).eligible, true);
  assert.equal(check("three_min", { ...base, lastSpeaker: "customer" }).eligible, false);
  assert.equal(check("three_min", { ...base, reminderAlreadySent: true }).eligible, false);
  assert.equal(check("three_min", { ...base, humanHandling: true }).eligible, false);
  assert.equal(check("three_min", { ...base, optedOut: true }).eligible, false);
});
test("after purchase requires verified paid status", () => {
  assert.equal(check("after_purchase", { paymentVerified: false }).eligible, false);
  assert.match(check("after_purchase").message, /mã QR/);
  assert.match(check("after_purchase").message, /khi ban tổ chức xác nhận/);
});
test("show-day weather never claims current conditions without verification", () => {
  assert.match(check("show_day", { today: "2026-11-28" }).message, /có thể lạnh/);
  const rain = check("show_day", { today: "2026-11-28", forecastVerified: true, rainForecast: true });
  assert.match(rain.message, /căng tăng che mưa/);
  assert.doesNotMatch(rain.message, /căng bạt/);
  const uncertain = check("weather");
  assert.equal(uncertain.eligible, false);
});
test("complaints get empathetic human handoff without invented hotline", () => {
  const value = check("complaint");
  assert.equal(value.action, "simulate_handoff");
  assert.doesNotMatch(value.message, /\+84\d|1900\d/);
  assert.match(check("complaint", { verifiedHotline: "0987654321" }).message, /0987654321/);
});
test("voice requires consent and configured channel", () => {
  assert.equal(check("voice", { audioChannelReady: true }).eligible, false);
  assert.equal(check("voice", { voiceConsent: true }).eligible, false);
  assert.equal(check("voice", { voiceConsent: true, audioChannelReady: true }).eligible, true);
});
test("seat-map attachments require exactly two authorized HTTPS urls", () => {
  assert.equal(check("images").eligible, false);
  assert.equal(check("images", { seatMapUrls: ["http://example.com/a.png", "https://example.com/b.png"] }).eligible, false);
  const value = check("images", { seatMapUrls: ["https://example.com/a.png", "https://example.com/b.png"] });
  assert.equal(value.attachments.length, 2);
  assert.equal(value.eligible, true);
});
test("no outreach after opt-out or staff handover", () => {
  for (const scenario of ["three_min", "day_before", "after_purchase", "after_show"]) {
    assert.equal(check(scenario, { optedOut: true }).eligible, false);
    assert.equal(check(scenario, { humanHandling: true }).eligible, false);
  }
});

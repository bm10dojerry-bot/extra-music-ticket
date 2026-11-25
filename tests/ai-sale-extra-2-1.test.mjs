import assert from "node:assert/strict";
import { test } from "node:test";
import { requestedSeatMaps } from "../lib/messenger-sale-media.ts";
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
  assert.match(check("after_purchase").message, /15 phút.*đăng ký với Ban Tổ chức/u);
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
test("artist photos are a 15 minute session after the show and registration is through the organizer", () => {
  for (const [scenario,changes] of [["after_purchase",{}],["day_before",{}],["show_day",{today:initial21.showDate}],["photo_reminder",{}],["day_before",{ticketState:"not_purchased"}]]) {
    const value = check(scenario, changes);
    assert.match(value.message, /Sau khi đêm nhạc kết thúc.*15 phút.*chụp ảnh cùng ca sĩ.*đăng ký với Ban Tổ chức/u);
    assert.doesNotMatch(check(scenario,{...changes,photoNoticeAlreadySent:true}).message,/15 phút/);
  }
  for (const change of [{paymentVerified:false},{ticketState:"pending"},{ticketState:"cancelled"},{today:"2026-11-29"},{optedOut:true},{reminderAlreadySent:true},{withinMessengerWindow:false}]) {
    assert.equal(check("photo_reminder",change).eligible,false);
  }
});
test("image preview selects verified originals for exactly the requested venue", () => {
  assert.equal(check("images").eligible,false);
  const availableMaps = ["ccc","laocai"];
  for (const [requestedMap,expected] of [["ccc",["CCC Sa Pa · 550 ghế"]],["laocai",["Lào Cai · 600 ghế"]],["both",["CCC Sa Pa · 550 ghế","Lào Cai · 600 ghế"]]]) {
    assert.deepEqual(check("images",{requestedMap,availableMaps}).attachments,expected);
  }
  assert.deepEqual(check("images",{requestedMap:"both",availableMaps:["laocai"]}).attachments,["Lào Cai · 600 ghế"]);
  assert.equal(check("images",{availableMaps,withinMessengerWindow:false}).eligible,false);
});
test("Messenger distinguishes the venue, artist photos and the pronoun anh", () => {
  assert.deepEqual(requestedSeatMaps("Cho anh xin sơ đồ CCC Sa Pa, Lào Cai","laocai"),["ccc"]);
  assert.deepEqual(requestedSeatMaps("Cho xem sơ đồ Lào Cai","ccc"),["laocai"]);
  assert.deepEqual(requestedSeatMaps("Cho xem sơ đồ CCC và Lào Cai"),["ccc","laocai"]);
  assert.deepEqual(requestedSeatMaps("Gửi em cả hai sơ đồ"),["ccc","laocai"]);
  assert.deepEqual(requestedSeatMaps("Cho em xin sơ đồ","moana"),[]);
  assert.deepEqual(requestedSeatMaps("Cho mình xin sơ đồ","ccc"),["ccc"]);
  assert.deepEqual(requestedSeatMaps("Gửi sơ đồ Moana Sa Pa, Lào Cai","ccc"),[]);
  assert.deepEqual(requestedSeatMaps("Gửi sơ đồ Sa Pa","laocai"),[]);
  assert.deepEqual(requestedSeatMaps("Cho anh hỏi giá vé","ccc"),[]);
  assert.deepEqual(requestedSeatMaps("Em muốn đăng ký chụp ảnh cùng ca sĩ","ccc"),[]);
  assert.deepEqual(requestedSeatMaps("Cho xem ảnh ca sĩ","ccc"),[]);
});
test("no outreach after opt-out or staff handover", () => {
  for (const scenario of ["three_min", "day_before", "after_purchase", "after_show"]) {
    assert.equal(check(scenario, { optedOut: true }).eligible, false);
    assert.equal(check(scenario, { humanHandling: true }).eligible, false);
  }
});

test("map history is venue-specific; explicit resend is opt-in", () => {
  const settings = {availableMaps:["ccc","laocai"], mapsAlreadySent:["ccc"], requestedMap:"both"};
  const onlyNew = check("images",settings);
  assert.equal(onlyNew.attachments.length,1);
  assert.match(onlyNew.attachments[0],/Lào Cai/);
  const repeat = check("images",{...settings,requestedMap:"ccc"});
  assert.deepEqual(repeat.attachments,[]);
  assert.match(repeat.message,/gần sân khấu/);
  assert.equal(check("images",{...settings,resendRequested:true}).attachments.length,2);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applicablePromotions, openingMessage, promotionMessage, seatViewQuestion } from "../lib/extra-sale-text-script";

test("opening uses a safe Facebook name and time of day without assuming salutation", () => {
  const first = openingMessage({ displayName: "Minh", localHour: 20, greeted: false, aiDisclosed: false });
  assert.match(first!, /chào Minh/);
  assert.match(first!, /buổi tối/);
  assert.match(first!, /công nghệ AI/);
  assert.doesNotMatch(first!, /anh Minh|chị Minh/);
  const unsafe = openingMessage({ displayName: "https://example.test", localHour: 7, greeted: false, aiDisclosed: true });
  assert.match(unsafe!, /chào mình.*buổi sáng/);
  assert.doesNotMatch(unsafe!, /https|công nghệ AI/);
});

test("a human greeting does not prevent one AI disclosure", () => {
  const firstAi = openingMessage({ localHour: 20, greeted: true, aiDisclosed: false });
  assert.match(firstAi!, /công nghệ AI/);
  assert.doesNotMatch(firstAi!, /chào|buổi tối/);
  assert.equal(openingMessage({ localHour: 20, greeted: true, aiDisclosed: true }), null);
});

test("seat question asks audience view and dated promotions must apply to the given show", () => {
  assert.match(seatViewQuestion, /bên trái, bên phải hay chính diện/);
  const promotion = { title: "Ưu đãi hợp lệ", active: true, showId: "show-a", terms: "Điều kiện rõ ràng", startsAt: "2026-11-20T00:00:00.000Z", expiresAt: "2026-11-25T00:00:00.000Z" };
  const now = new Date("2026-11-24T00:00:00.000Z");
  const promos = [promotion, { ...promotion, active: false }, { ...promotion, showId: "show-b" },
    { ...promotion, startsAt: "2026-11-24T00:00:00.001Z" }, { ...promotion, expiresAt: now.toISOString() }];
  assert.deepEqual(applicablePromotions(promos, "show-a", now), [promotion]);
  assert.match(promotionMessage([], "show-a", now), /chưa xác minh/);
});

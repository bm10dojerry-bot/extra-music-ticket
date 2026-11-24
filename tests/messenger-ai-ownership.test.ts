import {describe,it,expect} from "vitest";
import {initialOwnership,humanIntervened,requestHuman,clearHumanRequest,shouldAiResume,resumeAi,canAiSend} from "../lib/messenger-ai-ownership";

describe("AI-first Messenger ownership",()=>{
 it("starts with AI, not Sale",()=>{expect(canAiSend(initialOwnership)).toBe(true)});
 it("pauses on human intervention and resumes only after 180 seconds",()=>{
  const at=humanIntervened(initialOwnership,"2026-11-25T03:00:00.000Z");
  expect(canAiSend(at)).toBe(false);
  expect(shouldAiResume(at,"2026-11-25T03:02:59.999Z")).toBe(false);
  expect(shouldAiResume(at,"2026-11-25T03:03:00.000Z")).toBe(true);
  expect(canAiSend(resumeAi(at,"2026-11-25T03:03:00.000Z"))).toBe(true);
 });
 it("resets inactivity after another human action",()=>{
  const first=humanIntervened(initialOwnership,"2026-11-25T03:00:00Z");
  const second=humanIntervened(first,"2026-11-25T03:02:00Z");
  expect(shouldAiResume(second,"2026-11-25T03:03:00Z")).toBe(false);
  expect(shouldAiResume(second,"2026-11-25T03:05:00Z")).toBe(true);
 });
 it("never resumes automatically when customer explicitly requests a human",()=>{
  const state=requestHuman(humanIntervened(initialOwnership,"2026-11-25T03:00:00Z"));
  expect(shouldAiResume(state,"2026-11-25T04:00:00Z")).toBe(false);
  expect(shouldAiResume(clearHumanRequest(state),"2026-11-25T04:00:00Z")).toBe(true);
 });
 it("does not resume on invalid or backward clock",()=>{
  const state=humanIntervened(initialOwnership,"2026-11-25T03:00:00Z");
  expect(shouldAiResume(state,"bad")).toBe(false);
  expect(shouldAiResume(state,"2026-11-25T02:59:59Z")).toBe(false);
 });
});

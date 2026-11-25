// Standalone TypeScript assertions; run with a TS-capable test runner.
import {initialOwnership,humanIntervened,requestHuman,clearHumanRequest,shouldAiResume,resumeAi,canAiSend} from "../lib/messenger-ai-ownership";
function assert(value:boolean,label:string){if(!value)throw Error(label)}
assert(canAiSend(initialOwnership),"AI starts as owner");
const at=humanIntervened(initialOwnership,"2026-11-25T03:00:00.000Z");
assert(!canAiSend(at),"human pauses AI");
assert(!shouldAiResume(at,"2026-11-25T03:02:59.999Z"),"no early resumption");
assert(shouldAiResume(at,"2026-11-25T03:03:00.000Z"),"resumes at 180 seconds");
assert(canAiSend(resumeAi(at,"2026-11-25T03:03:00.000Z")),"AI resumes");
const second=humanIntervened(at,"2026-11-25T03:02:00Z");
assert(!shouldAiResume(second,"2026-11-25T03:03:00Z"),"human activity resets clock");
assert(shouldAiResume(second,"2026-11-25T03:05:00Z"),"resumes after new timeout");
const requested=requestHuman(at);
assert(!shouldAiResume(requested,"2026-11-25T04:00:00Z"),"human request blocks AI");
assert(shouldAiResume(clearHumanRequest(requested),"2026-11-25T04:00:00Z"),"cleared request permits AI");
assert(!shouldAiResume(at,"bad"),"invalid time blocked");

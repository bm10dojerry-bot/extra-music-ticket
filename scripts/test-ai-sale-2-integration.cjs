"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const policy=fs.readFileSync("lib/ai-sales-consultation.ts","utf8");
const worker=fs.readFileSync("lib/ai-sales.ts","utf8");
test("AI Sale 2.0 instructions are in the actual production consultation policy",()=>{
for(const term of ["sát sân khấu","góc nhìn","ghế xám","đã thanh toán","hai ảnh sơ đồ"]){assert(policy.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi")),"missing "+term)}
assert(worker.includes("consultationPolicy"));
});
test("payment, booking, ticket and queue protections remain in the production worker",()=>{
for(const symbol of ["getAiSeatOptions","reserveAiQuote","getAiOrderStatus","deliverTickets"]){assert(worker.includes(symbol),symbol)}
});

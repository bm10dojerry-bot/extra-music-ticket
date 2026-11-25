"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),test=require("node:test");
const ts=require("typescript");
const source=fs.readFileSync("lib/facebook-messenger.ts","utf8");
const marker="export function startMessengerTyping(";
assert.equal(source.split(marker).length,2);
const helper=source.slice(source.indexOf(marker));
const compiled=ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sample={pageId:"123456789",apiVersion:"v24.0",pageToken:"synthetic-only"};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(getConfig=async()=>sample,fail=false){
 const calls=[],exports={};
 const fetch=async(url,opts)=>{
  const b=JSON.parse(opts.body);
  assert.equal(url,"https://graph.facebook.com/v24.0/123456789/messages");
  assert.equal(opts.redirect,"error");
  assert.equal(opts.headers.Authorization,"Bearer synthetic-only");
  assert.equal(b.recipient.id,"1234567890");
  assert.ok(!("message" in b));
  calls.push(b.sender_action);
  if(fail)throw Error("synthetic failure");
  return {ok:true};
 };
 new Function("exports","getMessengerGraphConfig","fetch","AbortSignal","setTimeout","clearTimeout",compiled)(exports,getConfig,fetch,AbortSignal,setTimeout,clearTimeout);
 return {start:exports.startMessengerTyping,calls};
}
test("typing on then off",async()=>{
 const h=harness(),finish=h.start("1234567890");
 await turn();assert.deepEqual(h.calls,["typing_on"]);
 await finish();assert.deepEqual(h.calls,["typing_on","typing_off"]);
});
test("stop before Page credential resolves prevents late typing",async()=>{
 let release;
 const h=harness(()=>new Promise(r=>{release=r;}));
 const finish=h.start("1234567890");await finish();
 release(sample);await turn();assert.deepEqual(h.calls,[]);
});
test("invalid recipient is ignored",async()=>{
 const h=harness(),finish=h.start("");await finish();await turn();assert.deepEqual(h.calls,[]);
});
test("missing credential is harmless",async()=>{
 const h=harness(async()=>null),finish=h.start("1234567890");
 await turn();await finish();assert.deepEqual(h.calls,[]);
});
test("failed request never throws into sales worker",async()=>{
 const h=harness(undefined,true),finish=h.start("1234567890");
 await turn();await finish();assert.deepEqual(h.calls,["typing_on","typing_off"]);
});
test("cleanup is idempotent",async()=>{
 const h=harness(),finish=h.start("1234567890");
 await turn();await finish();await finish();
 assert.deepEqual(h.calls,["typing_on","typing_off"]);
});
test("worker wiring preserves paid branch and guards",()=>{
 const worker=fs.readFileSync("lib/ai-sales.ts","utf8");
 assert.match(worker,/if\(job.kind==="paid_ticket"&&job.order_code\)await handlePaid\(job,chat,job.order_code\)/);
 assert.match(worker,/await guard\(job\);\s*const finishTyping=startMessengerTyping\(chat.ai_mode==="auto"&&withinMessengerReplyWindow/);
 assert.match(worker,/try\{await handleInbound\(job,chat\);\}finally\{await finishTyping\(\);\}/);
});

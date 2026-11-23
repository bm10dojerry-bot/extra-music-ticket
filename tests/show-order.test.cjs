// Pure ordering regressions for homepage show cards. No browser or external data.
// Run: node --test tests/show-order.test.cjs
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");

const filename=path.resolve(__dirname,"../lib/show-order.ts");
const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(source.outputText,filename);
const {orderShowsByDate,vietnamDateISO}=loaded.exports;
const ids=shows=>shows.map(show=>show.id);
const show=(id,date,time="19:30",status="announced")=>({id,date,time,status});

test("Vietnam's ISO date rolls over at 17:00 UTC regardless of locale date ordering",()=>{
 assert.equal(vietnamDateISO(new Date("2026-11-23T16:59:59Z")),"2026-11-23");
 assert.equal(vietnamDateISO(new Date("2026-11-23T17:00:00Z")),"2026-11-24");
});

test("today and upcoming shows come first chronologically, followed by recent past and ended shows",()=>{
 const input=[
  show("far","2026-12-31"),
  show("old","2026-10-01"),
  show("tomorrow","2026-11-24"),
  show("ended-future","2027-01-01","20:00","ended"),
  show("today-late","2026-11-23","21:00"),
  show("yesterday","2026-11-22"),
  show("today-early","2026-11-23","18:30"),
 ];
 assert.deepEqual(ids(orderShowsByDate(input,"2026-11-23")),["today-early","today-late","tomorrow","far","ended-future","yesterday","old"]);
});

test("same-day times include seconds and invalid or missing times remain last",()=>{
 const input=[
  show("unknown","2026-11-24",""),
  show("later","2026-11-24","20:00"),
  show("seconds","2026-11-24","19:30:01"),
  show("minute","2026-11-24","19:30"),
  show("equal-seconds","2026-11-24","19:30:00"),
  show("invalid-hour","2026-11-24","24:00"),
  show("invalid-minute","2026-11-24","19:60"),
  show("invalid-second","2026-11-24","19:30:60"),
  {id:"missing",date:"2026-11-24"},
 ];
 assert.deepEqual(ids(orderShowsByDate(input,"2026-11-23")),["minute","equal-seconds","seconds","later","unknown","invalid-hour","invalid-minute","invalid-second","missing"]);
});

test("past shows use descending performance times while unknown times still stay last",()=>{
 const input=[
  show("unknown","2026-11-22","invalid"),
  show("early","2026-11-22","18:00"),
  show("late","2026-11-22","22:00"),
  show("seconds","2026-11-22","18:00:01"),
 ];
 assert.deepEqual(ids(orderShowsByDate(input,"2026-11-23")),["late","seconds","early","unknown"]);
});

test("invalid calendar dates stay last in input order and valid leap days remain sortable",()=>{
 const input=[
  show("non-leap","2026-02-29"),
  show("valid-leap","2024-02-29"),
  show("invalid-month","2026-13-01"),
  show("upcoming","2026-11-24"),
  show("invalid-day","2026-04-31"),
  show("missing-padding","2026-2-03"),
 ];
 assert.deepEqual(ids(orderShowsByDate(input,"2026-11-23")),["upcoming","valid-leap","non-leap","invalid-month","invalid-day","missing-padding"]);
});

test("sorting preserves input data, exact ties, object identities and all show statuses",()=>{
 const input=Object.freeze([
  Object.freeze(show("late","2026-12-01","20:00","sold_out")),
  Object.freeze(show("first-tie","2026-11-24","19:30","hidden")),
  Object.freeze(show("second-tie","2026-11-24","19:30","pending")),
  Object.freeze(show("third-tie","2026-11-24","19:30:00","live")),
 ]);
 const before=JSON.stringify(input),result=orderShowsByDate(input,"2026-11-23");
 assert.notEqual(result,input);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(ids(result),["first-tie","second-tie","third-tie","late"]);
 assert.equal(result.length,input.length);
 for(const item of result)assert.equal(item,input.find(original=>original.id===item.id));
});

test("omitting today gives a deterministic date order without consulting the viewer's current day",()=>{
 const input=[show("future","2099-01-01"),show("past","2000-01-01"),show("ended","2100-01-01","19:30","ended")];
 const expected=["past","future","ended"];
 assert.deepEqual(ids(orderShowsByDate(input)),expected);
 assert.deepEqual(ids(orderShowsByDate(input,"")),expected);
 assert.deepEqual(ids(orderShowsByDate(input,"not-a-date")),expected);
 assert.deepEqual(ids(orderShowsByDate(input,"2026-02-30")),expected);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const modules = new Map();
function load(name) {
  if(modules.has(name))return modules.get(name);
  const file=path.resolve("lib",name+".ts");
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  new Function("require","module","exports",code)(dep=>load(dep),m,m.exports);
  modules.set(name,m.exports);
  return m.exports;
}
const c=load("ai-sales-consultation");
const show={id:"dinh-dung-2811",artist:"Đình Dũng",title:"Đêm Đình Dũng",date:"2026-11-28",time:"19:30",venueId:"ccc",venueName:"CCC Sa Pa",venueAddress:"Sa Pa",prices:{A:599000,B:499000,C:399000,D:299000}};
function reply(lines,ref){return c.directTierReply(lines.map(body=>({sender:"customer",body})),ref,async()=>[show]);}
test("asks B and venue on Messenger",async()=>{
 const r=await reply(["Cho mình hỏi show Đình Dũng ngày 28/11 diễn ở đâu và giá vé hạng B cho một người là bao nhiêu ạ? Mình chỉ tham khảo giá."]);
 assert.match(r,/499\.000đ\/vé/);assert.match(r,/CCC Sa Pa/);assert.doesNotMatch(r,/Hạng [ACD]|mấy người|ưu đãi|giữ ghế/);
});
test("uses prior show and verified referrals",async()=>{
 assert.match(await reply(["Đình Dũng","Vé hạng B giá bao nhiêu?"]),/499\.000/);
 assert.match(await reply(["Giá vé hạng B?"],show.id),/499\.000/);
 assert.equal(await reply(["Giá vé hạng B?"],"unknown"),null);
 assert.equal(await reply(["Giá vé hạng B?"]),null);
});
test("requests all or several tiers; does not confuse row and rank",()=>{
 assert.deepEqual(c.askedTiers("Hàng B xem thế nào?"),[]);
 assert.deepEqual(c.askedTiers("Giá hạng A, B và D?"),["A","B","D"]);
 assert.doesNotMatch(c.priceLines(show,"Giá hạng A và B?"),/Hạng [CD]/);
 assert.match(c.priceLines(show,"gửi bảng giá tất cả các hạng","B"),/Hạng D/);
 assert.doesNotMatch(c.priceLines({...show,prices:{...show.prices,B:null}},"giá hạng B?"),/499|599/);
});
test("declines shortcuts for sales actions, refunds, support or compound questions",async()=>{
 for(const text of ["Đình Dũng giá hạng B còn ghế không?","Đình Dũng giá hạng B và gặp nhân viên","Đình Dũng giá hạng B, giữ ghế cho mình","Đình Dũng giá hạng B có ưu đãi gì?","Đình Dũng giá hạng B, thanh toán sao?"])
  assert.equal(await reply([text]),null,text);
});
test("remembers show, quantity, angle and budget across a staff reply",()=>{
 const m=c.salesPreferences([{sender:"customer",body:"Đình Dũng, mình đi 2 người, thích bên trái, ngân sách 500k mỗi vé."},{sender:"staff",body:"Dạ mình thích khu nào?"},{sender:"customer",body:"Hạng B ạ"}],[show]);
 assert.equal(m.showId,show.id);assert.equal(m.zone,"B");assert.equal(m.seatView,"left");assert.equal(m.quantity,2);assert.equal(m.budgetVnd,500000);assert.equal(m.greeted,true);
});
test("entry points use guards and the consultation rules",()=>{
 const worker=fs.readFileSync("lib/ai-sales.ts","utf8");
 const timer=fs.readFileSync("lib/ai-sales-manual-timeout.ts","utf8");
 const webhook=fs.readFileSync("app/api/meta/messenger/webhook/route.ts","utf8");
 assert.match(worker,/directTierReply\(messages,commentContext/);assert.match(worker,/\$\{consultationPolicy\}/);
 assert.match(worker,/getAiSeatOptions\(showId,quantity,zone,view,maxPerTicket\)/);
 assert.match(timer,/priceLines\(show,question,memory.zone\)/);assert.match(timer,/p_chat_id:chatId\?\?null/);
 assert.match(webhook,/Date.now\(\)\+180050/);assert.match(webhook,/runAiSalesManualTimeout\(chatId\)/);
});

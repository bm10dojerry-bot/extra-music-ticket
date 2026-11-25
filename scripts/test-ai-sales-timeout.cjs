"use strict";const fs=require("node:fs"),ts=require("typescript"),test=require("node:test"),assert=require("node:assert/strict");
function load(p){const code=ts.transpileModule(fs.readFileSync(p,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function("require","module","exports",code)(require,m,m.exports);return m.exports;}
const p=load("lib/ai-sales-timeout-policy.ts");
const m=(id,body,sender="customer")=>({id,body,sender});
test("retains unanswered map after alo",()=>assert.equal(p.selectWaitingQuestion([m(1,"Đình Dũng","staff"),m(2,"cho anh xem sơ đồ ghế nhé"),m(3,"alo")],2,3),"cho anh xem sơ đồ ghế nhé"));
test("does not reuse prior answered message",()=>assert.equal(p.selectWaitingQuestion([m(1,"sơ đồ"),m(2,"đây là sơ đồ","staff"),m(3,"giá vé?")],3,3),"giá vé?"));
test("keeps newest real question",()=>assert.equal(p.selectWaitingQuestion([m(2,"Giá vé?"),m(3,"Còn ghế không?"),m(4,"Alo em")],2,4),"Giá vé?\nCòn ghế không?"));
test("new acknowledgement supersedes request",()=>assert.equal(p.selectWaitingQuestion([m(2,"xin sơ đồ"),m(3,"Ok để anh vào link xem")],2,3),"Ok để anh vào link xem"));
test("missing latest fails closed",()=>assert.equal(p.selectWaitingQuestion([m(2,"xin sơ đồ")],2,3),null));
test("finance and receipt excluded from automatic decisions",()=>{for(const s of ["Anh chuyển khoản rồi","Cho anh mã QR","[Khách gửi ảnh; chưa đọc nội dung ảnh.]","Đổi vé cho anh","Khiếu nại đơn"])assert.equal(p.sensitiveQuestion(s),true,s);assert.equal(p.sensitiveQuestion("Cho anh xem sơ đồ ghế"),false);});
test("recognizes price schedule venue",()=>{assert.equal(p.wantsPrices("Xin giá vé"),true);assert.equal(p.wantsSchedule("Mấy giờ diễn"),true);assert.equal(p.wantsVenue("Địa chỉ ở đâu"),true);});
test("explicit refusal",()=>assert.ok(p.explicitStop("Anh không mua nữa")));
test("no customer private data in free-form prompt",()=>{const s=p.sanitize("EX0123456789ABCDEF 0912345678 someone@example.com https://a.example");assert.ok(!s.includes("EX0123456789ABCDEF")&&!s.includes("0912345678")&&!s.includes("@")&&!s.includes("https://"));});
test("guarded manual ownership and no transaction mutation",()=>{const s=fs.readFileSync("lib/ai-sales-manual-timeout.ts","utf8");assert.ok(!/reserveAiQuote|buildAiQuote|deliverTickets|set_mode|update.*payment_orders/.test(s));assert.match(s,/const v=await verify/);assert.match(s,/finish\("uncertain"/);assert.match(s,/sendMessengerPageImage/);assert.match(s,/second=await verify/);assert.match(s,/getAiOrderStatus\(item.chat_id,orderCode\)/);});
test("scheduled independently",()=>assert.match(fs.readFileSync("app/api/cron/ai-sales/route.ts","utf8"),/runAiSalesManualTimeout\(\)/));

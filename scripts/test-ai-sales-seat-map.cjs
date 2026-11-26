"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),test=require("node:test"),ts=require("typescript"),sharp=require("sharp");
function load(path,mocks={}){const result=ts.transpileModule(fs.readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});const mod={exports:{}};new Function("require","module","exports",result.outputText)(n=>Object.hasOwn(mocks,n)?mocks[n]:require(n),mod,mod.exports);return mod.exports;}
const venues=load("lib/venues.ts"),policy=load("lib/ai-sales-seat-map.ts"),renderer=load("lib/seat-map-image.ts",{"./venues":venues});
const mk=(id,artist,date,venueId)=>({id,artist,date,venueId,url:"https://iextra.net/show/"+id});
const c=mk("dinh-dung-2811","Đình Dũng","2026-11-28","ccc"),l=mk("ho-quang-hieu-2412","Hồ Quang Hiếu","2026-12-24","laocai"),m=mk("minh-vuong-0512","Minh Vương + Duy Khoa","2026-12-05","ccc"),shows=[c,l,m];
const msg=(body,sender="customer")=>({body,sender,staff_name:sender==="staff"?"EXTRA AI":null});
const choose=(latest,history=[],context=null,known=null)=>policy.selectSeatMap(latest,[...history,msg(latest)],shows,context,known);
for(const [q,v] of [["Em ơi có sơ đồ ghế để xem không",true],["Gửi mình sơ đồ CCC",true],["cho xem hình ghế",true],["Không cần sơ đồ ghế",false],["cho xin mã chuyển khoản",false],["giá vé bao nhiêu",false]])test("intent "+q,()=>assert.equal(policy.isSeatMapRequest(q),v));
test("latest named show wins",()=>assert.deepEqual(choose("Sơ đồ Hồ Quang Hiếu",[msg("Đình Dũng")]),{venue:"laocai",show:l}));
test("history context",()=>assert.deepEqual(choose("Cho xem sơ đồ ghế",[msg("Đình Dũng")]),{venue:"ccc",show:c}));
test("known order context",()=>assert.deepEqual(choose("Cho xem sơ đồ ghế",[],null,l.id),{venue:"laocai",show:l}));
test("ad context",()=>assert.deepEqual(choose("Cho xem sơ đồ ghế",[],{artist:"Hồ Quang Hiếu"}),{venue:"laocai",show:l}));
test("explicit venue",()=>assert.deepEqual(choose("Sơ đồ CCC"),{venue:"ccc"}));
test("explicit venue overrides old one",()=>assert.deepEqual(choose("Sơ đồ Lào Cai",[msg("Đình Dũng")]),{venue:"laocai"}));
test("multiple shows different venues require clarification",()=>assert.equal(choose("Sơ đồ Đình Dũng và Hồ Quang Hiếu"),null));
test("no context no guess",()=>assert.equal(choose("Sơ đồ ghế"),null));
test("Moana not swapped to CCC",()=>assert.equal(choose("Sơ đồ Moana"),null));
test("artist alias",()=>assert.equal(choose("Sơ đồ Duy Khoa").show.id,m.id));
test("date",()=>assert.equal(choose("Sơ đồ 24/12").show.id,l.id));
test("plain image no link",()=>assert.ok(!policy.seatMapCaption({venue:"ccc",show:c},false).includes("https://")));
test("availability stays in chat",()=>{assert.equal(policy.wantsSeatAvailability("Sơ đồ ghế còn trống"),true);assert.ok(!policy.seatMapCaption({venue:"laocai",show:l},true).includes(l.url));});
test("no specific show no made-up link",()=>assert.ok(!policy.seatMapCaption({venue:"ccc"},true).includes("https://")));
test("asset links only intended venues",()=>assert.equal(policy.SEAT_MAP_URL("ccc"),"https://iextra.net/api/public/seat-map/ccc"));
for(const [v,count] of [["ccc",550],["laocai",600]])test(v+" geometry and image decode",async()=>{const svg=renderer.renderSeatMapSvg(v);const codes=[...svg.matchAll(/data-seat="([A-O][0-9]{2})"/g)].map(m=>m[1]);assert.equal(codes.length,count);assert.deepEqual(codes,venues.seatsFor(v).map(s=>s.id));assert.match(svg,/Chưa thể hiện ghế trống/);assert.match(svg,v==="ccc"?/rotate\(90 2255 1875\)/:/x="740" y="395"/);assert.ok(!svg.includes("<text"));for(const row of new Set(venues.seatsFor(v).map(s=>s.row)))assert.ok(svg.includes(`data-row="${row}"`));const png=await sharp(Buffer.from(svg)).png().toBuffer();const meta=await sharp(png).metadata();assert.equal(meta.width,v==="ccc"?2400:3600);assert.equal(meta.height,v==="ccc"?3600:2400);});
test("layout overrides applied",()=>{const svg=renderer.renderSeatMapSvg("ccc",{A:40});const codes=[...svg.matchAll(/data-seat="([A-O][0-9]{2})"/g)].map(m=>m[1]);assert.equal(codes.length,540);assert.deepEqual(codes,venues.seatsFor("ccc",{A:40}).map(s=>s.id));});
test("worker uses guarded outbox before quick reply",()=>{const w=fs.readFileSync("lib/ai-sales.ts","utf8");assert.match(w,/seatMapUrl\?"seat-map":action\.purpose/);assert.match(w,/seatMapUrl\?await sendMessengerPageImage/);assert.ok(w.indexOf("isSeatMapRequest(latest.body)")<w.indexOf("const quickReply="));assert.match(w,/error\.ambiguous\)throw error/);assert.match(w,/await extraSendPaymentQr/);});

test("independent registration and blue mark verification through resized JPEG",async()=>{
 for(const venue of ["ccc","laocai"]){
  const seats=venues.seatsFor(venue),showId=venue==="ccc"?"dinh-dung-2811":"ho-quang-hieu-2412";
  const g=renderer.seatMapGeometry(venue,seats,showId);
  const expected=venue==="ccc"?["C26","C27"]:["B10","D31"];
  const dots=g.cells.filter(c=>expected.includes(c.id)).map(c=>'<circle cx="'+c.x+'" cy="'+c.y+'" r="10" fill="#0044ff"/>').join("");
  const svg=renderer.renderSeatMapSvg(venue,{}, {seats,taken:new Set(),title:"Đình Dũng · 28/11/2026",checkedAt:"04:30",showId});
  const jpg=await sharp(Buffer.from(svg.replace("</svg>",dots+"</svg>"))).resize({width:1800,height:1800,fit:"inside"}).jpeg({quality:76}).toBuffer();
  const {data,info}=await sharp(jpg).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});
  const marks=renderer.readSeatMapMarks(data,info.width,info.height);
  assert.ok(marks,venue+" registration");
  assert.deepEqual(renderer.verifySeatMapMarks(marks,venue,seats,showId)?.sort(),expected.sort());
  assert.equal(renderer.verifySeatMapMarks(marks,venue,seats,"different-show"),null);
  assert.equal(renderer.verifySeatMapMarks({...marks,points:[{x:0,y:0}]},venue,seats,showId),null);
  assert.equal(renderer.verifySeatMapMarks({...marks,points:[marks.points[0],marks.points[0]]},venue,seats,showId),null);
  assert.equal(renderer.verifySeatMapMarks({...marks,reference:"00000000"},venue,seats,showId),null);
 }
});

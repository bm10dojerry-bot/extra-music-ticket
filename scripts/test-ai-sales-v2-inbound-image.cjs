"use strict";
const fs=require("node:fs"),ts=require("typescript"),assert=require("node:assert/strict"),test=require("node:test");
const sharp=require("sharp");
function load(file,mocks={}){
 const source=fs.readFileSync(file,"utf8");
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 new Function("require","module","exports",code)(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),mod,mod.exports);
 return mod.exports;
}
const decision=load("lib/ai-sales-receipt-decision.ts");
const code="EX0123456789ABCDEF",owned={code,amount:450000,status:"paid"},receipt={kind:"transfer_receipt",showText:null,multipleShows:false,amount:450000,reference:code};
const cases=[
 ["no image result",null,owned,"unreadable"],
 ["unreadable",{...receipt,kind:"unreadable"},owned,"unreadable"],
 ["poster",{...receipt,kind:"poster"},owned,"other"],
 ["seat map",{...receipt,kind:"seat_map"},owned,"other"],
 ["no linked order",receipt,null,"check_order"],
 ["wrong amount",{...receipt,amount:400000},owned,"mismatch"],
 ["missing amount",{...receipt,amount:null},owned,"mismatch"],
 ["fractional amount",{...receipt,amount:450000.5},owned,"mismatch"],
 ["wrong reference",{...receipt,reference:"EXFFFFFFFFFFFFFFFF"},owned,"mismatch"],
 ["missing reference",{...receipt,reference:null},owned,"mismatch"],
 ["pending",receipt,{...owned,status:"pending"},"pending"],
 ["verified paid",receipt,owned,"paid"],
 ["expired",receipt,{...owned,status:"expired"},"review"],
 ["review",receipt,{...owned,status:"review"},"review"],
 ["unknown status",receipt,{...owned,status:"unknown"},"review"]
];
for(const [name,image,order,expected] of cases)test("decision "+name,()=>assert.equal(decision.decideImageReceipt(image,order),expected));
const policy=load("lib/ai-sales-policy.ts");
test("ordinary text unchanged",()=>assert.equal(policy.incomingMessengerText({text:" giá vé?"}),"giá vé?"));
test("image marked",()=>{delete process.env.EXTRA_AI_SALE_INBOUND_IMAGE;assert.match(policy.incomingMessengerText({attachments:[{type:"image"}]}),/^\[Khách gửi ảnh;/)});
test("caption retained",()=>assert.match(policy.incomingMessengerText({text:"Em gửi rồi",attachments:[{type:"image"}]}),/Em gửi rồi$/));
test("feature kill switch",()=>{process.env.EXTRA_AI_SALE_INBOUND_IMAGE="0";try{assert.equal(policy.incomingMessengerText({text:"Em gửi rồi",attachments:[{type:"image"}]}),"Em gửi rồi");}finally{delete process.env.EXTRA_AI_SALE_INBOUND_IMAGE;}});
test("audio unchanged",()=>assert.doesNotMatch(policy.incomingMessengerText({attachments:[{type:"audio"}]}),/^\[Khách gửi ảnh;/));
const cfg={pageId:"123456789",pageToken:"synthetic-page-token",apiVersion:"v24.0"};
const mid="m_test_receipt",psid="987654321",url="https://scontent.example.fbcdn.net/test.jpg";
const validGraph=()=>({id:mid,from:{id:psid},to:{data:[{id:cfg.pageId}]},attachments:{data:[{image_data:{url}}]}});
let modelCalls=0;
const imageModule=load("lib/ai-sales-inbound-image.ts",{
 "server-only":{},
 "./messenger-show-signals":load("lib/messenger-show-signals.ts",{"server-only":{},"./ai-sales-checkout":{},"./messenger-extra-ad-shows":{},"./staff-auth":{staffDb:async()=>[]}}),
 "./facebook-messenger":{getMessengerGraphConfig:async()=>cfg},
 "./ai-sales-policy":{AI_SALES_MODEL:"test-only"},
 "ai":{Output:{object:x=>x},generateText:async options=>{
  modelCalls++;const part=options.messages[0].content[1];
  assert.equal(part.type,"image");assert.equal(part.mediaType,"image/jpeg");
  assert.equal(part.image[0],255);assert.equal(part.image[1],216);
  return {output:receipt};
 }}
});
for(const [name,value,valid] of [
 ["allowed CDN",url,true],["allowed messenger CDN","https://cdn.fbsbx.com/a",true],
 ["HTTP refused","http://scontent.fbcdn.net/a",false],["foreign host","https://fbcdn.net.evil.example/a",false],
 ["credentialed URL","https://a:b@fbcdn.net/a",false],["local IP","https://127.0.0.1/a",false],["explicit port","https://fbcdn.net:8443/a",false]
])test("URL "+name,()=>assert.equal(Boolean(imageModule.validMessengerImageURL(value)),valid));
test("mock Meta retrieval and real image decode; mock vision",async()=>{
 const image=await sharp({create:{width:32,height:24,channels:3,background:"white"}}).png().toBuffer();
 const original=global.fetch;
 try{
  for(const [name,graph,mime,large,expected,graphStatus] of [
   ["valid",validGraph(),"image/png",false,true,200],
   ["media_url",{...validGraph(),attachments:{data:[{image_data:{media_url:url}}]}},"image/png",false,true,200],
   ["wrong sender",{...validGraph(),from:{id:"111111111"}},"image/png",false,false,200],
   ["wrong recipient",{...validGraph(),to:{data:[{id:"111111111"}]}},"image/png",false,false,200],
   ["wrong message",{...validGraph(),id:"m_other"},"image/png",false,false,200],
   ["multiple images",{...validGraph(),attachments:{data:[{image_data:{url}},{image_data:{url}}]}},"image/png",false,false,200],
   ["unsafe CDN",{...validGraph(),attachments:{data:[{image_data:{url:"https://evil.example/image.png"}}]}},"image/png",false,false,200],
   ["wrong MIME",validGraph(),"text/html",false,false,200],
   ["oversize",validGraph(),"image/png",true,false,200],
   ["Meta permission denied",{},"image/png",false,false,403]
  ]){
   let calls=0;const before=modelCalls;
   global.fetch=async(input,opts)=>{
    calls++;const u=new URL(input);assert.equal(opts.redirect,"error");
    if(u.hostname==="graph.facebook.com"){
     assert.equal(opts.headers.Authorization,"Bearer "+cfg.pageToken);
     return new Response(JSON.stringify(graph),{status:graphStatus,headers:{"content-type":"application/json"}});
    }
    assert.equal(u.hostname,"scontent.example.fbcdn.net");assert.equal(opts.headers,undefined);
    return new Response(image,{headers:{"content-type":mime,"content-length":String(large?7*1024*1024:image.length)}});
   };
   const result=await imageModule.readMessengerImage(mid,psid,cfg.pageId);
   assert.equal(Boolean(result),expected,name);
   assert.equal(modelCalls-before,expected?1:0,name+" vision calls");
   if(expected)assert.deepEqual(result,receipt);
   assert.ok(calls>=1&&calls<=2);
  }
 }finally{global.fetch=original;}
});
test("worker wiring and payment guards",()=>{
 const s=fs.readFileSync("lib/ai-sales.ts","utf8");
 assert.match(s,/process\.env\.EXTRA_AI_SALE_INBOUND_IMAGE!=="0"/);
 assert.match(s,/readMessengerImage\(latest\.external_message_id,chat\.messenger_psid,chat\.messenger_page_id\)/);
 assert.match(s,/getAiOrderStatus\(chat\.id,code\)/);assert.match(s,/decideImageReceipt\(reading,order\)/);
 const b=s.slice(s.indexOf('if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE'),s.indexOf('if(customerDeclined(latest.body)'));
 assert.ok(!/reserveAiQuote|handlePaid|deliverTickets|payment_orders/.test(b));
});

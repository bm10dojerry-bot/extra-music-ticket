const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const vm=require("node:vm");
function load(rel, overrides={}){
 const source=fs.readFileSync(path.join(__dirname,"..",rel),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 const context={module:mod,exports:mod.exports,require:(id)=>id in overrides?overrides[id]:require(id),process:{env:process.env},fetch:globalThis.fetch,AbortSignal,URLSearchParams,console};
 vm.runInNewContext(js,context,{filename:rel});
 return mod.exports;
}
const policy=load("lib/ai-sales-timeout-policy.ts");
const guide=load("lib/messenger-maps-guide.ts",{"server-only":{},"./ai-sales-timeout-policy":policy});
const moana={id:"moana",name:"Moana Sa Pa",address:"68 Violet, Sa Pa, Lào Cai",city:"Sa Pa"};
const ccc={id:"ccc",name:"Không gian Văn hóa Sa Pa – CCC",address:"002 Phan Xi Păng, Sa Pa, Lào Cai",city:"Sa Pa"};
const laocai={id:"laocai",name:"+1 Extra Music Show Lào Cai",address:"FXGV+68P, Phú Thịnh, Cam Đường, Lào Cai",city:"Lào Cai"};
const cases=[
 ["Khách sạn Hoàng Gia có gần sân khấu không?",moana,"Khách sạn Hoàng Gia"],
 ["Sun Plaza cách sân khấu bao xa nếu đi bộ?",ccc,"Sun Plaza"],
 ["Bến xe Lào Cai cách sân khấu bao xa?",laocai,"Bến xe Lào Cai"]
];
test("sale23 recognizes public locations and fixes the Lao Cai destination",()=>{
 for(const [q,v,origin] of cases){assert.equal(guide.wantsMapDistance(q),true);assert.equal(guide.extractOrigin(q),origin);}
 assert.equal(guide.wantsMapDistance("Ghế gần sân khấu không?"),false);
 assert.match(new URL(guide.directionUrl(laocai)).searchParams.get("destination"),/FXGV\+68P/);
});
const live=process.env.VERCEL_ENV==="preview"&&process.env.VERCEL_GIT_COMMIT_REF==="feature/ai-sale23-maps";
test("sale23 live Places and Routes smoke test (isolated preview only)",{skip:!live},async()=>{
 assert.ok(process.env.GOOGLE_MAPS_API_KEY,"Google Maps preview key missing");
 const results=await Promise.all(cases.map(async([q,v])=>{
  const started=Date.now();const reply=await guide.mapDistanceReply(q,v);
  const route=/khoảng .*?(?: km| m), .*?phút theo Google Maps/.test(reply);
  console.log("SALE23_MAP_SMOKE "+JSON.stringify({question:q,venue:v.id,status:route?"ROUTE_OK":reply.includes("chưa xác định được đúng")?"CLARIFY":"FALLBACK",elapsedMs:Date.now()-started,reply}));
  return route;
 }));
 assert.ok(results.some(Boolean),"No live route resolved; verify Maps permissions and venue matching");
});

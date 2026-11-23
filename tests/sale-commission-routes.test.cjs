// Execute the current Next route and tier validator, transpiled in memory.
// Mock only auth/database boundaries. No real credentials, database or network.
// Run: node --test tests/sale-commission-routes.test.cjs
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");

const repo=path.resolve(__dirname,"..");
function loadSource(relative){
 const filename=path.join(repo,relative);
 const loaded=new Module(filename,module);
 loaded.filename=filename;
 loaded.paths=Module._nodeModulePaths(path.dirname(filename));
 const result=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
  fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
 });
 loaded._compile(result.outputText,filename);
 return loaded.exports;
}

test("actual Admin commission route validates and isolates per-show policy writes",async t=>{
 const originalLoad=Module._load,originalFetch=global.fetch,originalError=console.error;
 const core=loadSource("lib/sale-commission.ts");
 const {NextRequest}=require("next/server");
 const origin="https://admin.synthetic.invalid";
 const alpha="synthetic-show-alpha",beta="synthetic-show-beta",fresh="synthetic-show-new";
 const uuidAlpha="00000000-0000-4000-8000-000000000001";
 const uuidBeta="abcdefab-cdef-4abc-8def-abcdefabcdef";
 const shows=new Set([alpha,beta,fresh]);
 const policies=new Map([alpha,beta].map((showId,index)=>[showId,{
  ...core.defaultSaleCommissionPolicy(showId),source:"show",version:index===0?uuidAlpha:uuidBeta,
  updatedAt:"2030-01-15T12:00:00.000Z",updatedBy:"Synthetic seed",
 }]));
 const clone=value=>structuredClone(value);
 const role=name=>({id:"synthetic-actor",username:"synthetic-user",display_name:"Synthetic Admin",role:name,active:true});
 let actor=role("admin"),mode="normal",serial=20;
 const showReads=[],policyReads=[],writes=[],authCalls=[],logged=[];
 let networkCalls=0;
 const counts=()=>[showReads.length,policyReads.length,writes.length];
 const body=(showId=alpha,version=policies.get(showId)?.version??null,tiers=[{maxTickets:10,rate:15},{maxTickets:30,rate:18},{maxTickets:50,rate:22},{maxTickets:550,rate:25}])=>({showId,tiers,version});
 const getRequest=showId=>new NextRequest(origin+"/api/admin/sale-commission"+(showId===undefined?"":"?showId="+encodeURIComponent(showId)));
 const patchRequest=(value,options={})=>{
  const headers=new Headers({origin,"content-type":"application/json"});
  if(Object.hasOwn(options,"origin")){if(options.origin===null)headers.delete("origin");else headers.set("origin",options.origin);}
  if(Object.hasOwn(options,"contentType")){if(options.contentType===null)headers.delete("content-type");else headers.set("content-type",options.contentType);}
  return new NextRequest(origin+"/api/admin/sale-commission",{method:"PATCH",headers,body:Object.hasOwn(options,"raw")?options.raw:JSON.stringify(value)});
 };
 const staffDb=async(request,init={})=>{
  assert.equal(init.method||"GET","GET","show existence check must not mutate database");
  const url=new URL("https://db.synthetic.invalid/"+request);
  assert.equal(url.pathname,"/managed_shows");
  assert.equal(url.searchParams.get("select"),"id");
  assert.equal(url.searchParams.get("limit"),"1");
  assert.deepEqual([...url.searchParams.keys()].sort(),["id","limit","select"]);
  const filter=url.searchParams.get("id");assert.match(filter,/^eq\.[a-z0-9-]+$/);
  const showId=filter.slice(3);showReads.push(showId);
  if(mode==="show-error")throw Error("synthetic-private-db-detail");
  return shows.has(showId)?[{id:showId}]:[];
 };
 Module._load=function(request,parent,isMain){
  if(request==="server-only")return {};
  if(/(?:^|\/)staff-auth(?:\.js)?$/.test(request))return {
   staffDb,requireRole:async roles=>{authCalls.push([...roles]);return actor&&roles.includes(actor.role)?actor:null;},
  };
  if(/(?:^|\/)sale-commission-db(?:\.js)?$/.test(request))return {
   getSaleCommissionPolicy:async showId=>{
    policyReads.push(showId);
    if(mode==="load-error")throw Error("synthetic-private-policy-detail");
    return clone(policies.get(showId)||core.defaultSaleCommissionPolicy(showId));
   },
   saveSaleCommissionPolicy:async(showId,tiers,version,updatedBy)=>{
    writes.push(clone({showId,tiers,version,updatedBy}));
    if(mode==="save-error")throw Error("synthetic-private-save-detail");
    const existing=policies.get(showId);
    if(version===null?Boolean(existing):!existing||existing.version.toLowerCase()!==version.toLowerCase())return null;
    const policy={showId,tiers:clone(tiers),version:"00000000-0000-4000-8000-"+String(++serial).padStart(12,"0"),
     updatedAt:"2030-01-16T12:00:00.000Z",updatedBy,source:"show"};
    policies.set(showId,policy);return clone(policy);
   },
  };
  if(/(?:^|\/)sale-commission(?:\.js)?$/.test(request))return core;
  return originalLoad.apply(this,arguments);
 };
 global.fetch=async()=>{networkCalls++;throw Error("Network is forbidden in synthetic commission tests");};
 console.error=(...args)=>logged.push(args);
 try{
  const route=loadSource("app/api/admin/sale-commission/route.ts");
  async function checked(response,status){
   assert.equal(response.status,status);assert.equal(response.headers.get("cache-control"),"no-store");
   return response.json();
  }
  await t.test("Admin-only auth rejects anonymous and every staff role before data access",async()=>{
   for(const denied of [null,"sale","show_manager","accountant","checkin"]){
    actor=denied?role(denied):null;
    await checked(await route.GET(getRequest(alpha)),403);
    await checked(await route.PATCH(patchRequest(body())),403);
   }
   assert.deepEqual(counts(),[0,0,0]);
   assert(authCalls.every(roles=>roles.length===1&&roles[0]==="admin"));
   actor=role("admin");
  });
  await t.test("mutations require an exact same-origin request and JSON content type",async()=>{
   const before=counts();
   for(const requestOrigin of [null,"null","https://evil.synthetic.invalid","https://sale.synthetic.invalid",origin+".evil.invalid",origin+":444"])
    await checked(await route.PATCH(patchRequest(body(),{origin:requestOrigin})),403);
   for(const contentType of [null,"text/plain","application/x-www-form-urlencoded"])
    await checked(await route.PATCH(patchRequest(body(),{contentType})),415);
   assert.deepEqual(counts(),before);
  });
  await t.test("malformed JSON, non-object bodies and invalid show identifiers fail before reads",async()=>{
   const before=counts();
   await checked(await route.PATCH(patchRequest(null,{raw:"{"})),400);
   for(const value of [null,[],"not-an-object",7,true])await checked(await route.PATCH(patchRequest(value)),400);
   for(const showId of ["","ab","Synthetic-Show","show id","show&version=eq.any", "a".repeat(101)]){
    await checked(await route.GET(getRequest(showId)),400);
    await checked(await route.PATCH(patchRequest({...body(),showId})),400);
   }
   await checked(await route.GET(getRequest()),400);
   const missing=body();delete missing.showId;
   await checked(await route.PATCH(patchRequest(missing)),400);
   assert.deepEqual(counts(),before);
  });
  await t.test("tier limits, ordered integral thresholds and bounded two-decimal rates are enforced",async()=>{
   const before=counts();
   const invalid=[undefined,null,{},[],Array.from({length:13},(_,i)=>({maxTickets:i+1,rate:15})),[null],[[]],[15],
    [{rate:15}],[{maxTickets:10}],[{maxTickets:"10",rate:15}],[{maxTickets:10,rate:"15"}],
    [{maxTickets:0,rate:15}],[{maxTickets:-1,rate:15}],[{maxTickets:1.5,rate:15}],[{maxTickets:10001,rate:15}],
    [{maxTickets:10,rate:15},{maxTickets:10,rate:18}],[{maxTickets:10,rate:15},{maxTickets:9,rate:18}],
    [{maxTickets:10,rate:-0.01}],[{maxTickets:10,rate:100.01}],[{maxTickets:10,rate:15.001}],[{maxTickets:10,rate:null}],
   ];
   for(const tiers of invalid)await checked(await route.PATCH(patchRequest({...body(),tiers})),400);
   assert.deepEqual(counts(),before);
  });
  await t.test("missing, malformed and non-hex UUID versions reject before database access",async()=>{
   const before=counts();
   for(const version of [undefined,"",123,false,"stale", "gggggggg-gggg-gggg-gggg-gggggggggggg", "________-____-____-____-____________", uuidAlpha+"x"])
    await checked(await route.PATCH(patchRequest({...body(),version})),400);
   assert.deepEqual(counts(),before);
  });
  await t.test("unknown but valid show IDs return404 without reading or writing policies",async()=>{
   const beforeReads=policyReads.length,beforeWrites=writes.length;
   await checked(await route.GET(getRequest("missing-show")),404);
   await checked(await route.PATCH(patchRequest(body("missing-show",null))),404);
   assert.equal(policyReads.length,beforeReads);assert.equal(writes.length,beforeWrites);
   assert.deepEqual(showReads.slice(-2),["missing-show","missing-show"]);
  });
  await t.test("GET loads only the selected existing show and returns its source/version",async()=>{
   const before=counts();
   const result=await checked(await route.GET(getRequest(alpha)),200);
   assert.deepEqual(Object.keys(result),["policy"]);assert.deepEqual(result.policy,policies.get(alpha));
   assert.deepEqual(showReads.slice(before[0]),[alpha]);assert.deepEqual(policyReads.slice(before[1]),[alpha]);
   assert.equal(writes.length,before[2]);assert.equal(JSON.stringify(result).includes(beta),false);
   const unsaved=await checked(await route.GET(getRequest(fresh)),200);
   assert.equal(unsaved.policy.showId,fresh);assert.equal(unsaved.policy.source,"default");assert.equal(unsaved.policy.version,null);
   assert.equal(policies.has(fresh),false,"viewing a starter policy must not save it");
  });
  await t.test("PATCH saves selected-show tiers with CAS and authenticated audit identity",async()=>{
   const untouchedBeta=clone(policies.get(beta));
   actor={...role("admin"),display_name:"Synthetic Admin "+"x".repeat(240)};
   const requestBody={...body(alpha,uuidAlpha,[{maxTickets:8,rate:12.5},{maxTickets:150,rate:22}]),updatedBy:"forged actor",global:true};
   requestBody.tiers[0].unexpected="discard-me";
   const result=await checked(await route.PATCH(patchRequest(requestBody)),200);
   assert.equal(result.ok,true);assert.equal(result.policy.showId,alpha);assert.equal(result.policy.source,"show");
   assert.notEqual(result.policy.version,uuidAlpha);
   assert.deepEqual(writes.at(-1),{showId:alpha,tiers:[{maxTickets:8,rate:12.5},{maxTickets:150,rate:22}],version:uuidAlpha,updatedBy:actor.display_name.slice(0,200)});
   assert.deepEqual(policies.get(beta),untouchedBeta);assert.equal(JSON.stringify(result).includes("forged actor"),false);
   actor=role("admin");
  });
  await t.test("stale versions return409 and preserve the current policy",async()=>{
   const current=clone(policies.get(alpha));
   const result=await checked(await route.PATCH(patchRequest(body(alpha,uuidAlpha))),409);
   assert.match(result.error,/cập nhật|tải lại/i);assert.equal("policy" in result,false);
   assert.deepEqual(policies.get(alpha),current);assert.equal(writes.at(-1).version,uuidAlpha);
  });
  await t.test("null version creates only the selected unconfigured show and cannot overwrite it",async()=>{
   const untouchedAlpha=clone(policies.get(alpha));
   const result=await checked(await route.PATCH(patchRequest(body(fresh,null,[{maxTickets:1,rate:0}]))),200);
   assert.equal(result.ok,true);assert.equal(result.policy.showId,fresh);assert.equal(result.policy.source,"show");
   assert.equal(writes.at(-1).version,null);assert.deepEqual(result.policy.tiers,[{maxTickets:1,rate:0}]);
   const created=clone(policies.get(fresh));
   await checked(await route.PATCH(patchRequest(body(fresh,null))),409);
   assert.deepEqual(policies.get(fresh),created);assert.deepEqual(policies.get(alpha),untouchedAlpha);
  });
  await t.test("valid twelve-tier, upper-cap and two-decimal boundary values reach scoped save",async()=>{
   const tiers=Array.from({length:12},(_,index)=>({maxTickets:index===11?10000:index+1,rate:index===0?0.29:index===11?100:0}));
   const result=await checked(await route.PATCH(patchRequest(body(beta,uuidBeta.toUpperCase(),tiers),{contentType:"application/json; charset=utf-8"})),200);
   assert.equal(result.policy.showId,beta);assert.deepEqual(result.policy.tiers,tiers);
   assert.equal(writes.at(-1).showId,beta);
  });
  await t.test("show, load and save failures return safe503 without leaking internal errors",async()=>{
   for(const failure of ["show-error","load-error","save-error"]){
    mode=failure;
    const response=failure==="save-error"?await route.PATCH(patchRequest(body())):await route.GET(getRequest(alpha));
    const result=await checked(response,503);
    assert.deepEqual(Object.keys(result),["error"]);assert.equal(typeof result.error,"string");
    assert.doesNotMatch(JSON.stringify(result),/synthetic-private|stack|select=|managed_shows|rpc\//);
    if(failure==="show-error"){
     const before=writes.length;const mutation=await checked(await route.PATCH(patchRequest(body())),503);
     assert.equal(writes.length,before);assert.doesNotMatch(JSON.stringify(mutation),/synthetic-private/);
    }
   }
   mode="normal";
   assert(logged.length>=4);assert.equal(logged.flat().some(value=>String(value).includes("synthetic-private")),false);
  });
  assert.equal(networkCalls,0,"all route dependencies stay inside synthetic boundaries");
 }finally{
  Module._load=originalLoad;global.fetch=originalFetch;console.error=originalError;
 }
});

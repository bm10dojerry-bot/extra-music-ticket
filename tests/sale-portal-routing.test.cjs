// Self-contained source-level middleware integration:
//   node --test tests/sale-portal-routing.test.cjs
// Uses the actual NextRequest/NextResponse and current middleware.ts, compiled
// in memory. No server, credentials, database, external requests or writes.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");
const {NextRequest}=require("next/server");

const root=path.resolve(__dirname,"..");
const sourcePath=path.join(root,"middleware.ts");
const source=fs.readFileSync(sourcePath,"utf8");
const compiled=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
  fileName:sourcePath,
});
const sourceModule=new Module(sourcePath,module);
sourceModule.filename=sourcePath;
sourceModule.paths=Module._nodeModulePaths(root);
sourceModule._compile(compiled.outputText,sourcePath);
const {middleware}=sourceModule.exports;

function request(pathname,host="sale.iextra.net",method="GET"){
  return new NextRequest("https://"+host+pathname,{method,headers:{host}});
}
function passed(response){
  assert.equal(response.status,200);
  assert.equal(response.headers.get("x-middleware-next"),"1");
  assert.equal(response.headers.get("x-middleware-rewrite"),null);
  assert.equal(response.headers.get("location"),null);
}
async function blocked(response){
  assert.equal(response.status,403);
  assert.equal(response.headers.get("x-middleware-next"),null);
  assert.equal(response.headers.get("x-middleware-rewrite"),null);
  assert.equal(typeof (await response.json()).error,"string");
}

test("Sale exact ticket-link path reaches its authenticated route, including a code query",()=>{
  passed(middleware(request("/api/staff/ticket-link")));
  passed(middleware(request("/api/staff/ticket-link?code=EX0000000000000001")));
});

test("Sale ticket-link prefix and suffix variants do not broaden the allowlist",async()=>{
  for(const pathname of [
    "/api/staff/ticket-links",
    "/api/staff/ticket-link-extra",
    "/api/staff/ticket-link/extra",
    "/api/staff/ticket-link/",
    "/api/staff/prefix-ticket-link",
    "/api/staff/ticket-link-admin",
    "/api/staff/TICKET-LINK",
  ])await blocked(middleware(request(pathname)));
});

test("Sale Admin APIs and Checkin ticket-link access remain blocked",async()=>{
  for(const pathname of ["/api/admin/sale-performance","/api/admin/tickets","/api/admin/staff"])
    await blocked(middleware(request(pathname)));
  await blocked(middleware(request("/api/staff/ticket-link?code=EX0000000000000001","checkin.iextra.net")));
});

test("existing Sale reports, reservation and customer/payment routes still reach their handlers",()=>{
  for(const [pathname,method] of [
    ["/api/staff/reports?show=synthetic-show","GET"],
    ["/api/staff/sale-reserve","POST"],
    ["/api/staff/sale-requests","GET"],
    ["/api/payments/sepay/status?code=EX0000000000000001","GET"],
  ])passed(middleware(request(pathname,"sale.iextra.net",method)));
});

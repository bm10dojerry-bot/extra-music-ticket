// Actual media routes/helpers with native multipart parsing and synthetic auth,
// Storage and database responses. No external request or real upload is made.
// Run: node --test tests/media-upload-routes.test.cjs
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");

const repo=path.resolve(__dirname,"..");
const storageOrigin="https://synthetic-media-storage.invalid";
const syntheticKey="synthetic-media-service-key-not-a-real-secret";
const newShowId="phamtruong02012007";
const newSlot="artist-"+newShowId;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const admin={id:"synthetic-admin",role:"admin",active:true};
const json=(value,status=200)=>Response.json(value,{status});

test("media uploads support saved new-show artists without weakening authorization or input limits",async t=>{
 const originalLoad=Module._load,originalFetch=global.fetch;
 const oldEnv=new Map(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].map(name=>[name,process.env[name]]));
 const cache=new Map(),requests=[],authCalls=[],unexpected=[];
 const stored=new Map(),uploaded=new Map();
 let actor=admin,mode="normal",publicRows=null;
 process.env.SUPABASE_URL=storageOrigin;process.env.SUPABASE_SERVICE_ROLE_KEY=syntheticKey;

 function loadSource(filename){
  filename=path.resolve(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const result=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  loaded._compile(result.outputText,filename);return loaded.exports;
 }
 Module._load=function(request,parent,isMain){
  if(request==="server-only")return {};
  if(/(?:^|\/)staff-auth(?:\.js)?$/.test(request))return {requireRole:async roles=>{authCalls.push(roles);return actor?.active&&roles.includes(actor.role)?actor:null;}};
  if(request.startsWith(".")&&parent?.filename?.startsWith(repo+path.sep)){
   const base=path.resolve(path.dirname(parent.filename),request);
   for(const suffix of [".ts","/index.ts"]){const candidate=base+suffix;if(fs.existsSync(candidate))return loadSource(candidate);}
  }
  return originalLoad.apply(this,arguments);
 };
 global.fetch=async(input,init={})=>{
  const url=new URL(input),method=init.method||"GET";
  assert.equal(url.origin,storageOrigin,"fixtures must never contact another service");
  const headers=new Headers(init.headers);
  assert.equal(headers.get("apikey"),syntheticKey);assert.equal(headers.get("authorization"),"Bearer "+syntheticKey);
  requests.push({url,method,init});
  if(url.pathname==="/rest/v1/managed_shows"&&method==="GET"){
   assert.equal(init.cache,"no-store");assert.equal(url.searchParams.get("select"),"id");
   assert.equal(url.searchParams.has("status"),false,"a saved hidden show remains editable");
   const filter=url.searchParams.get("id");assert(filter?.startsWith("eq."));
   const id=filter.slice(3);
   if(mode==="lookup-http")return new Response("synthetic-private-lookup-detail",{status:403});
   if(mode==="lookup-json")return json({unexpected:"synthetic-private-lookup-detail"});
   if(mode==="lookup-null-row")return json([null]);
   if(mode==="lookup-missing-id")return json([{status:"hidden"}]);
   if(mode==="lookup-invalid-id")return json([{id:42}]);
   if(mode==="lookup-bad-json")return new Response("not-json");
   if(mode==="lookup-transport")throw Error("synthetic-private-lookup-detail");
   if(mode==="lookup-other-id")return json([{id:"another-synthetic-show"}]);
   return json(id===newShowId?[{id,status:"hidden"}]:[]);
  }
  if(url.pathname.startsWith("/storage/v1/object/extra-media/")&&method==="POST"){
   if(mode==="storage-http")return new Response("synthetic-private-storage-detail",{status:500});
   if(mode==="storage-transport")throw Error("synthetic-private-storage-detail");
   assert.equal(headers.get("x-upsert"),"false");
   const objectPath=decodeURIComponent(url.pathname.slice("/storage/v1/object/extra-media/".length));
   assert(!uploaded.has(objectPath),"uploads receive a fresh immutable object path");
   uploaded.set(objectPath,{bytes:Buffer.from(init.body),type:headers.get("content-type")});
   return json({Key:objectPath});
  }
  if(url.pathname==="/rest/v1/site_media"&&method==="POST"){
   assert.equal(url.searchParams.get("on_conflict"),"slot");
   assert.match(headers.get("prefer"),/resolution=merge-duplicates/);
   const row=JSON.parse(init.body);
   if(mode==="metadata-http")return new Response("synthetic-private-metadata-detail",{status:500});
   if(mode==="metadata-transport")throw Error("synthetic-private-metadata-detail");
   assert.equal(typeof row.slot,"string");assert.equal(typeof row.image_path,"string");
   assert(Number.isFinite(Date.parse(row.updated_at)));
   assert(uploaded.has(row.image_path),"metadata cannot be saved before the image is uploaded");
   stored.set(row.slot,row);
   return new Response(null,{status:204});
  }
  if(url.pathname==="/rest/v1/site_media"&&method==="GET"){
   assert.equal(url.searchParams.get("select"),"slot,image_path");assert.equal(init.cache,"no-store");
   if(mode==="public-http")return new Response("synthetic-private-read-detail",{status:500});
   if(mode==="public-json")return json({unexpected:"synthetic-private-read-detail"});
   if(mode==="public-transport")throw Error("synthetic-private-read-detail");
   return json(publicRows??[...stored.values()]);
  }
  unexpected.push({path:url.pathname,method});throw Error("Unexpected synthetic media request");
 };

 try{
  const {NextRequest}=require("next/server");
  const media=loadSource(path.join(repo,"lib/media.ts"));
  const upload=loadSource(path.join(repo,"app/api/admin/media/route.ts"));
  const publicMedia=loadSource(path.join(repo,"app/api/public/media/route.ts"));
  function request(slot=newSlot,file=new File([png],"transparent.png",{type:"image/png"})){
   const form=new FormData();
   if(slot!==null)form.set("slot",slot);
   if(file!==null)form.set("file",file);
   return new NextRequest("https://admin.synthetic.invalid/api/admin/media",{method:"POST",body:form});
  }
  const writes=()=>requests.filter(item=>item.method!=="GET");
  const storageWrites=()=>requests.filter(item=>item.url.pathname.startsWith("/storage/v1/object/"));
  const metadataWrites=()=>requests.filter(item=>item.url.pathname==="/rest/v1/site_media"&&item.method==="POST");
  const lookupReads=()=>requests.filter(item=>item.url.pathname==="/rest/v1/managed_shows");
  async function expectError(response,status){
   assert.equal(response.status,status);
   const body=await response.json();assert.equal(typeof body.error,"string");assert(body.error.length>0);
   assert.equal(body.ok,undefined);assert.equal(body.url,undefined);
   assert.doesNotMatch(JSON.stringify(body),/synthetic-private-|synthetic-media-service-key/);
   return body;
  }

  await t.test("new artists are added to the catalog exactly once while legacy slots remain available",()=>{
   assert.equal(media.MAX_MEDIA_UPLOAD_MB,4);assert.equal(media.MAX_MEDIA_UPLOAD_BYTES,4*1024*1024);
   const slots=media.getMediaSlots([{id:newShowId,artist:"Phạm Trưởng & Onis"},{id:newShowId,artist:"Phạm Trưởng & Onis"},{id:"dinh-dung-2811",artist:"Updated fixture artist"},{id:"../bad",artist:"Rejected fixture"}]);
   assert.equal(slots.filter(slot=>slot.id===newSlot).length,1);
   assert.equal(slots.find(slot=>slot.id===newSlot).name,"Ảnh PNG ca sĩ · Phạm Trưởng & Onis");
   assert.equal(slots.find(slot=>slot.id==="artist-dinh-dung-2811").name,"Ảnh PNG ca sĩ · Updated fixture artist");
   for(const slot of media.mediaSlots)assert.equal(slots.filter(value=>value.id===slot.id).length,1);
   assert.equal(slots.some(slot=>slot.id==="artist-../bad"),false);
  });

  await t.test("unauthorized actors are rejected before multipart parsing or any database/storage access",async()=>{
   const before=requests.length;
   for(const value of [null,{...admin,role:"sale"},{...admin,role:"checkin"},{...admin,role:"accountant"},{...admin,active:false}]){
    actor=value;const req=request();let parsed=false;
    Object.defineProperty(req,"formData",{value:async()=>{parsed=true;throw Error("Unauthorized body must not be parsed");}});
    await expectError(await upload.POST(req),401);assert.equal(parsed,false);
   }
   assert.equal(requests.length,before);
   assert(authCalls.every(roles=>roles.length===2&&roles.includes("admin")&&roles.includes("show_manager")));
   actor=admin;
  });

  await t.test("a saved new hidden show accepts PNG bytes unchanged and publishes the exact dynamic slot",async()=>{
   const before=requests.length;
   const result=await upload.POST(request());assert.equal(result.status,200);
   const body=await result.json();assert.equal(body.ok,true);
   const calls=requests.slice(before);
   assert.equal(calls.length,3);assert.equal(calls[0].url.pathname,"/rest/v1/managed_shows");
   assert.equal(calls[0].url.searchParams.get("id"),"eq."+newShowId);
   assert.equal(calls[1].method,"POST");assert.equal(calls[2].method,"POST");
   const row=stored.get(newSlot);assert(row);
   assert.match(row.image_path,new RegExp("^"+newSlot+"/[0-9a-f-]{36}\\.png$"));
   assert.deepEqual(uploaded.get(row.image_path).bytes,png,"transparent PNG is not re-encoded or flattened");
   assert.equal(uploaded.get(row.image_path).type,"image/png");
   assert.equal(body.url,media.mediaPublicUrl(row.image_path));
   const published=await publicMedia.GET();assert.equal(published.status,200);
   assert.equal((await published.json()).images[newSlot],body.url,"the public reader must not discard a valid new artist");
  });

  await t.test("show managers keep the same upload permission, and legacy artist/banner/venue slots do not require a new-show lookup",async()=>{
   actor={...admin,role:"show_manager"};
   assert.equal((await upload.POST(request())).status,200);
   actor=admin;
   for(const slot of ["artist-dinh-dung-2811","banner-home-desktop","venue-ccc-2"]){
    const reads=lookupReads().length;
    assert.equal((await upload.POST(request(slot))).status,200);
    assert.equal(lookupReads().length,reads);assert(stored.has(slot));
   }
  });

  await t.test("unknown, mismatched or malformed artist slots never reach Storage",async()=>{
   const before=writes().length;
   await expectError(await upload.POST(request("artist-unsaved-fixture")),400);
   mode="lookup-other-id";await expectError(await upload.POST(request()),400);mode="normal";
   const lookups=lookupReads().length;
   for(const slot of [null,"","artist-xx","artist-Abc","artist--abc","artist-abc/../../other","artist-abc%2Fother","artist-abc\n","artist-abc\r\n","artist-"+"a".repeat(101),"venue-new","banner-home-other"]){
    await expectError(await upload.POST(request(slot)),400);
   }
   assert.equal(lookupReads().length,lookups,"invalid grammar is rejected before querying a show");
   assert.equal(writes().length,before);
  });

  await t.test("lookup HTTP, malformed JSON/rows and transport failures return safe 503 without uploads",async()=>{
   const before=writes().length;
   for(const failure of ["lookup-http","lookup-json","lookup-null-row","lookup-missing-id","lookup-invalid-id","lookup-bad-json","lookup-transport"]){mode=failure;await expectError(await upload.POST(request()),503);}
   mode="normal";assert.equal(writes().length,before);
  });

  await t.test("malformed forms, missing/empty files, unsupported MIME and mismatched signatures are rejected before writes",async()=>{
   const before=writes().length;
   const malformed=new NextRequest("https://admin.synthetic.invalid/api/admin/media",{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary=fixture"},body:"not multipart"});
   await expectError(await upload.POST(malformed),400);
   const cases=[
    null,"not a file",new File([],"empty.png",{type:"image/png"}),
    new File([png],"svg.svg",{type:"image/svg+xml"}),
    new File([png],"gif.gif",{type:"image/gif"}),
    new File(["not-png"],"wrong.png",{type:"image/png"}),
    new File([png],"renamed.jpg",{type:"image/jpeg"}),
    new File(["RIFF-not-a-webp"],"wrong.webp",{type:"image/webp"}),
    new File([png.subarray(0,8)],"truncated.png",{type:"image/png"}),
   ];
   for(const file of cases)await expectError(await upload.POST(request("banner-home-desktop",file)),400);
   assert.equal(writes().length,before);
  });

  await t.test("the 4 MiB bound is enforced consistently while exact-limit payloads remain accepted",async()=>{
   const limit=media.MAX_MEDIA_UPLOAD_BYTES,before=writes().length;
   const oversized=Buffer.alloc(limit+1);png.copy(oversized);
   const error=await expectError(await upload.POST(request(newSlot,new File([oversized],"too-large.png",{type:"image/png"}))),400);
   assert.match(error.error,/4 MB/);assert.equal(writes().length,before);
   const boundary=Buffer.alloc(limit);png.copy(boundary);
   assert.equal((await upload.POST(request("banner-home-mobile",new File([boundary],"at-limit.png",{type:"image/png"})))).status,200);
   const row=stored.get("banner-home-mobile");assert.equal(uploaded.get(row.image_path).bytes.length,limit);
  });

  await t.test("Storage and metadata failures cannot return a public URL or false success",async()=>{
   for(const failure of ["storage-http","storage-transport"]){
    mode=failure;const before=metadataWrites().length;
    await expectError(await upload.POST(request()),failure.endsWith("http")?502:503);
    assert.equal(metadataWrites().length,before);
   }
   for(const failure of ["metadata-http","metadata-transport"]){
    mode=failure;const before=storageWrites().length;
    await expectError(await upload.POST(request()),failure.endsWith("http")?502:503);
    assert.equal(storageWrites().length,before+1);
   }
   mode="normal";
  });

  await t.test("the public reader retains dynamic media and filters invalid row/slot shapes",async()=>{
   const valid=stored.get(newSlot),legacy=stored.get("artist-dinh-dung-2811");
   publicRows=[valid,legacy,null,{},{"slot":42,"image_path":"x"},{"slot":newSlot,"image_path":null},{"slot":"artist-abc\n","image_path":"x"},{"slot":"../secret","image_path":"x"}];
   const before=writes().length,result=await publicMedia.GET();assert.equal(result.status,200);
   assert.match(result.headers.get("cache-control"),/no-store/);
   const body=await result.json();assert.deepEqual(Object.keys(body.images).sort(),[newSlot,legacy.slot].sort());
   assert.equal(body.images[newSlot],media.mediaPublicUrl(valid.image_path));assert.equal(writes().length,before);
   publicRows=null;
   for(const failure of ["public-http","public-json","public-transport"]){mode=failure;const response=await publicMedia.GET();assert.equal(response.status,503);assert.deepEqual(await response.json(),{images:{}});}
   mode="normal";
  });

  await t.test("missing service configuration fails safely without contacting Storage",async()=>{
   const before=requests.length;
   delete process.env.SUPABASE_SERVICE_ROLE_KEY;
   await expectError(await upload.POST(request()),503);
   assert.deepEqual(await (await publicMedia.GET()).json(),{images:{}});
   assert.equal(requests.length,before);
   process.env.SUPABASE_SERVICE_ROLE_KEY=syntheticKey;
  });
  assert.deepEqual(unexpected,[]);
 }finally{
  Module._load=originalLoad;global.fetch=originalFetch;
  for(const [name,value] of oldEnv){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});

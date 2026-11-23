// Actual Sharp processing and poster route, with generated fixture images and
// fully intercepted auth/Storage/database requests. No live upload is made.
// Run: node --test tests/show-poster-routes.test.cjs
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");
const sharp=require("sharp");

const repo=path.resolve(__dirname,"..");
const origin="https://synthetic-poster-storage.invalid";
const serviceKey="synthetic-poster-key-not-a-real-secret";
const showId="synthetic-poster-show";
const admin={id:"synthetic-admin",role:"admin",active:true};
const json=(value,status=200)=>Response.json(value,{status});
const blue=[30,80,180],green=[30,225,60],red=[220,30,40],yellow=[240,180,20];

function rgb(width,height,colorAt){
 const data=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(colorAt(x,y),(y*width+x)*3);
 return {data,width,height};
}
const encode=(source,format="png")=>sharp(source.data,{raw:{width:source.width,height:source.height,channels:3}}).toFormat(format,{quality:100}).toBuffer();
const decode=buffer=>sharp(buffer).raw().toBuffer({resolveWithObject:true});
function pixel(decoded,x,y){
 const offset=(y*decoded.info.width+x)*decoded.info.channels;
 return [...decoded.data.subarray(offset,offset+decoded.info.channels)];
}
function nearColor(actual,expected,message){
 for(let channel=0;channel<expected.length;channel++)assert(Math.abs(actual[channel]-expected[channel])<=16,message+" channel "+channel+": "+actual+" vs "+expected);
}
function greenSpan(decoded,axis){
 const length=axis==="x"?decoded.info.width:decoded.info.height,positions=[];
 for(let pos=0;pos<length;pos++){
  const [r,g,b]=pixel(decoded,axis==="x"?pos:decoded.info.width/2,axis==="y"?pos:decoded.info.height/2);
  if(g>150&&g>r+60&&g>b+60)positions.push(pos);
 }
 assert(positions.length,"the centered green square must remain visible");
 return positions.at(-1)-positions[0]+1;
}
function withLargePngHeader(png){
 // The cap must reject the advertised raster before trying to allocate/decode it.
 const result=Buffer.from(png);result.writeUInt32BE(8000,16);result.writeUInt32BE(5001,20);
 let crc=0xffffffff;
 for(const byte of result.subarray(12,29)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 result.writeUInt32BE((crc^0xffffffff)>>>0,29);return result;
}

test("show posters are normalized to a uniform portrait without distorting images or weakening upload controls",async t=>{
 const originalLoad=Module._load,originalFetch=global.fetch;
 const oldEnv=new Map(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].map(name=>[name,process.env[name]]));
 const cache=new Map(),requests=[],unexpected=[],uploaded=new Map(),stored=new Map(),authCalls=[];
 let actor=admin,mode="normal",normalizations=0;
 process.env.SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=serviceKey;

 function loadSource(filename){
  filename=path.resolve(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const transpiled=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  loaded._compile(transpiled.outputText,filename);return loaded.exports;
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
  const url=new URL(input),method=init.method||"GET",headers=new Headers(init.headers);
  requests.push({url,method,init});
  assert.equal(url.origin,origin,"no request can leave the synthetic service");
  assert.equal(headers.get("apikey"),serviceKey);assert.equal(headers.get("authorization"),"Bearer "+serviceKey);
  if(url.pathname==="/rest/v1/managed_shows"&&method==="GET"){
   assert.equal(init.cache,"no-store");assert.equal(url.searchParams.get("select"),"id");
   assert.equal(url.searchParams.has("status"),false,"hidden shows must remain editable");
   if(mode==="lookup-http")return new Response("synthetic-private-lookup-detail",{status:500});
   if(mode==="lookup-json")return json({unexpected:true});
   if(mode==="lookup-malformed-row")return json([null,{id:42}]);
   if(mode==="lookup-bad-json")return new Response("not JSON");
   if(mode==="lookup-transport")throw Error("synthetic-private-lookup-detail");
   if(mode==="lookup-other-id")return json([{id:"another-synthetic-show"}]);
   return json(url.searchParams.get("id")==="eq."+showId?[{id:showId,status:"hidden"}]:[]);
  }
  if(url.pathname.startsWith("/storage/v1/object/extra-media/")&&method==="POST"){
   if(mode==="storage-http")return new Response("synthetic-private-storage-detail",{status:500});
   if(mode==="storage-transport")throw Error("synthetic-private-storage-detail");
   assert.equal(headers.get("content-type"),"image/webp");assert.equal(headers.get("x-upsert"),"false");
   const objectPath=decodeURIComponent(url.pathname.slice("/storage/v1/object/extra-media/".length));
   assert.match(objectPath,new RegExp("^posters/"+showId+"/[0-9a-f-]{36}\\.webp$"));
   assert(!uploaded.has(objectPath),"replacement posters use fresh immutable object paths");
   uploaded.set(objectPath,Buffer.from(init.body));return json({Key:objectPath});
  }
  if(url.pathname==="/rest/v1/managed_shows"&&method==="PATCH"){
   assert.equal(url.searchParams.get("id"),"eq."+showId);
   assert.equal(headers.get("content-type"),"application/json");assert.match(headers.get("prefer"),/return=minimal/);
   if(mode==="save-http")return new Response("synthetic-private-save-detail",{status:500});
   if(mode==="save-transport")throw Error("synthetic-private-save-detail");
   const row=JSON.parse(init.body);
   assert.deepEqual(Object.keys(row).sort(),["poster_path","updated_at"]);
   assert(Number.isFinite(Date.parse(row.updated_at)));assert(uploaded.has(row.poster_path),"show metadata must follow a successful upload");
   stored.set(showId,row);return new Response(null,{status:204});
  }
  unexpected.push({path:url.pathname,method});throw Error("Unexpected synthetic poster request");
 };

 try{
  const {NextRequest}=require("next/server");
  const limits=loadSource(path.join(repo,"lib/poster.ts"));
  const processing=loadSource(path.join(repo,"lib/poster-processing.ts"));
  const actualNormalize=processing.normalizeShowPoster;
  processing.normalizeShowPoster=bytes=>{normalizations++;return actualNormalize(bytes);};
  const upload=loadSource(path.join(repo,"app/api/admin/show-poster/route.ts"));
  const media=loadSource(path.join(repo,"lib/media.ts"));
  const landscape=rgb(600,400,(x,y)=>x>=250&&x<350&&y>=150&&y<250?green:x<150?red:x>=450?yellow:blue);
  const portrait=rgb(400,800,(x,y)=>x>=150&&x<250&&y>=350&&y<450?green:y<100?red:y>=700?yellow:blue);
  const png=await encode(landscape);
  const tinyPng=await sharp({create:{width:1,height:1,channels:3,background:"#dd2233"}}).png().toBuffer();
  const tooManyPixels=withLargePngHeader(tinyPng);
  function request(id=showId,file=new File([png],"synthetic-landscape.png",{type:"image/png"})){
   const form=new FormData();if(id!==null)form.set("showId",id);if(file!==null)form.set("file",file);
   return new NextRequest("https://admin.synthetic.invalid/api/admin/show-poster",{method:"POST",body:form});
  }
  const writes=()=>requests.filter(item=>item.method!=="GET");
  const patches=()=>requests.filter(item=>item.method==="PATCH");
  async function expectError(response,status){
   assert.equal(response.status,status);const body=await response.json();
   assert.equal(typeof body.error,"string");assert(body.error.length);
   assert.equal(body.ok,undefined);assert.equal(body.url,undefined);
   assert.doesNotMatch(JSON.stringify(body),/synthetic-private-|synthetic-poster-key|pngload|vips/);
   return body;
  }
  async function assertPoster(buffer){
   assert(Buffer.isBuffer(buffer));assert(buffer.length>0&&buffer.length<=5*1024*1024);
   const metadata=await sharp(buffer).metadata();
   assert.equal(metadata.format,"webp");assert.equal(metadata.width,1200);assert.equal(metadata.height,1800);
   assert(!metadata.orientation||metadata.orientation===1,"output must not depend on an EXIF rotation");
  }

  await t.test("landscape and tall inputs fill 1200×1800 by centered cropping while a square keeps equal scales",async()=>{
   assert.equal(limits.POSTER_WIDTH,1200);assert.equal(limits.POSTER_HEIGHT,1800);
   for(const [source,expectedSquareSize] of [[landscape,450],[portrait,300]]){
    const normalized=await actualNormalize(await encode(source));await assertPoster(normalized);
    const raster=await decode(normalized);
    for(const [x,y] of [[20,20],[1180,20],[20,1780],[1180,1780]])nearColor(pixel(raster,x,y),blue,"center crop must remove edge bands and fill every corner");
    const width=greenSpan(raster,"x"),height=greenSpan(raster,"y");
    assert(Math.abs(width-expectedSquareSize)<=4,"horizontal scale must preserve the known square");
    assert(Math.abs(height-expectedSquareSize)<=4,"vertical scale must preserve the known square");
    assert(Math.abs(width-height)<=3,"a square must not become a stretched rectangle");
    nearColor(pixel(raster,600,900),green,"center content must remain centered");
   }
  });

  await t.test("EXIF orientation is applied before resizing and removed from the normalized output",async()=>{
   const quadrants=rgb(600,400,(x,y)=>y<200?(x<300?red:green):(x<300?blue:yellow));
   const source=await sharp(quadrants.data,{raw:{width:600,height:400,channels:3}}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer();
   assert.equal((await sharp(source).metadata()).orientation,6);
   const normalized=await actualNormalize(source);await assertPoster(normalized);
   const raster=await decode(normalized);
   nearColor(pixel(raster,300,450),blue,"clockwise-oriented top-left");
   nearColor(pixel(raster,900,450),red,"clockwise-oriented top-right");
   nearColor(pixel(raster,300,1350),yellow,"clockwise-oriented bottom-left");
   nearColor(pixel(raster,900,1350),green,"clockwise-oriented bottom-right");
  });

  await t.test("PNG transparency remains transparent after normalization",async()=>{
   const raw=Buffer.alloc(120*180*4);
   for(let y=60;y<120;y++)for(let x=40;x<80;x++)raw.set([...green,255],(y*120+x)*4);
   const source=await sharp(raw,{raw:{width:120,height:180,channels:4}}).png().toBuffer();
   const normalized=await actualNormalize(source);await assertPoster(normalized);
   const raster=await decode(normalized);
   assert.equal(raster.info.channels,4);assert.equal(pixel(raster,20,20)[3],0);
   assert.equal(pixel(raster,600,900)[3],255);
  });

  await t.test("corrupt input and oversized advertised rasters fail before any output is returned",async()=>{
   await assert.rejects(actualNormalize(Buffer.from("not an image")));
   await assert.rejects(actualNormalize(png.subarray(0,45)));
   const advertised=await sharp(tooManyPixels,{limitInputPixels:false}).metadata();
   assert.equal(advertised.width*advertised.height,40_008_000);
   await assert.rejects(actualNormalize(tooManyPixels),/pixel limit/i);
   assert.equal(requests.length,0,"normalization is entirely local");
  });

  await t.test("the actual route accepts all supported formats and publishes only normalized WebP for the exact saved show",async()=>{
   for(const [format,type,role] of [["png","image/png","admin"],["jpeg","image/jpeg","show_manager"],["webp","image/webp","admin"]]){
    actor={...admin,role};const input=await encode(landscape,format),before=requests.length;
    const response=await upload.POST(request(showId,new File([input],"fixture."+format,{type})));
    assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.ok,true);assert.equal(body.width,1200);assert.equal(body.height,1800);
    const calls=requests.slice(before);
    assert.deepEqual(calls.map(call=>call.method),["GET","POST","PATCH"]);
    assert.equal(calls[0].url.searchParams.get("id"),"eq."+showId);
    const row=stored.get(showId);assert(row);assert.equal(body.url,media.mediaPublicUrl(row.poster_path));
    await assertPoster(uploaded.get(row.poster_path));
   }
   actor=admin;
  });

  await t.test("unauthorized actors are rejected before multipart parsing, normalization, lookup or upload",async()=>{
   const before=requests.length,normalizedBefore=normalizations;
   for(const value of [null,{...admin,role:"sale"},{...admin,role:"checkin"},{...admin,active:false}]){
    actor=value;const req=request();let parsed=false;
    Object.defineProperty(req,"formData",{value:async()=>{parsed=true;throw Error("unauthorized body must not be parsed");}});
    await expectError(await upload.POST(req),401);assert.equal(parsed,false);
   }
   assert.equal(requests.length,before);assert.equal(normalizations,normalizedBefore);
   assert(authCalls.every(roles=>roles.length===2&&roles.includes("admin")&&roles.includes("show_manager")));
   actor=admin;
  });

  await t.test("invalid IDs, malformed forms, missing files and mismatched MIME signatures are blocked before lookup",async()=>{
   const before=requests.length,normalizedBefore=normalizations;
   for(const id of [null,"","xx","Uppercase-id","-leading-hyphen","../show","show/other","show%2Fother","synthetic-show\n","a".repeat(101)]){
    await expectError(await upload.POST(request(id)),400);
   }
   const malformed=new NextRequest("https://admin.synthetic.invalid/api/admin/show-poster",{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary=fixture"},body:"invalid multipart"});
   await expectError(await upload.POST(malformed),400);
   for(const file of [null,"not a file",new File([],"empty.png",{type:"image/png"}),new File([png],"unsupported.svg",{type:"image/svg+xml"}),new File([png],"renamed.jpg",{type:"image/jpeg"}),new File(["not-png"],"invalid.png",{type:"image/png"})]){
    await expectError(await upload.POST(request(showId,file)),400);
   }
   assert.equal(requests.length,before);assert.equal(normalizations,normalizedBefore);
  });

  await t.test("the shared 4 MiB input bound rejects oversized files while accepting the exact boundary",async()=>{
   assert.equal(limits.MAX_POSTER_UPLOAD_MB,4);assert.equal(limits.MAX_POSTER_UPLOAD_BYTES,4*1024*1024);
   const before=requests.length,normalizedBefore=normalizations;
   const oversized=Buffer.alloc(limits.MAX_POSTER_UPLOAD_BYTES+1);png.copy(oversized);
   const error=await expectError(await upload.POST(request(showId,new File([oversized],"large.png",{type:"image/png"}))),400);
   assert.match(error.error,/4 MB/);assert.equal(requests.length,before);assert.equal(normalizations,normalizedBefore);
   const boundary=Buffer.alloc(limits.MAX_POSTER_UPLOAD_BYTES);png.copy(boundary);
   const result=await upload.POST(request(showId,new File([boundary],"limit.png",{type:"image/png"})));
   assert.equal(result.status,200);await assertPoster(uploaded.get(stored.get(showId).poster_path));
  });

  await t.test("unknown shows and lookup failures never reach expensive normalization or writes",async()=>{
   const before=writes().length,normalizedBefore=normalizations;
   await expectError(await upload.POST(request("unknown-fixture-show")),400);
   mode="lookup-other-id";await expectError(await upload.POST(request()),400);
   for(const failure of ["lookup-http","lookup-json","lookup-malformed-row","lookup-bad-json","lookup-transport"]){
    mode=failure;await expectError(await upload.POST(request()),503);
   }
   mode="normal";assert.equal(writes().length,before);assert.equal(normalizations,normalizedBefore);
  });

  await t.test("decoder and pixel-cap failures return safe 400 errors and cannot upload a partial poster",async()=>{
   const before=writes().length,normalizedBefore=normalizations;
   for(const bytes of [png.subarray(0,45),tooManyPixels]){
    const error=await expectError(await upload.POST(request(showId,new File([bytes],"invalid-raster.png",{type:"image/png"}))),400);
    assert.match(error.error,/chuẩn hóa poster/);
   }
   assert.equal(normalizations,normalizedBefore+2);assert.equal(writes().length,before);
  });

  await t.test("Storage and show-save failures never return success or overwrite metadata prematurely",async()=>{
   for(const failure of ["storage-http","storage-transport"]){
    mode=failure;const before=patches().length;
    await expectError(await upload.POST(request()),failure.endsWith("http")?502:503);
    assert.equal(patches().length,before);
   }
   for(const failure of ["save-http","save-transport"]){
    mode=failure;const previous=stored.get(showId),before=uploaded.size;
    await expectError(await upload.POST(request()),failure.endsWith("http")?502:503);
    assert.equal(uploaded.size,before+1);assert.equal(stored.get(showId),previous);
   }
   mode="normal";
  });

  await t.test("missing service configuration fails safely before processing or requests",async()=>{
   const before=requests.length,normalizedBefore=normalizations;
   delete process.env.SUPABASE_SERVICE_ROLE_KEY;
   await expectError(await upload.POST(request()),503);
   process.env.SUPABASE_SERVICE_ROLE_KEY=serviceKey;
   assert.equal(requests.length,before);assert.equal(normalizations,normalizedBefore);
  });

  assert.deepEqual(unexpected,[]);
 }finally{
  Module._load=originalLoad;global.fetch=originalFetch;
  for(const [name,value] of oldEnv){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});

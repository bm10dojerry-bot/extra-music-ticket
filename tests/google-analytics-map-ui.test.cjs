// Synthetic checks for the actual GA4 map component and its viewport projection.
// No browser, external network, Analytics account, or mutation is used.
// Optional renderer installation outside the repository (match resolved React):
// npm install --prefix /tmp/extra-sale-ui-test-runtime --no-save --package-lock=false react@19.3.1 react-test-renderer@19.3.1
// Run: node --test tests/google-analytics-map-ui.test.cjs
// These checks inspect React output and projection math, not browser visual geometry.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const ts=require("typescript");
const React=require("react");

const repo=path.resolve(__dirname,"..");
const runtime=process.env.EXTRA_SALE_UI_TEST_RUNTIME||"/tmp/extra-sale-ui-test-runtime";
const rendererPath=path.join(runtime,"node_modules/react-test-renderer");
const rendererAvailable=fs.existsSync(path.join(rendererPath,"package.json"));
const content=node=>node===null||node===undefined?"":typeof node==="string"||typeof node==="number"?String(node):Array.isArray(node)?node.map(content).join(""):(node.children||[]).map(content).join("");
const ready=countries=>({
 status:"ready",canManage:false,connectAvailable:true,
 property:{id:"123456",name:"Synthetic Analytics",streamId:"654321",streamName:"Synthetic Stream",siteUrl:"https://iextra.net",measurementId:"G-SYNTHETIC"},
 report:{updatedAt:"2099-01-01T00:00:00Z",windowMinutes:30,totalActiveUsers:countries.reduce((sum,row)=>sum+row.activeUsers,0),countries,
  cities:[{countryId:"VN",country:"Vietnam",city:"Synthetic Hanoi",activeUsers:9876},{countryId:"VN",country:"Vietnam",city:"Synthetic Ho Chi Minh City",activeUsers:5432}],limited:false},
});
const countryRows=[
 {countryId:"VN",country:"Vietnam",activeUsers:7},
 {countryId:"TH",country:"Thailand",activeUsers:3},
 {countryId:"LA",country:"Laos",activeUsers:2},
 {countryId:"KH",country:"Cambodia",activeUsers:4},
 {countryId:"US",country:"United States",activeUsers:19},
 {countryId:"AU",country:"Australia",activeUsers:11},
 {countryId:"JP",country:"Japan",activeUsers:13},
 {countryId:"DE",country:"Germany",activeUsers:17},
];
const approximately=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-7,message||actual+" differs from "+expected);

test("GA4 map focuses Vietnam while preserving aggregate data and viewport interactions",{
 skip:rendererAvailable?false:"Optional matching React renderer is not installed; see the installation command above.",
},async t=>{
 assert.equal(require(path.join(rendererPath,"package.json")).version,React.version);
 const originalLoad=Module._load,originalError=console.error;
 const names=["window","document","fetch","ResizeObserver","IntersectionObserver","setInterval","clearInterval","IS_REACT_ACT_ENVIRONMENT"];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(global,name)]));
 const define=(name,value)=>Object.defineProperty(global,name,{configurable:true,writable:true,value});
 const cache=new Map(),timers=new Map(),resizeObservers=new Set(),windowListeners=new Map(),documentListeners=new Map();
 const requests=[],unexpected=[];
 let tree=null,timerId=0,canvasSize={width:1200,height:450},response=ready(countryRows);
 function loadSource(filename) {
  filename=path.resolve(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const result=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  loaded._compile(result.outputText,filename);return loaded.exports;
 }
 Module._load=function(request,parent,isMain) {
  if(request==="react")return React;
  if(request==="react/jsx-runtime"||request==="react/jsx-dev-runtime")return originalLoad.call(this,request,module,isMain);
  if(request.endsWith(".css"))return {__esModule:true,default:new Proxy({},{get:(_target,key)=>String(key)})};
  if(request.startsWith(".")&&parent?.filename?.startsWith(repo+path.sep)){
   const base=path.resolve(path.dirname(parent.filename),request);
   for(const suffix of [".tsx",".ts","/index.tsx","/index.ts"]){const candidate=base+suffix;if(fs.existsSync(candidate))return loadSource(candidate);}
  }
  return originalLoad.apply(this,arguments);
 };
 const addListener=(store,name,listener)=>{if(!store.has(name))store.set(name,new Set());store.get(name).add(listener);};
 define("IS_REACT_ACT_ENVIRONMENT",true);
 define("setInterval",(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;});
 define("clearInterval",id=>timers.delete(id));
 define("window",{location:{search:""},addEventListener:(name,listener)=>addListener(windowListeners,name,listener),removeEventListener:(name,listener)=>windowListeners.get(name)?.delete(listener)});
 define("document",{visibilityState:"visible",addEventListener:(name,listener)=>addListener(documentListeners,name,listener),removeEventListener:(name,listener)=>documentListeners.get(name)?.delete(listener)});
 define("IntersectionObserver",undefined);
 define("ResizeObserver",class{
  constructor(callback){this.callback=callback;resizeObservers.add(this);}
  observe(node){this.node=node;}
  disconnect(){resizeObservers.delete(this);}
 });
 define("fetch",async(input,init={})=>{
  const method=init.method||"GET";requests.push({url:input,method,init});
  if(input!=="/api/admin/google-analytics"||method!=="GET"){unexpected.push({url:input,method});throw Error("Unexpected request in synthetic map test");}
  return Response.json(structuredClone(response));
 });
 console.error=(...args)=>{if(typeof args[0]==="string"&&args[0].startsWith("react-test-renderer is deprecated"))return;originalError(...args);};

 try{
  const renderer=require(rendererPath),{act}=renderer;
  const GoogleAnalyticsMap=loadSource(path.join(repo,"app/admin/google-analytics-map.tsx")).default;
  const {COUNTRY_POINTS}=loadSource(path.join(repo,"app/admin/ga4-country-points.ts"));
  const viewportHelpers=loadSource(path.join(repo,"app/admin/ga4-map-viewport.ts"));
  const anchors=new Map(COUNTRY_POINTS.map(point=>[point.id,point]));
  const update=async work=>{await act(async()=>{await work?.();});};
  async function mount(size={width:1200,height:450},data=ready(countryRows)){
   assert.equal(tree,null);canvasSize=size;response=data;
   await update(()=>{tree=renderer.create(React.createElement(GoogleAnalyticsMap),{createNodeMock:element=>{
    if(element.type==="div"&&String(element.props.className||"").split(" ").includes("canvas"))return {get clientWidth(){return canvasSize.width;},get clientHeight(){return canvasSize.height;}};
    if(element.type==="dialog")return {open:false,showModal(){this.open=true;},close(){this.open=false;}};
    return {};
   }});});
  }
  async function unmount(){if(tree){await update(()=>tree.unmount());tree=null;}assert.equal(resizeObservers.size,0);assert.equal(timers.size,0);}
  const map=()=>tree.root.findAllByType("svg").find(node=>node.props.role==="group");
  const viewBox=()=>map().props.viewBox.split(/\s+/).map(Number);
  const markers=()=>tree.root.findAllByType("g").filter(node=>node.props.role==="button");
  const button=label=>tree.root.findAllByType("button").find(node=>content(node)===label);
  const markerPosition=node=>{
   const match=node.props.transform.match(/^translate\(\s*([-+\d.e]+)[,\s]+([-+\d.e]+)\s*\)$/);
   assert(match,"country marker must retain its geographic anchor");
   return {x:Number(match[1]),y:Number(match[2])};
  };
  const markerId=node=>{
   const point=markerPosition(node);
   return COUNTRY_POINTS.find(anchor=>anchor.x===point.x&&anchor.y===point.y)?.id;
  };
  const markerFor=id=>markers().find(node=>markerId(node)===id);
  const tooltip=()=>tree.root.findAllByProps({role:"tooltip"});
  const click=async node=>update(()=>node.props.onClick());
  async function resize(width,height){canvasSize={width,height};await update(()=>{for(const observer of [...resizeObservers])observer.callback();});}
  function assertVisibleMarkers(){
   const [x,y,width,height]=viewBox();
   assert([x,y,width,height].every(Number.isFinite));assert(width>0&&height>0);
   const expected=(response.report?.countries||[]).filter(row=>row.activeUsers>0).map(row=>anchors.get(row.countryId)).filter(Boolean).filter(point=>point.x>=x&&point.x<=x+width&&point.y>=y&&point.y<=y+height).map(point=>point.id).sort();
   assert.deepEqual(markers().map(markerId).sort(),expected,"only visible active country anchors may remain in the tab order");
   for(const marker of markers())assert.equal(marker.props.tabIndex,0);
  }
  function assertConstantMarkerSize(){
   const [, ,width,height]=viewBox(),scale=canvasSize.width>0&&canvasSize.height>0?Math.min(canvasSize.width/width,canvasSize.height/height):1;
   for(const marker of markers()){
    const group=marker.findAllByType("g").find(node=>/^scale\(/.test(node.props.transform||""));
    assert(group,"marker decoration must be inverse-scaled");
    const inverse=Number(group.props.transform.match(/^scale\(([-+\d.e]+)\)$/)?.[1]);
    assert(Number.isFinite(inverse)&&inverse>0);
    const dot=marker.findAllByType("circle").find(node=>node.props.className==="dot");
    approximately(Number(dot.props.r)*inverse*scale,3.5,"zooming must not enlarge the country dots");
    const hit=marker.findAllByType("circle").find(node=>node.props.className==="hitArea");
    assert(Number.isFinite(Number(hit.props.r))&&Number(hit.props.r)>0);
   }
  }
  function assertTooltipPosition(id){
   const [x,y,width,height]=viewBox(),anchor=anchors.get(id);
   const scale=Math.min(canvasSize.width/width,canvasSize.height/height);
   const projectedX=(canvasSize.width-width*scale)/2+(anchor.x-x)*scale;
   const projectedY=(canvasSize.height-height*scale)/2+(anchor.y-y)*scale;
   const tip=tooltip()[0];assert(tip);
   assert(Number.isFinite(tip.props.style.left));assert(Number.isFinite(tip.props.style.top));
   assert(tip.props.style.left>=0&&tip.props.style.left<=canvasSize.width);
   approximately(tip.props.style.left,Math.max(108,Math.min(canvasSize.width-108,projectedX)));
   approximately(tip.props.style.top,projectedY+(projectedY<100?17:-17));
  }

  await t.test("desktop and mobile start zoomed on Vietnam and expose only on-screen country anchors",async()=>{
   for(const size of [{width:1200,height:450},{width:351,height:320}]){
    await mount(size);
    assert.equal(button("Việt Nam").props["aria-pressed"],true);assert.equal(button("Thế giới").props["aria-pressed"],false);
    const [x,y,width,height]=viewBox();
    approximately(x+width/2,629.55);approximately(y+height/2,198.6);
    assert(height<100&&width<400,"initial view must be substantially closer than the world map");
    assert(619.9>=x&&639.2<=x+width&&179.7>=y&&217.5<=y+height,"the full Vietnam polygon bounds fit the initial view");
    assertVisibleMarkers();assertConstantMarkerSize();
    assert(markerFor("VN"));assert.equal(markerFor("US"),undefined);assert.equal(markerFor("AU"),undefined);
    assert.equal(markers().filter(node=>markerId(node)==="VN").length,1);
    assert.match(markerFor("VN").props["aria-label"],/7 người dùng/);
    assert.doesNotMatch(markerFor("VN").props["aria-label"],/9876|5432|Hanoi|Ho Chi Minh/);
    await unmount();
   }
  });

  await t.test("world switch reveals overseas activity and clears selection, hover, and focus tooltips without fetching",async()=>{
   await mount();
   const before=requests.length;
   const vn=markerFor("VN");
   await update(()=>{vn.props.onFocus();vn.props.onMouseEnter();vn.props.onClick();});
   assert.equal(markerFor("VN").props["aria-pressed"],true);assert.equal(tooltip().length,1);assertTooltipPosition("VN");
   await click(button("Thế giới"));
   assert.deepEqual(viewBox(),[0,0,800,420]);
   assert.equal(button("Thế giới").props["aria-pressed"],true);assert.equal(button("Việt Nam").props["aria-pressed"],false);
   assert.equal(tooltip().length,0);assert(markers().every(node=>node.props["aria-pressed"]===false));
   assertVisibleMarkers();assertConstantMarkerSize();
   assert(markerFor("US"));assert(markerFor("AU"));assert(markerFor("JP"));assert(markerFor("DE"));
   await click(markerFor("US"));assert.equal(tooltip().length,1);assert.match(content(tooltip()[0]),/19 người dùng/);assertTooltipPosition("US");
   await click(button("Việt Nam"));
   assert.equal(markerFor("US"),undefined);assert.equal(tooltip().length,0);assertVisibleMarkers();
   assert.equal(requests.length,before,"changing the viewport is a local presentation action");
   await unmount();
  });

  await t.test("zero or missing Vietnam totals never invent a Vietnamese marker from city rows or overseas activity",async()=>{
   const cases=[
    ready([{countryId:"VN",country:"Vietnam",activeUsers:0},{countryId:"US",country:"United States",activeUsers:19}]),
    ready([{countryId:"US",country:"United States",activeUsers:19}]),
    {...ready([]),report:{...ready([]).report,totalActiveUsers:23}},
    {status:"not_connected",canManage:false,connectAvailable:false,property:null},
   ];
   for(const data of cases){
    await mount({width:351,height:320},data);
    assert.equal(markerFor("VN"),undefined);assert.equal(markers().length,0);assert.equal(tooltip().length,0);
    await click(button("Thế giới"));
    assert.equal(markerFor("VN"),undefined);
    assert.equal(markers().length,data.report?.countries.some(row=>row.countryId==="US")?1:0);
    if(markerFor("US"))assert.match(markerFor("US").props["aria-label"],/19 người dùng/);
    await unmount();
   }
  });

  await t.test("tooltip projection and constant-pixel markers stay correct while resizing both presets",async()=>{
   await mount({width:351,height:320});
   for(const label of ["Việt Nam","Thế giới"]){
    await click(button(label));
    for(const size of [{width:296,height:320},{width:640,height:400},{width:1200,height:450},{width:3440,height:450}]){
     await resize(size.width,size.height);
     assertVisibleMarkers();assertConstantMarkerSize();
     await update(()=>markerFor("VN").props.onFocus());
     assertTooltipPosition("VN");
     assert.match(content(tooltip()[0]),/7 người dùng/);
    }
   }
   const before=requests.length;
   await resize(0,0);
   assert(viewBox().every(Number.isFinite));assertConstantMarkerSize();assert.equal(tooltip().length,0);
   await resize(351,320);assertConstantMarkerSize();assertTooltipPosition("VN");
   assert.equal(requests.length,before,"layout measurements do not reload Analytics");
   await unmount();
  });

  await t.test("viewport cropping removes an out-of-view keyboard target and its tooltip on a narrower canvas",async()=>{
   await mount({width:1200,height:450},ready([...countryRows,{countryId:"IN",country:"India",activeUsers:5}]));
   const india=markerFor("IN");assert(india,"India fixture lies in the wide regional view");
   await update(()=>india.props.onFocus());assert.equal(tooltip().length,1);
   await resize(296,320);
   assert.equal(markerFor("IN"),undefined);assert.equal(tooltip().length,0);
   assertVisibleMarkers();
   await unmount();
  });

  await t.test("existing refresh uses new country counts and removes a country that is no longer active",async()=>{
   await mount();
   await click(markerFor("VN"));assert.equal(tooltip().length,1);
   response=ready([{countryId:"VN",country:"Vietnam",activeUsers:0},{countryId:"TH",country:"Thailand",activeUsers:9}]);
   const poll=[...timers.values()].find(timer=>timer.delay===60000);assert(poll);
   await update(()=>poll.callback());
   assert.equal(markerFor("VN"),undefined);assert.equal(tooltip().length,0);
   assert.match(markerFor("TH").props["aria-label"],/9 người dùng/);
   assertVisibleMarkers();
   await unmount();
  });

  await t.test("unmeasured and invalid dimensions have finite fallback projections",async()=>{
   for(const view of ["vietnam","world"]){
    for(const size of [{width:0,height:0},{width:320,height:0},{width:-1,height:320},{width:NaN,height:320},{width:Infinity,height:320}]){
     const viewport=viewportHelpers.analyticsMapViewport(view,size);
     assert(Object.values(viewport).every(Number.isFinite));assert(viewport.scale>0);
     assert(Object.values(viewportHelpers.projectMapPoint(anchors.get("VN"),viewport)).every(Number.isFinite));
    }
   }
  });

  assert.deepEqual(unexpected,[]);
  assert(requests.every(request=>request.method==="GET"&&request.url==="/api/admin/google-analytics"));
  assert(requests.every(request=>request.init.cache==="no-store"));
  assert.equal([...documentListeners.values()].reduce((sum,listeners)=>sum+listeners.size,0),0);
 }finally{
  if(tree){const renderer=require(rendererPath);await renderer.act(async()=>tree.unmount());}
  Module._load=originalLoad;console.error=originalError;
  for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}
 }
});

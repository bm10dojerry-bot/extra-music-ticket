// Actual homepage hero/motion and Booking interactions with a synthetic DOM.
// No browser, real network, customer data or payment/order mutation is used.
// Optional matching renderer: /tmp/extra-sale-ui-test-runtime
// Run: node --test tests/stage-hero-ui.test.cjs
// These checks do not simulate CSS geometry, visual quality or native tab order.
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
const fixtureVenues=[
 {id:"moana",name:"Synthetic Moana",city:"Synthetic Sa Pa",address:"Fixture address A",capacity:2,description:"Fixture stage A"},
 {id:"ccc",name:"Synthetic CCC",city:"Synthetic Sa Pa",address:"Fixture address B",capacity:2,description:"Fixture stage B"},
];
const fixtureShows=fixtureVenues.map((venue,index)=>({
 id:"synthetic-"+venue.id,artist:"Synthetic Artist "+(index+1),title:"Synthetic Night "+(index+1),
 date:"2099-01-"+(15+index),time:"19:30",venue:venue.id,status:"announced",
 prices:{A:300000,B:200000,C:100000,D:50000},posterUrl:null,
}));
const fixtureSeats=venue=>[{id:venue+"-A1",number:1,zone:"A",x:25,y:30},{id:venue+"-B1",number:1,zone:"B",x:60,y:50}];

test("stage hero preserves navigation while scroll motion remains bounded, gated and disposable",{
 skip:rendererAvailable?false:"Optional matching React renderer is not installed.",
},async t=>{
 assert.equal(require(path.join(rendererPath,"package.json")).version,React.version);
 const originalLoad=Module._load,originalError=console.error;
 const names=["window","document","fetch","IntersectionObserver","ResizeObserver","setInterval","clearInterval","IS_REACT_ACT_ENVIRONMENT"];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(global,name)]));
 const define=(name,value)=>Object.defineProperty(global,name,{configurable:true,writable:true,value});
 const cache=new Map(),frames=new Map(),timeouts=new Map(),intervals=new Map(),observers=new Set(),resizeObservers=new Set();
 const windowListeners=new Map(),documentListeners=new Map(),mediaListeners=new Set();
 const requests=[],unexpected=[],scrolls=[],focusCalls=[],styleWrites=[];
 let tree=null,stageNode=null,nextId=0,reduced=false,commits=0,rectReads=0,clock=0;
 let servedShows=fixtureShows,inventorySold={};
 let geometry={top:0,left:0,width:1280,height:720};
 const addListener=(store,name,callback,options)=>{
  if(!store.has(name))store.set(name,new Map());
  assert(!store.get(name).has(callback),"a listener must not be registered twice");
  store.get(name).set(callback,options);
 };
 const removeListener=(store,name,callback)=>store.get(name)?.delete(callback);
 const frameRequest=callback=>{const id=++nextId;frames.set(id,callback);return id;};
 const frameCancel=id=>frames.delete(id);
 const addInterval=(callback,delay)=>{const id=++nextId;intervals.set(id,{callback,delay});return id;};
 const clearIntervalFixture=id=>intervals.delete(id);
 const mediaQuery={
  media:"(prefers-reduced-motion: reduce)",get matches(){return reduced;},
  addEventListener(name,callback){assert.equal(name,"change");mediaListeners.add(callback);},
  removeEventListener(name,callback){assert.equal(name,"change");mediaListeners.delete(callback);},
 };
 class IntersectionFixture{
  constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();observers.add(this);}
  observe(node){this.targets.add(node);}
  unobserve(node){this.targets.delete(node);}
  disconnect(){this.targets.clear();observers.delete(this);}
 }
 class ResizeFixture{
  constructor(callback){this.callback=callback;this.targets=new Set();resizeObservers.add(this);}
  observe(node){this.targets.add(node);}
  disconnect(){this.targets.clear();resizeObservers.delete(this);}
 }
 function loadSource(filename){
  filename=path.resolve(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const transpiled=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  loaded._compile(transpiled.outputText,filename);return loaded.exports;
 }
 Module._load=function(request,parent,isMain){
  if(request==="react")return React;
  if(request==="react/jsx-runtime"||request==="react/jsx-dev-runtime")return originalLoad.call(this,request,module,isMain);
  if(request.endsWith(".css"))return {__esModule:true,default:new Proxy({},{get:(_target,key)=>String(key)})};
  if(request.startsWith(".")&&parent?.filename?.startsWith(repo+path.sep)){
   const base=path.resolve(path.dirname(parent.filename),request),relative=path.relative(repo,base).split(path.sep).join("/");
   if(relative==="lib/venues")return {venues:fixtureVenues,seatsFor:fixtureSeats,zoneColors:{A:"#aa3344",B:"#4477aa",C:"#66aa66",D:"#998844"}};
   if(relative==="lib/shows")return {shows:fixtureShows,formatShowDate:value=>value.split("-").reverse().join("/")};
   if(relative==="lib/show-data")return {defaultShows:()=>structuredClone(fixtureShows)};
   if(relative==="app/live-presence")return {useLiveVisitorPresence:()=>{}};
   for(const suffix of [".tsx",".ts","/index.tsx","/index.ts"]){const candidate=base+suffix;if(fs.existsSync(candidate))return loadSource(candidate);}
  }
  return originalLoad.apply(this,arguments);
 };
 define("IS_REACT_ACT_ENVIRONMENT",true);
 define("IntersectionObserver",IntersectionFixture);define("ResizeObserver",ResizeFixture);
 define("setInterval",addInterval);define("clearInterval",clearIntervalFixture);
 define("document",{
  visibilityState:"visible",hidden:false,body:{style:{overflow:"auto"}},
  addEventListener:(name,callback,options)=>addListener(documentListeners,name,callback,options),
  removeEventListener:(name,callback)=>removeListener(documentListeners,name,callback),
  getElementById:id=>tree?.root.findAllByProps({id}).length?{
   focus(options){focusCalls.push({id,options});},
   scrollIntoView(options){scrolls.push({id,options});},
  }:null,
 });
 define("window",{
  innerHeight:800,innerWidth:1280,
  location:{href:"https://iextra.synthetic.invalid/",search:""},
  matchMedia:query=>{assert.equal(query,"(prefers-reduced-motion: reduce)");return mediaQuery;},
  requestAnimationFrame:frameRequest,cancelAnimationFrame:frameCancel,
  setTimeout(callback,delay){const id=++nextId;timeouts.set(id,{callback,delay,due:clock+delay});return id;},
  clearTimeout:id=>timeouts.delete(id),setInterval:addInterval,clearInterval:clearIntervalFixture,
  addEventListener:(name,callback,options)=>addListener(windowListeners,name,callback,options),
  removeEventListener:(name,callback)=>removeListener(windowListeners,name,callback),
  IntersectionObserver:IntersectionFixture,ResizeObserver:ResizeFixture,
 });
 define("fetch",async(input,init={})=>{
  const method=init.method||"GET";requests.push({url:input,method});
  const fixtures={
   "/api/public/shows":{shows:servedShows},
   "/api/public/media":{images:{}},
   "/api/artist-profiles":{profiles:{}},
   "/api/venue-profiles":{profiles:{}},
   "/api/public/show-inventory":{available:true,seatRows:{},inventory:servedShows.map(show=>({showId:show.id,sold:inventorySold[show.id]||0,remaining:2,capacity:100,soldOut:false,soldSeats:[],heldSeats:[],blockedSeats:[]}))},
  };
  if(method==="GET"&&Object.hasOwn(fixtures,input))return Response.json(structuredClone(fixtures[input]));
  unexpected.push({url:input,method});throw Error("Unexpected request in synthetic homepage test");
 });
 console.error=(...args)=>{if(typeof args[0]==="string"&&args[0].startsWith("react-test-renderer is deprecated"))return;originalError(...args);};

 try{
  const renderer=require(rendererPath),{act}=renderer;
  const StageHero=loadSource(path.join(repo,"app/stage-hero.tsx")).default;
  const motion=loadSource(path.join(repo,"app/stage-hero-motion.ts"));
  const Booking=loadSource(path.join(repo,"app/booking.tsx")).default;
  const update=async work=>{await act(async()=>{await work?.();});};
  function nodeMock(element){
   if(element.props["data-stage-hero"]){
    const properties=new Map(Object.entries(element.props.style||{}).map(([key,value])=>[key,String(value)]));
    const dataset={};
    for(const [key,value] of Object.entries(element.props))if(key.startsWith("data-"))dataset[key.slice(5).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]=String(value);
    stageNode={
     dataset,
     style:{setProperty(key,value){assert.equal(typeof value,"string");properties.set(key,value);styleWrites.push({key,value});},getPropertyValue:key=>properties.get(key)||"",removeProperty:key=>properties.delete(key)},
     setAttribute(key,value){if(key.startsWith("data-"))dataset[key.slice(5).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]=String(value);},
     removeAttribute(key){if(key.startsWith("data-"))delete dataset[key.slice(5).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())];},
     getAttribute(key){return key.startsWith("data-")?dataset[key.slice(5).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]??null:null;},
     getBoundingClientRect(){rectReads++;return {...geometry,bottom:geometry.top+geometry.height,right:geometry.left+geometry.width};},
     focus(){focusCalls.push("stage");},
    };
    return stageNode;
   }
   return {focus(){focusCalls.push(element.props.id||element.props["aria-label"]||element.type);}};
  }
  async function mount(component=StageHero,props={},options={}){
   assert.equal(tree===null,true,"previous renderer must be unmounted");
   reduced=Boolean(options.reduced);geometry={top:0,left:0,width:1280,height:720,...options.geometry};
   document.visibilityState=options.hidden?"hidden":"visible";document.hidden=Boolean(options.hidden);
   stageNode=null;
   await update(()=>{tree=renderer.create(React.createElement(React.Profiler,{id:"homepage",onRender:()=>commits++},React.createElement(component,props)),{createNodeMock:nodeMock});});
   assert(stageNode,"the real hero must attach its DOM ref");
  }
  async function unmount(){
   if(tree){await update(()=>tree.unmount());tree=null;}
   assert.equal(frames.size,0,"unmount cancels pending animation frames");
   assert.equal(observers.size,0);assert.equal(resizeObservers.size,0);assert.equal(mediaListeners.size,0);
   assert.equal(timeouts.size,0);assert.equal(intervals.size,0);
   for(const store of [windowListeners,documentListeners])for(const callbacks of store.values())assert.equal(callbacks.size,0);
   assert.equal(document.body.style.overflow,"auto","the introduction must never lock page scrolling");
  }
  t.afterEach(async()=>{await unmount();servedShows=fixtureShows;inventorySold={};});
  async function dispatch(store,name){await update(()=>{for(const callback of [...(store.get(name)?.keys()||[])])callback({type:name});});}
  async function flushFrames(){
   await update(()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback(100);}});
  }
  async function flushTimeouts(){
   if(timeouts.size)await advanceTimers(Math.max(...[...timeouts.values()].map(timer=>timer.due))-clock);
  }
  async function advanceTimers(milliseconds){
   clock+=milliseconds;
   await update(()=>{for(const [id,{callback,due}] of [...timeouts].sort((a,b)=>a[1].due-b[1].due)){if(due<=clock){timeouts.delete(id);callback();}}});
  }
  async function intersection(visible){
   await update(()=>{for(const observer of [...observers])observer.callback([{target:stageNode,isIntersecting:visible,intersectionRatio:visible?1:0}],observer);});
  }
  async function visibility(visible){
   document.visibilityState=visible?"visible":"hidden";document.hidden=!visible;await dispatch(documentListeners,"visibilitychange");
  }
  async function preference(value){
   reduced=value;await update(()=>{for(const callback of [...mediaListeners])callback({matches:value,media:mediaQuery.media});});
  }
  const heroLink=href=>tree.root.findByType(StageHero).findAllByType("a").find(node=>node.props.href===href);
  const variable=name=>Number(stageNode.style.getPropertyValue(name));
  const values=()=>Object.fromEntries(["open","copy-opacity","light-opacity"].map(key=>[key,variable("--stage-"+key)]));
  function assertFiniteMotion(){
   for(const [key,value] of Object.entries(values()))assert(Number.isFinite(value)&&value>=0&&value<=1,key+" must stay finite within 0..1");
  }
  async function click(node,overrides={},finish=true){
   const event={button:0,detail:1,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...overrides};
   await update(()=>node.props.onClick?.(event));
   if(finish){await flushTimeouts();await flushFrames();}
   return event;
  }
  async function returnToHero(){
   geometry.top=-geometry.height-1;await intersection(false);
   geometry.top=0;await intersection(true);await flushFrames();
  }
  function assertAccessibleChoices(){
   for(const href of ["#lich-show","#dia-diem"]){
    const link=heroLink(href);assert(link);assert.notEqual(link.props.tabIndex,-1);
    assert.match(link.props["aria-label"]||content(link),href==="#lich-show"?/ca sĩ/i:/địa điểm/i);
    for(let node=link;node;node=node.parent){
     assert.notEqual(node.props["aria-hidden"],true);assert.notEqual(node.props["aria-hidden"],"true");
     assert(!node.props.hidden);assert(node.props.inert===undefined||node.props.inert===false);
    }
   }
   const hero=tree.root.findByType(StageHero);
   for(const hidden of hero.findAll(node=>node.props["aria-hidden"]===true||node.props["aria-hidden"]==="true")){
    assert.equal(hidden.findAll(node=>(node.type==="a"&&node.props.href)||["button","input","select","textarea"].includes(node.type)||(typeof node.props.tabIndex==="number"&&node.props.tabIndex>=0)).length,0,"decorative layers must not add hidden tab targets");
   }
   assert.equal(hero.findAllByProps({"aria-modal":true}).length,0);
  }

  await t.test("motion math clamps invalid geometry and opens/fades monotonically across the scroll range",()=>{
   for(const [top,height] of [[NaN,720],[Infinity,720],[-Infinity,720],[0,0],[-10,-1],[-10,NaN],[-10,Infinity]]){
    const progress=motion.getStageProgress(top,height);assert(Number.isFinite(progress)&&progress>=0&&progress<=1);
   }
   assert.equal(motion.getStageProgress(100,720),0);assert.equal(motion.getStageProgress(0,720),0);
   assert.equal(motion.getStageProgress(-10000,720),1);
   let previous=0;
   for(let travel=0;travel<=1000;travel+=25){const progress=motion.getStageProgress(-travel,720);assert(progress>=previous);previous=progress;}
   let previousMotion=motion.getStageMotion(0);
   assert.equal(previousMotion.open,0);assert.equal(previousMotion.copyOpacity,1);
   for(let step=1;step<=20;step++){
    const current=motion.getStageMotion(step/20);
    for(const value of Object.values(current))assert(Number.isFinite(value)&&value>=0&&value<=1);
    assert(current.open>=previousMotion.open);assert(current.copyOpacity<=previousMotion.copyOpacity);assert(current.lightOpacity<=previousMotion.lightOpacity);
    previousMotion=current;
   }
   assert.equal(previousMotion.open,1);
   for(const input of [NaN,Infinity,-Infinity,-10,10])for(const value of Object.values(motion.getStageMotion(input)))assert(Number.isFinite(value)&&value>=0&&value<=1);
  });

  await t.test("the logo-free choices remain accessible links and modified clicks retain native navigation",async()=>{
   let artistCalls=0,venueCalls=0;
   await mount(StageHero,{onChooseArtist:()=>artistCalls++,onChooseVenue:()=>venueCalls++});
   await intersection(true);await flushFrames();
   assertAccessibleChoices();
   const hero=tree.root.findByType(StageHero);
   assert.equal(hero.findAllByType("img").length,0);assert.equal(hero.findAllByType("picture").length,0);
   assert.doesNotMatch(content(hero),/CUỘN ĐỂ MỞ SÂN KHẤU/);
   for(const href of ["#lich-show","#dia-diem"])for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2}]){
    assert.equal((await click(heroLink(href),modifier,false)).defaultPrevented,false);
   }
   assert.equal(artistCalls,0);assert.equal(venueCalls,0);assert.equal(timeouts.size,0);
   assert.equal(focusCalls.length,0,"the entrance animation must not steal focus");
   assert.equal(requests.length,0,"standalone hero interactions must not perform network requests");
  });

  await t.test("ordinary and keyboard choices open before navigating once, ignore repeat clicks, and reset after returning to the top",async()=>{
   let artistCalls=0,venueCalls=0;
   await mount(StageHero,{onChooseArtist:()=>artistCalls++,onChooseVenue:()=>venueCalls++});
   await intersection(true);await flushFrames();
   assert.equal((await click(heroLink("#lich-show"),{detail:0},false)).defaultPrevented,true);
   assert.equal(stageNode.dataset.navigation,"opening");assert.equal(variable("--stage-open"),1);
   assert.equal(artistCalls,0);assert.equal(timeouts.size,1);
   assertAccessibleChoices();
   await click(heroLink("#lich-show"),{},false);await click(heroLink("#dia-diem"),{},false);
   assert.equal(timeouts.size,1);assert.equal(artistCalls,0);assert.equal(venueCalls,0);
   await advanceTimers(motion.STAGE_OPEN_DURATION_MS-1);assert.equal(artistCalls,0);
   await advanceTimers(1);
   assert.equal(artistCalls,1);assert.equal(venueCalls,0);assert.equal(timeouts.size,0);assert.equal(stageNode.dataset.navigation,"opened");
   await click(heroLink("#dia-diem"),{},false);
   assert.equal(venueCalls,0);assert.equal(timeouts.size,0,"the first choice remains latched until the hero exits");
   await returnToHero();
   assert.equal(stageNode.dataset.navigation,"idle");assert.equal(variable("--stage-open"),0);assert.equal(variable("--stage-copy-opacity"),1);
   assert.equal((await click(heroLink("#dia-diem"),{},false)).defaultPrevented,true);
   assert.equal(venueCalls,0);assert.equal(timeouts.size,1);
   await advanceTimers(motion.STAGE_OPEN_DURATION_MS);
   assert.equal(venueCalls,1);assert.equal(artistCalls,1);
  });

  await t.test("scroll bursts share one frame and update DOM motion without React commits or perpetual RAF work",async()=>{
   await mount(StageHero,{onChooseArtist:()=>{},onChooseVenue:()=>{}});
   await intersection(true);await flushFrames();assertFiniteMotion();assert.equal(variable("--stage-open"),0);
   const commitCount=commits,readsBefore=rectReads;
   geometry.top=-250;
   await dispatch(windowListeners,"scroll");await dispatch(windowListeners,"scroll");await dispatch(windowListeners,"resize");
   assert.equal(frames.size,1,"all pending geometry changes should share one RAF");
   assert.equal(rectReads,readsBefore,"events must not force layout before the scheduled frame");
   await flushFrames();
   assertFiniteMotion();assert(variable("--stage-open")>0&&variable("--stage-open")<1);
   assert(variable("--stage-copy-opacity")<1);assert.equal(frames.size,0);
   assert.equal(commits,commitCount,"scroll motion must not rerender the React tree");
   assert.equal(rectReads,readsBefore+1);
   assertAccessibleChoices();
  });

  await t.test("intersection changes pause offscreen work, cancel queued frames and resume at current geometry",async()=>{
   await mount(StageHero,{onChooseArtist:()=>{},onChooseVenue:()=>{}});
   await intersection(true);await flushFrames();
   geometry.top=-120;await dispatch(windowListeners,"scroll");assert.equal(frames.size,1);
   await intersection(false);assert.equal(frames.size,0);assert.equal(stageNode.dataset.motion,"paused");
   const readsBefore=rectReads,writesBefore=styleWrites.length;
   geometry.top=-2000;await dispatch(windowListeners,"scroll");await dispatch(windowListeners,"resize");
   assert.equal(frames.size,0);assert.equal(rectReads,readsBefore);assert.equal(styleWrites.length,writesBefore);
   geometry.top=-180;await intersection(true);await flushFrames();
   assert.equal(stageNode.dataset.motion,"running");assert(variable("--stage-open")>0);assertFiniteMotion();
  });

  await t.test("a hidden document suspends frame work and visibility restores the current scroll state",async()=>{
   await mount(StageHero,{onChooseArtist:()=>{},onChooseVenue:()=>{}});
   await intersection(true);await flushFrames();
   geometry.top=-200;await dispatch(windowListeners,"scroll");assert.equal(frames.size,1);
   await visibility(false);assert.equal(frames.size,0);assert.equal(stageNode.dataset.motion,"paused");
   const readsBefore=rectReads;
   await dispatch(windowListeners,"scroll");await dispatch(windowListeners,"resize");assert.equal(frames.size,0);assert.equal(rectReads,readsBefore);
   geometry.top=-150;await visibility(true);await flushFrames();
   assert.equal(stageNode.dataset.motion,"running");assert(variable("--stage-open")>0);assertFiniteMotion();
  });

  await t.test("reduced motion keeps a readable static hero and preference changes stop pending animation work",async()=>{
   let venueCalls=0;
   await mount(StageHero,{onChooseArtist:()=>{},onChooseVenue:()=>venueCalls++},{reduced:true,geometry:{top:-250}});
   await intersection(true);await flushFrames();
   assert.equal(stageNode.dataset.motion,"reduced");assert.equal(variable("--stage-copy-opacity"),1);
   const reducedValues=values();
   geometry.top=-400;await dispatch(windowListeners,"scroll");await dispatch(windowListeners,"resize");
   assert.equal(frames.size,0);assert.deepEqual(values(),reducedValues);assertAccessibleChoices();
   await preference(false);await flushFrames();assert.equal(stageNode.dataset.motion,"running");assertFiniteMotion();
   geometry.top=-180;await dispatch(windowListeners,"scroll");assert.equal(frames.size,1);
   await preference(true);assert.equal(frames.size,0);assert.equal(stageNode.dataset.motion,"reduced");
   assert.equal(variable("--stage-copy-opacity"),1);assertAccessibleChoices();
   assert.equal((await click(heroLink("#dia-diem"),{},false)).defaultPrevented,true);
   assert.equal(venueCalls,1);assert.equal(timeouts.size,0);assert.equal(variable("--stage-copy-opacity"),1);
   await click(heroLink("#dia-diem"),{},false);assert.equal(venueCalls,1);
  });

  await t.test("enabling reduced motion during opening completes the requested navigation once without waiting for its timer",async()=>{
   let calls=0;
   await mount(StageHero,{onChooseArtist:()=>calls++,onChooseVenue:()=>{}});
   await intersection(true);await flushFrames();
   await click(heroLink("#lich-show"),{},false);assert.equal(calls,0);assert.equal(timeouts.size,1);
   await preference(true);
   assert.equal(calls,1);assert.equal(timeouts.size,0);assert.equal(stageNode.dataset.navigation,"opened");
   await advanceTimers(motion.STAGE_OPEN_DURATION_MS);assert.equal(calls,1);assert.equal(variable("--stage-copy-opacity"),1);
  });

  await t.test("unmount releases observers/listeners and cancels frames plus delayed navigation",async()=>{
   await mount(StageHero,{onChooseArtist:()=>{},onChooseVenue:()=>{}});
   await intersection(true);await flushFrames();
   await dispatch(windowListeners,"scroll");assert.equal(frames.size,1);
   assert(observers.size>0);assert(mediaListeners.size>0);
   await unmount();
   let calls=0;
   await mount(StageHero,{onChooseArtist:()=>calls++,onChooseVenue:()=>{}});
   await click(heroLink("#lich-show"),{},false);assert.equal(timeouts.size,1);
   const callback=[...timeouts.values()][0].callback;
   await unmount();
   await update(()=>callback());
   assert.equal(calls,0,"a late timer callback must not navigate after the hero unmounts");
  });

  await t.test("Booking keeps artist/venue transitions and seat selection reachable without creating an order",async()=>{
   await mount(Booking);await intersection(true);await flushFrames();
   const before=requests.length;
   const venueButton=tree.root.findAllByType("button").find(node=>String(node.props.className).startsWith("venue-card")&&content(node).includes(fixtureVenues[0].name));
   await click(venueButton);
   assert.equal(tree.root.findByProps({className:"show-grid"}).findAllByType("button").length,1);
   await returnToHero();
   assert.equal((await click(heroLink("#lich-show"))).defaultPrevented,true);
   assert.equal(tree.root.findByProps({className:"show-grid"}).findAllByType("button").length,2);
   assert.equal(scrolls.at(-1).id,"lich-show");
   assert.equal(scrolls.at(-1).options.behavior,"smooth");
   assert.deepEqual(focusCalls.at(-1),{id:"lich-show",options:{preventScroll:true}});
   assert.equal(tree.root.findByProps({id:"lich-show"}).props.tabIndex,-1);
   const selectedCard=tree.root.findByProps({className:"show-grid"}).findAllByType("button").find(node=>node.props["aria-pressed"]===true);
   assert(selectedCard,"artist mode must retain the selected show card");
   assert(content(selectedCard).includes(fixtureShows[0].artist));assert(!selectedCard.props.hidden);
   assert.match(content(tree.root.findByProps({id:"lich-show"})),/Chọn show theo ca sĩ/);
   const showButton=tree.root.findByProps({className:"show-grid"}).findAllByType("button").find(node=>content(node).includes(fixtureShows[1].artist));
   await click(showButton);assert.equal(scrolls.at(-1).id,"artist-detail");
   assert.match(content(tree.root.findByProps({id:"artist-detail"})),new RegExp(fixtureShows[1].artist));
   await click(tree.root.findByProps({className:"artist-seat-button"}));
   assert.equal(scrolls.at(-1).id,"so-do");assert.equal(tree.root.findAllByProps({id:"so-do"}).length,1);
   const seat=tree.root.findByProps({"aria-label":"Chọn ghế ccc-A1, Hạng A"});
   await click(seat);assert.equal(tree.root.findByProps({"aria-label":"Chọn ghế ccc-A1, Hạng A"}).props["aria-pressed"],true);
   await returnToHero();
   assert.equal((await click(heroLink("#dia-diem"))).defaultPrevented,true);
   assert.equal(tree.root.findAllByProps({id:"artist-detail"}).length,0);assert.equal(tree.root.findAllByProps({id:"so-do"}).length,0);
   assert.deepEqual(focusCalls.at(-1),{id:"dia-diem",options:{preventScroll:true}});
   assert.equal(tree.root.findByProps({id:"dia-diem"}).props.tabIndex,-1);assert.equal(scrolls.at(-1).id,"dia-diem");
   await returnToHero();
   await preference(true);
   await click(heroLink("#lich-show"));
   assert.equal(scrolls.at(-1).options.behavior,"auto","reduced-motion navigation must not introduce a smooth page animation");
   assert.equal(tree.root.findByProps({className:"show-grid"}).findAllByType("button").length,2);
   const previousFocusCount=focusCalls.length;
   await returnToHero();await click(heroLink("#lich-show"));
   assert.equal(focusCalls.length,previousFocusCount+1,"choosing the same mode after returning still focuses its destination");
   assert.equal(requests.length,before,"choosing views and local seats must not mutate or refetch orders");
   assert.equal([...intervals.values()].some(timer=>timer.delay===4500),false,"the unused hero carousel must not keep running");
   assert.equal([...intervals.values()].filter(timer=>timer.delay===10000).length,1,"inventory polling must remain available");
  });

  await t.test("Booking cancels destination focus if it unmounts after the opening callback",async()=>{
   await mount(Booking);await intersection(true);await flushFrames();
   const beforeFocus=focusCalls.length;
   await click(heroLink("#lich-show"),{},false);
   assert.equal(focusCalls.length,beforeFocus,"opening must precede navigation and focus");
   await advanceTimers(motion.STAGE_OPEN_DURATION_MS);
   assert.equal(focusCalls.length,beforeFocus,"focus must wait until the new view has committed");
   assert.equal(frames.size,1);
   await unmount();await flushFrames();assert.equal(focusCalls.length,beforeFocus);
  });

  await t.test("main show cards stay chronological through inventory refresh and venue filters, including the selected show",async()=>{
   servedShows=[
    {...fixtureShows[0],id:"synthetic-late",artist:"Synthetic Later",date:"2099-04-20",time:"20:00"},
    {...fixtureShows[0],id:"synthetic-past",artist:"Synthetic Past",date:"2000-01-01"},
    {...fixtureShows[1],id:"synthetic-same-late",artist:"Synthetic Same Day Later",date:"2099-03-01",time:"21:00"},
    {...fixtureShows[0],id:"synthetic-near",artist:"Synthetic Nearest",date:"2099-03-01",time:"18:00"},
    {...fixtureShows[1],id:"synthetic-ended",artist:"Synthetic Ended",date:"2099-05-01",status:"ended"},
   ];
   inventorySold={"synthetic-late":90,"synthetic-near":1};
   const expected=["synthetic-near","synthetic-same-late","synthetic-late","synthetic-ended","synthetic-past"];
   const renderedIds=()=>tree.root.findByProps({className:"show-grid"}).findAllByType("button").map(node=>servedShows.find(show=>content(node.findByType("strong"))===show.artist)?.id);
   await mount(Booking);await intersection(true);await flushFrames();
   assert.deepEqual(renderedIds(),expected,"nearest performance date/time wins even when a later show has more sales");
   assert.equal(tree.root.findAllByProps({className:"extra-upcoming"}).length,0);
   assert.doesNotMatch(content(tree.toJSON()),/4 show được mua vé nhiều nhất/);
   const beforeReads=requests.filter(request=>request.url==="/api/public/show-inventory").length;
   inventorySold={"synthetic-late":0,"synthetic-near":99,"synthetic-past":100};
   await update(async()=>{for(const timer of intervals.values())if(timer.delay===10000)await timer.callback();});
   assert.equal(requests.filter(request=>request.url==="/api/public/show-inventory").length,beforeReads+1);
   assert.deepEqual(renderedIds(),expected,"inventory changes must not reorder show cards by popularity");
   const venueButton=tree.root.findAllByType("button").find(node=>String(node.props.className).startsWith("venue-card")&&content(node).includes(fixtureVenues[0].name));
   await click(venueButton);
   assert.deepEqual(renderedIds(),["synthetic-near","synthetic-late","synthetic-past"]);
   await returnToHero();await click(heroLink("#lich-show"));
   assert.deepEqual(renderedIds(),expected,"artist browsing must retain every show after leaving a venue filter");
   const selected=tree.root.findByProps({className:"show-grid"}).findAllByType("button").filter(node=>node.props["aria-pressed"]===true);
   assert.equal(selected.length,1);assert(!selected[0].props.hidden);assert.notEqual(selected[0].props["aria-hidden"],true);
  });

  assert.deepEqual(unexpected,[]);
  assert(requests.every(request=>request.method==="GET"),"all fixture requests must remain read-only; no payment, email, visitor heartbeat or order mutation is permitted");
 }finally{
  if(tree){const renderer=require(rendererPath);await renderer.act(async()=>tree.unmount());}
  Module._load=originalLoad;console.error=originalError;
  for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}
 }
});

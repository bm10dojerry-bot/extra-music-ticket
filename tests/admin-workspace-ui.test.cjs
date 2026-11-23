// Synthetic interaction checks for the actual Admin shell and Dashboard wiring.
// No browser, customer data, real network, email, payment or database writes are used.
// Optional renderer installation outside the repository (match resolved React):
// npm install --prefix /tmp/extra-sale-ui-test-runtime --no-save --package-lock=false react@19.3.1 react-test-renderer@19.3.1
// Run: node --test tests/admin-workspace-ui.test.cjs
// Native browser focus trapping and visual geometry are not simulated here.
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
const json=value=>Response.json(structuredClone(value));
const expectedSections=["overview","shows","artists","stages","venues","landingpage-ads","tickets","staff-sales","live-monitor","support-chats","seats","checkin","financials","show-costs","sale-performance","sale-commission","staff-users","staff-reports","staff-overview","gioi-thieu","tuyen-dung","lien-he"];
const owner={id:"owner",username:"owner",display_name:"Synthetic Owner",role:"admin",active:true};
const manager={id:"synthetic-manager",username:"manager",display_name:"Synthetic Show Manager",role:"show_manager",active:true};

test("Admin navigation preserves editing context and verifies new-show artist uploads",{
 skip:rendererAvailable?false:"Optional matching React renderer is not installed; see the installation command above.",
},async t=>{
 assert.equal(require(path.join(rendererPath,"package.json")).version,React.version);
 const originalLoad=Module._load,originalError=console.error;
 const originals=new Map(["window","document","fetch","IS_REACT_ACT_ENVIRONMENT"].map(name=>[name,Object.getOwnPropertyDescriptor(global,name)]));
 const define=(name,value)=>Object.defineProperty(global,name,{configurable:true,writable:true,value});
 const cache=new Map(),leaves=new Map(),frames=new Map(),domById=new Map();
 const focusCalls=[],scrollCalls=[],requests=[],unexpected=[],historyCalls=[];
 const mediaListeners=new Set();
 let tree=null,frameId=0,desktopMatches=false,dialogNode=null;
 const fixtureShow={id:"synthetic-show-alpha",artist:"Synthetic Artist Alpha",title:"Synthetic Show",date:"2099-01-15",time:"20:00",venue:"ccc",status:"announced",prices:{A:500000,B:400000,C:300000,D:200000},posterUrl:null};
 const dynamicShow={...fixtureShow,id:"phamtruong02012007",artist:"Phạm Trưởng & Onis",status:"hidden"};
 const dynamicSlot="artist-"+dynamicShow.id;
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
 let managedShows=[fixtureShow],publicImages={},mediaUploadHandler=null,publicMediaHandler=null,showListHandler=null,showSaveHandler=null;
 const fixtureVenue={id:"ccc",name:"Synthetic Venue",city:"Synthetic City",address:"Synthetic Address",capacity:550,description:"Fixture only"};
 const fixtureReport={updatedAt:"2099-01-01T00:00:00Z",filters:{from:"",to:"",showId:"",saleId:""},shows:[fixtureShow],policies:{},commissionByShow:[],commissionBySeller:[],commissionTotal:0,commissionComplete:true,commissionIssues:[],bySeller:[],byDay:[],summary:[],totals:{orders:0,tickets:0,commissionTickets:0,complimentaryTickets:0,revenue:0,commissionPendingOrders:0},rows:[],rowCount:0,rowsLimited:false,limited:false,verifiedOnly:true,onlineOrders:0};

 function leaf(name) {
  if(!leaves.has(name)){const component=props=>React.createElement("div",{"data-admin-leaf":name},props.children);component.displayName="Fixture_"+name;leaves.set(name,component);}
  return leaves.get(name);
 }
 const leafPaths=new Set([
  "app/staff/workspace","app/admin/tickets/ticket-dashboard","app/admin/financial-breakdown",
  "app/admin/sale-commission-manager","app/admin/detailed-charts","app/admin/show-landing-editor",
  "app/admin/landing-analytics","app/admin/live-monitor","app/admin/zalo-delivery-admin",
  "app/admin/seat-row-manager","app/admin/site-page-editor","app/support-inbox","app/checkin/scanner-client",
 ]);
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
  if(request==="next/dynamic")return {__esModule:true,default:loader=>{
   const name=loader.toString().match(/(?:require|import)\(["']([^"']+)["']/)?.[1];
   assert(name,"Dynamic panel must retain a statically analyzable import");
   return leaf(path.basename(name));
  }};
  if(request.startsWith(".")&&parent?.filename?.startsWith(repo+path.sep)){
   const base=path.resolve(path.dirname(parent.filename),request),relative=path.relative(repo,base).split(path.sep).join("/");
   if(leafPaths.has(relative))return {__esModule:true,default:leaf(path.basename(base))};
   if(relative==="lib/venues")return {venues:[fixtureVenue],seatsFor:()=>[]};
   if(relative==="lib/shows")return {shows:[fixtureShow]};
   if(relative==="lib/show-data")return {defaultShows:()=>[fixtureShow]};
   for(const suffix of [".tsx",".ts","/index.tsx","/index.ts"]){const candidate=base+suffix;if(fs.existsSync(candidate))return loadSource(candidate);}
  }
  return originalLoad.apply(this,arguments);
 };
 define("IS_REACT_ACT_ENVIRONMENT",true);
 define("document",{body:{style:{overflow:"auto"}},activeElement:null});
 define("window",{
  location:{href:"https://admin.synthetic.invalid/?ga4=connected&keep=fixture#anchor"},
  history:{state:{synthetic:true},replaceState(state,title,url){historyCalls.push({state,title,url:String(url)});window.location.href=String(url);}},
  requestAnimationFrame(callback){const id=++frameId;frames.set(id,callback);return id;},
  cancelAnimationFrame(id){frames.delete(id);},
  scrollTo(options){scrollCalls.push(options);},
  matchMedia(query){assert.equal(query,"(min-width: 901px)");return {get matches(){return desktopMatches;},addEventListener(name,callback){assert.equal(name,"change");mediaListeners.add(callback);},removeEventListener(name,callback){assert.equal(name,"change");mediaListeners.delete(callback);}};},
 });
 define("fetch",async(input,init={})=>{
  const method=init.method||"GET";
  requests.push({url:input,method,init});
  if(method==="POST"&&input==="/api/admin/media"&&mediaUploadHandler)return mediaUploadHandler(init);
  if(method==="GET"&&input==="/api/public/media"&&publicMediaHandler)return publicMediaHandler(init);
  if(method==="GET"&&input==="/api/admin/shows"&&showListHandler)return showListHandler(init);
  if(method==="POST"&&input==="/api/admin/shows"&&showSaveHandler)return showSaveHandler(init);
  const fixtures={
   "/api/public/media":{images:publicImages},
   "/api/admin/shows":{shows:managedShows},
   "/api/admin/venues":{venues:[]},
   "/api/venue-profiles":{profiles:{}},
   "/api/staff/reports":fixtureReport,
   "/api/admin/staff":{staff:[]},
   "/api/artist-profiles":{profiles:{}},
  };
  if(method==="GET"&&Object.hasOwn(fixtures,input))return json(fixtures[input]);
  unexpected.push({url:input,method});throw Error("Unexpected request in synthetic Admin navigation test");
 });
 console.error=(...args)=>{if(typeof args[0]==="string"&&args[0].startsWith("react-test-renderer is deprecated"))return;originalError(...args);};

 try{
  const renderer=require(rendererPath),{act}=renderer;
  const navigation=loadSource(path.join(repo,"app/admin/admin-navigation.ts"));
  const AdminWorkspace=loadSource(path.join(repo,"app/admin/admin-workspace.tsx")).default;
  const Dashboard=loadSource(path.join(repo,"app/admin/dashboard.tsx")).default;
  const media=loadSource(path.join(repo,"lib/media.ts"));
  function Harness({actor=owner,initialSection="overview"}) {
   const [section,setSection]=React.useState(()=>navigation.resolveAdminSection(initialSection,actor.role));
   return React.createElement(AdminWorkspace,{actor,section,onNavigate:next=>setSection(navigation.resolveAdminSection(next,actor.role))},React.createElement("section",{"data-current-section":section},section));
  }
  const update=async work=>{await act(async()=>{await work?.();});};
  async function flushFrames(){await update(()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback();}});}
  async function mount(component,props) {
   assert.equal(tree,null);desktopMatches=false;domById.clear();dialogNode=null;
   await update(()=>{tree=renderer.create(React.createElement(component,props),{createNodeMock:element=>{
    const node={focus(options){focusCalls.push({id:element.props.id||element.props["aria-label"],options});document.activeElement=node;}};
    if(element.props.id)domById.set(element.props.id,node);
    if(element.type==="dialog"){
     Object.assign(node,{open:false,shows:0,closes:0,showModal(){assert.equal(this.open,false);this.open=true;this.shows++;this.previousFocus=document.activeElement;},close(){assert.equal(this.open,true);this.open=false;this.closes++;this.previousFocus?.focus();}});
     dialogNode=node;
    }
    return node;
   }});});
   await flushFrames();
  }
  async function unmount(){if(tree){await update(()=>tree.unmount());tree=null;}assert.equal(frames.size,0);assert.equal(mediaListeners.size,0);}
  const byId=id=>tree.root.findByProps({id});
  const buttonsWithPrefix=prefix=>tree.root.findAllByType("button").filter(node=>typeof node.props.id==="string"&&node.props.id.startsWith(prefix));
  const click=async node=>{domById.get(node.props.id)?.focus();await update(()=>node.props.onClick());await flushFrames();};
  const openMenu=()=>click(byId("admin-mobile-more"));
  const searchIn=label=>tree.root.findAllByType("label").find(node=>content(node).includes(label)).findByType("input");
  const fieldIn=(label,type="input")=>tree.root.findAllByType("label").find(node=>content(node).startsWith(label)).findByType(type);
  const buttonText=text=>tree.root.findAllByType("button").find(node=>content(node).startsWith(text));
  const artistCard=artist=>tree.root.findAllByProps({className:"admin-media-artist-card"}).find(card=>content(card.findByType("h3"))===artist);
  async function chooseFile(input,file){
   const target={files:[file],value:file.name};
   await update(()=>input.props.onChange({target}));
   assert.equal(target.value,"","clearing the picker permits selecting the same file again after an error");
  }

  await t.test("all 22 sections resolve correctly, including content deep links, and restricted IDs fall back safely",async()=>{
   assert.deepEqual([...navigation.adminSections.map(item=>item.id)].sort(),[...expectedSections].sort());
   for(const id of expectedSections)assert.equal(navigation.resolveAdminSection(id,"admin"),id);
   for(const bad of [undefined,null,"","unknown","__proto__","constructor",["shows"]])assert.equal(navigation.resolveAdminSection(bad,"admin"),"overview");
   for(const id of ["sale-performance","sale-commission"])assert.equal(navigation.resolveAdminSection(id,"show_manager"),"overview");
   for(const id of ["shows","artists","stages","venues","landingpage-ads"])assert.equal(navigation.resolveAdminSection(id,"show_manager"),id);
  });

  await t.test("every existing Admin function is reachable in the mobile More menu and moves focus to the selected heading",async()=>{
   await mount(Harness,{});
   assert.deepEqual(buttonsWithPrefix("admin-nav-").map(node=>node.props.id.slice("admin-nav-".length)).sort(),[...expectedSections].sort());
   assert.equal(byId("admin-panel").props["aria-labelledby"],"admin-workspace-title");
   for(const id of expectedSections){
    await openMenu();
    assert.equal(dialogNode.open,true);assert.equal(document.body.style.overflow,"hidden");
    assert.equal(byId("admin-mobile-more").props["aria-expanded"],true);
    assert.deepEqual(buttonsWithPrefix("admin-menu-").map(node=>node.props.id.slice("admin-menu-".length)).sort(),[...expectedSections].sort());
    const previous=tree.root.findByType(Harness).findByType(AdminWorkspace).props.section;
    await click(byId("admin-menu-"+id));
    assert.equal(tree.root.findByProps({"data-current-section":id}).children[0],id);
    assert.equal(byId("admin-nav-"+id).props["aria-current"],"page");
    assert.equal(byId("admin-menu-"+id).props["aria-current"],"page");
    assert.equal(dialogNode.open,false);assert.equal(document.body.style.overflow,"auto");
    assert.equal(byId("admin-mobile-more").props["aria-expanded"],false);
    if(previous!==id)assert.equal(focusCalls.at(-1).id,"admin-workspace-title");
   }
   assert.equal(requests.length,0,"navigation shell performs no network requests");
   await unmount();
  });

  await t.test("search accepts Vietnamese without accents and resets after selecting an item",async()=>{
   await mount(Harness,{});
   await update(()=>searchIn("Tìm mục quản trị").props.onChange({target:{value:"hoa hong"}}));
   assert.deepEqual(buttonsWithPrefix("admin-nav-").map(node=>node.props.id),["admin-nav-sale-commission"]);
   await click(byId("admin-nav-sale-commission"));
   assert.equal(searchIn("Tìm mục quản trị").props.value,"");
   await openMenu();
   await update(()=>searchIn("Tìm chức năng quản trị").props.onChange({target:{value:"dia diem"}}));
   assert(buttonsWithPrefix("admin-menu-").some(node=>node.props.id==="admin-menu-stages"));
   await update(()=>searchIn("Tìm chức năng quản trị").props.onChange({target:{value:"zzznomatch"}}));
   assert.equal(buttonsWithPrefix("admin-menu-").length,0);
   assert.match(content(byId("admin-menu-dialog")),/Không tìm thấy mục phù hợp/);
   await update(()=>searchIn("Tìm chức năng quản trị").props.onChange({target:{value:"nhan vien"}}));
   await click(byId("admin-menu-staff-users"));
   await openMenu();assert.equal(searchIn("Tìm chức năng quản trị").props.value,"");
   await unmount();assert.equal(document.body.style.overflow,"auto");
  });

  await t.test("mobile shortcuts honor role, and account actions use the actual account and applicable logout route",async()=>{
   for(const actor of [owner,manager,{...owner,id:"synthetic-staff-admin",display_name:"Synthetic Staff Admin"}]){
    await mount(Harness,{actor,initialSection:actor.role==="show_manager"?"sale-performance":"overview"});
    const shortcuts=tree.root.findByProps({"aria-label":"Truy cập nhanh Admin"}).findAllByType("button");
    assert.equal(shortcuts.length,5);
    assert.equal(byId("admin-mobile-"+(actor.role==="admin"?"sale-performance":"shows")).props.type,"button");
    if(actor.role==="show_manager"){
     assert.equal(buttonsWithPrefix("admin-nav-").some(node=>node.props.id==="admin-nav-sale-performance"),false);
     assert.equal(buttonsWithPrefix("admin-menu-").some(node=>node.props.id==="admin-menu-sale-commission"),false);
     assert.equal(tree.root.findByProps({"data-current-section":"overview"}).children[0],"overview");
     assert.match(content(tree.toJSON()),/Quản lý show/);
    }
    assert.match(content(tree.toJSON()),new RegExp(actor.display_name));
    for(const form of tree.root.findAllByType("form")){assert.equal(form.props.method,"post");assert.equal(form.props.action,actor.id==="owner"?"/api/admin/logout":"/api/staff/logout");}
    for(const link of tree.root.findAllByType("a").filter(node=>content(node).includes("Xem website")))assert.equal(link.props.href,"https://iextra.net/");
    assert.equal(tree.root.findAllByType("a").filter(node=>node.props.href==="/reset-password?from=admin").length,2);
    await unmount();
   }
  });

  await t.test("Escape, close button, and backdrop synchronize the dialog and restore scrolling and trigger focus",async()=>{
   await mount(Harness,{});
   const dismissals=[
    async()=>{let prevented=false;await update(()=>byId("admin-menu-dialog").props.onCancel({preventDefault(){prevented=true;}}));assert.equal(prevented,true);},
    async()=>click(tree.root.findByProps({"aria-label":"Đóng menu quản trị"})),
    async()=>{const backdrop={};await update(()=>byId("admin-menu-dialog").props.onClick({target:backdrop,currentTarget:backdrop}));},
   ];
   for(const dismiss of dismissals){
    await openMenu();assert.equal(dialogNode.open,true);
    assert.equal(focusCalls.at(-1).id,"Đóng menu quản trị","opening More does not autofocus the search input/mobile keyboard");
    await dismiss();assert.equal(dialogNode.open,false);assert.equal(document.body.style.overflow,"auto");
    assert.equal(byId("admin-mobile-more").props["aria-expanded"],false);
    assert.equal(focusCalls.at(-1).id,"admin-mobile-more");
    assert.equal(mediaListeners.size,0);
   }
   await openMenu();
   await update(()=>byId("admin-menu-dialog").props.onClick({target:{},currentTarget:{}}));
   assert.equal(dialogNode.open,true,"clicks inside the sheet do not dismiss it");
   await unmount();assert.equal(document.body.style.overflow,"auto");
  });

  await t.test("desktop resizing and unmount restore the prior body overflow and release modal listeners",async()=>{
   document.body.style.overflow="clip";
   await mount(Harness,{});
   await openMenu();assert.equal(document.body.style.overflow,"hidden");assert.equal(mediaListeners.size,1);
   await update(()=>{desktopMatches=true;for(const listener of [...mediaListeners])listener();});
   assert.equal(dialogNode.open,false);assert.equal(document.body.style.overflow,"clip");
   assert.equal(byId("admin-mobile-more").props["aria-expanded"],false);assert.equal(mediaListeners.size,0);
   desktopMatches=false;await openMenu();const before=dialogNode.closes;
   await unmount();assert.equal(dialogNode.closes,before+1);assert.equal(document.body.style.overflow,"clip");
   document.body.style.overflow="auto";
  });

  await t.test("Dashboard preserves show/poster drafts and the exact show-cost crosslink while navigation retains OAuth parameters",async()=>{
   await mount(Dashboard,{actor:owner,initialSection:"shows"});
   assert.equal(tree.root.findByType(AdminWorkspace).props.section,"shows");
   assert.equal(requests.filter(request=>request.url==="/api/admin/shows").length,1);
   const artist=fieldIn("Ca sĩ / nhóm nhạc");
   await update(()=>artist.props.onChange({target:{value:"Synthetic Unsaved Artist"}}));
   const picker=tree.root.findAllByType("input").find(node=>node.props.type==="file");
   await update(()=>picker.props.onChange({target:{files:[new File(["synthetic-image"],"synthetic.png",{type:"image/png"})],value:"synthetic.png"}}));
   const preview=tree.root.findAllByType("img").find(node=>node.props.alt==="Poster Synthetic Unsaved Artist").props.src;
   assert.match(preview,/^blob:/);
   await click(byId("admin-nav-tickets"));
   assert.equal(tree.root.findByType(leaf("ticket-dashboard")).props.embedded,true);
   const url=new URL(window.location.href);
   assert.equal(url.pathname,"/admin");assert.equal(url.searchParams.get("section"),"tickets");
   assert.equal(url.searchParams.get("ga4"),"connected");assert.equal(url.searchParams.get("keep"),"fixture");assert.equal(url.hash,"#anchor");
   assert.deepEqual(historyCalls.at(-1).state,{synthetic:true});
   await click(byId("admin-nav-shows"));
   assert.equal(fieldIn("Ca sĩ / nhóm nhạc").props.value,"Synthetic Unsaved Artist");
   assert.equal(tree.root.findAllByType("img").find(node=>node.props.alt==="Poster Synthetic Unsaved Artist").props.src,preview);
   await click(buttonText("Mở quản lý chi phí show này"));
   const costs=tree.root.findByType(leaf("financial-breakdown"));
   assert.equal(costs.props.mode,"editor");assert.equal(costs.props.initialShowId,fixtureShow.id);
   await click(byId("admin-nav-overview"));
   assert.equal(new URL(window.location.href).searchParams.has("section"),false);
   assert.equal(new URL(window.location.href).searchParams.get("ga4"),"connected");
   await click(byId("admin-nav-show-costs"));
   assert.equal(tree.root.findByType(leaf("financial-breakdown")).props.initialShowId,"","generic menu entry clears the specific show-cost context");
   assert.equal(requests.filter(request=>request.url==="/api/admin/shows").length,1,"navigation must not reload shows and overwrite a draft");
   assert.equal(requests.every(request=>request.method==="GET"),true);
   await unmount();URL.revokeObjectURL(preview);
  });

  await t.test("Dashboard preserves media crosslinks and all landing-page children without mounting unrelated panels",async()=>{
   await mount(Dashboard,{actor:owner,initialSection:"stages"});
   await click(buttonText("Quản lý ảnh sân khấu"));
   assert.equal(tree.root.findByType(AdminWorkspace).props.section,"venues");
   assert.equal(tree.root.findAllByProps({className:"admin-media-venue-cards"}).length,1);
   await click(byId("admin-nav-venues"));
   assert.equal(tree.root.findAllByProps({className:"admin-media-artist-cards"}).length,1,"the ordinary media menu returns to the artist category");
   await click(artistCard(fixtureShow.artist).findAllByType("button").find(node=>content(node).startsWith("Sửa tiểu sử")));
   assert.equal(tree.root.findByType(AdminWorkspace).props.section,"artists");
   assert.equal(tree.root.findAllByType("h3").some(node=>content(node)===fixtureShow.artist),true);
   await click(byId("admin-nav-landingpage-ads"));
   assert.equal(tree.root.findAllByType(leaf("landing-analytics")).length,1);
   assert.equal(tree.root.findAllByType(leaf("zalo-delivery-admin")).length,1);
   await update(()=>byId("landing-show-picker").props.onChange({target:{value:fixtureShow.id}}));
   assert.equal(tree.root.findByType(leaf("show-landing-editor")).props.showId,fixtureShow.id);
   assert.equal(tree.root.findByType(leaf("show-landing-editor")).props.showReady,true);
   for(const name of ["ticket-dashboard","financial-breakdown","live-monitor","seat-row-manager","scanner-client"])assert.equal(tree.root.findAllByType(leaf(name)).length,0);
   await unmount();
  });

  await t.test("a saved new show appears in the artist grid and its PNG preview updates only after public verification",async()=>{
   managedShows=[fixtureShow,dynamicShow];publicImages={};
   await mount(Dashboard,{actor:owner,initialSection:"venues"});
   const card=artistCard(dynamicShow.artist);assert(card,"saved artists outside the original catalog must have an upload control");
   const expectedArtistCount=media.getMediaSlots(managedShows).filter(slot=>slot.id.startsWith("artist-")).length;
   assert.equal(tree.root.findAllByProps({className:"admin-media-artist-card"}).length,expectedArtistCount);
   assert.match(content(tree.root.findByProps({className:"admin-media-search"})),new RegExp("0/"+expectedArtistCount+" ảnh đã tải"));
   const file=new File([png],"transparent-new-artist.png",{type:"image/png"});
   const uploadedUrl="https://media.synthetic.invalid/"+dynamicSlot+"/new-transparent.png";
   let releaseVerification;
   const verification=new Promise(resolve=>{releaseVerification=resolve;});
   const before=requests.length;
   mediaUploadHandler=async init=>{
    assert(init.body instanceof FormData);assert.equal(init.body.get("slot"),dynamicSlot);
    const sent=init.body.get("file");assert(sent instanceof File);assert.equal(sent.name,file.name);assert.equal(sent.type,"image/png");
    assert.deepEqual(Buffer.from(await sent.arrayBuffer()),png,"the client sends the original transparent PNG bytes");
    return json({ok:true,url:uploadedUrl});
   };
   publicMediaHandler=()=>verification;
   await chooseFile(card.findByType("input"),file);
   assert.equal(artistCard(dynamicShow.artist).findAllByType("img").length,0,"an upload response alone must not display an unverified image");
   assert.equal(byId("media-upload-status-"+dynamicSlot).props.role,"status");
   assert.match(content(byId("media-upload-status-"+dynamicSlot)),/Đang xác minh/);
   assert(tree.root.findAllByType("input").filter(node=>node.props.type==="file").every(node=>node.props.disabled));
   await update(()=>releaseVerification(json({images:{[dynamicSlot]:uploadedUrl}})));
   assert.equal(artistCard(dynamicShow.artist).findByType("img").props.src,uploadedUrl);
   assert.match(content(byId("media-upload-status-"+dynamicSlot)),/Đã tải và xác minh/);
   assert.equal(artistCard(dynamicShow.artist).findByType("input").props["aria-describedby"],"media-upload-status-"+dynamicSlot);
   assert.equal(artistCard(dynamicShow.artist).findByType("input").props.disabled,false);
   assert.deepEqual(requests.slice(before).map(request=>[request.method,request.url]),[["POST","/api/admin/media"],["GET","/api/public/media"]]);
   await click(artistCard(dynamicShow.artist).findAllByType("button").find(node=>content(node).startsWith("Sửa tiểu sử")));
   assert.equal(tree.root.findByType(AdminWorkspace).props.section,"artists");
   assert.equal(tree.root.findByProps({alt:"Ảnh PNG "+dynamicShow.artist}).props.src,uploadedUrl);
   assert.equal(tree.root.findByProps({"aria-label":"Tải ảnh PNG cho "+dynamicShow.artist}).props["aria-describedby"],"media-upload-status-"+dynamicSlot);
   assert.match(content(byId("media-upload-status-"+dynamicSlot)),/Đã tải và xác minh/);
   await unmount();mediaUploadHandler=null;publicMediaHandler=null;
  });

  await t.test("a stale public URL reports a local artist error and preserves the last verified preview",async()=>{
   const oldUrl="https://media.synthetic.invalid/"+dynamicSlot+"/previous.png";
   const newUrl="https://media.synthetic.invalid/"+dynamicSlot+"/replacement.png";
   publicImages={[dynamicSlot]:oldUrl};
   await mount(Dashboard,{actor:owner,initialSection:"venues"});
   await click(artistCard(dynamicShow.artist).findAllByType("button").find(node=>content(node).startsWith("Sửa tiểu sử")));
   mediaUploadHandler=()=>json({ok:true,url:newUrl});
   const before=requests.length;
   await chooseFile(tree.root.findByProps({"aria-label":"Tải ảnh PNG cho "+dynamicShow.artist}),new File([png],"retry.png",{type:"image/png"}));
   const feedback=byId("media-upload-status-"+dynamicSlot);
   assert.equal(feedback.props.role,"alert");assert.match(content(feedback),/Khung xem trước chưa cập nhật/);
   assert.doesNotMatch(content(feedback),/Đã tải và xác minh/);
   assert.equal(tree.root.findByProps({alt:"Ảnh PNG "+dynamicShow.artist}).props.src,oldUrl);
   assert.equal(tree.root.findByProps({"aria-label":"Tải ảnh PNG cho "+dynamicShow.artist}).props.disabled,false);
   assert.deepEqual(requests.slice(before).map(request=>[request.method,request.url]),[["POST","/api/admin/media"],["GET","/api/public/media"]]);
   await click(byId("admin-nav-venues"));
   assert.equal(artistCard(dynamicShow.artist).findByType("img").props.src,oldUrl);
   assert.equal(byId("media-upload-status-"+dynamicSlot).props.role,"alert","the error stays attached to the same artist across views");
   await unmount();mediaUploadHandler=null;publicImages={};
  });

  await t.test("non-JSON 413 and malformed success responses show actionable local errors without verification or false previews",async()=>{
   await mount(Dashboard,{actor:owner,initialSection:"venues"});
   for(const scenario of [
    {response:()=>new Response("Request Entity Too Large",{status:413,headers:{"Content-Type":"text/plain"}}),message:/tối đa 4 MB/},
    {response:()=>new Response("<html>not JSON</html>",{status:200,headers:{"Content-Type":"text/html"}}),message:/dữ liệu ảnh không hợp lệ/},
    {response:()=>json({ok:true,url:""}),message:/Chưa nhận được đường dẫn ảnh/},
   ]){
    mediaUploadHandler=scenario.response;const before=requests.length;
    await chooseFile(artistCard(dynamicShow.artist).findByType("input"),new File([png],"same-file.png",{type:"image/png"}));
    const feedback=byId("media-upload-status-"+dynamicSlot);
    assert.equal(feedback.props.role,"alert");assert.match(content(feedback),scenario.message);
    assert.equal(artistCard(dynamicShow.artist).findAllByType("img").length,0);
    assert.equal(artistCard(dynamicShow.artist).findByType("input").props.disabled,false);
    assert.deepEqual(requests.slice(before).map(request=>[request.method,request.url]),[["POST","/api/admin/media"]]);
   }
   await unmount();mediaUploadHandler=null;
  });

  await t.test("client MIME, empty-file and size checks block invalid artist uploads before any request",async()=>{
   await mount(Dashboard,{actor:owner,initialSection:"venues"});
   const before=requests.length;
   for(const scenario of [
    {file:new File([png],"unsupported.svg",{type:"image/svg+xml"}),message:/Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP/},
    {file:new File([],"empty.png",{type:"image/png"}),message:/Tệp ảnh rỗng/},
    {file:new File([Buffer.alloc(media.MAX_MEDIA_UPLOAD_BYTES+1)],"oversized.png",{type:"image/png"}),message:/vượt quá 4 MB/},
   ]){
    await chooseFile(artistCard(dynamicShow.artist).findByType("input"),scenario.file);
    const feedback=byId("media-upload-status-"+dynamicSlot);
    assert.equal(feedback.props.role,"alert");assert.match(content(feedback),scenario.message);
   }
   assert.equal(requests.length,before);
   await unmount();managedShows=[fixtureShow];publicImages={};
  });

  await t.test("saving a hidden new show exposes its artist immediately and a stale initial load cannot remove it",async()=>{
   let releaseInitialLoad,showReads=0,saved=false;
   const initialLoad=new Promise(resolve=>{releaseInitialLoad=resolve;});
   showListHandler=()=>{
    showReads++;
    if(showReads===1)return initialLoad;
    assert.equal(saved,true,"verification must follow the successful synthetic save");
    return json({shows:[fixtureShow,{...dynamicShow,status:"announced",rawStatus:"hidden"}]});
   };
   showSaveHandler=init=>{
    const body=JSON.parse(init.body);
    assert.equal(body.id,dynamicShow.id);assert.equal(body.artist,dynamicShow.artist);assert.equal(body.status,"hidden");
    saved=true;return json({ok:true});
   };
   const before=requests.length;
   await mount(Dashboard,{actor:owner,initialSection:"shows"});
   assert.equal(showReads,1);
   await click(buttonText("+ Thêm show"));
   for(const [label,value,type] of [
    ["Mã show",dynamicShow.id,"input"],
    ["Ca sĩ / nhóm nhạc",dynamicShow.artist,"input"],
    ["Trạng thái","hidden","select"],
   ])await update(()=>fieldIn(label,type).props.onChange({target:{value}}));
   await click(buttonText("Lưu & Đăng lên trang chủ"));
   assert.equal(saved,true);assert.equal(showReads,2);
   assert.equal(fieldIn("Trạng thái","select").props.value,"hidden","the raw stored visibility survives verification normalization");
   assert.equal(fieldIn("Mã show").props.disabled,true,"the saved show is now part of the managed list");
   await click(byId("admin-nav-venues"));
   assert(artistCard(dynamicShow.artist),"the saved new artist is available without a page reload");
   await update(()=>releaseInitialLoad(json({shows:[fixtureShow]})));
   assert(artistCard(dynamicShow.artist),"an older initial request must not overwrite the verified saved show");
   assert.equal(tree.root.findAllByProps({className:"admin-media-artist-card"}).filter(card=>content(card.findByType("h3"))===dynamicShow.artist).length,1);
   await click(byId("admin-nav-shows"));
   assert.equal(fieldIn("Ca sĩ / nhóm nhạc").props.value,dynamicShow.artist);
   assert.equal(fieldIn("Trạng thái","select").props.value,"hidden");
   assert.equal(requests.slice(before).filter(request=>request.method==="POST").length,1);
   assert.equal(requests.slice(before).find(request=>request.method==="POST").url,"/api/admin/shows","saving this fixture must not trigger any other mutation");
   await unmount();showListHandler=null;showSaveHandler=null;
  });

  assert.deepEqual(unexpected,[]);
  assert.equal(requests.every(request=>request.method==="GET"||(request.method==="POST"&&["/api/admin/media","/api/admin/shows"].includes(request.url))),true,"only explicit synthetic image/show fixture actions may POST; no customer, order, email or payment mutation is permitted");
 }finally{
  if(tree){const renderer=require(rendererPath);await renderer.act(async()=>tree.unmount());}
  Module._load=originalLoad;console.error=originalError;
  for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}
 }
});

// Synthetic interaction checks for the actual Sale components; no browser,
// customer data, network, email, payment or database writes are used.
// Install the optional renderer outside the repo using the project's React version:
// npm install --prefix /tmp/extra-sale-ui-test-runtime --no-save --package-lock=false react@19.3.1 react-test-renderer@19.3.1
// Run: node --test tests/sale-workspace-ui.test.cjs
// Set EXTRA_SALE_UI_TEST_RUNTIME to another directory containing node_modules.
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
const code="EX0011223344556677",otherCode="EX8899AABBCCDDEEFF";
const ticketUrl=orderCode=>"https://iextra.net/ve?ticket="+orderCode+"."+"a".repeat(64);
const json=(value,status=200)=>Response.json(structuredClone(value),{status});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const content=node=>node===null||node===undefined?"":typeof node==="string"||typeof node==="number"?String(node):Array.isArray(node)?node.map(content).join(""):(node.children||[]).map(content).join("");

test("actual Sale workspace and signed-ticket copying preserve user state",{
 skip:rendererAvailable?false:"Optional React renderer is not installed; see the temporary-runtime install command above.",
},async t=>{
 assert.equal(require(path.join(rendererPath,"package.json")).version,React.version,"the temporary renderer must match the project's resolved React version");
 const originalLoad=Module._load,originalError=console.error;
 const names=["fetch","navigator","window","document","setInterval","clearInterval","IS_REACT_ACT_ENVIRONMENT"];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(global,name)]));
 const cache=new Map(),timers=new Map(),requests=[],clipboardWrites=[],focusCalls=[],selectCalls=[],unexpected=[];
 const listeners=new Map();let timerId=0,tree=null,renderer;
 const define=(name,value)=>Object.defineProperty(global,name,{configurable:true,writable:true,value});
 const fixtureShow={id:"synthetic-show-alpha",artist:"Synthetic Artist Alpha",date:"2099-01-15",time:"20:00",venue:"ccc",status:"selling",prices:{A:500000,B:400000,C:300000,D:200000}};
 const laterShow={...fixtureShow,id:"synthetic-show-beta",artist:"Synthetic Artist Beta",date:"2099-02-15",venue:"laocai"};
 const fixtureChat={id:"synthetic-chat",show_id:fixtureShow.id,customer_name:"Synthetic Chat Customer",customer_phone:null,status:"open",created_at:"2099-01-01T00:00:00Z",updated_at:"2099-01-01T00:00:00Z",last_customer_at:null,last_staff_at:null,assigned_staff_id:"synthetic-sale",assigned_at:"2099-01-01T00:00:00Z",channel:"website"};
 const secondChat={...fixtureChat,id:"synthetic-chat-beta",customer_name:"Synthetic Chat Customer Beta"};
 const fixtureReport={updatedAt:"2099-01-01T00:00:00Z",filters:{from:"",to:"",showId:"",saleId:""},shows:[{id:fixtureShow.id,artist:fixtureShow.artist,date:fixtureShow.date}],policies:{},commissionByShow:[],commissionBySeller:[],commissionTotal:0,commissionComplete:true,commissionIssues:[],bySeller:[],byDay:[],summary:[],totals:{orders:0,tickets:0,commissionTickets:0,complimentaryTickets:0,revenue:0,commissionPendingOrders:0},rows:[],rowCount:0,rowsLimited:false,limited:false,verifiedOnly:true,onlineOrders:0};
 const fixturePayment={code,token:"synthetic-status-token",amount:950000,expiresAt:"2099-01-01T00:15:00Z",qr:"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",bank:"Synthetic Bank",account:"00000000",holder:"SYNTHETIC HOLDER",status:"pending"};
 let shows=[fixtureShow,laterShow],paymentStatus="pending",reserveAllowed=false;
 let linkHandler=async orderCode=>json({code:orderCode,url:ticketUrl(orderCode),emailStatus:"sent"});
 let clipboardHandler=async()=>{};
 let chatList=[fixtureChat],chatDetailHandler=async chatId=>json({chat:chatList.find(chat=>chat.id===chatId)||fixtureChat,messages:[]}),chatPostHandler=null;

 function loadSource(filename){
  filename=path.resolve(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const result=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  loaded._compile(result.outputText,filename);return loaded.exports;
 }
 Module._load=function(request,parent,isMain){
  if(request==="react")return React;
  if(request==="react/jsx-runtime"||request==="react/jsx-dev-runtime")return originalLoad.call(this,request,module,isMain);
  if(request==="next/navigation")return {usePathname:()=>"/sale"};
  if(request.endsWith(".css"))return {__esModule:true,default:new Proxy({}, {get:(_target,key)=>String(key)})};
  if(request.startsWith(".")&&parent?.filename?.startsWith(repo+path.sep)){
   const base=path.resolve(path.dirname(parent.filename),request);
   for(const suffix of [".tsx",".ts","/index.tsx","/index.ts"]){const candidate=base+suffix;if(fs.existsSync(candidate))return loadSource(candidate);}
  }
  return originalLoad.apply(this,arguments);
 };
 define("IS_REACT_ACT_ENVIRONMENT",true);
 define("setInterval",(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;});
 define("clearInterval",id=>timers.delete(id));
 define("window",{setInterval:global.setInterval,clearInterval:global.clearInterval});
 define("document",{visibilityState:"visible",activeElement:null,addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)});
 define("navigator",{clipboard:{writeText:async value=>{clipboardWrites.push(value);return clipboardHandler(value);}}});
 define("fetch",async(input,init={})=>{
  assert.equal(typeof input,"string");assert(input.startsWith("/api/"),"external requests are forbidden in this test");
  const url=new URL(input,"https://synthetic.invalid"),method=init.method||"GET";
  requests.push({url:input,pathname:url.pathname,method,init});
  if(url.pathname==="/api/staff/ticket-link"&&method==="GET")return linkHandler(url.searchParams.get("code"),init);
  if(url.pathname==="/api/staff/live-presence"&&method==="POST")return json({ok:true});
  if(url.pathname==="/api/staff/sale-requests"&&method==="GET")return json({requests:[{id:"00000000-0000-4000-8000-000000000001",show_id:fixtureShow.id,customer_name:"Synthetic Lead",customer_phone:"0900000000",note:"Synthetic fixture only",status:"new",status_confirmed:false,created_at:"2099-01-01T00:00:00Z"}],paidCustomers:[{code:otherCode,show_id:fixtureShow.id,seats:["B01"],buyer_name:"Synthetic Paid Customer",buyer_phone:"0900000001",buyer_email:"paid@example.invalid",amount_vnd:400000,paid_at:"2099-01-01T00:00:00Z",email_status:"queued"}]});
  if(url.pathname==="/api/staff/reports"&&method==="GET")return json(fixtureReport);
  if(url.pathname==="/api/staff/sale-shows"&&method==="GET")return json({shows});
  if(url.pathname==="/api/public/show-inventory"&&method==="GET")return json({available:true,seatRows:{ccc:Object.fromEntries("ABCDEFGHIJK".split("").map(row=>[row,2])),laocai:Object.fromEntries("ABCDEFGHIJKLMNO".split("").map(row=>[row,2]))},inventory:[fixtureShow,laterShow].map(show=>({showId:show.id,soldSeats:[],heldSeats:[],soldOut:false}))});
  if(url.pathname==="/api/staff/sale-reserve"&&method==="POST"&&reserveAllowed)return json(fixturePayment);
  if(url.pathname==="/api/payments/sepay/status"&&method==="GET"){assert.equal(url.searchParams.get("code"),code);assert.equal(url.searchParams.get("token"),fixturePayment.token);return json({code,status:paymentStatus});}
  if(url.pathname==="/api/staff/support-chats"&&method==="GET")return url.searchParams.has("chatId")?chatDetailHandler(url.searchParams.get("chatId"),init):json({chats:chatList,staff:[{id:"synthetic-sale",display_name:"Synthetic Sale",openCount:chatList.length}],actorId:"synthetic-sale",isManager:false,myOpenCount:chatList.length,waitingCount:0,messengerConfigured:false});
  if(url.pathname==="/api/staff/support-chats"&&method==="POST"&&chatPostHandler)return chatPostHandler(JSON.parse(init.body));
  unexpected.push({url:input,method});throw Error("Unexpected request in synthetic Sale UI test");
 });
 // React's renderer deprecation is expected for this optional, temporary harness.
 // Retain every other warning/error so test failures remain visible.
 console.error=(...args)=>{if(typeof args[0]==="string"&&args[0].startsWith("react-test-renderer is deprecated"))return;originalError(...args);};

 try{
  renderer=require(rendererPath);const {act}=renderer;
  const TicketLinkActions=loadSource(path.join(repo,"app/sale/ticket-link-actions.tsx")).default;
  const SeatBooking=loadSource(path.join(repo,"app/sale/seat-booking.tsx")).default;
  const SaleWorkspace=loadSource(path.join(repo,"app/sale/sale-workspace.tsx")).default;
  const SupportInbox=loadSource(path.join(repo,"app/support-inbox.tsx")).default;
  const update=async work=>{await act(async()=>{await work?.();});};
  async function mount(component,props){
   assert.equal(tree,null);await update(()=>{tree=renderer.create(React.createElement(component,props),{createNodeMock:element=>({focus(){focusCalls.push(element.props.id||element.props["aria-label"]);global.document.activeElement=this;},select(){selectCalls.push(element.props.id||element.props["aria-label"]);}})});});return tree.root;
  }
  async function unmount(){if(tree){await update(()=>tree.unmount());tree=null;}}
  const count=pathname=>requests.filter(request=>request.pathname===pathname).length;
  const byId=id=>tree.root.findByProps({id});
  const buttonFor=orderCode=>tree.root.findByProps({"aria-label":"Sao chép đường dẫn vé "+orderCode});
  const click=async node=>update(()=>node.props.onClick());
  const inputIn=(root,label,type="input")=>root.findAllByType("label").find(node=>content(node).startsWith(label)).findByType(type);
  async function tick(delay){await update(async()=>{for(const timer of [...timers.values()].filter(timer=>timer.delay===delay))await timer.callback();});}

  await t.test("copy is lazy, deduplicates clicks, and announces success only after the clipboard resolves",async()=>{
   const pending=deferred();clipboardHandler=()=>pending.promise;
   const before=count("/api/staff/ticket-link");await mount(TicketLinkActions,{orderCode:code});
   assert.equal(count("/api/staff/ticket-link"),before);assert.equal(tree.root.findAllByType("a").length,0);
   await click(buttonFor(code));assert.equal(count("/api/staff/ticket-link"),before+1);
   const request=requests.at(-1);assert.equal(request.method,"GET");assert.equal(request.init.cache,"no-store");assert.equal(request.init.signal.aborted,false);
   assert.equal(buttonFor(code).props.disabled,true);assert.equal(buttonFor(code).props["aria-busy"],true);assert.doesNotMatch(content(tree.toJSON()),/Đã sao chép/);
   await click(buttonFor(code));assert.equal(count("/api/staff/ticket-link"),before+1);
   await update(()=>pending.resolve());assert.match(content(tree.toJSON()),/Đã sao chép/);assert.equal(clipboardWrites.at(-1),ticketUrl(code));
   const open=tree.root.findByType("a");assert.equal(open.props.href,ticketUrl(code));assert.equal(open.props.rel,"noopener noreferrer");assert.equal(open.props.referrerPolicy,"no-referrer");
   assert.match(content(tree.toJSON()),/Email vé đã được gửi/);assert.doesNotMatch(content(tree.toJSON()),/khách đã nhận|đã nhận email/i);
   await unmount();clipboardHandler=async()=>{};
  });
  await t.test("denied clipboard exposes a focused, selected read-only link without false success",async()=>{
   clipboardHandler=async()=>{throw Error("Synthetic clipboard denied");};
   await mount(TicketLinkActions,{orderCode:code});await click(buttonFor(code));
   const input=tree.root.findByType("input");assert.equal(input.props.value,ticketUrl(code));assert.equal(input.props.readOnly,true);
   assert.equal(focusCalls.at(-1),"Đường dẫn vé "+code);assert.equal(selectCalls.at(-1),"Đường dẫn vé "+code);
   assert.doesNotMatch(content(tree.toJSON()),/Đã sao chép/);assert.equal(buttonFor(code).props.disabled,false);
   await unmount();clipboardHandler=async()=>{};
  });
  await t.test("not-ready409 shows the actual error and never copies or renders a URL",async()=>{
   linkHandler=async()=>json({error:"Vé đang được phát hành. Vui lòng thử lại."},409);
   const copied=clipboardWrites.length;await mount(TicketLinkActions,{orderCode:code});await click(buttonFor(code));
   assert.match(content(tree.root.findByProps({role:"alert"})),/đang được phát hành/);assert.equal(clipboardWrites.length,copied);
   assert.equal(tree.root.findAllByType("a").length,0);assert.equal(tree.root.findAllByType("input").length,0);assert.doesNotMatch(content(tree.toJSON()),/Đã sao chép/);
   await unmount();
  });
  await t.test("mismatched orders and unsafe ticket URLs are rejected before clipboard access",async()=>{
   const responses=[{code:otherCode,url:ticketUrl(otherCode)},
    {code,url:"https://evil.invalid/ve?ticket="+code+"."+"a".repeat(64)},
    {code,url:"javascript:alert(1)"},{code,url:ticketUrl(otherCode)},
    {code,url:ticketUrl(code)+"&token=unexpected"},{code,url:ticketUrl(code)+"#unexpected"}];
   for(const response of responses){
    linkHandler=async()=>json(response);const copied=clipboardWrites.length;await mount(TicketLinkActions,{orderCode:code});await click(buttonFor(code));
    assert.equal(tree.root.findAllByProps({role:"alert"}).length,1);assert.equal(clipboardWrites.length,copied);
    assert.equal(tree.root.findAllByType("a").length,0);assert.doesNotMatch(content(tree.toJSON()),/Đã sao chép/);await unmount();
   }
  });
  await t.test("changing the order aborts an old response so it cannot replace the new link",async()=>{
   const old=deferred();let oldSignal;
   linkHandler=(requested,init)=>{if(requested===code){oldSignal=init.signal;return old.promise;}return Promise.resolve(json({code:requested,url:ticketUrl(requested),emailStatus:"queued"}));};
   await mount(TicketLinkActions,{orderCode:code});await click(buttonFor(code));
   await update(()=>tree.update(React.createElement(TicketLinkActions,{orderCode:otherCode})));assert.equal(oldSignal.aborted,true);
   await click(buttonFor(otherCode));assert.equal(tree.root.findByType("a").props.href,ticketUrl(otherCode));
   await update(()=>old.resolve(json({code,url:ticketUrl(code),emailStatus:"sent"})));
   assert.equal(tree.root.findByType("a").props.href,ticketUrl(otherCode));assert.equal(clipboardWrites.at(-1),ticketUrl(otherCode));assert.match(content(tree.toJSON()),/Email vé đang chờ gửi/);
   await unmount();linkHandler=async requested=>json({code:requested,url:ticketUrl(requested),emailStatus:"sent"});
  });

  await t.test("four navigation views keep selected seats, contact, promotion and chat draft mounted",async()=>{
   const initialInventory=count("/api/public/show-inventory"),initialChat=count("/api/staff/support-chats"),initialLinks=count("/api/staff/ticket-link");
   await mount(SaleWorkspace,{name:"Synthetic Sale"});
   const labels={home:"Home",tickets:"Bán vé",commission:"Hoa hồng",customers:"Chăm sóc khách hàng"};
   for(const [id,label] of Object.entries(labels)){const control=byId("sale-nav-"+id);assert.match(content(control),new RegExp(label));assert.equal(control.props["aria-controls"],"sale-panel-"+id);}
   assert.equal(byId("sale-nav-home").props["aria-current"],"page");assert.equal(Boolean(byId("sale-panel-home").props.hidden),false);
   assert.equal(count("/api/public/show-inventory"),initialInventory);assert.equal(count("/api/staff/support-chats"),initialChat);assert.equal(count("/api/staff/ticket-link"),initialLinks);
   await click(byId("sale-nav-tickets"));const booking=tree.root.findByType(SeatBooking);
   await update(()=>inputIn(booking,"Chương trình khuyến mại","select").props.onChange({target:{value:"couple5"}}));
   for(const seat of ["A01","A02"])await click(booking.findByProps({"aria-label":"Ghế "+seat}));
   for(const [label,value] of [["Tên khách","Synthetic Buyer"],["Số điện thoại","0900000000"],["Email nhận vé","buyer@example.invalid"]])await update(()=>inputIn(booking,label).props.onChange({target:{value}}));
   const invRequest=requests.filter(request=>request.pathname==="/api/public/show-inventory").at(-1);
   await click(byId("sale-nav-customers"));assert.equal(invRequest.init.signal.aborted,true);assert.equal(timers.size>0,true);
   const reply=tree.root.findByProps({id:"extra-inbox-reply-text"});await update(()=>reply.props.onChange({target:{value:"Synthetic unsent chat draft"}}));
   for(const id of ["commission","home","tickets"]){await click(byId("sale-nav-"+id));assert.equal(byId("sale-nav-"+id).props["aria-current"],"page");assert.equal(Boolean(byId("sale-panel-"+id).props.hidden),false);}
   assert.equal(tree.root.findByType(SeatBooking),booking,"the existing booking component remains mounted");
   for(const seat of ["A01","A02"])assert.equal(booking.findByProps({"aria-label":"Ghế "+seat}).props["aria-pressed"],true);
   assert.equal(inputIn(booking,"Chương trình khuyến mại","select").props.value,"couple5");
   for(const [label,value] of [["Tên khách","Synthetic Buyer"],["Số điện thoại","0900000000"],["Email nhận vé","buyer@example.invalid"]])assert.equal(inputIn(booking,label).props.value,value);
   assert.equal(count("/api/staff/sale-reserve"),0);assert.equal(count("/api/staff/ticket-link"),initialLinks);
   await click(byId("sale-nav-customers"));assert.equal(tree.root.findByProps({id:"extra-inbox-reply-text"}).props.value,"Synthetic unsent chat draft");
   assert.equal(requests.some(request=>request.pathname==="/api/staff/support-chats"&&request.method!=="GET"),false,"a saved draft never sends a message");
   await click(byId("sale-nav-tickets"));
  });
  await t.test("pending QR survives navigation and paid status refreshes once without changing its show",async()=>{
   const booking=tree.root.findByType(SeatBooking);reserveAllowed=true;
   await update(()=>booking.findAllByType("form").find(form=>form.props.onSubmit).props.onSubmit({preventDefault(){}}));
   reserveAllowed=false;assert.equal(count("/api/staff/sale-reserve"),1);
   assert.deepEqual(JSON.parse(requests.find(request=>request.pathname==="/api/staff/sale-reserve").init.body),{showId:fixtureShow.id,seats:["A01","A02"],childSeats:[],promotion:"couple5",giftSeats:[],name:"Synthetic Buyer",phone:"0900000000",email:"buyer@example.invalid"});
   assert.equal(booking.findByType("img").props.src,fixturePayment.qr);assert.match(content(booking),new RegExp(code));
   for(const id of ["home","commission","customers","tickets"])await click(byId("sale-nav-"+id));
   assert.equal(tree.root.findByType(SeatBooking),booking);assert.equal(booking.findByType("img").props.src,fixturePayment.qr);assert.equal(count("/api/staff/sale-reserve"),1);
   await click(byId("sale-nav-home"));assert.equal(booking.props.active,false);
   assert.equal([...timers.values()].some(timer=>timer.delay===10000),false,"hidden seat inventory stops polling");
   assert.equal([...timers.values()].some(timer=>timer.delay===9000||timer.delay===6000),false,"hidden inbox stops polling");
   assert.equal([...timers.values()].some(timer=>timer.delay===5000),true,"pending payment continues checking while hidden");
   const before=count("/api/staff/reports");shows=[laterShow];paymentStatus="paid";await tick(5000);
   assert.equal(count("/api/staff/reports"),before+1,"the paid transition refreshes the workspace exactly once");
   assert.equal([...timers.values()].some(timer=>timer.delay===5000),false);
   await click(byId("sale-nav-tickets"));assert.match(content(booking),/ĐÃ THANH TOÁN/);assert.equal(booking.findAllByType("img").length,0);
   assert.equal(inputIn(booking,"Chọn show","select").props.value,fixtureShow.id,"a refreshed show list cannot relabel the existing order");
   assert.match(content(booking),/Synthetic Artist Alpha/);assert.match(content(booking),/buyer@example.invalid/);
   assert.equal(booking.findAllByType(TicketLinkActions).length,1);
   await click(byId("sale-nav-home"));await click(byId("sale-nav-tickets"));await tick(5000);assert.equal(count("/api/staff/reports"),before+1);
   await unmount();assert.equal(timers.size,0);assert.equal([...listeners.values()].reduce((sum,set)=>sum+set.size,0),0);
  });
  await t.test("resuming onto another chat blocks replies until its messages load and isolates each draft",async()=>{
   const pendingBeta=deferred();let betaRequested=false;
   chatList=[fixtureChat];
   chatDetailHandler=async chatId=>{if(chatId===secondChat.id){betaRequested=true;return pendingBeta.promise;}return json({chat:fixtureChat,messages:[]});};
   const resume=active=>update(()=>tree.update(React.createElement(SupportInbox,{embedded:true,active})));
   const postedBefore=requests.filter(request=>request.pathname==="/api/staff/support-chats"&&request.method==="POST").length;
   try{
    await mount(SupportInbox,{embedded:true,active:true});
    await update(()=>byId("extra-inbox-reply-text").props.onChange({target:{value:"Private unsent draft for A"}}));
    await resume(false);await resume(true);
    assert.equal(byId("extra-inbox-reply-text").props.value,"Private unsent draft for A");
    await resume(false);chatList=[secondChat];await resume(true);assert.equal(betaRequested,true);
    assert.equal(tree.root.findAllByProps({id:"extra-inbox-reply-text"}).length,0,"a stale A thread cannot expose a reply editor targeting newly selected B");
    assert.equal(tree.root.findAllByType("form").filter(form=>form.props.className==="extra-inbox-reply").length,0);
    await update(()=>pendingBeta.resolve(json({chat:secondChat,messages:[]})));
    assert.equal(byId("extra-inbox-reply-text").props.value,"","B must start without A's draft");
    await update(()=>byId("extra-inbox-reply-text").props.onChange({target:{value:"Private unsent draft for B"}}));
    await resume(false);chatList=[fixtureChat];await resume(true);
    assert.equal(byId("extra-inbox-reply-text").props.value,"Private unsent draft for A","returning to A restores only A's draft");
    assert.equal(requests.filter(request=>request.pathname==="/api/staff/support-chats"&&request.method==="POST").length,postedBefore);
   }finally{await unmount();chatList=[fixtureChat];chatDetailHandler=async()=>json({chat:fixtureChat,messages:[]});}
  });
  await t.test("an in-flight send for A cannot replace B messages or clear either newer draft",async()=>{
   const pendingSend=deferred(),message=(id,body)=>({id,sender:"customer",body,staff_name:null,created_at:"2099-01-01T00:00:00Z"});
   chatList=[fixtureChat,secondChat];
   chatDetailHandler=async chatId=>json({chat:chatId===secondChat.id?secondChat:fixtureChat,messages:[message(chatId===secondChat.id?2:1,chatId===secondChat.id?"Existing message for B":"Existing message for A")]});
   chatPostHandler=async body=>{assert.deepEqual(body,{chatId:fixtureChat.id,message:"Submitted message for A"});return pendingSend.promise;};
   const selectChat=async name=>click(tree.root.findAllByType("button").find(button=>String(button.props.className||"").split(" ").includes("extra-inbox-person")&&content(button).startsWith(name)));
   try{
    await mount(SupportInbox,{embedded:true,active:true});
    await update(()=>byId("extra-inbox-reply-text").props.onChange({target:{value:"Submitted message for A"}}));
    await update(()=>tree.root.findAllByType("form").find(form=>form.props.className==="extra-inbox-reply").props.onSubmit({preventDefault(){}}));
    await update(()=>byId("extra-inbox-reply-text").props.onChange({target:{value:"Newer unsent draft for A"}}));
    await selectChat(secondChat.customer_name);assert.equal(byId("extra-inbox-reply-text").props.value,"");
    await update(()=>byId("extra-inbox-reply-text").props.onChange({target:{value:"Unsent draft for B"}}));
    assert.match(content(tree.root.findByProps({role:"log"})),/Existing message for B/);
    await update(()=>pendingSend.resolve(json({messages:[{...message(3,"Late submitted message for A"),sender:"staff",staff_name:"Synthetic Sale"}]})));
    assert.equal(byId("extra-inbox-reply-text").props.value,"Unsent draft for B");
    assert.match(content(tree.root.findByProps({role:"log"})),/Existing message for B/);assert.doesNotMatch(content(tree.root.findByProps({role:"log"})),/Late submitted message for A/);
    await selectChat(fixtureChat.customer_name);assert.equal(byId("extra-inbox-reply-text").props.value,"Newer unsent draft for A","a successful earlier send must not erase text typed afterwards");
   }finally{await unmount();chatList=[fixtureChat];chatDetailHandler=async()=>json({chat:fixtureChat,messages:[]});chatPostHandler=null;}
  });
  assert.deepEqual(unexpected,[],"all HTTP calls stayed within the synthetic fixture");
  assert.equal(requests.some(request=>/email|resend|webhook/.test(request.pathname)),false);
 }finally{
  if(tree&&renderer)await renderer.act(async()=>tree.unmount());
  Module._load=originalLoad;console.error=originalError;
  for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}
 }
});

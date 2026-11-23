// Isolated, synthetic route checks. Compile the two routes into
// SALE_TICKET_COMPILED_ROOT; NODE_PATH points to the project's node_modules.
// All identities, customer details, secrets and orders in this file are synthetic.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const Module=require("node:module");
const {createHmac}=require("node:crypto");

test("Sale ticket links are private read-only capabilities for exact assigned, issued paid orders",async t=>{
  const compiled=process.env.SALE_TICKET_COMPILED_ROOT;
  if(!compiled)throw Error("Set SALE_TICKET_COMPILED_ROOT to compiled route output");
  const originalLoad=Module._load,originalFetch=global.fetch,originalError=console.error,originalWarn=console.warn;
  const signingSecret="synthetic-sale-ticket-link-signing-secret-only";
  process.env.ADMIN_MEDIA_SECRET=signingSecret;
  const alpha={id:"synthetic-sale-alpha",username:"sample-alpha",display_name:"Synthetic Alpha",role:"sale",active:true};
  const beta={id:"synthetic-sale-beta",username:"sample-beta",display_name:"Synthetic Alpha",role:"sale",active:true};
  let actor=alpha,mode="normal";
  const reads=[],logs=[],unexpectedActions=[];
  const codeFor=number=>"EX"+number.toString(16).toUpperCase().padStart(16,"0");
  const order=(number,patch={})=>({
    id:"synthetic-order-"+number,code:codeFor(number),show_id:"synthetic-show",venue_id:"synthetic-venue",
    seats:["A1","A2"],amount_vnd:200000,status:"paid",sale_staff_id:alpha.id,paid_at:"2030-01-15T10:00:00Z",
    access_token:number.toString(16).slice(-1).repeat(48),email_status:"queued",
    buyer_name:"Synthetic Customer "+number,buyer_phone:"0000000000",buyer_email:"customer"+number+"@example.invalid",
    ...patch,
  });
  const orders=[
    order(1),order(2,{sale_staff_id:beta.id}),order(3,{sale_staff_id:null}),
    order(4,{status:"pending",paid_at:null}),order(5,{status:"refunded"}),
    order(6),order(7),order(8),order(9),order(10),order(11),order(12),
    order(13,{seats:["A1","A1"]}),order(14,{seats:[]}),order(15),
  ];
  const makeTickets=row=>row.seats.map(seat=>({
    order_id:row.id,order_code:row.code,show_id:row.show_id,venue_id:row.venue_id,
    seat_id:seat,issued_at:"2030-01-15T10:00:01Z",
  }));
  const tickets=new Map(orders.map(row=>[row.id,makeTickets(row)]));
  tickets.set(orders[5].id,[]);
  tickets.set(orders[6].id,makeTickets(orders[6]).slice(0,1));
  tickets.set(orders[7].id,makeTickets(orders[7]).map((row,index)=>index?{...row,seat_id:"Z99"}:row));
  tickets.set(orders[8].id,makeTickets(orders[8]).map(row=>({...row,seat_id:"A1"})));
  tickets.set(orders[9].id,makeTickets(orders[9]).map(row=>({...row,show_id:"different-show"})));
  tickets.set(orders[10].id,makeTickets(orders[10]).map(row=>({...row,venue_id:"different-venue"})));
  tickets.set(orders[11].id,makeTickets(orders[11]).map(row=>({...row,issued_at:"invalid-date"})));
  const leadRows=[
    {id:"lead-alpha",created_by:alpha.id,customer_name:"Synthetic Own Lead"},
    {id:"lead-beta",created_by:beta.id,customer_name:"Synthetic Other Lead"},
  ];
  // These same-name legacy shadows must have no authority over either online ID.
  const legacyShadows=[
    {order_code:codeFor(2),seller_name:alpha.display_name,payment_verified:true},
    {order_code:codeFor(3),seller_name:alpha.username,payment_verified:true},
  ];
  const project=(row,select)=>Object.fromEntries(select.split(",").map(key=>[key,row[key]]));
  const staffDb=async(request,init={})=>{
    reads.push({request,method:init.method||"GET"});
    assert.equal(init.method||"GET","GET","copying a link must not mutate any record");
    assert.equal(request.startsWith("rpc/"),false,"copying must not invoke ticket issuance or email RPCs");
    const url=new URL("https://synthetic.invalid/"+request),query=url.searchParams;
    const select=query.get("select")||"";
    assert.equal(select.includes("qr_secret"),false,"the readiness check never needs QR secrets");
    if(mode==="database-error")throw Error("synthetic-private-db-detail-"+orders[0].access_token);
    if(url.pathname==="/extra_payment_orders"){
      const code=query.get("code")?.slice(3);
      if(code){
        let row=orders.find(value=>value.code===code);
        if(!row)return [];
        assert.doesNotMatch(select,/buyer_|customer_/,"link authorization does not need customer PII");
        if(select.includes("access_token")){
          if(mode==="race-assignment")row={...row,sale_staff_id:beta.id};
          if(mode==="race-status")row={...row,status:"refunded"};
          if(mode==="race-seats")row={...row,seats:[...row.seats,"A3"]};
          if(mode==="race-delete")return [];
          if(mode==="bad-token")row={...row,access_token:"synthetic-invalid-private-token"};
          if(mode.startsWith("email-"))row={...row,email_status:mode.slice(6)};
        }
        return [project(row,select)];
      }
      assert.equal(select.includes("access_token"),false);
      let values=orders;
      if(mode!=="unsafe-list"){
        const staffFilter=query.get("sale_staff_id");
        values=values.filter(row=>row.status==="paid"&&(staffFilter==="not.is.null"?row.sale_staff_id!==null:row.sale_staff_id===staffFilter?.slice(3)));
      }
      const offset=Number(query.get("offset")||0);
      return values.slice(offset,offset+2).map(row=>project(row,select));
    }
    if(url.pathname==="/extra_tickets"){
      const id=query.get("order_id")?.slice(3),code=query.get("order_code")?.slice(3);
      const values=(tickets.get(id)||[]).filter(row=>row.order_code===code);
      const offset=Number(query.get("offset")||0);
      return values.slice(offset,offset+1).map(row=>project(row,select));
    }
    if(url.pathname==="/sale_requests"){
      assert.equal(select.includes("customer_name"),true);
      // Deliberately return both to verify the response's second ownership guard.
      return leadRows;
    }
    if(url.pathname==="/ticket_sales"){
      unexpectedActions.push("legacy-ownership-read");
      return legacyShadows;
    }
    throw Error("Unexpected synthetic table");
  };
  Module._load=function(request,parent,isMain){
    if(request==="server-only")return {};
    if(/(?:^|\/)staff-auth(?:\.js)?$/.test(request))return {
      staffDb,requireRole:async roles=>actor?.active&&roles.includes(actor.role)?actor:null,
    };
    if(/(?:^|\/)extra-ticketing(?:\.js)?$/.test(request))return Object.fromEntries(
      ["paidOrder","ticketsFor","issueTickets","deliverTickets"].map(name=>[name,()=>{
        unexpectedActions.push(name);throw Error("Ticket copying must not call "+name);
      }]));
    return originalLoad.apply(this,arguments);
  };
  global.fetch=async()=>{unexpectedActions.push("network");throw Error("Network is forbidden in this fixture");};
  console.error=(...args)=>logs.push(args);console.warn=(...args)=>logs.push(args);
  try{
    const {NextRequest}=require("next/server");
    const link=require(path.join(compiled,"app/api/staff/ticket-link/route.js"));
    const customers=require(path.join(compiled,"app/api/staff/sale-requests/route.js"));
    const request=code=>new NextRequest("https://sale.synthetic.invalid/api/staff/ticket-link?code="+encodeURIComponent(code));
    const privacy=response=>{
      assert.match(response.headers.get("cache-control"),/private/);
      assert.match(response.headers.get("cache-control"),/no-store/);
      assert.equal(response.headers.get("referrer-policy"),"no-referrer");
    };
    const tokenReads=()=>reads.filter(read=>new URL("https://synthetic.invalid/"+read.request).searchParams.get("select")?.includes("access_token")).length;

    await t.test("forbidden actors are rejected before any order, token or customer reads",async()=>{
      for(const value of [null,{...alpha,role:"accountant"},{...alpha,role:"show_manager"},{...alpha,role:"checkin"},{...alpha,active:false}]){
        actor=value;
        const result=await link.GET(request(codeFor(1)));assert.equal(result.status,403);privacy(result);
        const list=await customers.GET();assert.equal(list.status,403);privacy(list);
      }
      assert.equal(reads.length,0);
    });
    await t.test("an own paid order with complete issued seats returns only the signed capability and stored email state",async()=>{
      actor=alpha;mode="normal";
      const result=await link.GET(request(codeFor(1).toLowerCase()));
      assert.equal(result.status,200);privacy(result);
      const body=await result.json();
      assert.deepEqual(Object.keys(body).sort(),["code","emailStatus","url"]);
      assert.equal(body.code,codeFor(1));assert.equal(body.emailStatus,"queued");
      const url=new URL(body.url);
      assert.equal(url.origin,"https://iextra.net");assert.equal(url.pathname,"/ve");
      assert.deepEqual([...url.searchParams.keys()],["ticket"]);
      const expected=createHmac("sha256",signingSecret).update("extra-ticket-link-v1:"+body.code+":"+orders[0].access_token).digest("hex");
      assert.equal(url.searchParams.get("ticket"),body.code+"."+expected);
      assert.equal(JSON.stringify(body).includes(orders[0].access_token),false);
      assert.doesNotMatch(JSON.stringify(body),/buyer_|customer|qr_secret|access_token/);
      assert.equal(tokenReads(),1);
    });
    await t.test("other Sale IDs and null assignments stay inaccessible despite matching legacy names",async()=>{
      const before=tokenReads(),ticketReads=reads.filter(read=>read.request.startsWith("extra_tickets?")).length;
      for(const code of [codeFor(2),codeFor(3),codeFor(999),"bad&code=anything"]){
        const result=await link.GET(request(code));assert.equal(result.status,404);privacy(result);
        assert.deepEqual(Object.keys(await result.json()),["error"]);
      }
      assert.equal(tokenReads(),before);
      assert.equal(reads.filter(read=>read.request.startsWith("extra_tickets?")).length,ticketReads);
      assert.equal(unexpectedActions.includes("legacy-ownership-read"),false);
    });
    await t.test("unpaid or refunded own orders cannot yield ticket links",async()=>{
      const before=tokenReads();
      for(const code of [codeFor(4),codeFor(5)]){
        const result=await link.GET(request(code));assert.equal(result.status,409);privacy(result);
        assert.equal("url" in await result.json(),false);
      }
      assert.equal(tokenReads(),before);
    });
    await t.test("paid orders remain retryable until the exact nonempty issued seat set is complete",async()=>{
      const before=tokenReads();
      for(const number of [6,7,8,9,10,11,12,13,14]){
        const result=await link.GET(request(codeFor(number)));assert.equal(result.status,409);privacy(result);
        assert.equal("url" in await result.json(),false);
      }
      assert.equal(tokenReads(),before);
    });
    await t.test("current assignment, payment and seats are rechecked before signing",async()=>{
      for(const [value,status] of [["race-assignment",404],["race-delete",404],["race-status",409],["race-seats",409]]){
        mode=value;const result=await link.GET(request(codeFor(1)));assert.equal(result.status,status);privacy(result);
        assert.equal("url" in await result.json(),false);
      }
      mode="normal";
    });
    await t.test("email state is read as queued, sending or sent without asserting delivery or sending messages",async()=>{
      for(const state of ["queued","sending","sent"]){
        mode="email-"+state;
        const result=await link.GET(request(codeFor(1)));assert.equal(result.status,200);
        assert.equal((await result.json()).emailStatus,state);
      }
      mode="email-synthetic-private-unknown-state";
      const unknown=await link.GET(request(codeFor(1)));assert.equal(unknown.status,200);
      const body=await unknown.json();assert.equal("emailStatus" in body,false);
      assert.equal(JSON.stringify(body).includes("synthetic-private"),false);mode="normal";
    });
    await t.test("the customer list uses exact assignment, rejects name shadows and paginates short pages",async()=>{
      actor=alpha;mode="unsafe-list";
      const before=reads.length,result=await customers.GET();assert.equal(result.status,200);privacy(result);
      const body=await result.json();
      assert.deepEqual(body.requests.map(row=>row.id),["lead-alpha"]);
      assert.equal(body.paidCustomers.every(row=>row.sale_staff_id===alpha.id&&row.status==="paid"),true);
      assert.equal(body.paidCustomers.some(row=>row.code===codeFor(15)),true);
      assert.equal(body.paidCustomers.some(row=>[codeFor(2),codeFor(3),codeFor(4),codeFor(5)].includes(row.code)),false);
      assert.doesNotMatch(JSON.stringify(body),/access_token|qr_secret|Synthetic Other Lead/);
      const listReads=reads.slice(before).filter(read=>read.request.startsWith("extra_payment_orders?"));
      assert.equal(listReads.every(read=>new URL("https://synthetic.invalid/"+read.request).searchParams.get("sale_staff_id")==="eq."+alpha.id),true);
      assert.equal(listReads.some(read=>new URL("https://synthetic.invalid/"+read.request).searchParams.get("offset")==="14"),true);
      assert.equal(unexpectedActions.includes("legacy-ownership-read"),false);mode="normal";
    });
    await t.test("Admin access keeps attributed customer-list behavior and can read a paid unassigned ticket",async()=>{
      actor={...alpha,role:"admin"};
      const result=await link.GET(request(codeFor(3)));assert.equal(result.status,200);privacy(result);
      const list=await customers.GET();assert.equal(list.status,200);
      const body=await list.json();
      assert.equal(body.paidCustomers.some(row=>row.code===codeFor(2)),true);
      assert.equal(body.paidCustomers.some(row=>row.code===codeFor(3)),false);
      actor=alpha;
    });
    await t.test("configuration and backend failures disclose no raw secret, URL or internal error",async()=>{
      for(const value of ["database-error","bad-token"]){
        mode=value;const result=await link.GET(request(codeFor(1)));assert.equal(result.status,503);privacy(result);
        const body=await result.json();assert.deepEqual(Object.keys(body),["error"]);
        assert.doesNotMatch(JSON.stringify(body),/synthetic-private|1111111111111111|access_token|qr_secret/);
      }
      mode="normal";delete process.env.ADMIN_MEDIA_SECRET;
      const unavailable=await link.GET(request(codeFor(1)));assert.equal(unavailable.status,503);privacy(unavailable);
      process.env.ADMIN_MEDIA_SECRET=signingSecret;
      assert.deepEqual(unexpectedActions,[]);
      assert.equal(reads.every(read=>read.method==="GET"),true);
      assert.equal(logs.flat().some(value=>String(value).includes("synthetic-private")||String(value).includes(orders[0].access_token)),false);
    });
  }finally{
    Module._load=originalLoad;global.fetch=originalFetch;console.error=originalError;console.warn=originalWarn;
    delete process.env.ADMIN_MEDIA_SECRET;
  }
});

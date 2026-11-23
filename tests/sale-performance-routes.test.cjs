// Synthetic route integration. Compile routes and their dependencies to
// SALE_REPORT_COMPILED_ROOT; NODE_PATH points at the project's node_modules.
// No real authentication, credentials, Supabase connection or network is used.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const Module=require("node:module");

test("actual Admin and staff routes share progressive allocations without leaking other Sales",async t=>{
  const compiled=process.env.SALE_REPORT_COMPILED_ROOT;
  if(!compiled)throw Error("Set SALE_REPORT_COMPILED_ROOT to compiled route output");
  const originalLoad=Module._load,originalFetch=global.fetch,originalError=console.error;
  let actor={id:"owner",username:"owner",display_name:"Synthetic Admin",role:"admin",active:true};
  let mode="normal";
  const queries=[],policyRequests=[],logged=[];
  const accounts=[
    {id:"staff-alpha",username:"sample-alpha",display_name:"Synthetic Alpha",role:"sale",active:true},
    {id:"staff-beta",username:"sample-beta",display_name:"Synthetic Beta",role:"sale",active:false},
  ];
  const shows=[
    {id:"sample-show",artist:"Synthetic Show",show_date:"2030-01-20",status:"announced"},
    {id:"ended-show",artist:"Synthetic Historical Show",show_date:"2029-12-01",status:"ended"},
    {id:"hidden-paid-show",artist:"Synthetic Hidden Paid Show",show_date:"2029-12-05",status:"hidden"},
    {id:"hidden-draft-show",artist:"Synthetic Unpublished Draft",show_date:"2031-01-01",status:"hidden"},
  ];
  const lines=(seats,amount)=>seats.map((seat,index)=>({seat,netAmount:Math.floor(amount/seats.length)+(index<amount%seats.length?1:0)}));
  const order=(code,seats,amount,patch={})=>({
    code,show_id:"sample-show",seats,amount_vnd:amount,paid_at:"2030-01-15T10:00:00Z",
    sale_staff_id:"staff-alpha",is_vip_invitation:false,status:"paid",commission_lines:lines(seats,amount),...patch,
  });
  const online=[
    order("PRIOR",Array.from({length:9},(_,index)=>"A"+(index+1)),900000,{paid_at:"2030-01-14T10:00:00Z"}),
    order("CROSSING",["B1","B2","B3"],900000,{commission_lines:[{seat:"B1",netAmount:200000},{seat:"B2",netAmount:300000},{seat:"B3",netAmount:400000}]}),
    order("PRIVATE-BETA",["C1"],100000,{sale_staff_id:"staff-beta"}),
    order("UNPAID-SHADOW",["D1"],100000,{status:"pending",paid_at:null}),
    order("OTHER-SHOW-SHADOW",["E1"],100000,{show_id:"ended-show",sale_staff_id:"staff-beta"}),
    order("HIDDEN-PAID",["H1","H2"],200000,{show_id:"hidden-paid-show",paid_at:"2030-01-13T10:00:00Z"}),
  ];
  const legacy=(code,patch={})=>({
    order_code:code,show_id:"sample-show",event_name:"Synthetic Show",venue_name:"Synthetic Venue",
    seats:["L1"],amount_vnd:100000,payment_method:"Synthetic transfer",seller_name:"sample-alpha",
    paid_at:"2030-01-15T12:00:00Z",payment_verified:true,commission_lines:[{seat:"L1",netAmount:100000}],...patch,
  });
  const legacyRows=[
    legacy("PRIVATE-BETA"),legacy("UNPAID-SHADOW"),legacy("OTHER-SHOW-SHADOW"),legacy("OWN-LEGACY"),
  ];
  const staffDb=async(request,init={})=>{
    assert.equal(init.method||"GET","GET");
    const url=new URL("https://synthetic.invalid/"+request);
    const query=url.searchParams;queries.push({table:url.pathname,query});
    assert.equal(query.has("paid_at"),false,"display dates must not trim lifetime histories");
    assert.equal(query.has("status"),false,"all online statuses must suppress stale legacy shadows");
    assert.doesNotMatch(query.get("select")||"",/buyer_|customer_|access_token|password|email/);
    let values;
    if(url.pathname==="/staff_accounts")values=accounts;
    else if(url.pathname==="/managed_shows"){
      if(mode==="shows-error")throw Error("synthetic-private-show-database-failure");
      values=shows;
    }
    else if(url.pathname==="/extra_payment_orders"){
      assert.match(query.get("select"),/commission_lines/);
      if(mode==="oversized")return Array.from({length:500},()=>online[3]);
      values=mode==="invalid-chronology"?online.map(row=>row.code==="PRIOR"?{...row,paid_at:null}:row):online;
    }else if(url.pathname==="/ticket_sales"){
      assert.match(query.get("select"),/commission_lines/);
      values=legacyRows;
      const filter=query.get("show_id");
      if(filter)values=values.filter(row=>row.show_id===filter.slice(3));
    }else throw Error("Unexpected fixture table");
    const offset=Number(query.get("offset")||0);
    // A real PostgREST installation may cap results below the requested limit.
    return values.slice(offset,offset+2);
  };
  Module._load=function(request,parent,isMain){
    if(request==="server-only")return {};
    if(/(?:^|\/)staff-auth(?:\.js)?$/.test(request))return {
      staffDb,requireRole:async roles=>actor&&roles.includes(actor.role)?actor:null,
    };
    if(/(?:^|\/)sale-commission-db(?:\.js)?$/.test(request))return {
      getSaleCommissionPolicies:async ids=>{
        policyRequests.push(ids);
        if(mode==="policy-error")throw Error("synthetic-private-internal-detail");
        return Object.fromEntries(ids.map(showId=>[showId,{
          showId,tiers:showId==="hidden-paid-show"?[{maxTickets:10,rate:7},{maxTickets:550,rate:11}]:
            [{maxTickets:10,rate:15},{maxTickets:30,rate:18},{maxTickets:50,rate:22},{maxTickets:550,rate:25}],
          version:null,updatedAt:null,updatedBy:null,source:showId==="hidden-paid-show"?"show":"default",
        }]));
      },
    };
    return originalLoad.apply(this,arguments);
  };
  global.fetch=async()=>{throw Error("External network is forbidden in this synthetic fixture");};
  console.error=(...args)=>logged.push(args);
  try{
    const {NextRequest}=require("next/server");
    const admin=require(path.join(compiled,"app/api/admin/sale-performance/route.js"));
    const staff=require(path.join(compiled,"app/api/staff/reports/route.js"));
    const request=(route,query="from=2030-01-15&to=2030-01-15&show=sample-show")=>
      new NextRequest("https://admin.synthetic.invalid/api/"+route+"?"+query);

    await t.test("authorization occurs before any report or policy reads",async()=>{
      actor=null;
      assert.equal((await admin.GET(request("admin/sale-performance"))).status,403);
      assert.equal((await staff.GET(request("staff/reports"))).status,403);
      actor={...accounts[0],role:"sale"};
      assert.equal((await admin.GET(request("admin/sale-performance"))).status,403);
      actor={...accounts[0],role:"checkin"};
      assert.equal((await staff.GET(request("staff/reports"))).status,403);
      assert.equal(queries.length,0);assert.equal(policyRequests.length,0);
    });
    await t.test("invalid impossible, reversed and injected filters reject before reads",async()=>{
      actor={...accounts[0],role:"admin"};
      for(const query of ["from=2030-02-31","from=2030-01-17&to=2030-01-15","show=sample%26status%3Dpaid"]){
        assert.equal((await admin.GET(request("admin/sale-performance",query))).status,400);
        assert.equal((await staff.GET(request("staff/reports",query))).status,400);
      }
      assert.equal(queries.length,0);assert.equal(policyRequests.length,0);
    });
    let adminReport;
    await t.test("Admin route returns weighted band splits and full lifetime ranking after short pages",async()=>{
      actor={...accounts[0],role:"admin"};
      const response=await admin.GET(request("admin/sale-performance"));
      assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
      adminReport=await response.json();
      const alpha=adminReport.sales.find(sale=>sale.id==="staff-alpha");
      assert.equal(alpha.commission,174000);
      assert.equal(alpha.paidTickets,4);assert.equal(alpha.shows[0].lifetimePaidTickets,13);
      assert.equal(alpha.orders.find(order=>order.code==="CROSSING").firstTicket,10);
      assert.equal(adminReport.totals.commission,189000);
      assert.equal(adminReport.totals.paidOrders,3);
      assert.equal(queries.some(({table,query})=>table==="/extra_payment_orders"&&query.get("offset")==="4"),true);
      assert.deepEqual(policyRequests.at(-1),shows.map(show=>show.id));
      assert.equal(queries.some(({table,query})=>table==="/managed_shows"&&query.get("offset")==="4"),true);
    });
    await t.test("accountant and Sale routes use the same earnings and strict Sale ID isolation",async()=>{
      actor={...accounts[0],role:"accountant"};
      const accountantResponse=await staff.GET(request("staff/reports"));
      assert.equal(accountantResponse.status,200);
      const accountant=await accountantResponse.json();
      assert.equal(accountant.commissionTotal,adminReport.totals.commission);
      assert.equal(accountant.totals.orders,3);
      actor=accounts[0];
      const saleResponse=await staff.GET(request("staff/reports","from=2030-01-15&to=2030-01-15"));
      assert.equal(saleResponse.status,200);assert.equal(saleResponse.headers.get("cache-control"),"no-store");
      const sale=await saleResponse.json();
      assert.equal(sale.commissionTotal,174000);
      assert.deepEqual(sale.rows.map(row=>row.order_code).sort(),["CROSSING","OWN-LEGACY"]);
      assert.equal(sale.rows.every(row=>row.saleId==="staff-alpha"),true);
      assert.equal(JSON.stringify(sale).includes("Synthetic Beta"),false);
      assert.equal(sale.shows.some(show=>show.id==="ended-show"),true);
      const ended=sale.commissionByShow.find(show=>show.showId==="ended-show");
      assert.equal(ended.lifetimePaidTickets,0);assert.equal(ended.policy.showId,"ended-show");
      assert.equal(sale.shows.some(show=>show.id==="hidden-paid-show"),true);
      assert.equal(sale.shows.some(show=>show.id==="hidden-draft-show"),false);
      assert.equal(sale.commissionByShow.some(show=>show.showId==="hidden-draft-show"),false);
      assert.equal("hidden-draft-show" in sale.policies,false);
    });
    await t.test("a hidden historical show's saved custom policy remains authoritative for Admin and Sale",async()=>{
      actor={...accounts[0],role:"admin"};
      const adminResponse=await admin.GET(request("admin/sale-performance","show=hidden-paid-show"));
      assert.equal(adminResponse.status,200);
      const hiddenAdmin=await adminResponse.json();
      assert.equal(hiddenAdmin.totals.commission,14000);assert.equal(hiddenAdmin.totals.paidTickets,2);
      const show=hiddenAdmin.sales.find(sale=>sale.id==="staff-alpha").shows[0];
      assert.equal(show.policy.source,"show");assert.equal(show.policy.tiers[0].rate,7);
      assert.equal(show.showDate,"2029-12-05");assert.equal(show.commissionComplete,true);
      actor=accounts[0];
      const saleResponse=await staff.GET(request("staff/reports","show=hidden-paid-show"));
      assert.equal(saleResponse.status,200);
      const hiddenSale=await saleResponse.json();
      assert.equal(hiddenSale.commissionTotal,14000);
      assert.equal(hiddenSale.commissionByShow[0].bands[0].rate,7);
      assert.deepEqual(hiddenSale.rows.map(row=>row.order_code),["HIDDEN-PAID"]);
    });
    await t.test("show database failure fails both reports closed without public-show fallback",async()=>{
      actor={...accounts[0],role:"admin"};mode="shows-error";
      for(const [route,handler] of [["admin/sale-performance",admin],["staff/reports",staff]]){
        const response=await handler.GET(request(route));assert.equal(response.status,503);
        const result=await response.json();
        assert.equal("totals" in result,false);assert.equal("policies" in result,false);
        assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
      }
      mode="normal";
    });
    await t.test("unknown earlier paid chronology rejects both routes without fabricated lower ranks",async()=>{
      actor={...accounts[0],role:"admin"};mode="invalid-chronology";
      for(const [route,handler] of [["admin/sale-performance",admin],["staff/reports",staff]]){
        const response=await handler.GET(request(route));assert.equal(response.status,503);
        const result=await response.json();
        assert.match(result.error,/đối soát/);assert.equal("totals" in result,false);
        assert.doesNotMatch(JSON.stringify(result),/PRIOR|staff-alpha/);
      }
      mode="normal";
    });
    await t.test("policy and history failures return safe errors instead of partial commission",async()=>{
      actor={...accounts[0],role:"admin"};mode="policy-error";
      const failure=await staff.GET(request("staff/reports"));
      assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/synthetic-private/);
      assert.equal(logged.flat().some(value=>String(value).includes("synthetic-private")),false);
      mode="oversized";
      const oversized=await admin.GET(request("admin/sale-performance"));
      assert.equal(oversized.status,503);
      const result=await oversized.json();
      assert.match(result.error,/vượt giới hạn/);assert.equal("totals" in result,false);
    });
  }finally{
    Module._load=originalLoad;global.fetch=originalFetch;console.error=originalError;
  }
});

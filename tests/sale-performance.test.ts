import {strict as assert} from "node:assert";
import {test} from "node:test";
import {defaultSaleCommissionPolicy} from "../lib/sale-commission";
import {
  buildSalePerformance,buildStaffSaleReport,validateSalePerformanceFilters,readAllSaleReportRows,SalePerformanceLimitError,SalePerformanceDataError,
  type SalePerformanceAccount,type SalePerformanceOnlineOrder,type SalePerformanceLegacyOrder,
  type SalePerformanceInput,
} from "../lib/sale-performance";

// Every identity, order, show, date and amount below belongs to synthetic fixtures.
const accounts:SalePerformanceAccount[]=[
  {id:"staff-alpha",username:"sample-alpha",display_name:"Sample Alpha",role:"sale",active:true},
  {id:"staff-beta",username:"sample-beta",display_name:"Sample Beta",role:"sale",active:false},
];
const input:SalePerformanceInput={
  accounts,policies:{"sample-show":defaultSaleCommissionPolicy("sample-show"),"second-show":defaultSaleCommissionPolicy("second-show")},
  shows:[{id:"sample-show",artist:"Nghệ sĩ thử nghiệm",date:"2030-01-20"},{id:"second-show",artist:"Show khác",date:"2030-02-01"}],
  filters:{from:"",to:"",show:""},updatedAt:"2030-01-15T13:00:00Z",onlineOrders:[],legacyOrders:[],
};
function online(patch:Partial<SalePerformanceOnlineOrder>={}):SalePerformanceOnlineOrder{
  const row:SalePerformanceOnlineOrder={
    code:"EX0000000000000001",show_id:"sample-show",seats:["X01","X02"],amount_vnd:825000,
    paid_at:"2030-01-15T09:30:00Z",sale_staff_id:"staff-alpha",is_vip_invitation:false,status:"paid",...patch,
  };
  if(!Object.prototype.hasOwnProperty.call(patch,"commission_lines")){
    const base=Math.floor(row.amount_vnd/row.seats.length),remainder=row.amount_vnd-base*row.seats.length;
    row.commission_lines=row.seats.map((seat,index)=>({seat,netAmount:base+(index<remainder?1:0)}));
  }
  return row;
}
function legacy(patch:Partial<SalePerformanceLegacyOrder>={}):SalePerformanceLegacyOrder{
  const row:SalePerformanceLegacyOrder={
    order_code:"LEGACY-1",show_id:"sample-show",event_name:"Nghệ sĩ thử nghiệm",seats:["A1"],
    amount_vnd:100000,paid_at:"2030-01-15T12:00:00Z",payment_verified:true,seller_name:"sample-beta",...patch,
  };
  if(!Object.prototype.hasOwnProperty.call(patch,"commission_lines")){
    const base=Math.floor(row.amount_vnd/row.seats.length),remainder=row.amount_vnd-base*row.seats.length;
    row.commission_lines=row.seats.map((seat,index)=>({seat,netAmount:base+(index<remainder?1:0)}));
  }
  return row;
}
const seats=(count:number,prefix="A")=>Array.from({length:count},(_,index)=>prefix+String(index+1).padStart(3,"0"));
const period={from:"2030-01-15",to:"2030-01-15",show:""};
const prior=(count:number,patch:Partial<SalePerformanceOnlineOrder>={})=>online({
  code:"EARLIER",seats:seats(count),amount_vnd:count*100000,paid_at:"2030-01-14T10:00:00Z",...patch,
});

test("credits exact Sale IDs, preserves inactive zero-sale staff and returns effective rates",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[online()]});
  assert.equal(result.sales.length,2);
  assert.deepEqual(result.totals,{sales:2,activeSales:1,salesWithRevenue:1,paidOrders:1,
    paidTickets:2,complimentaryTickets:0,revenue:825000,commission:123750,commissionPendingOrders:0});
  const sale=result.sales.find(row=>row.id==="staff-alpha")!;
  assert.equal(sale.commissionRate,.15);
  assert.equal(sale.orders[0].firstTicket,1);
  assert.equal(sale.orders[0].lastTicket,2);
  assert.equal(sale.shows[0].lifetimePaidTickets,2);
  assert.equal(result.sales.find(row=>row.id==="staff-beta")!.revenue,0);
  assert.equal(result.commissionComplete,true);
});

test("a multi-seat order crosses 10 with actual net prices after lifetime ranking and before dates",()=>{
  const crossing=online({code:"CROSSING",seats:["B03","B01","B02"],amount_vnd:900000,
    commission_lines:[{seat:"B03",netAmount:400000},{seat:"B01",netAmount:200000},{seat:"B02",netAmount:300000}]});
  const result=buildSalePerformance({...input,filters:period,onlineOrders:[crossing,prior(9)]});
  const sale=result.sales[0],order=sale.orders[0];
  assert.equal(sale.paidTickets,3);
  assert.equal(sale.revenue,900000);
  assert.equal(sale.commission,156000);
  assert.equal(sale.commissionRate,156000/900000);
  assert.deepEqual(order.commissionBands,[
    {fromTicket:1,toTicket:10,rate:15,tickets:1,revenue:200000,commission:30000},
    {fromTicket:11,toTicket:30,rate:18,tickets:2,revenue:700000,commission:126000},
  ]);
  assert.equal(order.firstTicket,10);assert.equal(order.lastTicket,12);
  assert.equal(sale.shows[0].lifetimePaidTickets,12);
  assert.equal(sale.shows[0].lifetimeLastTicket,12);
  assert.equal(sale.shows[0].lifetimeComplete,true);
  const full=buildSalePerformance({...input,onlineOrders:[prior(9),crossing]});
  assert.equal(full.sales[0].orders.find(row=>row.code==="CROSSING")!.commission,order.commission);
});

test("30 and 50 boundaries retain earlier tickets' rates and apportion rounding within each order",()=>{
  const thirty=buildSalePerformance({...input,filters:period,onlineOrders:[
    prior(29),online({code:"THIRTY",seats:["B1","B2"],amount_vnd:333333,
      commission_lines:[{seat:"B1",netAmount:111111},{seat:"B2",netAmount:222222}]}),
  ]});
  assert.equal(thirty.totals.commission,68889);
  assert.deepEqual(thirty.sales[0].orders[0].commissionBands.map(band=>band.commission),[20000,48889]);
  const fifty=buildSalePerformance({...input,filters:period,onlineOrders:[
    prior(49),online({code:"FIFTY",seats:["B1","B2"],amount_vnd:200000}),
  ]});
  assert.equal(fifty.totals.commission,47000);
  assert.deepEqual(fifty.sales[0].orders[0].commissionBands.map(band=>[band.rate,band.tickets]),[[22,1],[25,1]]);
});

test("commission sequences and configurable policies are independent for every Sale and show",()=>{
  const policies={...input.policies,"second-show":{...defaultSaleCommissionPolicy("second-show"),source:"show" as const,
    tiers:[{maxTickets:2,rate:5},{maxTickets:50,rate:7}],version:"fixture-policy-v1"}};
  const result=buildSalePerformance({...input,policies,onlineOrders:[
    online({code:"ALPHA-SHOW-A",seats:seats(11),amount_vnd:1100000}),
    online({code:"ALPHA-SHOW-B",show_id:"second-show",seats:seats(11),amount_vnd:1100000}),
    online({code:"BETA-SHOW-A",sale_staff_id:"staff-beta",seats:["B1"],amount_vnd:100000}),
  ]});
  assert.equal(result.sales.find(sale=>sale.id==="staff-alpha")!.commission,241000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.commission,15000);
  assert.equal(result.totals.commission,256000);
  assert.deepEqual(result.sales.find(sale=>sale.id==="staff-alpha")!.shows.map(show=>show.lifetimePaidTickets),[11,11]);
});

test("rounds once per order so two odd-priced tickets do not create an extra dong",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[online({amount_vnd:758100})]});
  assert.equal(result.totals.commission,113715);
  assert.equal(result.sales[0].orders[0].commissionBands.reduce((total,band)=>total+band.commission,0),113715);
});

test("accepted individual amounts cannot produce unsafe aggregate integer balances",()=>{
  const maximum=online({code:"SAFE-MAX",seats:["A1"],amount_vnd:Number.MAX_SAFE_INTEGER});
  const one=online({code:"PLUS-ONE",seats:["B1"],amount_vnd:1});
  assert.equal(buildSalePerformance({...input,onlineOrders:[maximum]}).totals.revenue,Number.MAX_SAFE_INTEGER);
  for(const onlineOrders of [
    [maximum,one],
    [maximum,{...one,sale_staff_id:"staff-beta"}],
    [{...maximum,sale_staff_id:null},{...one,sale_staff_id:null}],
  ]){
    assert.throws(()=>buildSalePerformance({...input,onlineOrders}),SalePerformanceDataError);
    assert.throws(()=>buildStaffSaleReport({...input,onlineOrders}),SalePerformanceDataError);
  }
  // Separately safe assigned/unassigned subtotals can still overflow a staff
  // day/show/payment-method bucket or the combined report total.
  assert.throws(()=>buildStaffSaleReport({...input,onlineOrders:[
    maximum,{...one,sale_staff_id:null},
  ]}),SalePerformanceDataError);
});

test("same-time ranking is deterministic by order code and seat regardless of input order",()=>{
  const timestamp="2030-01-15T10:00:00Z";
  const baseline=prior(9);
  const a=online({code:"A-ORDER",paid_at:timestamp,seats:["Z2","Z1"],amount_vnd:300000,
    commission_lines:[{seat:"Z2",netAmount:100000},{seat:"Z1",netAmount:200000}]});
  const b=online({code:"B-ORDER",paid_at:timestamp,seats:["C1"],amount_vnd:100000});
  const first=buildSalePerformance({...input,onlineOrders:[b,a,baseline]});
  const second=buildSalePerformance({...input,onlineOrders:[baseline,{...a,seats:[...a.seats].reverse(),commission_lines:[...a.commission_lines!].reverse()},b]});
  const financial=(result:ReturnType<typeof buildSalePerformance>)=>result.sales[0].orders.map(order=>({
    code:order.code,commission:order.commission,first:order.firstTicket,last:order.lastTicket,bands:order.commissionBands,
  }));
  assert.deepEqual(financial(first),financial(second));
  assert.equal(first.sales[0].orders.find(order=>order.code==="A-ORDER")!.commission,48000);
  assert.equal(first.sales[0].orders.find(order=>order.code==="B-ORDER")!.firstTicket,12);
});

test("free, VIP, unpaid and refunded orders and gift seats never advance paid-ticket tiers",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[
    prior(9),
    online({code:"FREE",amount_vnd:0,seats:["F1","F2"]}),
    online({code:"VIP",amount_vnd:0,is_vip_invitation:true,seats:["V1"]}),
    online({code:"PENDING",status:"pending"}),online({code:"REFUND",status:"refunded"}),
    online({code:"GIFT-ORDER",seats:["Z3","Z1","Z2"],amount_vnd:200000,
      commission_lines:[{seat:"Z3",netAmount:0},{seat:"Z1",netAmount:100000},{seat:"Z2",netAmount:100000}]}),
  ],legacyOrders:[legacy({order_code:"REFUND"}),legacy({payment_verified:false})]});
  assert.equal(result.totals.paidOrders,2);assert.equal(result.totals.paidTickets,11);
  assert.equal(result.totals.complimentaryTickets,4);
  assert.equal(result.totals.commission,168000);
  assert.equal(result.sales[0].orders.find(order=>order.code==="GIFT-ORDER")!.lastTicket,11);
});

test("missing historical snapshots block later ambiguous ordinals without hiding known counts",()=>{
  const result=buildSalePerformance({...input,filters:period,onlineOrders:[
    prior(6,{commission_lines:null}),
    online({code:"LATER-EXACT",seats:seats(5,"B"),amount_vnd:500000}),
  ]});
  const sale=result.sales[0],order=sale.orders[0],show=sale.shows[0];
  assert.equal(result.totals.paidTickets,5);
  assert.equal(result.totals.commission,0);
  assert.equal(result.totals.commissionPendingOrders,1);
  assert.equal(result.commissionComplete,false);
  assert.equal(order.firstTicket,null);assert.equal(order.lastTicket,null);
  assert.match(order.commissionIssue!,/trước đó/);
  assert.equal(show.lifetimeComplete,false);assert.equal(show.lifetimeLastTicket,null);
  assert.equal(show.lifetimePaidTickets,5);
  assert.equal(show.commissionComplete,false);
  assert.equal(result.commissionIssues[0].orderCode,"LATER-EXACT");
});

test("invalid paid chronology or amounts fail closed before filtering instead of resetting ranks",()=>{
  for(const paid_at of [null,"","invalid-date"]){
    const fixture={...input,filters:period,onlineOrders:[
      prior(9,{paid_at}),online({code:"LATER",seats:["B1","B2"],amount_vnd:200000}),
    ]};
    assert.throws(()=>buildSalePerformance(fixture),SalePerformanceDataError);
    assert.throws(()=>buildStaffSaleReport(fixture,"staff-alpha"),SalePerformanceDataError);
  }
  assert.throws(()=>buildSalePerformance({...input,filters:period,
    legacyOrders:[legacy({paid_at:"invalid-date"})]}),SalePerformanceDataError);
  assert.throws(()=>buildSalePerformance({...input,onlineOrders:[online({amount_vnd:NaN})]}),SalePerformanceDataError);
  assert.throws(()=>buildSalePerformance({...input,legacyOrders:[legacy({amount_vnd:-1})]}),SalePerformanceDataError);
  const safe=buildSalePerformance({...input,onlineOrders:[
    online({code:"VALID",seats:["A1"],amount_vnd:100000}),
    online({code:"UNPAID",status:"pending",paid_at:null,amount_vnd:NaN}),
    online({code:"FREE",paid_at:null,amount_vnd:0}),
    online({code:"VIP",paid_at:null,amount_vnd:0,is_vip_invitation:true}),
  ],legacyOrders:[legacy({payment_verified:false,paid_at:"invalid-date"})]});
  assert.equal(safe.totals.paidTickets,1);assert.equal(safe.totals.commission,15000);
  assert.equal(safe.commissionComplete,true);
});

test("unconfigured show and beyond-cap allocations remain explicit partial amounts",()=>{
  const unknown=buildSalePerformance({...input,legacyOrders:[legacy({show_id:null})]});
  assert.equal(unknown.totals.paidTickets,1);assert.equal(unknown.totals.commission,0);
  assert.equal(unknown.commissionComplete,false);
  assert.equal(unknown.sales.find(sale=>sale.id==="staff-beta")!.shows[0].policy,null);
  const over=buildSalePerformance({...input,onlineOrders:[online({seats:seats(551),amount_vnd:55100000})]});
  assert.equal(over.totals.paidTickets,551);assert.equal(over.totals.commission,13450000);
  assert.equal(over.sales[0].orders[0].lastTicket,551);
  assert.equal(over.sales[0].shows[0].lifetimeComplete,true);
  assert.equal(over.commissionComplete,false);
  assert.match(over.sales[0].orders[0].commissionIssue!,/vượt mốc/);
});

test("canonical online status, amount and exact Sale ID override all legacy shadows before filters",()=>{
  const result=buildSalePerformance({...input,filters:{...period,show:"sample-show"},onlineOrders:[
    online(),online({code:"PENDING",status:"pending"}),online({code:"OLD",paid_at:"2030-01-14T10:00:00Z"}),
    online({code:"OTHER-SHOW",show_id:"second-show"}),
  ],legacyOrders:[
    legacy({order_code:"ex0000000000000001",amount_vnd:900000}),legacy({order_code:"PENDING"}),
    legacy({order_code:"OLD"}),legacy({order_code:"OTHER-SHOW"}),legacy({order_code:"NEW"}),legacy({order_code:"new"}),
  ]});
  assert.equal(result.totals.paidOrders,2);assert.equal(result.totals.revenue,925000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-alpha")!.paidOrders,1);
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.paidOrders,1);
});

test("same-name accounts stay separate and ambiguous legacy ownership remains unassigned",()=>{
  const sameNames=accounts.map(account=>({...account,display_name:"Cùng tên"}));
  const result=buildSalePerformance({...input,accounts:sameNames,onlineOrders:[online()],legacyOrders:[
    legacy({order_code:"AMBIGUOUS",seller_name:"Cùng tên"}),
    legacy({order_code:"UNIQUE-USERNAME",seller_name:" SAMPLE-BETA "}),
  ]});
  assert.equal(result.sales.find(sale=>sale.id==="staff-alpha")!.revenue,825000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.revenue,100000);
  assert.deepEqual(result.unassigned,{orders:1,tickets:1,revenue:100000,complimentaryTickets:0});
});

test("staff and Admin agree on commission, while a Sale cannot see another seller through a name shadow",()=>{
  const fixture={...input,filters:period,onlineOrders:[
    prior(9),online({code:"ALPHA-LATEST",seats:["B1","B2"],amount_vnd:200000}),
    online({code:"PRIVATE-BETA",sale_staff_id:"staff-beta"}),
  ],legacyOrders:[legacy({order_code:"PRIVATE-BETA",seller_name:"sample-alpha"}),legacy({order_code:"OWN-LEGACY",seller_name:"sample-alpha"})]};
  const admin=buildSalePerformance(fixture),staff=buildStaffSaleReport(fixture),sale=buildStaffSaleReport(fixture,"staff-alpha");
  assert.equal(staff.commissionTotal,admin.totals.commission);
  assert.equal(sale.commissionTotal,admin.sales.find(row=>row.id==="staff-alpha")!.commission);
  assert.equal(sale.rows.some(row=>row.order_code==="PRIVATE-BETA"),false);
  assert.equal(sale.commissionBySeller.length,1);
  assert.equal(JSON.stringify(sale).includes("Sample Beta"),false);
  assert.equal(sale.rows.every(row=>row.saleId==="staff-alpha"),true);
  const zero=sale.commissionByShow.find(show=>show.showId==="second-show")!;
  assert.equal(zero.lifetimePaidTickets,0);assert.equal(zero.commission,0);
  assert.equal(zero.policy!.showId,"second-show");assert.equal(zero.showDate,"2030-02-01");
  assert.equal(sale.shows.length,2);
});

test("Vietnam date boundaries include the full end date without resetting earlier ordinals",()=>{
  const timestamps=["2030-01-14T16:59:59Z","2030-01-14T17:00:00Z","2030-01-15T16:59:59Z","2030-01-15T17:00:00Z"];
  const result=buildSalePerformance({...input,filters:period,
    onlineOrders:timestamps.map((paid_at,index)=>online({code:"DATE-"+index,paid_at}))});
  assert.equal(result.totals.paidOrders,2);
  assert.deepEqual(result.sales[0].orders.map(order=>[order.code,order.firstTicket]),[["DATE-2",5],["DATE-1",3]]);
  assert.equal(result.sales[0].shows[0].lifetimePaidTickets,8);
});

test("order row truncation never truncates earnings or lifetime counts",()=>{
  const fixture={...input,onlineOrders:Array.from({length:501},(_,index)=>online({
    code:"ORDER-"+String(index).padStart(4,"0"),seats:["A1"],amount_vnd:100000,
  }))};
  const admin=buildSalePerformance(fixture),staff=buildStaffSaleReport(fixture,"staff-alpha");
  assert.equal(staff.rowCount,501);assert.equal(staff.rows.length,500);
  assert.equal(staff.rowsLimited,true);assert.equal(staff.limited,false);
  assert.equal(staff.totals.orders,501);
  assert.equal(staff.commissionTotal,admin.totals.commission);
  assert.equal(staff.commissionByShow.find(show=>show.showId==="sample-show")!.lifetimePaidTickets,501);
});

test("database pagination continues after short pages and refuses incomplete oversized histories",async()=>{
  const values=Array.from({length:1201},(_,id)=>({id})),offsets:number[]=[];
  const loaded=await readAllSaleReportRows<{id:number}>(async path=>{
    const query=new URL("https://fixture.invalid/"+path).searchParams,offset=Number(query.get("offset"));
    offsets.push(offset);return values.slice(offset,offset+137);
  },"fixture?select=id");
  assert.deepEqual(loaded,values);assert.equal(offsets.at(-1),1201);
  await assert.rejects(()=>readAllSaleReportRows(async()=>Array.from({length:500},()=>({id:"same-fixture-row"})),"fixture?select=id"),SalePerformanceLimitError);
});

test("rejects impossible, reversed and malformed date and show filters",()=>{
  for(const from of ["2030-02-29","2030-02-31","2030-13-01","15/01/2030"])
    assert.notEqual(validateSalePerformanceFilters({from,to:"",show:""}),null);
  assert.notEqual(validateSalePerformanceFilters({from:"2030-01-16",to:"2030-01-15",show:""}),null);
  assert.notEqual(validateSalePerformanceFilters({from:"",to:"",show:"sample&status=paid"}),null);
  assert.equal(validateSalePerformanceFilters({from:"2032-02-29",to:"2032-02-29",show:"sample-show"}),null);
});

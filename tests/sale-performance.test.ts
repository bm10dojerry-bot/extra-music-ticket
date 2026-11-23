import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
  buildSalePerformance,validateSalePerformanceFilters,
  type SalePerformanceAccount,type SalePerformanceOnlineOrder,type SalePerformanceLegacyOrder,
} from "../lib/sale-performance";

// All identities, orders, shows, dates and amounts below are synthetic fixtures.
const settings={rate_1_10:15,rate_11_30:18,rate_31_50:22,rate_51_plus:25};
const accounts:SalePerformanceAccount[]=[
  {id:"staff-alpha",username:"sample-alpha",display_name:"Sample Alpha",role:"sale",active:true},
  {id:"staff-beta",username:"sample-beta",display_name:"Sample Beta",role:"sale",active:false},
];
const input={accounts,settings,shows:[{id:"sample-show",artist:"Nghệ sĩ thử nghiệm",date:"2030-01-20"}],
  filters:{from:"",to:"",show:""},updatedAt:"2030-01-15T13:00:00Z"};
const online=(patch:Partial<SalePerformanceOnlineOrder>={}):SalePerformanceOnlineOrder=>({
  code:"EX0000000000000001",show_id:"sample-show",seats:["X01","X02"],amount_vnd:825000,
  paid_at:"2030-01-15T09:30:00Z",sale_staff_id:"staff-alpha",is_vip_invitation:false,status:"paid",...patch,
});
const legacy=(patch:Partial<SalePerformanceLegacyOrder>={}):SalePerformanceLegacyOrder=>({
  order_code:"LEGACY-1",show_id:"sample-show",event_name:"Nghệ sĩ thử nghiệm",seats:["A1"],
  amount_vnd:100000,paid_at:"2030-01-15T12:00:00Z",payment_verified:true,seller_name:"sample-beta",...patch,
});

test("credits the exact sale and keeps inactive staff with zero sales",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[online()],legacyOrders:[]});
  assert.equal(result.sales.length,2);
  assert.deepEqual(result.totals,{sales:2,activeSales:1,salesWithRevenue:1,paidOrders:1,
    paidTickets:2,complimentaryTickets:0,revenue:825000,commission:123750});
  const credited=result.sales.find(sale=>sale.id==="staff-alpha")!;
  assert.equal(credited.commissionRate,.15);
  assert.equal(credited.orders[0].code,"EX0000000000000001");
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.revenue,0);
});

test("does not merge same-name accounts or guess ambiguous legacy attribution",()=>{
  const sameNames=accounts.map(account=>({...account,display_name:"Cùng tên"}));
  const result=buildSalePerformance({...input,accounts:sameNames,onlineOrders:[online()],legacyOrders:[
    legacy({order_code:"AMBIGUOUS",seller_name:"Cùng tên"}),
    legacy({order_code:"UNIQUE-USERNAME",seller_name:" SAMPLE-BETA "}),
  ]});
  assert.equal(result.sales.find(sale=>sale.id==="staff-alpha")!.revenue,825000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.revenue,100000);
  assert.deepEqual(result.unassigned,{orders:1,tickets:1,revenue:100000,complimentaryTickets:0});
});

test("deduplicates case-insensitively and online attribution and status win",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[online(),online({code:"PENDING",status:"pending"})],
    legacyOrders:[legacy({order_code:"ex0000000000000001",amount_vnd:900000}),
      legacy({order_code:"PENDING"}),legacy({order_code:"NEW"}),legacy({order_code:"new"})]});
  assert.equal(result.totals.paidOrders,2);
  assert.equal(result.totals.revenue,925000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-beta")!.paidOrders,1);
});

test("unpaid, negative and complimentary rows do not raise paid totals or commission tier",()=>{
  const result=buildSalePerformance({...input,onlineOrders:[
    online({code:"TEN-PAID",seats:Array.from({length:10},(_,i)=>"A"+(i+1)),amount_vnd:1000000}),
    online({code:"ZERO",amount_vnd:0,seats:["B1","B2","B3"]}),
    online({code:"VIP",amount_vnd:0,is_vip_invitation:true,seats:["C1","C2"]}),
    online({code:"PENDING",status:"pending"}),online({code:"NEGATIVE",amount_vnd:-100}),
    online({code:"UNASSIGNED",sale_staff_id:"missing"}),
    online({code:"UNASSIGNED-FREE",sale_staff_id:null,amount_vnd:0}),
  ],legacyOrders:[legacy({payment_verified:false})]});
  assert.equal(result.totals.paidOrders,1);
  assert.equal(result.totals.paidTickets,10);
  assert.equal(result.totals.complimentaryTickets,5);
  assert.equal(result.totals.revenue,1000000);
  assert.equal(result.totals.commission,150000);
  assert.equal(result.sales.find(sale=>sale.id==="staff-alpha")!.orders.length,3);
  assert.deepEqual(result.unassigned,{orders:1,tickets:2,revenue:825000,complimentaryTickets:2});
});

test("each tier applies to all revenue using configured percentages and dong rounding",()=>{
  const tiers=[[10,.15],[11,.18],[30,.18],[31,.22],[50,.22],[51,.25],[551,.25]];
  for(const [tickets,rate] of tiers){
    const result=buildSalePerformance({...input,onlineOrders:[online({
      seats:Array.from({length:tickets},(_,i)=>"A"+(i+1)),amount_vnd:100001,
    })],legacyOrders:[]});
    assert.equal(result.sales[0].commissionRate,rate);
    assert.equal(result.totals.commission,Math.round(100001*rate));
  }
  const custom=buildSalePerformance({...input,settings:{...settings,rate_1_10:12.34},onlineOrders:[online()],legacyOrders:[]});
  assert.equal(custom.sales[0].commissionRate,.1234);
  assert.equal(custom.totals.commission,101805);
});

test("date boundaries use Vietnam midnight and include the selected end date",()=>{
  const timestamps=["2030-01-14T16:59:59Z","2030-01-14T17:00:00Z","2030-01-15T16:59:59Z","2030-01-15T17:00:00Z"];
  const result=buildSalePerformance({...input,filters:{from:"2030-01-15",to:"2030-01-15",show:""},
    onlineOrders:timestamps.map((paid_at,i)=>online({code:"DATE-"+i,paid_at})),legacyOrders:[]});
  assert.equal(result.totals.paidOrders,2);
  assert.deepEqual(result.sales[0].orders.map(order=>order.code),["DATE-2","DATE-1"]);
});

test("online authority is preserved before show and date filters",()=>{
  const result=buildSalePerformance({...input,filters:{from:"2030-01-15",to:"2030-01-15",show:"sample-show"},
    onlineOrders:[online({show_id:"second-sample-show"}),online({code:"OLD",paid_at:"2030-01-14T10:00:00Z"})],
    legacyOrders:[legacy({order_code:"EX0000000000000001"}),legacy({order_code:"OLD"})]});
  assert.equal(result.totals.paidOrders,0);
  assert.equal(result.unassigned.orders,0);
});

test("rejects impossible, reversed and malformed date and show filters",()=>{
  for(const from of ["2030-02-29","2030-02-31","2030-13-01","15/01/2030"])
    assert.notEqual(validateSalePerformanceFilters({from,to:"",show:""}),null);
  assert.notEqual(validateSalePerformanceFilters({from:"2030-01-16",to:"2030-01-15",show:""}),null);
  assert.notEqual(validateSalePerformanceFilters({from:"",to:"",show:"sample&status=paid"}),null);
  assert.equal(validateSalePerformanceFilters({from:"2032-02-29",to:"2032-02-29",show:"sample-show"}),null);
});

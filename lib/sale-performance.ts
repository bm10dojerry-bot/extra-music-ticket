import {
  saleCommissionAmount,
  saleCommissionRate,
  type SaleCommissionSettings,
} from "./sale-commission";

export type SalePerformanceFilters = {from:string;to:string;show:string};
export type SalePerformanceShow = {id:string;artist:string;date:string};
export type SalePerformanceOrder = {
  code:string;
  showId:string;
  showName:string;
  seats:string[];
  amount:number;
  paidAt:string;
  isComplimentary:boolean;
};
export type SalePerformanceSale = {
  id:string;
  name:string;
  username:string;
  active:boolean;
  paidOrders:number;
  paidTickets:number;
  complimentaryTickets:number;
  revenue:number;
  commissionRate:number;
  commission:number;
  lastPaidAt:string|null;
  orders:SalePerformanceOrder[];
};
export type SalePerformanceResponse = {
  updatedAt:string;
  filters:SalePerformanceFilters;
  settings:SaleCommissionSettings;
  shows:SalePerformanceShow[];
  totals:{
    sales:number;
    activeSales:number;
    salesWithRevenue:number;
    paidOrders:number;
    paidTickets:number;
    complimentaryTickets:number;
    revenue:number;
    commission:number;
  };
  sales:SalePerformanceSale[];
  unassigned:{orders:number;tickets:number;revenue:number;complimentaryTickets:number};
  limited:boolean;
};

export type SalePerformanceAccount = {
  id:string;username:string;display_name:string;active:boolean;role:string;
};
export type SalePerformanceOnlineOrder = {
  code:string;show_id:string;seats:string[];amount_vnd:number;
  paid_at:string|null;sale_staff_id:string|null;is_vip_invitation:boolean|null;status:string;
};
export type SalePerformanceLegacyOrder = {
  order_code:string;show_id:string|null;event_name:string;seats:string[];
  amount_vnd:number;paid_at:string;payment_verified:boolean;seller_name:string|null;
};

function validDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function validateSalePerformanceFilters(filters:SalePerformanceFilters):string|null {
  if((filters.from&&!validDate(filters.from))||(filters.to&&!validDate(filters.to)))
    return "Ngày lọc phải là ngày hợp lệ theo định dạng YYYY-MM-DD.";
  if(filters.from&&filters.to&&filters.from>filters.to)
    return "Ngày bắt đầu không được sau ngày kết thúc.";
  if(filters.show&&!/^[a-z0-9-]{3,100}$/.test(filters.show))
    return "Mã show không hợp lệ.";
  return null;
}

type AggregateInput = {
  accounts:SalePerformanceAccount[];
  onlineOrders:SalePerformanceOnlineOrder[];
  legacyOrders:SalePerformanceLegacyOrder[];
  shows:SalePerformanceShow[];
  settings:SaleCommissionSettings;
  filters:SalePerformanceFilters;
  updatedAt:string;
};

const orderKey=(code:string)=>code.trim().toUpperCase();
const nameKey=(name:string)=>name.trim().toLocaleLowerCase("vi-VN");

/** Read-only calculation. An online order's staff ID is authoritative, including
 * when a legacy record has the same order code but a different seller name.
 * All totals here concern the selected period; reward amounts are not payouts.
 */
export function buildSalePerformance(input:AggregateInput):SalePerformanceResponse {
  const validation=validateSalePerformanceFilters(input.filters);
  if(validation)throw Error(validation);
  const start=input.filters.from?Date.parse(input.filters.from+"T00:00:00+07:00"):-Infinity;
  const end=input.filters.to?Date.parse(input.filters.to+"T00:00:00+07:00")+86400000:Infinity;
  const showNames=new Map(input.shows.map(show=>[show.id,show.artist]));
  const byId=new Map<string,SalePerformanceSale>();
  const aliases=new Map<string,Set<string>>();
  for(const account of input.accounts){
    if(account.role!=="sale"||byId.has(account.id))continue;
    byId.set(account.id,{
      id:account.id,name:account.display_name||account.username,username:account.username,
      active:account.active,paidOrders:0,paidTickets:0,complimentaryTickets:0,
      revenue:0,commissionRate:0,commission:0,lastPaidAt:null,orders:[],
    });
    for(const name of [account.username,account.display_name]){
      const alias=nameKey(name);
      if(!alias)continue;
      const ids=aliases.get(alias)||new Set<string>();
      ids.add(account.id);aliases.set(alias,ids);
    }
  }
  const unassigned={orders:0,tickets:0,revenue:0,complimentaryTickets:0};
  const included=(showId:string,paidAt:string|null):paidAt is string=>{
    if(!paidAt||(input.filters.show&&showId!==input.filters.show))return false;
    const at=Date.parse(paidAt);
    return Number.isFinite(at)&&at>=start&&at<end;
  };
  const add=(order:SalePerformanceOrder,staffId:string|null)=>{
    const sale=staffId?byId.get(staffId):undefined;
    if(!sale){
      if(order.isComplimentary)unassigned.complimentaryTickets+=order.seats.length;
      else {unassigned.orders++;unassigned.tickets+=order.seats.length;unassigned.revenue+=order.amount;}
      return;
    }
    sale.orders.push(order);
    if(order.isComplimentary){sale.complimentaryTickets+=order.seats.length;return;}
    sale.paidOrders++;
    sale.paidTickets+=order.seats.length;
    sale.revenue+=order.amount;
    if(!sale.lastPaidAt||Date.parse(order.paidAt)>Date.parse(sale.lastPaidAt))sale.lastPaidAt=order.paidAt;
  };
  // Keep non-paid online codes in the index too: an old verified legacy row
  // must not resurrect an online order that is currently unpaid/cancelled.
  const onlineByCode=new Map<string,SalePerformanceOnlineOrder>();
  for(const order of input.onlineOrders){
    const key=orderKey(order.code);
    if(key&&!onlineByCode.has(key))onlineByCode.set(key,order);
  }
  for(const [code,order] of onlineByCode){
    if(order.status!=="paid"||!included(order.show_id,order.paid_at))continue;
    const amount=Number(order.amount_vnd);
    if(!Number.isSafeInteger(amount)||amount<0)continue;
    const seats=Array.isArray(order.seats)?[...order.seats]:[];
    add({code,showId:order.show_id,showName:showNames.get(order.show_id)||order.show_id,
      seats,amount,paidAt:order.paid_at,isComplimentary:order.is_vip_invitation===true||amount===0},
      order.sale_staff_id);
  }
  const legacySeen=new Set<string>();
  for(const order of input.legacyOrders){
    const code=orderKey(order.order_code);
    if(!code||onlineByCode.has(code)||legacySeen.has(code)||order.payment_verified!==true)continue;
    legacySeen.add(code);
    const showId=order.show_id||"";
    if(!included(showId,order.paid_at))continue;
    const amount=Number(order.amount_vnd);
    if(!Number.isSafeInteger(amount)||amount<0)continue;
    const candidates=aliases.get(nameKey(order.seller_name||""));
    const staffId=candidates?.size===1?[...candidates][0]:null;
    add({code,showId,showName:showNames.get(showId)||order.event_name||showId,
      seats:Array.isArray(order.seats)?[...order.seats]:[],amount,paidAt:order.paid_at,
      isComplimentary:amount===0},staffId);
  }
  const sales=[...byId.values()];
  for(const sale of sales){
    sale.commissionRate=saleCommissionRate(sale.paidTickets,input.settings);
    sale.commission=saleCommissionAmount(sale.paidTickets,sale.revenue,input.settings);
    sale.orders.sort((a,b)=>Date.parse(b.paidAt)-Date.parse(a.paidAt)||a.code.localeCompare(b.code));
  }
  sales.sort((a,b)=>b.revenue-a.revenue||b.paidTickets-a.paidTickets||a.name.localeCompare(b.name,"vi")||a.id.localeCompare(b.id));
  const totals={sales:sales.length,activeSales:0,salesWithRevenue:0,paidOrders:0,
    paidTickets:0,complimentaryTickets:0,revenue:0,commission:0};
  for(const sale of sales){
    if(sale.active)totals.activeSales++;
    if(sale.revenue>0)totals.salesWithRevenue++;
    totals.paidOrders+=sale.paidOrders;totals.paidTickets+=sale.paidTickets;
    totals.complimentaryTickets+=sale.complimentaryTickets;
    totals.revenue+=sale.revenue;totals.commission+=sale.commission;
  }
  return {updatedAt:input.updatedAt,filters:{...input.filters},settings:{...input.settings},
    shows:input.shows.map(show=>({...show})),totals,sales,unassigned,limited:false};
}

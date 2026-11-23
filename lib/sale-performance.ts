import {
  calculateSaleCommissions,
  type SaleCommissionPolicy,
} from "./sale-commission";

export type SalePerformanceFilters = {from:string;to:string;show:string};
export type SalePerformanceShow = {id:string;artist:string;date:string;hidden?:boolean};
export type SalePerformanceManagedShow = {id:string;artist:string;show_date:string;status:string};
export type SalePerformanceCommissionBand = {
  fromTicket:number;toTicket:number;rate:number;tickets:number;revenue:number;commission:number;
};
export type SalePerformanceCommissionIssue = {orderCode:string;showId:string;message:string};
export type SalePerformanceShowCommission = {
  saleId:string;saleName:string;showId:string;showName:string;showDate:string;
  policy:SaleCommissionPolicy|null;
  paidOrders:number;paidTickets:number;complimentaryTickets:number;revenue:number;
  commission:number;commissionRate:number;bands:SalePerformanceCommissionBand[];
  lifetimePaidTickets:number;lifetimeLastTicket:number|null;lifetimeComplete:boolean;
  commissionComplete:boolean;commissionIssues:SalePerformanceCommissionIssue[];
};
export type SalePerformanceOrder = {
  code:string;showId:string;showName:string;seats:string[];amount:number;paidAt:string;
  isComplimentary:boolean;paidTickets:number;complimentaryTickets:number;
  commission:number;commissionBands:SalePerformanceCommissionBand[];
  firstTicket:number|null;lastTicket:number|null;commissionIssue:string|null;
};
export type SalePerformanceSale = {
  id:string;name:string;username:string;active:boolean;
  paidOrders:number;paidTickets:number;complimentaryTickets:number;revenue:number;
  /** Effective earned commission / revenue, never a rate retroactively applied to all tickets. */
  commissionRate:number;commission:number;lastPaidAt:string|null;
  orders:SalePerformanceOrder[];shows:SalePerformanceShowCommission[];
  commissionComplete:boolean;commissionIssues:SalePerformanceCommissionIssue[];
};
export type SalePerformanceResponse = {
  updatedAt:string;filters:SalePerformanceFilters;
  policies:Record<string,SaleCommissionPolicy>;shows:SalePerformanceShow[];
  totals:{
    sales:number;activeSales:number;salesWithRevenue:number;paidOrders:number;
    paidTickets:number;complimentaryTickets:number;revenue:number;commission:number;
    commissionPendingOrders:number;
  };
  sales:SalePerformanceSale[];
  unassigned:{orders:number;tickets:number;revenue:number;complimentaryTickets:number};
  commissionComplete:boolean;commissionIssues:SalePerformanceCommissionIssue[];
  limited:boolean;
};
export type StaffSaleReportRow = {
  order_code:string;show_id:string|null;event_name:string;venue_name:string;
  seats:string[];amount_vnd:number;payment_method:string;seller_name:string|null;paid_at:string;
  saleId:string|null;paidTickets:number;complimentaryTickets:number;commission:number;
  commissionBands:SalePerformanceCommissionBand[];firstTicket:number|null;lastTicket:number|null;
  commissionIssue:string|null;isComplimentary:boolean;
};
export type StaffSaleReportSeller = {
  saleId:string|null;seller:string;orders:number;tickets:number;commissionTickets:number;
  complimentaryTickets:number;revenue:number;
};
export type StaffSaleReportResponse = {
  updatedAt:string;filters:SalePerformanceFilters;shows:SalePerformanceShow[];
  policies:Record<string,SaleCommissionPolicy>;
  commissionByShow:SalePerformanceShowCommission[];
  commissionBySeller:Array<StaffSaleReportSeller&{
    rate:number;commission:number;commissionComplete:boolean;
    commissionIssues:SalePerformanceCommissionIssue[];shows:SalePerformanceShowCommission[];
  }>;
  commissionTotal:number;commissionComplete:boolean;commissionIssues:SalePerformanceCommissionIssue[];
  bySeller:StaffSaleReportSeller[];
  byDay:Array<{day:string;orders:number;tickets:number;complimentaryTickets:number;revenue:number}>;
  summary:Array<{
    showId:string;showName:string;orders:number;tickets:number;complimentaryTickets:number;
    revenue:number;byMethod:Record<string,number>;
  }>;
  totals:{
    orders:number;tickets:number;commissionTickets:number;complimentaryTickets:number;
    revenue:number;commissionPendingOrders:number;
  };
  rows:StaffSaleReportRow[];rowCount:number;rowsLimited:boolean;
  limited:boolean;verifiedOnly:true;onlineOrders:number;
};
export type SalePerformanceAccount = {
  id:string;username:string;display_name:string;active:boolean;role:string;
};
export type SalePerformanceCommissionLine = {seat:string;netAmount:number};
export type SalePerformanceOnlineOrder = {
  code:string;show_id:string;seats:string[];amount_vnd:number;
  paid_at:string|null;sale_staff_id:string|null;is_vip_invitation:boolean|null;status:string;
  commission_lines?:SalePerformanceCommissionLine[]|null;
};
export type SalePerformanceLegacyOrder = {
  order_code:string;show_id:string|null;event_name:string;seats:string[];
  amount_vnd:number;paid_at:string;payment_verified:boolean;seller_name:string|null;
  venue_name?:string;payment_method?:string;commission_lines?:SalePerformanceCommissionLine[]|null;
};
export type SalePerformanceInput = {
  accounts:SalePerformanceAccount[];onlineOrders:SalePerformanceOnlineOrder[];
  legacyOrders:SalePerformanceLegacyOrder[];shows:SalePerformanceShow[];
  policies:Record<string,SaleCommissionPolicy>;filters:SalePerformanceFilters;updatedAt:string;
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
export class SalePerformanceLimitError extends Error {}
export class SalePerformanceDataError extends Error {
  constructor(){
    super("Có giao dịch đã thanh toán thiếu thời điểm hoặc số tiền hợp lệ. Cần đối soát dữ liệu trước khi tính hoa hồng.");
    this.name="SalePerformanceDataError";
  }
}
/** PostgREST can return a shorter page than requested. An empty page alone
 * proves completion; refusing oversized histories is safer than partial earnings. */
export async function readAllSaleReportRows<T>(
  read:(path:string)=>Promise<unknown>,path:string,
):Promise<T[]> {
  const rows:T[]=[];
  while(true){
    const page=await read(path+"&limit=500&offset="+rows.length);
    if(!Array.isArray(page))throw Error("Invalid report data");
    if(page.length===0)return rows;
    if(rows.length+page.length>50000)throw new SalePerformanceLimitError();
    rows.push(...page as T[]);
  }
}

type CanonicalOrder = {
  code:string;showId:string;showName:string;seats:string[];amount:number;paidAt:string;
  saleId:string|null;sellerName:string;source:"online"|"legacy";venueName:string;paymentMethod:string;
  isComplimentary:boolean;commissionLines?:SalePerformanceCommissionLine[]|null;
};
type AllocatedOrder = CanonicalOrder&SalePerformanceOrder;
type PreparedReport = {response:SalePerformanceResponse;visible:AllocatedOrder[]};
const orderKey=(code:string)=>code.trim().toUpperCase();
const nameKey=(name:string)=>name.trim().toLocaleLowerCase("vi-VN");
const compareText=(a:string,b:string)=>a<b?-1:a>b?1:0;
function addInteger(total:number,value:number):number {
  const next=total+value;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(value)||total<0||value<0||!Number.isSafeInteger(next))
    throw new SalePerformanceDataError();
  return next;
}
const sum=(values:number[])=>values.reduce(addInteger,0);
const issueFor=(order:AllocatedOrder):SalePerformanceCommissionIssue|null=>
  order.commissionIssue?{orderCode:order.code,showId:order.showId,message:order.commissionIssue}:null;
const copyPolicy=(policy:SaleCommissionPolicy):SaleCommissionPolicy=>({...policy,tiers:policy.tiers.map(tier=>({...tier}))});

/** Normalize once for every report. A matching online record owns attribution,
 * status, paid time, amount and ticket pricing even if a legacy row disagrees. */
function canonicalOrders(input:SalePerformanceInput,accounts:Map<string,SalePerformanceAccount>):CanonicalOrder[] {
  const shows=new Map(input.shows.map(show=>[show.id,show]));
  const aliases=new Map<string,Set<string>>();
  for(const account of accounts.values()){
    for(const value of [account.username,account.display_name]){
      const key=nameKey(value);
      if(!key)continue;
      const ids=aliases.get(key)||new Set<string>();
      ids.add(account.id);aliases.set(key,ids);
    }
  }
  const result:CanonicalOrder[]=[];
  const onlineByCode=new Map<string,SalePerformanceOnlineOrder>();
  for(const order of input.onlineOrders){
    const key=orderKey(order.code);
    if(key&&!onlineByCode.has(key))onlineByCode.set(key,order);
  }
  for(const [code,order] of onlineByCode){
    if(order.status!=="paid")continue;
    const amount=Number(order.amount_vnd);
    if(!Number.isSafeInteger(amount)||amount<0)throw new SalePerformanceDataError();
    const isComplimentary=order.is_vip_invitation===true||amount===0;
    if(!order.paid_at||!Number.isFinite(Date.parse(order.paid_at))){
      if(!isComplimentary)throw new SalePerformanceDataError();
      continue;
    }
    const sale=order.sale_staff_id?accounts.get(order.sale_staff_id):undefined;
    result.push({
      code,showId:order.show_id,showName:shows.get(order.show_id)?.artist||order.show_id,
      seats:Array.isArray(order.seats)?[...order.seats]:[],amount,paidAt:order.paid_at,
      saleId:sale?.id||null,sellerName:sale?(sale.display_name||sale.username):"Online / SePay",
      source:"online",venueName:"",paymentMethod:"SePay / ACB",
      isComplimentary,commissionLines:order.commission_lines,
    });
  }
  const legacySeen=new Set<string>();
  for(const order of input.legacyOrders){
    const code=orderKey(order.order_code);
    if(!code||onlineByCode.has(code)||legacySeen.has(code)||order.payment_verified!==true)continue;
    legacySeen.add(code);
    const amount=Number(order.amount_vnd);
    if(!Number.isSafeInteger(amount)||amount<0)throw new SalePerformanceDataError();
    if(!order.paid_at||!Number.isFinite(Date.parse(order.paid_at))){
      if(amount>0)throw new SalePerformanceDataError();
      continue;
    }
    const ids=aliases.get(nameKey(order.seller_name||""));
    const sale=ids?.size===1?accounts.get([...ids][0]):undefined;
    const showId=order.show_id||"";
    result.push({
      code,showId,showName:shows.get(showId)?.artist||order.event_name||showId,
      seats:Array.isArray(order.seats)?[...order.seats]:[],amount,paidAt:order.paid_at,
      saleId:sale?.id||null,sellerName:sale?(sale.display_name||sale.username):(order.seller_name||"Online / Không xác định"),
      source:"legacy",venueName:order.venue_name||"",paymentMethod:order.payment_method||"Không xác định",
      isComplimentary:amount===0,commissionLines:order.commission_lines,
    });
  }
  return result;
}

function mergeBands(orders:AllocatedOrder[],policy:SaleCommissionPolicy|null):SalePerformanceCommissionBand[] {
  const groups=new Map<string,SalePerformanceCommissionBand>();
  for(const order of orders)for(const band of order.commissionBands){
    const tier=policy?.tiers.findIndex(item=>band.fromTicket<=item.maxTickets)??-1;
    const key=String(tier)+":"+String(band.rate);
    const current=groups.get(key);
    if(current){
      current.fromTicket=Math.min(current.fromTicket,band.fromTicket);
      current.toTicket=Math.max(current.toTicket,band.toTicket);
      current.tickets=addInteger(current.tickets,band.tickets);
      current.revenue=addInteger(current.revenue,band.revenue);
      current.commission=addInteger(current.commission,band.commission);
    }else groups.set(key,{...band});
  }
  return [...groups.values()].sort((a,b)=>a.fromTicket-b.fromTicket);
}

function prepareReport(input:SalePerformanceInput,saleIdScope?:string):PreparedReport {
  const validation=validateSalePerformanceFilters(input.filters);
  if(validation)throw Error(validation);
  const start=input.filters.from?Date.parse(input.filters.from+"T00:00:00+07:00"):-Infinity;
  const end=input.filters.to?Date.parse(input.filters.to+"T00:00:00+07:00")+86400000:Infinity;
  const accounts=new Map(input.accounts.filter(account=>account.role==="sale").map(account=>[account.id,account]));
  const canonical=canonicalOrders(input,accounts);
  // Unassigned records use isolated internal groups only to validate/count their
  // paid/gift seat lines. Their calculated commission is never credited or returned.
  const allocations=calculateSaleCommissions(canonical.map(order=>({
    saleId:order.saleId||"unassigned:"+order.code,showId:order.showId,orderCode:order.code,
    paidAt:order.paidAt,amount:order.amount,seats:order.seats,isComplimentary:order.isComplimentary,
    commissionLines:order.commissionLines,
  })),input.policies);
  const byOrder=new Map(allocations.map(allocation=>[allocation.orderCode,allocation]));
  const allocated:AllocatedOrder[]=canonical.map(order=>{
    const allocation=byOrder.get(order.code);
    if(!allocation)throw Error("Incomplete commission allocation");
    return {...order,paidTickets:allocation.paidTickets,complimentaryTickets:allocation.complimentaryTickets,
      commission:order.saleId?allocation.commission:0,
      commissionBands:order.saleId?allocation.bands.map(band=>({...band})):[],
      firstTicket:order.saleId?allocation.firstTicket:null,lastTicket:order.saleId?allocation.lastTicket:null,
      commissionIssue:order.saleId?allocation.issue:(allocation.issue||"Chưa xác định tài khoản Sale của đơn."),
    };
  });
  const visible=allocated.filter(order=>{
    const at=Date.parse(order.paidAt);
    return (!saleIdScope||order.saleId===saleIdScope)&&(!input.filters.show||order.showId===input.filters.show)&&at>=start&&at<end;
  }).sort((a,b)=>Date.parse(b.paidAt)-Date.parse(a.paidAt)||compareText(a.code,b.code));
  const ownHistoricalShowIds=new Set(allocated.filter(order=>order.saleId===saleIdScope).map(order=>order.showId));
  const selectableShows=input.shows.filter(show=>!saleIdScope||!show.hidden||ownHistoricalShowIds.has(show.id));
  const selectableShowIds=new Set(selectableShows.map(show=>show.id));
  const showIndex=new Map(input.shows.map(show=>[show.id,show]));
  const sales:SalePerformanceSale[]=[];
  for(const account of accounts.values()){
    if(saleIdScope&&account.id!==saleIdScope)continue;
    const lifetime=allocated.filter(order=>order.saleId===account.id);
    const orders=visible.filter(order=>order.saleId===account.id);
    const name=account.display_name||account.username;
    const issues=orders.map(issueFor).filter((issue):issue is SalePerformanceCommissionIssue=>issue!==null);
    const paid=orders.filter(order=>!order.isComplimentary);
    const revenue=sum(paid.map(order=>order.amount)),commission=sum(orders.map(order=>order.commission));
    const showIds=new Set(lifetime.filter(order=>!input.filters.show||order.showId===input.filters.show).map(order=>order.showId));
    // Sale dashboards need a real policy and zero progress for unsold/ended shows,
    // without asking the browser to reconstruct financial values.
    if(saleIdScope){
      for(const show of selectableShows)if(!input.filters.show||show.id===input.filters.show)showIds.add(show.id);
    }else if(input.filters.show&&showIndex.has(input.filters.show))showIds.add(input.filters.show);
    const shows:SalePerformanceShowCommission[]=[...showIds].map(showId=>{
      const all=lifetime.filter(order=>order.showId===showId),selected=orders.filter(order=>order.showId===showId);
      const selectedPaid=selected.filter(order=>!order.isComplimentary);
      const policy=input.policies[showId]?copyPolicy(input.policies[showId]):null;
      const show=showIndex.get(showId);
      const commissionIssues=selected.map(issueFor).filter((issue):issue is SalePerformanceCommissionIssue=>issue!==null);
      const showRevenue=sum(selectedPaid.map(order=>order.amount)),showCommission=sum(selected.map(order=>order.commission));
      const lifetimeComplete=all.every(order=>order.isComplimentary||(order.firstTicket!==null&&order.lastTicket!==null));
      return {
        saleId:account.id,saleName:name,showId,showName:show?.artist||all[0]?.showName||showId,
        showDate:show?.date||"",policy,paidOrders:selectedPaid.length,
        paidTickets:sum(selected.map(order=>order.paidTickets)),
        complimentaryTickets:sum(selected.map(order=>order.complimentaryTickets)),
        revenue:showRevenue,commission:showCommission,commissionRate:showRevenue?showCommission/showRevenue:0,
        bands:mergeBands(selected,policy),lifetimePaidTickets:sum(all.map(order=>order.paidTickets)),
        lifetimeLastTicket:lifetimeComplete?Math.max(0,...all.map(order=>order.lastTicket||0)):null,
        lifetimeComplete,commissionComplete:commissionIssues.length===0,commissionIssues,
      };
    }).sort((a,b)=>compareText(b.showDate,a.showDate)||compareText(a.showId,b.showId));
    sales.push({
      id:account.id,name,username:account.username,active:account.active,
      paidOrders:paid.length,paidTickets:sum(orders.map(order=>order.paidTickets)),
      complimentaryTickets:sum(orders.map(order=>order.complimentaryTickets)),
      revenue,commission,commissionRate:revenue?commission/revenue:0,
      lastPaidAt:paid[0]?.paidAt||null,orders:orders.map(order=>({
        code:order.code,showId:order.showId,showName:order.showName,seats:[...order.seats],amount:order.amount,
        paidAt:order.paidAt,isComplimentary:order.isComplimentary,paidTickets:order.paidTickets,
        complimentaryTickets:order.complimentaryTickets,commission:order.commission,
        commissionBands:order.commissionBands.map(band=>({...band})),firstTicket:order.firstTicket,
        lastTicket:order.lastTicket,commissionIssue:order.commissionIssue,
      })),shows,commissionComplete:issues.length===0,commissionIssues:issues,
    });
  }
  sales.sort((a,b)=>b.revenue-a.revenue||b.paidTickets-a.paidTickets||a.name.localeCompare(b.name,"vi")||compareText(a.id,b.id));
  const unassigned={orders:0,tickets:0,revenue:0,complimentaryTickets:0};
  for(const order of visible.filter(order=>!order.saleId)){
    unassigned.complimentaryTickets=addInteger(unassigned.complimentaryTickets,order.complimentaryTickets);
    if(!order.isComplimentary){
      unassigned.orders=addInteger(unassigned.orders,1);
      unassigned.tickets=addInteger(unassigned.tickets,order.paidTickets);
      unassigned.revenue=addInteger(unassigned.revenue,order.amount);
    }
  }
  const commissionIssues=sales.flatMap(sale=>sale.commissionIssues);
  const totals={
    sales:sales.length,activeSales:sales.filter(sale=>sale.active).length,
    salesWithRevenue:sales.filter(sale=>sale.revenue>0).length,
    paidOrders:sum(sales.map(sale=>sale.paidOrders)),paidTickets:sum(sales.map(sale=>sale.paidTickets)),
    complimentaryTickets:sum(sales.map(sale=>sale.complimentaryTickets)),revenue:sum(sales.map(sale=>sale.revenue)),
    commission:sum(sales.map(sale=>sale.commission)),commissionPendingOrders:commissionIssues.length,
  };
  return {visible,response:{
    updatedAt:input.updatedAt,filters:{...input.filters},
    policies:Object.fromEntries(Object.entries(input.policies).filter(([id])=>!saleIdScope||selectableShowIds.has(id)).map(([id,policy])=>[id,copyPolicy(policy)])),
    shows:selectableShows.map(show=>({id:show.id,artist:show.artist,date:show.date})),totals,sales,unassigned,commissionIssues,
    commissionComplete:commissionIssues.length===0,limited:false,
  }};
}

/** Lifetime ticket ordinals are fixed before the display period is selected. */
export function buildSalePerformance(input:SalePerformanceInput):SalePerformanceResponse {
  return prepareReport(input).response;
}

/** Same canonical ledger and allocations as Admin, then server-side actor scope.
 * A name match on a shadow legacy row can never grant access to another Sale's order. */
export function buildStaffSaleReport(input:SalePerformanceInput,saleIdScope?:string):StaffSaleReportResponse {
  const {response,visible}=prepareReport(input,saleIdScope);
  const bySeller=new Map<string,StaffSaleReportSeller>();
  const byDay=new Map<string,StaffSaleReportResponse["byDay"][number]>();
  const summary=new Map<string,StaffSaleReportResponse["summary"][number]>();
  const dateFormatter=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"});
  for(const order of visible){
    const paid=order.isComplimentary?0:1,amount=order.isComplimentary?0:order.amount;
    const key=order.saleId||"unassigned:"+nameKey(order.sellerName);
    const seller=bySeller.get(key)||{saleId:order.saleId,seller:order.sellerName,orders:0,tickets:0,commissionTickets:0,complimentaryTickets:0,revenue:0};
    seller.orders=addInteger(seller.orders,paid);seller.tickets=addInteger(seller.tickets,order.paidTickets);
    seller.commissionTickets=addInteger(seller.commissionTickets,order.paidTickets);
    seller.complimentaryTickets=addInteger(seller.complimentaryTickets,order.complimentaryTickets);
    seller.revenue=addInteger(seller.revenue,amount);bySeller.set(key,seller);
    const day=dateFormatter.format(new Date(order.paidAt));
    const dayGroup=byDay.get(day)||{day,orders:0,tickets:0,complimentaryTickets:0,revenue:0};
    dayGroup.orders=addInteger(dayGroup.orders,paid);dayGroup.tickets=addInteger(dayGroup.tickets,order.paidTickets);
    dayGroup.complimentaryTickets=addInteger(dayGroup.complimentaryTickets,order.complimentaryTickets);
    dayGroup.revenue=addInteger(dayGroup.revenue,amount);byDay.set(day,dayGroup);
    const showKey=order.showId||"unassigned:"+order.showName;
    const show=summary.get(showKey)||{showId:order.showId,showName:order.showName,orders:0,tickets:0,complimentaryTickets:0,revenue:0,byMethod:Object.create(null) as Record<string,number>};
    show.orders=addInteger(show.orders,paid);show.tickets=addInteger(show.tickets,order.paidTickets);
    show.complimentaryTickets=addInteger(show.complimentaryTickets,order.complimentaryTickets);
    show.revenue=addInteger(show.revenue,amount);
    if(amount>0)show.byMethod[order.paymentMethod]=addInteger(show.byMethod[order.paymentMethod]||0,amount);
    summary.set(showKey,show);
  }
  const commissionBySeller=response.sales.map(sale=>({
    saleId:sale.id,seller:sale.name,orders:sale.paidOrders,tickets:sale.paidTickets,
    commissionTickets:sale.paidTickets,complimentaryTickets:sale.complimentaryTickets,
    revenue:sale.revenue,rate:sale.commissionRate,commission:sale.commission,
    commissionComplete:sale.commissionComplete,commissionIssues:sale.commissionIssues,shows:sale.shows,
  })).sort((a,b)=>b.commission-a.commission||compareText(a.saleId,b.saleId));
  const rows:StaffSaleReportRow[]=visible.slice(0,500).map(order=>({
    order_code:order.code,show_id:order.showId||null,event_name:order.showName,venue_name:order.venueName,
    seats:[...order.seats],amount_vnd:order.amount,payment_method:order.paymentMethod,seller_name:order.sellerName,
    paid_at:order.paidAt,saleId:order.saleId,paidTickets:order.paidTickets,complimentaryTickets:order.complimentaryTickets,
    commission:order.commission,commissionBands:order.commissionBands.map(band=>({...band})),
    firstTicket:order.firstTicket,lastTicket:order.lastTicket,commissionIssue:order.commissionIssue,isComplimentary:order.isComplimentary,
  }));
  return {
    updatedAt:response.updatedAt,filters:response.filters,shows:response.shows,policies:response.policies,
    commissionByShow:response.sales.flatMap(sale=>sale.shows),commissionBySeller,
    commissionTotal:response.totals.commission,commissionComplete:response.commissionComplete,commissionIssues:response.commissionIssues,
    bySeller:[...bySeller.values()].sort((a,b)=>b.revenue-a.revenue||compareText(a.saleId||a.seller,b.saleId||b.seller)),
    byDay:[...byDay.values()].sort((a,b)=>compareText(b.day,a.day)),
    summary:[...summary.values()].sort((a,b)=>b.revenue-a.revenue||compareText(a.showId||a.showName,b.showId||b.showName)),
    totals:{
      orders:visible.filter(order=>!order.isComplimentary).length,tickets:sum(visible.map(order=>order.paidTickets)),
      commissionTickets:sum(visible.filter(order=>order.saleId!==null).map(order=>order.paidTickets)),
      complimentaryTickets:sum(visible.map(order=>order.complimentaryTickets)),
      revenue:sum(visible.filter(order=>!order.isComplimentary).map(order=>order.amount)),
      commissionPendingOrders:response.totals.commissionPendingOrders,
    },
    rows,rowCount:visible.length,rowsLimited:visible.length>rows.length,limited:false,verifiedOnly:true,
    onlineOrders:visible.filter(order=>order.source==="online"&&!order.isComplimentary).length,
  };
}

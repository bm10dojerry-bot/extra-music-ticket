/** Progressive commission: each paid ticket has an ordinal within its Sale + show.
 * Apply report date filters AFTER the lifetime calculation. Money is whole VND.
 */
export type SaleCommissionTier={maxTickets:number;rate:number};
export type SaleCommissionPolicy={showId:string;tiers:SaleCommissionTier[];version:string|null;updatedAt:string|null;updatedBy:string|null;source:"show"|"default"};
export const DEFAULT_SALE_COMMISSION_TIERS:ReadonlyArray<SaleCommissionTier>=[{maxTickets:10,rate:15},{maxTickets:30,rate:18},{maxTickets:50,rate:22},{maxTickets:550,rate:25}];
export function defaultSaleCommissionPolicy(showId:string):SaleCommissionPolicy{return {showId,tiers:DEFAULT_SALE_COMMISSION_TIERS.map(t=>({...t})),version:null,updatedAt:null,updatedBy:null,source:"default"};}
export function validateSaleCommissionTiers(value:unknown):string|null{
 if(!Array.isArray(value)||value.length<1||value.length>12)return "Mỗi show cần từ 1 đến 12 bậc hoa hồng.";
 let previous=0;
 for(const raw of value){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return "Bậc hoa hồng không hợp lệ.";
  const t=raw as Record<string,unknown>;
  if(typeof t.maxTickets!=="number"||!Number.isSafeInteger(t.maxTickets)||t.maxTickets<=previous||t.maxTickets>10000)return "Mốc vé phải là số nguyên tăng dần, từ 1 đến 10.000.";
  if(typeof t.rate!=="number"||!Number.isFinite(t.rate)||t.rate<0||t.rate>100||Math.abs(t.rate*100-Math.round(t.rate*100))>0.000001)return "Hoa hồng phải từ 0 đến 100%, tối đa 2 chữ số thập phân.";
  previous=t.maxTickets;
 }
 return null;
}
export type SaleCommissionLine={seat:string;netAmount:number};
export type SaleCommissionBand={fromTicket:number;toTicket:number;rate:number;tickets:number;revenue:number;commission:number};
export type SaleCommissionInputOrder={saleId:string;showId:string;orderCode:string;paidAt:string;amount:number;seats:string[];isComplimentary:boolean;commissionLines?:SaleCommissionLine[]|null};
export type SaleCommissionAllocation={orderCode:string;saleId:string;showId:string;paidTickets:number;complimentaryTickets:number;commission:number;bands:SaleCommissionBand[];firstTicket:number|null;lastTicket:number|null;issue:string|null};
export function validateSaleCommissionLines(value:unknown,seats:string[],amount:number):string|null{
 if(!Number.isSafeInteger(amount)||amount<0||!Array.isArray(seats)||!seats.length||new Set(seats).size!==seats.length)return "Dữ liệu vé hoặc số tiền của đơn chưa hợp lệ.";
 if(!Array.isArray(value)||value.length!==seats.length)return "Đơn chưa có chi tiết giá vé mua và vé tặng để tính hoa hồng.";
 const expected=new Set(seats),seen=new Set<string>();let sum=BigInt(0);
 for(const raw of value){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return "Chi tiết giá vé của đơn chưa hợp lệ.";
  const line=raw as Record<string,unknown>;
  if(typeof line.seat!=="string"||!expected.has(line.seat)||seen.has(line.seat)||typeof line.netAmount!=="number"||!Number.isSafeInteger(line.netAmount)||line.netAmount<0)return "Chi tiết giá vé không khớp danh sách ghế.";
  seen.add(line.seat);sum+=BigInt(line.netAmount);
 }
 return sum===BigInt(amount)?null:"Tổng giá vé không khớp số tiền đã thanh toán.";
}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const DENOMINATOR=BigInt(10000);
/** Round once per order, then apportion whole-dong commission across its bands.
 * For example two 379,050đ tickets at 15% total 113,715đ, not 113,716đ.
 */
function roundedBands(bands:SaleCommissionBand[],numerators:bigint[]):number{
 const total=numerators.reduce((sum,value)=>sum+value,BigInt(0));
 const rounded=Number((total+DENOMINATOR/BigInt(2))/DENOMINATOR);let allocated=0;
 for(let i=0;i<bands.length;i++){bands[i].commission=Number(numerators[i]/DENOMINATOR);allocated+=bands[i].commission;}
 const priority=numerators.map((value,index)=>({index,remainder:value%DENOMINATOR})).sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 for(let i=0;i<rounded-allocated;i++)bands[priority[i].index].commission++;
 return rounded;
}
export function calculateSaleCommissions(orders:SaleCommissionInputOrder[],policies:Record<string,SaleCommissionPolicy>):SaleCommissionAllocation[]{
 const groups=new Map<string,SaleCommissionInputOrder[]>(),seen=new Set<string>();
 for(const order of orders){
  const identity=order.orderCode.trim().toUpperCase();if(!identity||seen.has(identity))throw Error("Mã đơn trùng hoặc không hợp lệ trong dữ liệu hoa hồng.");seen.add(identity);
  const key=JSON.stringify([order.saleId,order.showId]),group=groups.get(key)||[];group.push(order);groups.set(key,group);
 }
 const allocations:SaleCommissionAllocation[]=[];
 for(const group of groups.values()){
  const unknownChronology=group.some(order=>!order.isComplimentary&&order.amount>0&&!Number.isFinite(Date.parse(order.paidAt)));
  group.sort((a,b)=>((Number.isFinite(Date.parse(a.paidAt))?Date.parse(a.paidAt):0)-(Number.isFinite(Date.parse(b.paidAt))?Date.parse(b.paidAt):0))||compare(a.orderCode.toUpperCase(),b.orderCode.toUpperCase()));
  let ordinal=0,blocked=unknownChronology;
  for(const order of group){
   const result:SaleCommissionAllocation={orderCode:order.orderCode,saleId:order.saleId,showId:order.showId,paidTickets:0,complimentaryTickets:0,commission:0,bands:[],firstTicket:null,lastTicket:null,issue:null};allocations.push(result);
   if(order.isComplimentary||order.amount===0){result.complimentaryTickets=order.seats.length;continue;}
   const invalid=validateSaleCommissionLines(order.commissionLines,order.seats,order.amount);
   if(invalid||!Number.isFinite(Date.parse(order.paidAt))){result.issue=invalid||"Đơn thiếu thời điểm thanh toán hợp lệ.";blocked=true;continue;}
   const lines=[...order.commissionLines!].sort((a,b)=>compare(a.seat,b.seat)),paid=lines.filter(line=>line.netAmount>0);
   result.paidTickets=paid.length;result.complimentaryTickets=lines.length-paid.length;
   if(blocked){result.issue=unknownChronology?"Có đơn thiếu thời điểm thanh toán; cần đối soát thứ tự vé của show.":"Có đơn trước đó chưa đủ chi tiết; cần đối soát để xác định đúng thứ tự vé của show.";continue;}
   result.firstTicket=paid.length?ordinal+1:null;result.lastTicket=paid.length?ordinal+paid.length:null;
   const policy=policies[order.showId];
   if(!policy||policy.showId!==order.showId||validateSaleCommissionTiers(policy.tiers)){result.issue="Show chưa có cấu hình hoa hồng hợp lệ.";ordinal+=paid.length;continue;}
   const bandMap=new Map<number,{band:SaleCommissionBand;numerator:bigint}>();
   for(const line of paid){
    ordinal++;const index=policy.tiers.findIndex(tier=>ordinal<=tier.maxTickets);
    if(index<0){result.issue="Số vé đã vượt mốc cuối trong cấu hình hoa hồng của show; các vé vượt mốc chưa được tính.";continue;}
    const tier=policy.tiers[index];let entry=bandMap.get(index);
    if(!entry){entry={band:{fromTicket:index?policy.tiers[index-1].maxTickets+1:1,toTicket:tier.maxTickets,rate:tier.rate,tickets:0,revenue:0,commission:0},numerator:BigInt(0)};bandMap.set(index,entry);}
    entry.band.tickets++;entry.band.revenue+=line.netAmount;entry.numerator+=BigInt(line.netAmount)*BigInt(Math.round(tier.rate*100));
   }
   const entries=[...bandMap.values()];result.bands=entries.map(entry=>entry.band);result.commission=roundedBands(result.bands,entries.map(entry=>entry.numerator));
  }
 }
 return allocations;
}
/** Proportional checkout discount allocation; preserves the exact paid amount. */
export function allocateSaleCommissionLines(paidSeats:Array<{seat:string;price:number}>,giftSeats:string[],amount:number):SaleCommissionLine[]{
 if(!paidSeats.length||!Number.isSafeInteger(amount)||amount<paidSeats.length||paidSeats.some(line=>!Number.isSafeInteger(line.price)||line.price<=0))throw Error("Giá vé không hợp lệ.");
 const all=[...paidSeats.map(line=>line.seat),...giftSeats];if(new Set(all).size!==all.length)throw Error("Danh sách ghế bị trùng.");
 const total=paidSeats.reduce((sum,line)=>sum+BigInt(line.price),BigInt(0));
 const weighted=paidSeats.map(line=>{const exact=BigInt(amount)*BigInt(line.price);return {seat:line.seat,netAmount:Number(exact/total),remainder:exact%total};});
 const remainder=amount-weighted.reduce((sum,line)=>sum+line.netAmount,0);
 const priority=[...weighted].sort((a,b)=>a.remainder===b.remainder?compare(a.seat,b.seat):a.remainder>b.remainder?-1:1);
 for(let i=0;i<remainder;i++)priority[i].netAmount++;
 const lines=[...weighted.map(({seat,netAmount})=>({seat,netAmount})),...giftSeats.map(seat=>({seat,netAmount:0}))];
 const error=validateSaleCommissionLines(lines,all,amount);if(error)throw Error(error);return lines;
}

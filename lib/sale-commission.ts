/** Same performance reward tiers displayed on sale.iextra.net. */
export function saleCommissionRate(paidOrders:number):number{
 return paidOrders>100?.09:paidOrders>50?.08:paidOrders>25?.06:paidOrders>15?.05:.03;
}
export function saleCommissionAmount(paidOrders:number,verifiedRevenue:number):number{
 return Math.round(Math.max(0,verifiedRevenue)*saleCommissionRate(paidOrders));
}

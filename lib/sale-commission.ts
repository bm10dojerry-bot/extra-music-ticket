/** Configurable Sale performance reward: number of PAID TICKETS, not orders.
 * The current tier applies to all verified revenue in the selected reporting period.
 * Free VIP/complimentary tickets must not increase the ticket count used for a tier.
 */
export type SaleCommissionSettings = {
 rate_1_10:number;
 rate_11_30:number;
 rate_31_50:number;
 rate_51_plus:number;
};
export const DEFAULT_SALE_COMMISSION_SETTINGS:SaleCommissionSettings = {
 rate_1_10:15,rate_11_30:18,rate_31_50:22,rate_51_plus:25
};
export const SALE_COMMISSION_BANDS = [
 {key:"rate_1_10",label:"1–10 vé",minTickets:1,maxTickets:10},
 {key:"rate_11_30",label:"11–30 vé",minTickets:11,maxTickets:30},
 {key:"rate_31_50",label:"31–50 vé",minTickets:31,maxTickets:50},
 {key:"rate_51_plus",label:"51–550 vé",minTickets:51,maxTickets:550}
] as const;
export function saleCommissionRate(paidTickets:number,settings:SaleCommissionSettings=DEFAULT_SALE_COMMISSION_SETTINGS):number{
 if(!Number.isFinite(paidTickets)||paidTickets<1)return 0;
 if(paidTickets<=10)return settings.rate_1_10/100;
 if(paidTickets<=30)return settings.rate_11_30/100;
 if(paidTickets<=50)return settings.rate_31_50/100;
 // For aggregated multi-show reports with >550 tickets, use highest configured tier.
 return settings.rate_51_plus/100;
}
export function saleCommissionAmount(paidTickets:number,verifiedRevenue:number,settings:SaleCommissionSettings=DEFAULT_SALE_COMMISSION_SETTINGS):number{
 return Math.round(Math.max(0,verifiedRevenue)*saleCommissionRate(paidTickets,settings));
}

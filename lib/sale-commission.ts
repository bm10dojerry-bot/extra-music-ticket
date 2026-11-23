/** Thưởng Sale tính theo tổng số VÉ ĐÃ BÁN CÓ THANH TOÁN, không theo số đơn.
 * Mỗi mức áp dụng cho TOÀN BỘ doanh thu đã xác minh trong kỳ báo cáo.
 * Vé tặng/VIP 0đ không được dùng để nâng bậc thưởng.
 */
export const SALE_COMMISSION_TIERS = [
 {minTickets:1,maxTickets:10,rate:0.15},
 {minTickets:11,maxTickets:30,rate:0.18},
 {minTickets:31,maxTickets:50,rate:0.22},
 {minTickets:51,maxTickets:550,rate:0.25},
] as const;

export function saleCommissionRate(paidTickets:number):number{
 if(!Number.isFinite(paidTickets)||paidTickets<1)return 0;
 if(paidTickets<=10)return 0.15;
 if(paidTickets<=30)return 0.18;
 if(paidTickets<=50)return 0.22;
 // Giữ bậc cao nhất nếu tổng nhiều show vượt 550 vé.
 return 0.25;
}
export function saleCommissionAmount(paidTickets:number,verifiedRevenue:number):number{
 return Math.round(Math.max(0,verifiedRevenue)*saleCommissionRate(paidTickets));
}

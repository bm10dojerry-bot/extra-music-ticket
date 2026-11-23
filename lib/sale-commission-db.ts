import "server-only";
import {staffDb} from "./staff-auth";
import {defaultSaleCommissionPolicy,validateSaleCommissionTiers,type SaleCommissionPolicy,type SaleCommissionTier} from "./sale-commission";
type PolicyRow={show_id:string;tiers:SaleCommissionTier[];version:string;updated_at:string;updated_by:string};
function normalize(row:PolicyRow):SaleCommissionPolicy{
 if(!row||typeof row.show_id!=="string"||!row.version||validateSaleCommissionTiers(row.tiers))throw Error("Cấu hình hoa hồng của show không hợp lệ.");
 return {showId:row.show_id,tiers:row.tiers.map(tier=>({maxTickets:tier.maxTickets,rate:tier.rate})),version:row.version,updatedAt:row.updated_at,updatedBy:row.updated_by,source:"show"};
}
export async function getSaleCommissionPolicies(showIds?:string[]):Promise<Record<string,SaleCommissionPolicy>>{
 const rows:PolicyRow[]=[];
 while(true){
  const page=await staffDb("sale_commission_policies?select=show_id,tiers,version,updated_at,updated_by&order=show_id.asc&limit=500&offset="+rows.length);
  if(!Array.isArray(page))throw Error("Không tải được cấu hình hoa hồng.");
  if(!page.length)break;
  if(rows.length+page.length>10000)throw Error("Số cấu hình hoa hồng vượt giới hạn xử lý.");
  rows.push(...page as PolicyRow[]);
 }
 const stored=new Map(rows.map(row=>[row.show_id,normalize(row)]));
 const ids=showIds?[...new Set(showIds)]:[...stored.keys()];
 return Object.fromEntries(ids.filter(Boolean).map(id=>[id,stored.get(id)||defaultSaleCommissionPolicy(id)]));
}
export async function getSaleCommissionPolicy(showId:string):Promise<SaleCommissionPolicy>{return (await getSaleCommissionPolicies([showId]))[showId];}
export async function saveSaleCommissionPolicy(showId:string,tiers:SaleCommissionTier[],version:string|null,updatedBy:string):Promise<SaleCommissionPolicy|null>{
 const error=validateSaleCommissionTiers(tiers);if(error)throw Error(error);
 const rows=await staffDb("rpc/extra_save_sale_commission_policy",{method:"POST",body:JSON.stringify({p_show_id:showId,p_tiers:tiers,p_expected_version:version,p_updated_by:updatedBy})}) as PolicyRow[];
 return rows?.length===1?normalize(rows[0]):null;
}

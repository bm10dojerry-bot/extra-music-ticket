import "server-only";
import {staffDb} from "./staff-auth";
import type {SaleCommissionSettings} from "./sale-commission";
export type SaleCommissionRecord = SaleCommissionSettings&{id:"default";updated_at:string;updated_by:string};
export async function getSaleCommissionSettings():Promise<SaleCommissionRecord>{
 const rows=await staffDb("sale_commission_settings?id=eq.default&select=id,rate_1_10,rate_11_30,rate_31_50,rate_51_plus,updated_at,updated_by&limit=1") as Array<Record<string,unknown>>;
 const row=rows?.[0];
 if(!row)throw Error("Chưa có cấu hình thưởng Sale trong cơ sở dữ liệu.");
 const result={
  id:"default" as const,rate_1_10:Number(row.rate_1_10),rate_11_30:Number(row.rate_11_30),
  rate_31_50:Number(row.rate_31_50),rate_51_plus:Number(row.rate_51_plus),
  updated_at:String(row.updated_at||""),updated_by:String(row.updated_by||"")
 };
 if(![result.rate_1_10,result.rate_11_30,result.rate_31_50,result.rate_51_plus].every(v=>Number.isFinite(v)&&v>=0&&v<=100))throw Error("Cấu hình phần trăm thưởng trong cơ sở dữ liệu không hợp lệ.");
 return result;
}

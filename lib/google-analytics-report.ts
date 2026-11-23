import type {GoogleAnalyticsReport} from "./google-analytics-types";
export type AnalyticsRealtimePayload={
 dimensionHeaders?:Array<{name?:string}>;metricHeaders?:Array<{name?:string}>;
 rows?:Array<{dimensionValues?:Array<{value?:string}>;metricValues?:Array<{value?:string}>}>;
 rowCount?:number;
};
const label=(value:string|undefined)=>String(value||"(not set)").replace(/[\u0000-\u001f\u007f]/g,"").slice(0,200);
const countryCode=(value:string|undefined)=>/^[A-Z]{2}$/.test(value||"")?value!:"";

function values(payload:AnalyticsRealtimePayload,dimensions:string[]){
 if(!Array.isArray(payload.metricHeaders)||(payload.dimensionHeaders!==undefined&&!Array.isArray(payload.dimensionHeaders))||
  (dimensions.length>0&&!Array.isArray(payload.dimensionHeaders)))throw Error("Invalid Analytics headers");
 const rows=payload.rows||[];
 if(!Array.isArray(rows)||rows.length>1000)throw Error("Invalid Analytics rows");
 const indexes=dimensions.map(name=>payload.dimensionHeaders?.findIndex(header=>header.name===name)??-1);
 const metric=payload.metricHeaders?.findIndex(header=>header.name==="activeUsers")??-1;
 if(metric<0||indexes.some(index=>index<0))throw Error("Invalid Analytics headers");
 const result=rows.map(row=>{
  const raw=row.metricValues?.[metric]?.value;
  if(!raw||!/^\d+$/.test(raw))throw Error("Invalid Analytics metric");
  const activeUsers=Number(raw);
  if(!Number.isSafeInteger(activeUsers)||activeUsers<0)throw Error("Invalid Analytics metric");
  return {dimensions:indexes.map(index=>row.dimensionValues?.[index]?.value),activeUsers};
 });
 const count=payload.rowCount??rows.length;
 if(!Number.isSafeInteger(count)||count<rows.length)throw Error("Invalid Analytics row count");
 return {rows:result,limited:count>rows.length};
}
/** The three reports each measure unique active users at their own grain.
 * Never sum city rows to derive country counts or sum countries for the total.
 */
export function parseAnalyticsRealtime(total:AnalyticsRealtimePayload,countries:AnalyticsRealtimePayload,cities:AnalyticsRealtimePayload,updatedAt:string):GoogleAnalyticsReport{
 const totals=values(total,[]),countryRows=values(countries,["countryId","country"]),cityRows=values(cities,["countryId","country","city"]);
 if(totals.rows.length>1)throw Error("Unexpected Analytics total");
 return {
  updatedAt,windowMinutes:30,totalActiveUsers:totals.rows[0]?.activeUsers??0,
  countries:countryRows.rows.map(row=>({countryId:countryCode(row.dimensions[0]),country:label(row.dimensions[1]),activeUsers:row.activeUsers})),
  cities:cityRows.rows.map(row=>({countryId:countryCode(row.dimensions[0]),country:label(row.dimensions[1]),city:label(row.dimensions[2]),activeUsers:row.activeUsers})),
  limited:totals.limited||countryRows.limited||cityRows.limited,
 };
}

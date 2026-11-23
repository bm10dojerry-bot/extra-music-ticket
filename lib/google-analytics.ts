import "server-only";
import {staffDb} from "./staff-auth";
import {GOOGLE_ANALYTICS_SCOPE,compatibleAnalyticsSite,openAnalyticsSecret,validAnalyticsId,validMeasurementId} from "./google-analytics-security";
import {parseAnalyticsRealtime,type AnalyticsRealtimePayload} from "./google-analytics-report";
import type {GoogleAnalyticsPropertyOption,GoogleAnalyticsReport,GoogleAnalyticsSelectedProperty,GoogleAnalyticsStreamOption} from "./google-analytics-types";

type AnalyticsErrorCode="not_configured"|"not_connected"|"reconnect"|"permission"|"admin_api_disabled"|"data_api_disabled"|"quota"|"resources_limit"|"invalid_selection"|"connection_changed"|"unavailable";
const messages:Record<AnalyticsErrorCode,string>={
 not_configured:"Máy chủ chưa sẵn sàng kết nối Google Analytics. Vui lòng kiểm tra cấu hình Google OAuth.",
 not_connected:"Kết nối Google Analytics trước khi chọn website.",
 reconnect:"Quyền truy cập Google Analytics đã hết hạn hoặc bị thu hồi. Quản trị viên cần kết nối lại.",
 permission:"Tài khoản Google chưa có quyền đọc tài sản Analytics này. Cần quyền Viewer hoặc cao hơn.",
 admin_api_disabled:"Cần bật Google Analytics Admin API trong dự án Google Cloud của ứng dụng rồi thử lại.",
 data_api_disabled:"Cần bật Google Analytics Data API trong dự án Google Cloud của ứng dụng rồi thử lại.",
 quota:"Google Analytics đang giới hạn lượt đọc. Vui lòng chờ một phút rồi thử lại.",
 resources_limit:"Danh sách Analytics vượt giới hạn xử lý. Chưa thể tải một danh sách đầy đủ.",
 invalid_selection:"Chọn luồng dữ liệu Web của iextra.net hoặc www.iextra.net với mã đo lường GA4 hợp lệ.",
 connection_changed:"Kết nối vừa thay đổi. Vui lòng tải lại trước khi chọn website.",
 unavailable:"Chưa đọc được Google Analytics. Vui lòng thử lại sau.",
};
export class GoogleAnalyticsError extends Error{
 constructor(public code:AnalyticsErrorCode,public status=503){super(messages[code]);this.name="GoogleAnalyticsError";}
}
export const analyticsSafeError=(error:unknown)=>error instanceof GoogleAnalyticsError?error.message:messages.unavailable;
export const analyticsErrorStatus=(error:unknown)=>error instanceof GoogleAnalyticsError?error.status:503;
export const analyticsConnectAvailable=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&(process.env.ADMIN_MEDIA_SECRET||"").length>=24);
export type GoogleAnalyticsConnection={
 version:string;refresh_token_cipher:string|null;property_id:string|null;property_name:string;
 stream_id:string|null;stream_name:string;site_url:string;measurement_id:string;
};
const connectionSelect="version,refresh_token_cipher,property_id,property_name,stream_id,stream_name,site_url,measurement_id";
export async function getAnalyticsConnection():Promise<GoogleAnalyticsConnection>{
 const rows=await staffDb("extra_google_analytics_connection?id=eq.default&select="+connectionSelect+"&limit=1") as GoogleAnalyticsConnection[];
 if(!Array.isArray(rows)||!rows[0]?.version)throw new GoogleAnalyticsError("unavailable");
 return rows[0];
}
export function selectedAnalyticsProperty(connection:GoogleAnalyticsConnection):GoogleAnalyticsSelectedProperty|null{
 if(!connection.refresh_token_cipher||!connection.property_id||!connection.stream_id)return null;
 if(!validAnalyticsId(connection.property_id)||!validAnalyticsId(connection.stream_id)||!validMeasurementId(connection.measurement_id)||!compatibleAnalyticsSite(connection.site_url))
  throw new GoogleAnalyticsError("invalid_selection",400);
 return {id:connection.property_id,name:connection.property_name,streamId:connection.stream_id,streamName:connection.stream_name,siteUrl:connection.site_url,measurementId:connection.measurement_id};
}
type JsonRecord=Record<string,unknown>;
function object(value:unknown):JsonRecord{return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};}
const text=(value:unknown)=>typeof value==="string"?value:"";
const label=(value:unknown)=>text(value).replace(/[\u0000-\u001f\u007f]/g,"").slice(0,200);
async function json(response:Response):Promise<JsonRecord>{return object(await response.json().catch(()=>null));}
const tokenCache=new Map<string,{token:string;expires:number}>();
const tokenRequests=new Map<string,Promise<string>>();
const reportCache=new Map<string,{report:GoogleAnalyticsReport;expires:number}>();
const reportRequests=new Map<string,Promise<GoogleAnalyticsReport>>();
export function clearAnalyticsCache(){tokenCache.clear();reportCache.clear();}

async function accessToken(connection:GoogleAnalyticsConnection):Promise<string>{
 if(!connection.refresh_token_cipher)throw new GoogleAnalyticsError("not_connected",409);
 if(!analyticsConnectAvailable())throw new GoogleAnalyticsError("not_configured");
 const cached=tokenCache.get(connection.version);if(cached&&cached.expires>Date.now())return cached.token;
 const pending=tokenRequests.get(connection.version);if(pending)return pending;
 const operation=(async()=>{
  let refresh:string;
  try{refresh=openAnalyticsSecret(connection.refresh_token_cipher!,process.env.ADMIN_MEDIA_SECRET!,"refresh-token");}
  catch{throw new GoogleAnalyticsError("reconnect",401);}
  let response:Response;
  try{response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
   body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!}),cache:"no-store",signal:AbortSignal.timeout(12000)});}
  catch{throw new GoogleAnalyticsError("unavailable");}
  const data=await json(response);
  if(!response.ok){if(data.error==="invalid_grant")throw new GoogleAnalyticsError("reconnect",401);if(data.error==="invalid_client")throw new GoogleAnalyticsError("not_configured");throw new GoogleAnalyticsError("unavailable");}
  if(typeof data.scope==="string"&&!data.scope.split(" ").includes(GOOGLE_ANALYTICS_SCOPE))throw new GoogleAnalyticsError("reconnect",401);
  const token=text(data.access_token),ttl=Number(data.expires_in);
  if(!token||token.length>8192||data.token_type!=="Bearer"||!Number.isFinite(ttl)||ttl<=0)throw new GoogleAnalyticsError("reconnect",401);
  if(tokenCache.size>=10)tokenCache.clear();
  tokenCache.set(connection.version,{token,expires:Date.now()+Math.max(0,Math.min(ttl,3600)-60)*1000});return token;
 })();
 tokenRequests.set(connection.version,operation);
 try{return await operation;}finally{tokenRequests.delete(connection.version);}
}
async function googleRequest(url:string,token:string,api:"admin"|"data",body?:JsonRecord):Promise<JsonRecord>{
 const expected=api==="admin"?"https://analyticsadmin.googleapis.com/v1beta/":"https://analyticsdata.googleapis.com/v1beta/";
 if(!url.startsWith(expected))throw new GoogleAnalyticsError("unavailable");
 let response:Response;
 try{response=await fetch(url,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},
  body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(15000)});}
 catch{throw new GoogleAnalyticsError("unavailable");}
 const data=await json(response);
 if(!response.ok){
  const error=object(data.error),details=Array.isArray(error.details)?error.details:[];
  const disabled=details.some(detail=>["SERVICE_DISABLED","API_DISABLED","accessNotConfigured"].includes(text(object(detail).reason)));
  if(disabled)throw new GoogleAnalyticsError(api==="admin"?"admin_api_disabled":"data_api_disabled");
  if(response.status===401)throw new GoogleAnalyticsError("reconnect",401);
  if(response.status===403||response.status===404)throw new GoogleAnalyticsError("permission",403);
  if(response.status===429)throw new GoogleAnalyticsError("quota",429);
  throw new GoogleAnalyticsError("unavailable");
 }
 return data;
}
export async function listAnalyticsProperties(connection:GoogleAnalyticsConnection):Promise<GoogleAnalyticsPropertyOption[]>{
 const token=await accessToken(connection),result=new Map<string,GoogleAnalyticsPropertyOption>(),seen=new Set<string>();let next="";
 for(let page=0;page<50;page++){
  const params=new URLSearchParams({pageSize:"200"});if(next)params.set("pageToken",next);
  const data=await googleRequest("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?"+params,token,"admin");
  if(data.accountSummaries!==undefined&&!Array.isArray(data.accountSummaries))throw new GoogleAnalyticsError("unavailable");
  for(const item of (data.accountSummaries||[]) as unknown[]){
   const account=object(item),properties=account.propertySummaries;
   if(properties!==undefined&&!Array.isArray(properties))throw new GoogleAnalyticsError("unavailable");
   for(const property of (properties||[]) as unknown[]){
    const row=object(property),match=/^properties\/([1-9][0-9]{0,19})$/.exec(text(row.property));if(!match)continue;
    result.set(match[1],{id:match[1],name:label(row.displayName)||match[1],accountName:label(account.displayName)});
    if(result.size>10000)throw new GoogleAnalyticsError("resources_limit");
   }
  }
  next=text(data.nextPageToken);if(!next)return [...result.values()];
  if(seen.has(next))throw new GoogleAnalyticsError("resources_limit");seen.add(next);
 }
 throw new GoogleAnalyticsError("resources_limit");
}
function streamOption(raw:unknown,propertyId:string):GoogleAnalyticsStreamOption|null{
 const row=object(raw),match=new RegExp("^properties/"+propertyId+"/dataStreams/([1-9][0-9]{0,19})$").exec(text(row.name));if(!match)return null;
 const web=object(row.webStreamData),siteUrl=text(web.defaultUri),measurementId=text(web.measurementId);
 return {id:match[1],name:label(row.displayName)||match[1],siteUrl:siteUrl.slice(0,2000),measurementId,
  compatible:row.type==="WEB_DATA_STREAM"&&compatibleAnalyticsSite(siteUrl)&&validMeasurementId(measurementId)};
}
export async function listAnalyticsStreams(connection:GoogleAnalyticsConnection,propertyId:string):Promise<GoogleAnalyticsStreamOption[]>{
 if(!validAnalyticsId(propertyId))throw new GoogleAnalyticsError("invalid_selection",400);
 const token=await accessToken(connection),result:GoogleAnalyticsStreamOption[]=[],seen=new Set<string>();let next="";
 for(let page=0;page<10;page++){
  const params=new URLSearchParams({pageSize:"200"});if(next)params.set("pageToken",next);
  const data=await googleRequest("https://analyticsadmin.googleapis.com/v1beta/properties/"+propertyId+"/dataStreams?"+params,token,"admin");
  if(data.dataStreams!==undefined&&!Array.isArray(data.dataStreams))throw new GoogleAnalyticsError("unavailable");
  for(const raw of (data.dataStreams||[]) as unknown[]){const option=streamOption(raw,propertyId);if(option)result.push(option);}
  if(result.length>2000)throw new GoogleAnalyticsError("resources_limit");
  next=text(data.nextPageToken);if(!next)return result;
  if(seen.has(next))throw new GoogleAnalyticsError("resources_limit");seen.add(next);
 }
 throw new GoogleAnalyticsError("resources_limit");
}
export async function selectAnalyticsStream(connection:GoogleAnalyticsConnection,propertyId:string,streamId:string):Promise<void>{
 if(!validAnalyticsId(propertyId)||!validAnalyticsId(streamId))throw new GoogleAnalyticsError("invalid_selection",400);
 const token=await accessToken(connection);
 const [property,rawStream]=await Promise.all([
  googleRequest("https://analyticsadmin.googleapis.com/v1beta/properties/"+propertyId,token,"admin"),
  googleRequest("https://analyticsadmin.googleapis.com/v1beta/properties/"+propertyId+"/dataStreams/"+streamId,token,"admin")
 ]);
 const stream=streamOption(rawStream,propertyId);
 if(property.name!=="properties/"+propertyId||property.deleteTime||!stream?.compatible||stream.id!==streamId)throw new GoogleAnalyticsError("invalid_selection",400);
 const saved=await staffDb("rpc/extra_select_google_analytics_stream",{method:"POST",body:JSON.stringify({
  p_expected_version:connection.version,p_property_id:propertyId,p_property_name:label(property.displayName)||propertyId,
  p_stream_id:streamId,p_stream_name:stream.name,p_site_url:new URL(stream.siteUrl).href,p_measurement_id:stream.measurementId,
 })});
 if(saved!==true)throw new GoogleAnalyticsError("connection_changed",409);clearAnalyticsCache();
}
export async function analyticsRealtime(connection:GoogleAnalyticsConnection,property:GoogleAnalyticsSelectedProperty):Promise<GoogleAnalyticsReport>{
 const key=[connection.version,property.id,property.streamId].join(":"),cached=reportCache.get(key);
 if(cached&&cached.expires>Date.now())return cached.report;
 const pending=reportRequests.get(key);if(pending)return pending;
 const operation=(async()=>{
  const token=await accessToken(connection);
  const base={metrics:[{name:"activeUsers"}],minuteRanges:[{startMinutesAgo:29,endMinutesAgo:0}],limit:"1000",
   dimensionFilter:{filter:{fieldName:"streamId",stringFilter:{matchType:"EXACT",value:property.streamId,caseSensitive:true}}},
   orderBys:[{metric:{metricName:"activeUsers"},desc:true}]};
  const responses=await Promise.all([[],["countryId","country"],["countryId","country","city"]].map(dimensions=>
   googleRequest("https://analyticsdata.googleapis.com/v1beta/properties/"+property.id+":runRealtimeReport",token,"data",{...base,dimensions:dimensions.map(name=>({name}))})));
  let report:GoogleAnalyticsReport;
  try{report=parseAnalyticsRealtime(responses[0] as AnalyticsRealtimePayload,responses[1] as AnalyticsRealtimePayload,responses[2] as AnalyticsRealtimePayload,new Date().toISOString());}
  catch{throw new GoogleAnalyticsError("unavailable");}
  if(reportCache.size>=10)reportCache.clear();reportCache.set(key,{report,expires:Date.now()+60000});return report;
 })();
 reportRequests.set(key,operation);try{return await operation;}finally{reportRequests.delete(key);}
}

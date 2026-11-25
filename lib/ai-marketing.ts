import "server-only";
import {staffDb} from "./staff-auth";
import {venues} from "./venues";
import {MARKETING_ACCOUNTS,MARKETING_INITIAL_BUDGET,MARKETING_MAX_DAILY_CAP,MARKETING_PAGE_ID,MARKETING_SCALE_BUDGET,MARKETING_SLOTS,MARKETING_TIMEZONE,marketingBusinessDate,marketingMetricsFreshness,marketingObjective,safeMarketingUrl} from "./ai-marketing-policy";
import type {AiMarketingAdminResponse,MarketingAllocationStatus,MarketingPostStatus} from "./ai-marketing-admin-types";

type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(row):[];
const text=(value:unknown,fallback=""):string=>typeof value==="string"?value:fallback;
const nullableText=(value:unknown):string|null=>typeof value==="string"&&value?value:null;
const metric=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;
const amount=(value:unknown,fallback=0):number=>metric(value)??fallback;
const postStatuses:MarketingPostStatus[]=["draft","scheduled","publishing","published","blocked","failed","uncertain","cancelled"];
const adStatuses:MarketingAllocationStatus[]=["reserved","pending","active","paused","completed","uncertain","blocked","failed","released"];
const dayValid=(value:unknown,fallback:string)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback;
const recentCheck=(value:unknown,now:number)=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+60000&&now-Date.parse(value)<=86400000;
const allKnown=(values:(number|null)[])=>values.length&&values.every(value=>value!==null)?values.reduce<number>((total,value)=>total+(value??0),0):null;
const mediaUrl=(path:unknown)=>typeof path==="string"?safeMarketingUrl("https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/public/extra-media/"+path,"image"):null;

export async function marketingRpc(name:"read_contract"|"configure",params:Row={}):Promise<Row>{
 return row(await staffDb("rpc/extra_marketing_"+name,{method:"POST",body:JSON.stringify(params)}));
}

/** Only Admin display fields leave this boundary; no outbox payloads, tokens or customer identities. */
export function marketingAdminView(contract:unknown,now=Date.now()):AiMarketingAdminResponse {
 const source=row(contract),settings=row(source.settings),businessDate=dayValid(source.business_date,marketingBusinessDate(new Date(now)));
 const rawShows=rows(source.shows),rawPosts=rows(source.posts),rawAllocations=rows(source.allocations),rawActions=rows(source.actions);
 const accountId=nullableText(settings.account_id),account=MARKETING_ACCOUNTS.find(item=>item.id===accountId);
 const publishingReady=settings.publishing_ready===true&&recentCheck(settings.publishing_checked_at,now);
 const advertisingReady=settings.advertising_ready===true&&!!account&&recentCheck(settings.advertising_checked_at,now);
 const enabled=settings.enabled===true,pausePending=source.pause_pending===true;
 const reasons=(Array.isArray(settings.readiness_reasons)?settings.readiness_reasons:[]).filter((value):value is string=>typeof value==="string").map(value=>value.slice(0,1200));
 if(!publishingReady&&!reasons.some(value=>/đăng bài|Fanpage|Page/i.test(value)))reasons.push("Cần kết nối hoặc kiểm tra lại quyền đăng bài cho Page 1 EXTRA trong Facebook Pages / Windsor.ai.");
 if(!accountId&&!reasons.some(value=>/tài khoản/i.test(value)))reasons.push("Chọn extra 02 hoặc extra 03 để chạy luồng quảng cáo này.");
 if(accountId&&!advertisingReady&&!reasons.some(value=>/quảng cáo|Ads|Pixel/i.test(value)))reasons.push("Tài khoản đã được chọn; đang chờ xác minh quyền quảng cáo, đơn vị VND và Pixel mua vé.");
 const automation=row(settings.automation_ids);
 if(automation.schedule_ready!==true)reasons.push("Lịch tự động đang chờ xác nhận sẵn sàng.");
 const plan=settings.objective_plan==="messages_only"?"messages_only":"rotate_messages_sales";
 const slots:[string,string]=Array.isArray(settings.slots)&&settings.slots.length===2&&settings.slots.every(value=>typeof value==="string")?[String(settings.slots[0]),String(settings.slots[1])]:[...MARKETING_SLOTS];
 const showNames=new Map<string,string>();
 const shows=rawShows.map(item=>{
  const id=text(item.id),venue=venues.find(value=>value.id===item.venue_id);
  showNames.set(id,text(item.artist)||text(item.title));
  return {id,artist:text(item.artist),title:text(item.title),startsAt:text(item.starts_at),venueName:venue?.name||text(item.venue_id),posterUrl:mediaUrl(item.artist_image_path)||mediaUrl(item.poster_path),url:"https://iextra.net/show/"+encodeURIComponent(id)};
 });
 const posts=rawPosts.map(item=>{
  const snapshot=row(item.show_snapshot),showId=text(item.show_id),date=dayValid(item.business_date,businessDate),slot=amount(item.slot,1);
  const showName=text(snapshot.artist)||text(snapshot.title)||showNames.get(showId)||showId;
  return {
   id:text(item.id),businessDate:date,slot,scheduledAt:text(item.scheduled_at),showId,showName,caption:text(item.caption),
   imageUrl:safeMarketingUrl(item.image_url,"image"),landingUrl:safeMarketingUrl(item.landing_url,"website")||"https://iextra.net/show/"+encodeURIComponent(showId),
   status:postStatuses.includes(item.status as MarketingPostStatus)?item.status as MarketingPostStatus:"blocked",
   objective:item.objective==="messages"||item.objective==="sales"?item.objective:marketingObjective(date,slot,plan),
   facebookPostId:nullableText(item.facebook_post_id),permalink:safeMarketingUrl(item.permalink,"facebook"),publishedAt:nullableText(item.published_at),reason:nullableText(item.reason),updatedAt:text(item.updated_at),
  };
 });
 const postMap=new Map(posts.map(post=>[post.id,post]));
 const allocations=rawAllocations.map(item=>{
  const metricsAsOf=nullableText(item.metrics_as_of);
  let status:MarketingAllocationStatus=adStatuses.includes(item.status as MarketingAllocationStatus)?item.status as MarketingAllocationStatus:"blocked";
  if(status==="active"&&typeof item.ends_at==="string"&&Date.parse(item.ends_at)<=now)status="completed";
  return {
   id:text(item.id),postId:text(item.post_id),showName:postMap.get(text(item.post_id))?.showName||"Show đã lưu",businessDate:dayValid(item.business_date,businessDate),objective:item.objective==="sales"?"sales" as const:"messages" as const,
   status,budgetVnd:amount(item.budget_vnd),spendVnd:metric(item.spend_vnd),messages:metric(item.messages),platformPurchases:metric(item.platform_purchases),attributedPaidOrders:metric(item.paid_orders),attributedPaidRevenueVnd:metric(item.paid_revenue_vnd),
   metricsAsOf,freshness:marketingMetricsFreshness(metricsAsOf,now),reason:nullableText(item.reason),adId:nullableText(item.ad_id),
  };
 });
 const actionNames:Record<string,string>={configure:"Cập nhật cài đặt",reserve:"Giữ hạn mức quảng cáo",publish_post:"Đăng bài Fanpage",create_campaign:"Tạo chiến dịch",create_adset:"Tạo lượt chạy trong ngày",create_ad:"Tạo mẫu quảng cáo",enable:"Bật quảng cáo",pause:"Tạm dừng quảng cáo",set_budget:"Điều chỉnh ngân sách"};
 const actionDetails:Record<string,string>={sending:"Đã gửi yêu cầu, đang chờ xác nhận của nền tảng.",succeeded:"Đã xác nhận thao tác thành công.",failed:"Thao tác chưa thành công.",uncertain:"Chưa xác định kết quả; giữ hạn mức và không gửi lặp."};
 const audit=rawActions.map(item=>({id:text(item.id),createdAt:text(item.created_at),title:actionNames[text(item.kind)]||"Xử lý tự động",detail:text(item.reason)||actionDetails[text(item.state)]||"Đã ghi nhận thao tác.",status:item.state==="succeeded"?"success" as const:item.state==="failed"?"error" as const:item.state==="uncertain"?"warning" as const:"info" as const}));
 const todaysPosts=posts.filter(post=>post.businessDate===businessDate),todaysAds=allocations.filter(item=>item.businessDate===businessDate);
 const timestamps=todaysAds.map(item=>item.metricsAsOf).filter((value):value is string=>Boolean(value&&Number.isFinite(Date.parse(value))));
 const needsAttention=posts.some(post=>post.status==="uncertain")||allocations.some(item=>item.status==="uncertain");
 return {
  updatedAt:text(source.updated_at,new Date(now).toISOString()),
  settings:{enabled,pageId:MARKETING_PAGE_ID,pageName:"1 EXTRA",accountId:account?.id||null,accountName:account?.name||null,publishingReady,advertisingReady,readinessReasons:[...new Set(reasons)],timezone:MARKETING_TIMEZONE,slots,initialBudgetVnd:MARKETING_INITIAL_BUDGET,scaleBudgetVnd:MARKETING_SCALE_BUDGET,dailyCapVnd:Math.min(MARKETING_MAX_DAILY_CAP,amount(settings.daily_cap_vnd,MARKETING_MAX_DAILY_CAP)),maxAuthorizedDailyCapVnd:MARKETING_MAX_DAILY_CAP,objectivePlan:plan,automationStatus:!enabled?"paused":needsAttention?"needs_attention":publishingReady&&advertisingReady&&automation.schedule_ready===true?"active":"waiting_connection",lastWorkerAt:nullableText(settings.last_worker_at),pausePending},
  accounts:MARKETING_ACCOUNTS.map(item=>({...item})),shows,posts,allocations,audit,
  totals:{businessDate,publishedToday:todaysPosts.filter(post=>post.status==="published").length,scheduledToday:todaysPosts.length,allocatedVnd:todaysAds.reduce((sum,item)=>sum+(item.status==="released"?(item.spendVnd??0):Math.max(item.budgetVnd,item.spendVnd??0)),0),spendVnd:allKnown(todaysAds.map(item=>item.spendVnd)),messages:allKnown(todaysAds.map(item=>item.messages)),attributedPaidOrders:allKnown(todaysAds.map(item=>item.attributedPaidOrders)),attributedPaidRevenueVnd:allKnown(todaysAds.map(item=>item.attributedPaidRevenueVnd)),metricsAsOf:timestamps.length===todaysAds.length&&timestamps.length?timestamps.reduce((earlier,value)=>Date.parse(value)<Date.parse(earlier)?value:earlier):null},
  limited:rawPosts.length>=200||rawAllocations.length>=200||rawActions.length>=50,
 };
}

'use strict';
const endpoint='https://fokntdvgzfldxbaglrdc.supabase.co/functions/v1/extra-os-music-signals-v1';
const {parseSaleAudit,requestSaleReview}=require('./sale-conversation-audit.cjs');
const accounts=new Set(['1915621506464312','1482182900406200']);
const count=n=>Number.isSafeInteger(n)&&n>=0;
const validId=s=>typeof s==='string'&&/^[a-z0-9_-]{1,100}$/i.test(s);
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
function parseSignals(data){
 if(data?.source!=='music_sales_signals_v1'||!Number.isFinite(Date.parse(data.checkedAt))||!day(data.fromDay)||!day(data.toDay)||data.fromDay>data.toDay||!Array.isArray(data.messenger)||!Array.isArray(data.adDays)||data.adDays.length>7)throw Error('source');
 const messenger=data.messenger.map(({showId,quotedChats,linkedPaidChats})=>{
  if(!validId(showId)||!count(quotedChats)||!count(linkedPaidChats)||linkedPaidChats>quotedChats)throw Error('messenger');
  return {showId,quotedChats,linkedPaidChats};
 });
 const adDays=data.adDays.map(({day:date,fetchedAt,rows})=>{
  if(!day(date)||date<data.fromDay||date>data.toDay||!Number.isFinite(Date.parse(fetchedAt))||!Array.isArray(rows)||rows.length>2000)throw Error('ads day');
  const groups=rows.map(({showId,accountId,spendVnd,campaigns})=>{
   if(!validId(showId)||!accounts.has(accountId)||!count(spendVnd)||!count(campaigns))throw Error('ads group');
   return {showId,accountId,spendVnd,campaigns};
  });
  if(new Set(groups.map(g=>g.showId+'/'+g.accountId)).size!==groups.length)throw Error('duplicate');
  return {day:date,fetchedAt,rows:groups};
 });
 if(new Set(messenger.map(q=>q.showId)).size!==messenger.length||new Set(adDays.map(a=>a.day)).size!==adDays.length)throw Error('duplicate');
 return {checkedAt:data.checkedAt,fromDay:data.fromDay,toDay:data.toDay,messenger,adDays,
  saleAudit:parseSaleAudit(data.saleAudit,data.fromDay,data.toDay),
  economics:data.economics?require('./show-economics.cjs').parseEconomicsSource(data.economics):null,
  limits:'Messenger chỉ gồm hội thoại nhận báo giá trong kỳ và đơn trả tiền liên kết cùng show. Meta chỉ gồm chiến dịch nhận diện được show, tính VND; không có phân bổ vé theo quảng cáo.'};
}
async function readMusicSignals(env,request){
 const token=env.EXTRA_OS_MUSIC_REPORT_READ_TOKEN;
 if(!/^[0-9a-f]{64}$/.test(token??''))return null;
 try{
  const response=await request(endpoint,{method:'GET',redirect:'error',headers:{'x-extra-music-report-key':token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;
  const data=parseSignals(await response.json());
  if(data.saleAudit)data.saleAudit.review=await requestSaleReview(data.saleAudit,env,request);
  return data;
 }catch{return null;}
}
let lastRead=null,expires=0;
function getMusicSignals(env=process.env,request=fetch){
 if(env!==process.env||request!==fetch)return readMusicSignals(env,request);
 if(!lastRead||Date.now()>=expires){
  expires=Date.now()+60000;
  lastRead=readMusicSignals(env,request);
 }
 return lastRead;
}
module.exports={getMusicSignals,parseSignals};

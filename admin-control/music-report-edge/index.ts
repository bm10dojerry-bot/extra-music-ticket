// Independent Music reporting endpoint. Deploy with a dedicated token digest substituted at build/deploy time.
// No Music administrative credential is provided to the EXTRA OS caller.
const tokenDigest = '__REPORT_TOKEN_SHA256__';
const costFields = ['artist_fee','venue_fee','sound_lighting','labor','advertising','band','tax','sale_commission','logistics','security','miscellaneous'];
const pageSize=250,maxRows=20000;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(req:Request){
 const token=req.headers.get('x-extra-music-report-key')||'';
 if(!/^[0-9a-f]{64}$/.test(token)||!/^[0-9a-f]{64}$/.test(tokenDigest))return false;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 let difference=0;for(let i=0;i<64;i++)difference|=hash.charCodeAt(i)^tokenDigest.charCodeAt(i);
 return difference===0;
}
type Row=Record<string,any>;
async function rows(table:string,select:string,order:string,filter:Record<string,string>={}):Promise<Row[]> {
 const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key)throw Error('configuration');
 const result:Row[]=[];
 for(let offset=0;offset<=maxRows;offset+=pageSize){
  const url=new URL('/rest/v1/'+table,base);
  for(const [k,v] of Object.entries({...filter,select,order,limit:String(pageSize),offset:String(offset)}))url.searchParams.set(k,v);
  const res=await fetch(url,{method:'GET',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,accept:'application/json'},signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw Error('source');
  const batch=await res.json();if(!Array.isArray(batch)||batch.length>pageSize)throw Error('invalid');
  result.push(...batch);if(result.length>maxRows)throw Error('limit');
  if(batch.length<pageSize)return result;
 }
 throw Error('limit');
}
const amount=(v:unknown)=>{if((typeof v!=='number'&&typeof v!=='string')||String(v).trim()==='')throw Error('amount');const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('amount');return n;};
const safeAdd=(a:number,b:number)=>amount(a+b);
const dayVN=(v:string)=>{const t=Date.parse(v);if(!Number.isFinite(t))throw Error('date');return new Date(t+7*3600000).toISOString().slice(0,10);};
const keyOf=(v:unknown)=>typeof v==='string'?v.trim().toUpperCase():'';
type Totals={paidOrders:number,paidTickets:number,revenueVnd:number,complimentaryTickets:number};
const empty=():Totals=>({paidOrders:0,paidTickets:0,revenueVnd:0,complimentaryTickets:0});
type Summary={showId:string,artist:string,date:string|null,status:string|null,total:Totals,days:Record<string,Totals>,recordedCostVnd:number|null,costUpdatedAt:string|null};
export function aggregate(shows:Row[],online:Row[],legacy:Row[],costs:Row[]){
 const result=new Map<string,Summary>();
 const get=(id:string)=>{let item=result.get(id);if(!item){item={showId:id,artist:id==='unassigned'?'Chưa gắn show':id,date:null,status:null,total:empty(),days:Object.create(null),recordedCostVnd:null,costUpdatedAt:null};result.set(id,item);}return item;};
 for(const show of shows){if(typeof show.id!=='string'||!show.id||show.id==='unassigned'||result.has(show.id)||typeof show.artist!=='string')throw Error('show');Object.assign(get(show.id),{artist:show.artist,date:show.show_date,status:show.status});}
 const add=(row:Row,complimentary:boolean)=>{
  const n=amount(row.amount_vnd);
  if(!row.paid_at){if(complimentary)return;throw Error('paid_at');}
  const day=dayVN(row.paid_at),show=get(typeof row.show_id==='string'&&row.show_id?row.show_id:'unassigned');
  if(!Array.isArray(row.seats)||row.seats.some((s:unknown)=>typeof s!=='string'||!s))throw Error('seats');
  const seats=new Set(row.seats).size;
  const daily=show.days[day]??(show.days[day]=empty());
  for(const target of [show.total,daily]){
   if(complimentary)target.complimentaryTickets=safeAdd(target.complimentaryTickets,seats);
   else {target.paidOrders=safeAdd(target.paidOrders,1);target.paidTickets=safeAdd(target.paidTickets,seats);target.revenueVnd=safeAdd(target.revenueVnd,n);}
  }
 };
 const onlineCodes=new Set<string>();
 for(const row of online){const code=keyOf(row.code);if(!code||onlineCodes.has(code))throw Error('online code');onlineCodes.add(code);if(row.status==='paid')add(row,row.is_vip_invitation===true||amount(row.amount_vnd)===0);}
 const legacyCodes=new Set<string>();
 for(const row of legacy){const code=keyOf(row.order_code);if(!code)throw Error('legacy code');if(onlineCodes.has(code))continue;if(legacyCodes.has(code))throw Error('duplicate legacy code');legacyCodes.add(code);if(row.payment_verified===true)add(row,amount(row.amount_vnd)===0);}
 const seenCosts=new Set<string>();
 for(const row of costs){if(typeof row.show_id!=='string'||!row.show_id||seenCosts.has(row.show_id))throw Error('cost');seenCosts.add(row.show_id);const item=get(row.show_id);item.recordedCostVnd=costFields.some(k=>row[k]===null||row[k]===undefined)?null:costFields.reduce((sum,k)=>safeAdd(sum,amount(row[k])),0);item.costUpdatedAt=typeof row.updated_at==='string'?row.updated_at:null;}
 return [...result.values()].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.showId.localeCompare(b.showId));
}
let cache:{expires:number;data:unknown}|null=null,pending:Promise<unknown>|null=null;
async function build(){
 const [shows,online,legacy,costs]=await Promise.all([
  rows('managed_shows','id,artist,show_date,status','id.asc'),
  rows('extra_payment_orders','code,show_id,seats,amount_vnd,paid_at,is_vip_invitation,status','code.asc'),
  rows('ticket_sales','order_code,show_id,seats,amount_vnd,paid_at,payment_verified','id.asc',{payment_verified:'eq.true'}),
  rows('show_financial_costs','show_id,updated_at,'+costFields.join(','),'show_id.asc'),
 ]);
 return {source:'music_confirmed_payment_readonly_v1',checkedAt:new Date().toISOString(),timezone:'Asia/Ho_Chi_Minh',rows:aggregate(shows,online,legacy,costs)};
}
Deno.serve(async req=>{
 if(req.method!=='GET')return json({error:'method_not_allowed'},405);
 if(!await authorized(req))return json({error:'unauthorized'},401);
 if(new URL(req.url).search)return json({error:'unsupported_query'},400);
 try{
  if(cache&&cache.expires>Date.now())return json(cache.data);
  if(!pending)pending=build().then(data=>{cache={data,expires:Date.now()+60000};return data;}).finally(()=>{pending=null;});
  return json(await pending);
 }catch{return json({error:'report_unavailable'},503);}
});
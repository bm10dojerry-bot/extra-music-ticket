'use strict';
const {calculateFinance}=require('./director-finance.cjs');
const endpoint='https://fokntdvgzfldxbaglrdc.supabase.co/functions/v1/extra-os-music-report-v1';
const todayVN=(now=new Date())=>new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function reportDay(raw,now=new Date()){return validDay(raw)&&raw>='2000-01-01'&&raw<=todayVN(now)?raw:todayVN(now);}
const previousDay=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const fields=['paidOrders','paidTickets','revenueVnd','complimentaryTickets'];
const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function totals(value){if(!fields.every(k=>integer(value?.[k])))throw Error('report totals');return Object.fromEntries(fields.map(k=>[k,value[k]]));}
function parseMusicFinance(body){
 if(body?.source!=='music_confirmed_payment_readonly_v1'||body.timezone!=='Asia/Ho_Chi_Minh'||!Number.isFinite(Date.parse(body.checkedAt))||!Array.isArray(body.rows)||body.rows.length>1000)throw Error('source');
 const seen=new Set();
 return {source:body.source,checkedAt:body.checkedAt,rows:body.rows.map(row=>{
  if(typeof row.showId!=='string'||!row.showId||seen.has(row.showId)||typeof row.artist!=='string'||row.artist.length>300||!row.days||typeof row.days!=='object'||Array.isArray(row.days)||Object.keys(row.days).length>20000||row.recordedCostVnd!==null&&!integer(row.recordedCostVnd))throw Error('row');
  seen.add(row.showId);
  const days=Object.create(null);for(const [key,value] of Object.entries(row.days)){if(!validDay(key))throw Error('day');days[key]=totals(value);}
  const total=totals(row.total);
  for(const k of fields)if(Object.values(days).reduce((sum,item)=>sum+item[k],0)!==total[k])throw Error('total mismatch');
  return {showId:row.showId,artist:row.artist,date:validDay(row.date)?row.date:null,days,total,recordedCostVnd:row.recordedCostVnd,costUpdatedAt:typeof row.costUpdatedAt==='string'&&Number.isFinite(Date.parse(row.costUpdatedAt))?row.costUpdatedAt:null};
 })};
}
function createMusicFinanceReader({request=fetch,env=process.env,clock=Date.now,ttlMs=60000}={}){
 let cache=null,pending=null,expires=0;
 return async function read(){
  const token=env.EXTRA_OS_MUSIC_REPORT_READ_TOKEN??'';
  if(!/^[a-f0-9]{64}$/.test(token))return {status:'not_configured',data:null};
  if(cache&&clock()<expires)return cache;
  if(pending)return pending;
  pending=(async()=>{try{
   const response=await request(endpoint,{method:'GET',redirect:'error',cache:'no-store',headers:{'x-extra-music-report-key':token,accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('report request');
   return {status:'available',data:parseMusicFinance(await response.json())};
  }catch{return {status:'unavailable',data:null};}})().then(result=>{cache=result;expires=clock()+ttlMs;return result;}).finally(()=>{pending=null;});
  return pending;
 };
}
const getMusicFinance=createMusicFinanceReader();
function musicDay(data,day){
 const rows=data.rows.map(row=>({artist:row.artist,showId:row.showId,date:row.date,daily:row.days[day]??zero(),total:row.total,recordedCostVnd:row.recordedCostVnd,costUpdatedAt:row.costUpdatedAt}));
 const daily=zero();for(const row of rows)for(const k of fields){daily[k]+=row.daily[k];if(!integer(daily[k]))throw Error('day total');}
 return {daily,rows};
}
async function readRetailDaily(pool,day){
 const previous=previousDay(day);
 const [runs,jobs,finance,crm]=await Promise.all([
  pool.query("select count(*)::int as created from os_director_runs where platform='24h' and coalesce(input->>'mode','')<>'sample' and (created_at at time zone 'Asia/Ho_Chi_Minh')::date=$1::date",[day]),
  pool.query("select count(*) filter(where e.event='accepted')::int accepted,count(*) filter(where e.event='blocked')::int blocked,count(*) filter(where e.event='failed')::int failed from os_director_events e join os_director_jobs j on j.id=e.job_id join os_director_runs r on r.id=j.run_id where r.platform='24h' and coalesce(r.input->>'mode','')<>'sample' and (e.created_at at time zone 'Asia/Ho_Chi_Minh')::date=$1::date",[day]),
  pool.query("select distinct on(f.run_id,f.as_of) f.run_id,r.input->>'product' as product,f.as_of::text as as_of,f.figures,f.recorded_at from os_director_finance f join os_director_runs r on r.id=f.run_id where r.platform='24h' and coalesce(r.input->>'mode','')<>'sample' and f.as_of in ($1::date,$2::date) order by f.run_id,f.as_of,f.version desc",[day,previous]),
  pool.query("select count(*)::int events,count(distinct thread_key)::int threads,count(*) filter(where category='sales')::int sale_intents from os_24h_inbound_events where (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date=$1::date",[day])
 ]);
 const prior=new Map(finance.rows.filter(r=>r.as_of===previous).map(r=>[r.run_id,r]));
 const records=finance.rows.filter(r=>r.as_of===day).map(row=>{
  const metrics=calculateFinance(row.figures),prev=prior.get(row.run_id),before=prev?calculateFinance(prev.figures):null;
  const change=(a,b)=>Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=b?a-b:null;
  return {product:row.product||'Chiến dịch 24H',recordedAt:row.recorded_at,metrics,deltaRevenue:before?change(metrics.netRevenueVnd,before.netRevenueVnd):null,deltaCost:before?change(metrics.expenseVnd,before.expenseVnd):null,deltaOrders:prev?change(row.figures.orderCount,prev.figures.orderCount):null};
 });
 const crmData=crm.rows[0];
 return {created:runs.rows[0].created,...jobs.rows[0],crm:crmData.events>0?crmData:null,records};
}
const fmt=n=>n==null?'Chưa có':Number(n).toLocaleString('vi-VN');
const money=n=>n==null?'Chưa có':fmt(n)+' đ';
const timeVN=t=>new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
const card=(label,value,esc)=>'<div class="tile">'+esc(label)+'<strong>'+esc(value)+'</strong></div>';
function layout(title,day,body,esc){
 return '<main><nav><a href="/#reports">‹ EXTRA OS</a><a href="/reports/music?day='+esc(day)+'">Music · Báo cáo ngày</a><a href="/reports/24h?day='+esc(day)+'">24H · Báo cáo ngày</a><a href="/music">Lịch show, số ghế và giá</a></nav><section><h1>'+esc(title)+'</h1><form method="get"><label>Ngày báo cáo (giờ Việt Nam)<input type="date" name="day" value="'+esc(day)+'" min="2000-01-01" max="'+esc(todayVN())+'" required></label><button>Xem báo cáo</button></form></section>'+body+'</main>';
}
function renderMusicDaily(result,day,esc){
 if(result.status!=='available')return layout('Music Show · Báo cáo ngày',day,'<section><h2>Chưa có dữ liệu tài chính</h2><p>'+esc(result.status==='not_configured'?'Chưa cấu hình token báo cáo chỉ đọc.':'API báo cáo chưa trả được dữ liệu.')+'</p><p>Không thay thế dữ liệu thiếu bằng số 0.</p><a href="/music">Xem lịch show, số ghế công khai</a></section>',esc);
 const report=musicDay(result.data,day),d=report.daily;
 const rows=report.rows.map(r=>'<tr><td>'+esc(r.artist)+'</td><td>'+esc(r.date??'—')+'</td><td>'+esc(fmt(r.daily.paidOrders))+'</td><td>'+esc(fmt(r.daily.paidTickets))+'</td><td>'+esc(money(r.daily.revenueVnd))+'</td><td>'+esc(fmt(r.daily.complimentaryTickets))+'</td><td>'+esc(money(r.total.revenueVnd))+'</td><td>'+esc(money(r.recordedCostVnd))+'</td><td>'+esc(r.costUpdatedAt?timeVN(r.costUpdatedAt):'—')+'</td></tr>').join('');
 return layout('Music Show · Báo cáo ngày',day,'<section><h2>Đơn đã xác nhận thanh toán</h2><p>Nguồn Music chỉ đọc · Cập nhật '+esc(timeVN(result.data.checkedAt))+' (giờ Việt Nam). Ngày ghi nhận theo thời điểm thanh toán, không theo ngày diễn.</p><div class="grid">'+card('Doanh thu vé trong ngày',money(d.revenueVnd),esc)+card('Đơn trả tiền',fmt(d.paidOrders),esc)+card('Vé trả tiền',fmt(d.paidTickets),esc)+card('Vé mời',fmt(d.complimentaryTickets),esc)+'</div><p>Loại đơn trùng, ưu tiên đơn online. Doanh thu là số tiền trên đơn đã xác nhận, chưa đối soát ngân hàng/hoàn tiền. Lũy kế và chi phí khai báo là tại thời điểm truy vấn, không phải đến ngày lọc. Chưa có chi phí theo ngày, chưa kết luận lãi/lỗ thực tế.</p><div class="scroll"><table><thead><tr><th>Show</th><th>Ngày diễn</th><th>Đơn ngày</th><th>Vé ngày</th><th>Doanh thu ngày</th><th>Vé mời ngày</th><th>Doanh thu lũy kế</th><th>Chi phí khai báo lũy kế</th><th>Cập nhật chi phí</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>',esc);
}
function renderRetailDaily(report,day,esc){
 const r=report;
 const rows=r.records.map(a=>'<tr><td>'+esc(a.product)+'</td><td>'+esc(money(a.metrics.netRevenueVnd))+'</td><td>'+esc(money(a.metrics.expenseVnd))+'</td><td>'+esc(money(a.metrics.profitVnd))+'</td><td>'+esc(money(a.deltaRevenue))+'</td><td>'+esc(money(a.deltaCost))+'</td><td>'+esc(fmt(a.deltaOrders))+'</td><td>'+esc(timeVN(a.recordedAt))+'</td></tr>').join('');
 return layout('24H · Báo cáo ngày',day,'<section><h2>Doanh thu cửa hàng</h2><div class="grid">'+card('Doanh thu ngày từ Sapo FnB','Chưa kết nối',esc)+card('Đơn thanh toán từ Sapo FnB','Chưa kết nối',esc)+card('Chi phí và lợi nhuận thực tế','Chưa có đối soát',esc)+'</div><p>Đang chờ API FnB. Không lấy số liệu mẫu, kế hoạch hoặc Sapo Web làm số thực tế.</p></section><section><h2>Hoạt động nội bộ EXTRA OS</h2><div class="grid">'+card('Chiến dịch nội bộ tạo trong ngày',fmt(r.created),esc)+card('Lượt nhiệm vụ nghiệm thu',fmt(r.accepted),esc)+card('Lượt nhiệm vụ bị chặn',fmt(r.blocked),esc)+card('Lượt nhiệm vụ thất bại',fmt(r.failed),esc)+card('Hội thoại ghi nhận qua webhook',fmt(r.crm?.threads),esc)+card('Tin có ý định mua',fmt(r.crm?.sale_intents),esc)+'</div><p>Không tính lượt chạy mẫu. Số liệu hội thoại chỉ là sự kiện đã nhận, không khẳng định toàn bộ inbox.</p></section><section><h2>Đối soát nội bộ theo chiến dịch</h2><p>Lũy kế do người phụ trách ghi nhận đến ngày chọn. Chênh lệch chỉ hiện nếu có bản ghi của hai ngày liên tiếp và không giảm; không cộng chiến dịch vì có thể trùng đơn. Chưa phải doanh thu ngày của toàn cửa hàng.</p>'+(rows?'<div class="scroll"><table><thead><tr><th>Sản phẩm</th><th>Doanh thu lũy kế</th><th>Chi phí lũy kế</th><th>Lãi/lỗ ghi nhận</th><th>Chênh doanh thu</th><th>Chênh chi phí</th><th>Chênh số đơn</th><th>Ngày ghi nhận</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>Chưa có bản đối soát cho ngày này.</p>')+'</section>',esc);
}
async function verifyMusicFinance(env=process.env,request=fetch){
 const token=env.EXTRA_OS_MUSIC_REPORT_READ_TOKEN??'';
 if(!/^[a-f0-9]{64}$/.test(token))return {configured:false};
 const [read,noKey,write]=await Promise.all([
  getMusicFinance(),
  request(endpoint,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>r.status).catch(()=>null),
  request(endpoint,{method:'POST',redirect:'error',headers:{'x-extra-music-report-key':token},signal:AbortSignal.timeout(10000)}).then(r=>r.status).catch(()=>null)
 ]);
 return {configured:true,status:read.status,rows:read.data?.rows.length??0,unauthorizedStatus:noKey,writeRejectedStatus:write};
}
module.exports={reportDay,musicDay,parseMusicFinance,createMusicFinanceReader,getMusicFinance,readRetailDaily,renderMusicDaily,renderRetailDaily,verifyMusicFinance};

'use strict';
const {createHash}=require('node:crypto');
const {reportDay,musicDay,getMusicFinance,readRetailDaily}=require('./daily-reports.cjs');
const {getMusicSnapshot}=require('./music-readonly.cjs');
const n=v=>Number(v).toLocaleString('vi-VN');
const money=v=>n(v)+' đ';
const validCount=v=>Number.isSafeInteger(v)&&v>=0;
const hoursToDay=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
const task=(id,agent,title,deliverable,state='draft_ready')=>({id,agent,title,deliverable,state});
function musicPlan(day,finance,inventory){
 const source=finance?.status==='available'&&finance.data;
 const current=inventory?.showsAvailable===true&&inventory?.inventoryAvailable===true;
 if(!source||!current){
  return {title:'Khôi phục nguồn báo cáo Music',summary:'Chưa đủ nguồn xác minh để đề xuất bán hàng theo số liệu.',evidence:{finance:source?'available':'missing',inventory:current?'available':'missing'},tasks:[
   task('audit-source','Auditor','Kiểm tra API chỉ đọc','Kiểm tra nguồn dữ liệu thiếu; không suy diễn doanh thu, không sửa Music.','needs_input'),
   task('analyst-hold','Analyst','Tạm dừng kết luận kinh doanh','Chưa tính tỷ lệ bán, doanh thu hoặc mức chi khi nguồn chưa đủ.','needs_input')]};
 }
 const report=musicDay(finance.data,day);
 const byId=new Map(report.rows.map(r=>[r.showId,r]));
 const candidates=inventory.rows.filter(r=>r.date>=day&&hoursToDay(r.date,day)<=7&&r.status==='announced'&&r.inventory&&r.inventory.capacity>0&&r.inventory.remaining>0&&validCount(r.inventory.sold)&&r.inventory.sold<=r.inventory.capacity)
 .sort((a,b)=>a.date.localeCompare(b.date)||a.inventory.sold/a.inventory.capacity-b.inventory.sold/b.inventory.capacity).slice(0,2);
 const facts={daily:report.daily,shows:candidates.map(s=>({id:s.id,artist:s.artist,date:s.date,inventory:s.inventory,daySales:byId.get(s.id)?.daily??null}))};
 const base=[task('daily-analysis','Analyst','Đọc báo cáo ngày','Theo ngày thanh toán: '+n(report.daily.paidOrders)+' đơn trả tiền, '+n(report.daily.paidTickets)+' vé trả tiền, '+money(report.daily.revenueVnd)+'. Chưa coi doanh thu xác nhận là tiền đã đối soát ngân hàng.')];
 if(!candidates.length)return {title:'Theo dõi bán vé Music',summary:'Không có show phù hợp tiêu chí ưu tiên trong 7 ngày tới ở nguồn hiện tại. Không đề xuất chiến dịch bán vé mới khi chưa có căn cứ.',evidence:facts,tasks:[...base,task('review-shows','Planner','Kiểm tra lịch show','Rà các show sắp tới và đối chiếu tình trạng mở bán từ nguồn chính thức.','needs_input')]};
 const tasks=[...base];
 for(const s of candidates){
  const id=s.id,ratio=Math.round(s.inventory.sold*100/s.inventory.capacity),r=byId.get(id),left=s.inventory.remaining;
  const price=Object.entries(s.prices||{}).filter(([,v])=>validCount(v)).map(([k,v])=>'Hạng '+k+': '+money(v)).join('; ');
  const headline=s.artist+' — '+s.date;
  const context='Show '+headline+'. API ghi '+n(s.inventory.sold)+'/'+n(s.inventory.capacity)+' ghế đã bán ('+ratio+'%); '+n(left)+' ghế còn theo API, chưa trừ giữ chỗ. '+(r?'Ngày chọn: '+n(r.daily.paidTickets)+' vé trả tiền, '+money(r.daily.revenueVnd)+'.':'Chưa khớp dữ liệu doanh thu theo mã show.');
  tasks.push(
   task(id+':planner','Planner','Chiến dịch ưu tiên '+s.artist,context+' Mục tiêu đề xuất: tăng số vé thanh toán so với báo cáo ngày trước; kiểm tra lại lượng ghế và mục tiêu đã duyệt trước khi chốt KPI. Ưu tiên nhắc lịch, tư vấn ghế và chăm sóc khách đã quan tâm.'),
   task(id+':content','Content','Bản nháp bài truyền thông '+s.artist,'Hẹn gặp bạn tại '+headline+'! Xem lịch, giá vé và ghế đang mở tại https://iextra.net. '+(price?'Giá niêm yết nguồn hiện tại: '+price+'. ':'')+'Liên hệ đội tư vấn nếu cần chọn khu ghế. Bản nháp chưa đăng; phải kiểm lại thông tin trước khi xuất bản.'),
   task(id+':creative','Creative','Brief hình ảnh '+s.artist,'Dùng poster đã được xác nhận quyền sử dụng của '+s.artist+'. Nhấn ngày '+s.date+', thương hiệu +1 Music Show và lời mời xem sơ đồ ghế. Không tự tạo hoặc công bố giá, ảnh nghệ sĩ khi chưa xác minh.'),
   task(id+':sale','Sale','Kịch bản tư vấn '+s.artist,'Xác nhận khách quan tâm '+headline+'; hỏi số vé và mức giá; gửi sơ đồ ghế hiện hành từ Music. Nhắc xác nhận chỗ trống trên hệ bán vé trước khi tư vấn. Không tạo đơn, giữ ghế hoặc gửi tin từ EXTRA OS.'),
   task(id+':crm','CRM','Rà nhóm khách cần chăm sóc','Đề xuất đội CRM lọc khách đã chủ động hỏi '+s.artist+' và khách đang chờ hỗ trợ. Chỉ liên hệ khi đúng quyền và quy định; chưa có dữ liệu hội thoại chi tiết, chưa gửi tin.','needs_input'),
   task(id+':ads','Ads','Phương án quảng cáo '+s.artist,'Đề xuất kiểm tra chi phí mỗi vé và chất lượng hội thoại; so sánh quảng cáo nhắc lịch với nội dung tư vấn ghế. Chưa có số liệu chi tiêu hay hạn mức được duyệt; ngân sách mới 0 đ. Không tạo hay sửa quảng cáo.','awaiting_approval'),
   task(id+':social','Social','Chuẩn bị lịch đăng '+s.artist,'Dùng bản nháp Content sau khi duyệt poster, giá và ngày; lên lịch dự kiến theo giờ Việt Nam. Chưa đăng lên Facebook hoặc TikTok.','awaiting_approval')
  );
 }
 tasks.push(task('audit','Auditor','Kiểm tra quyền và nghiệm thu','Tất cả đầu ra là bản nháp nội bộ, nguồn Music chỉ đọc. Chưa có quyền đăng bài, tạo đơn, sửa dữ liệu hay chi tiền; không xác nhận thực thi bên ngoài.'));
 return {title:'Chiến dịch ưu tiên show gần ngày diễn',summary:'Ưu tiên theo lịch diễn trong 7 ngày tới và số ghế công khai còn lại. Không đặt KPI giả; cần đối chiếu doanh số, nguồn ghế và ngân sách trước khi chạy thật.',evidence:facts,tasks};
}
function retailPlan(report){
 if(!report)return {title:'Khôi phục báo cáo 24H',summary:'Chưa đọc được báo cáo nội bộ.',evidence:{available:false},tasks:[task('audit-source','Auditor','Kiểm tra nguồn 24H','Rà kết nối báo cáo nội bộ, không sử dụng số liệu giả.','needs_input')]};
 const evidence={created:report.created,accepted:report.accepted,blocked:report.blocked,failed:report.failed,crm:report.crm??null,records:report.records.map(r=>({product:r.product,deltaRevenue:r.deltaRevenue,deltaOrders:r.deltaOrders}))};
 const tasks=[
  task('sapo','Auditor','Mở nguồn Sapo FnB chỉ đọc','Yêu cầu đúng API đơn đã thanh toán, hoàn trả, giá vốn, tồn kho của cửa hàng 24H. Không dùng Sapo Web thay thế.','needs_input'),
  task('finance','Analyst','Đối soát báo cáo 24H','Chỉ dùng số có chứng từ. '+n(report.created)+' chiến dịch nội bộ tạo trong ngày, '+n(report.accepted)+' lượt nghiệm thu, '+n(report.blocked)+' lượt bị chặn. Doanh thu cửa hàng, chi phí thật và lợi nhuận chưa xác minh.'),
  task('plan','Planner','Phương án chiến dịch 24H','Chọn sản phẩm dựa trên tồn kho, giá bán, giá vốn và nhu cầu thực sau khi FnB kết nối. Đề xuất thử nghiệm nội dung, tư vấn và theo dõi đơn thanh toán; không chọn hàng hoặc chỉ tiêu bằng dữ liệu mẫu.','needs_input'),
  task('sale','Sale','Chuẩn bị luồng tư vấn thử nghiệm','Hỏi nhu cầu, số lượng, kiểm tra giá và tồn kho chính thức, báo phí và xác nhận phương thức nhận hàng. Chưa phát hành đơn thật.'),
  task('content','Content','Khung nội dung chiến dịch','Mẫu thông điệp: 24H — xem sản phẩm, giá và tình trạng hàng đã xác minh. Bổ sung sản phẩm, hình ảnh và ưu đãi sau khi người phụ trách duyệt.'),
  task('crm','CRM','Kiểm tra hội thoại 24H',report.crm?'Nguồn đã ghi nhận '+n(report.crm.threads)+' hội thoại; rà yêu cầu mua hàng theo đúng quyền, không tự nhắn khách.':'Chưa có dữ liệu hội thoại được xác minh; kiểm tra webhook đúng Page, không kết luận không có khách.','needs_input'),
  task('ads','Ads','Giữ khóa chi tiêu','Chỉ lập đề xuất khi giá vốn, biên lợi nhuận và số đơn đã thanh toán được xác minh. Ngân sách mới 0 đ.','awaiting_approval')
 ];
 return {title:'Chiến dịch 24H — chuẩn bị và xác minh dữ liệu',summary:'Chưa đủ API FnB để chọn chiến dịch bán hàng thật. Director thực hiện bản nháp nội bộ và giao đầu việc gỡ vướng; không chạy mẫu dưới danh nghĩa dữ liệu thật.',evidence,tasks};
}
function initDailyDirector(pool){
 return pool.query("create table if not exists os_daily_director (platform text not null check(platform in ('music','24h')), day date not null, fingerprint text not null, plan jsonb not null, revision integer not null default 1, updated_at timestamptz not null default now(), primary key(platform,day))");
}
async function savePlan(pool,platform,day,plan){
 if(!['music','24h'].includes(platform))throw Error('platform');
 const fingerprint=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 const {rows}=await pool.query("insert into os_daily_director(platform,day,fingerprint,plan) values($1,$2::date,$3,$4::jsonb) on conflict(platform,day) do update set fingerprint=excluded.fingerprint,plan=excluded.plan,revision=os_daily_director.revision+1,updated_at=now() where os_daily_director.fingerprint<>excluded.fingerprint returning revision",[platform,day,fingerprint,JSON.stringify(plan)]);
 return {changed:rows.length===1,revision:rows[0]?.revision??null};
}
async function readPlan(pool,platform,day){
 const {rows}=await pool.query("select day::text day,plan,revision,updated_at from os_daily_director where platform=$1 and day=$2::date",[platform,day]);
 return rows[0]??null;
}
async function runDailyDirector(pool,{now=new Date(),music=getMusicFinance,inventory=getMusicSnapshot,retail=day=>readRetailDaily(pool,day)}={}){
 const day=reportDay(null,now);
 const [f,i,r]=await Promise.allSettled([music(),inventory(),retail(day)]);
 const musicResult=f.status==='fulfilled'?f.value:null,inventoryResult=i.status==='fulfilled'?i.value:null,retailResult=r.status==='fulfilled'?r.value:null;
 const plans=[['music',musicPlan(day,musicResult,inventoryResult)],['24h',retailPlan(retailResult)]];
 const outcomes=[];
 for(const [platform,plan] of plans){
  const saved=await savePlan(pool,platform,day,plan);
  outcomes.push({platform,day,changed:saved.changed,revision:saved.revision,tasks:plan.tasks.length,drafts:plan.tasks.filter(t=>t.state==='draft_ready').length,externalActions:0});
 }
 return outcomes;
}
function startDailyDirector(pool,{interval=3600000,onResult=()=>{},onError=()=>{}}={}){
 let stopped=false,timer=null,pending=null;
 async function run(){
  if(stopped)return;
  pending=runDailyDirector(pool).then(onResult).catch(onError);
  try{await pending;}finally{pending=null;if(!stopped)timer=setTimeout(run,interval).unref();}
 }
 timer=setTimeout(run,1000).unref();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);if(pending)await pending;};
}
function renderDailyDirector(record,day,esc){
 const states={draft_ready:'Bản nháp nội bộ đã tạo',needs_input:'Chờ dữ liệu / nhân sự',awaiting_approval:'Khóa thực thi bên ngoài'};
 if(!record)return '<section id="daily-director"><h2>AI Director</h2><p>Chưa có bản phân tích tự động đã lưu cho ngày '+esc(day)+'. Hệ thống tạo bản phân tích cho ngày hiện tại; không dựng lại lịch sử bằng dữ liệu hôm nay.</p></section>';
 const p=record.plan;
 return '<section id="daily-director"><h2>AI Director</h2><p>Ngày '+esc(day)+' · Phiên bản '+esc(record.revision)+' · Cập nhật '+esc(new Date(record.updated_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+' (giờ Việt Nam).</p><h3>'+esc(p.title)+'</h3><p>'+esc(p.summary)+'</p><p>Đang thử nghiệm bộ quy tắc phân việc nội bộ. Bản nháp tạo tự động, không đồng nghĩa Agent đã chạy mô hình hoặc đã đăng bài. Không có quyền ghi Music, gửi tin hoặc chi ngân sách.</p><div class="scroll"><table><thead><tr><th>Agent</th><th>Nhiệm vụ / Đề xuất</th><th>Đầu ra nội bộ</th><th>Trạng thái</th></tr></thead><tbody>'+p.tasks.map(t=>'<tr><td>'+esc(t.agent)+'</td><td>'+esc(t.title)+'</td><td>'+esc(t.deliverable)+'</td><td>'+esc(states[t.state]??'Chưa xác định')+'</td></tr>').join('')+'</tbody></table></div></section>';
}
module.exports={musicPlan,retailPlan,initDailyDirector,savePlan,readPlan,runDailyDirector,startDailyDirector,renderDailyDirector};

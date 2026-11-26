'use strict';
const {createHash}=require('node:crypto');
const {reportDay,musicDay,getMusicFinance,readRetailDaily}=require('./daily-reports.cjs');
const {getMusicSnapshot}=require('./music-readonly.cjs');
const {buildRetailStrategy,renderRetailStrategy}=require('./retail-strategy.cjs');
const n=v=>Number(v).toLocaleString('vi-VN');
const money=v=>n(v)+' đ';
const validCount=v=>Number.isSafeInteger(v)&&v>=0;
const hoursToDay=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
const task=(id,agent,title,deliverable,state='draft_ready')=>({id,agent,title,deliverable,state});
const shiftDay=(day,delta)=>new Date(Date.parse(day+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
const timeOf=(day,time='22:00')=>day+'T'+time+':00+07:00';
function buildCampaign(day,show,financeRow,now=new Date(timeOf(day,'00:00')),period='day'){
 const i=show.inventory,daysToShow=hoursToDay(show.date,day);
 if(show.status!=='announced'||!financeRow||!i||!validCount(i.capacity)||!validCount(i.remaining)||!validCount(i.held)||i.remaining<=i.held||daysToShow<0)return null;
 const available=Math.max(0,i.remaining-i.held);
 const last7=Array.from({length:7},(_,k)=>financeRow.days?.[shiftDay(day,-k-1)]?.paidTickets??0).reduce((a,b)=>a+b,0);
 const rate=last7/7;
 // Explicit trial-policy targets, not a statistical sales prediction.
 // Urgent shows: propose 10/day or 1.5x recent pace, limited to 20/day.
 // Other shows: propose 5/day or 1.5x recent pace, limited to 20/day.
 const dailyGoal=Math.min(20,Math.max(daysToShow<=3?10:5,Math.ceil(rate*1.5)));
 const slots=[];
 const horizon=period==='week'?7:period==='month'?31:1;
 const month=day.slice(0,7);
 for(let k=0;k<horizon;k++){
  const date=shiftDay(day,k);if(date>show.date||(period==='month'&&date.slice(0,7)!==month))break;
  let deadline=timeOf(date);
  if(date===show.date){
   if(!/^\d{2}:\d{2}$/.test(show.time??''))break;
   const showTime=Date.parse(timeOf(date,show.time));if(!Number.isFinite(showTime))break;
   const cutoff=showTime-2*3600000;
   const local=new Date(cutoff+7*3600000).toISOString();
   if(local.slice(0,10)!==date)break;
   deadline=timeOf(date,local.slice(11,16));
  }
  if(Date.parse(deadline)<=now.getTime())continue;
  const remainingGoal=available-slots.reduce((total,s)=>total+s.targetNewPaidTickets,0);
  if(remainingGoal<=0)break;
  slots.push({day:date,deadline,targetNewPaidTickets:Math.min(remainingGoal,dailyGoal)});
  // Do not assume seats remain for an additional slot on the show date.
  if(date===show.date)break;
 }
 if(!slots.length)return null;
 const goal=slots.reduce((total,s)=>total+s.targetNewPaidTickets,0),deadline=slots.at(-1).deadline;
 const started=now.getTime();
 const firstDeadline=Date.parse(slots[0].deadline);
 // Use fixed milestone times for saved proposals to avoid pointless versions on each refresh.
 const firstDay=slots[0].day;
 const prepDeadline=timeOf(firstDay,'16:00');
 const initialDeadline=Date.parse(prepDeadline)>started&&Date.parse(prepDeadline)<=firstDeadline?prepDeadline:slots[0].deadline;
 const baseline=financeRow.total?.paidTickets??null;
 const paceScenario=Math.min(available,Math.floor(rate*Math.max(0,Date.parse(deadline)-started)/86400000+0.5));
 const paidBudgetVnd=daysToShow<=3?1000000:500000;
 const lowCpa=100000,highCpa=250000;
 const additionalLow=Math.min(Math.max(0,available-paceScenario),Math.floor(paidBudgetVnd/highCpa));
 const additionalHigh=Math.min(Math.max(0,available-paceScenario),Math.floor(paidBudgetVnd/lowCpa));
 const staffPlan=[
  {id:'dieu',person:'Diệu',role:'Sale / CSKH',deadline:initialDeadline,action:'Đề xuất rà khách đã chủ động hỏi vé, điều phối tư vấn trên hệ thống hiện hành nếu được phép.',metric:'Số hội thoại đủ điều kiện, vé đã thanh toán và lý do chưa chốt.'},
  {id:'trang',person:'Trang',role:'Quảng cáo',deadline:initialDeadline,action:'Đọc số chi, hội thoại và đơn theo chiến dịch; không tăng ngân sách khi chưa được duyệt riêng.',metric:'Bảng chi tiêu, hội thoại, chi phí/vé nếu xác minh được; đề xuất giữ/dừng/tăng.'},
  {id:'hai',person:'Hải',role:'Tài chính',deadline,action:'Đối chiếu doanh thu xác nhận, hoàn trả và chi phí trước khi kết luận hiệu quả.',metric:'Bảng đối soát và khoản còn thiếu.'}
 ];
 const mediaPlan=[
  {channel:'Facebook / Messenger',asset:'2 bản nội dung: nhắc lịch và hướng dẫn chọn ghế',agent:'Content / Creative',deadline:initialDeadline,metric:'2 bản nháp đúng ngày, giá, nguồn ghế và quyền sử dụng ảnh.'},
  {channel:'TikTok / Reels',asset:'Kịch bản video 15–30 giây và lời mời tư vấn',agent:'Content / Creative / Social',deadline:initialDeadline,metric:'1 kịch bản và lịch dự kiến; chưa đăng.'},
  {channel:'Quảng cáo',asset:'So sánh thông điệp nhắc lịch với tư vấn chọn ghế',agent:'Ads / Auditor',deadline:initialDeadline,metric:'Kiểm tra CPA và tỷ lệ hội thoại thành vé khi có dữ liệu.'}
 ];
 return {showId:show.id,artist:show.artist,showDate:show.date,baselinePaidTickets:baseline,last7PaidTickets:last7,
  ratePerDay:Math.round(rate*100)/100,availableForPlanning:available,scenarioNewPaidTickets:paceScenario,
  targetNewPaidTickets:goal,targetTotalPaidTickets:baseline===null?null:baseline+goal,deadline,slots,
  budgetNewVnd:0,staffPlan,mediaPlan,paidScenario:{budgetVnd:paidBudgetVnd,cpaLowVnd:lowCpa,cpaHighVnd:highCpa,additionalLow,additionalHigh,combinedLow:paceScenario+additionalLow,combinedHigh:paceScenario+additionalHigh,basis:'Minh họa với giả định CPA 100.000–250.000 đ/vé tăng thêm; chưa đo thực tế, không phải dự báo chắc chắn. Chưa duyệt chi tiền.'},forecastBasis:'Kịch bản tham chiếu = nhịp bán 7 ngày hoàn tất × thời gian còn lại đến hạn. Không phải dự báo xác suất.',
  targetBasis:'Chỉ tiêu thử nghiệm: '+(daysToShow<=3?'tối thiểu 10':'tối thiểu 5')+' vé mới/ngày hoặc 1,5 lần nhịp bán 7 ngày, tối đa 20 vé/ngày và không vượt số ghế còn sau khi trừ ghế giữ theo API. Cần kiểm lại ghế khi thực hiện.',
  steps:[
   {agent:'Sale / CRM',deadline:initialDeadline,action:'Rà khách đã chủ động hỏi vé và đơn đang chờ; lập danh sách ưu tiên, xác minh chỗ trống và giá. Đội bán vé thực hiện tư vấn trên hệ thống hiện hành nếu được phép; EXTRA OS không gửi tin hoặc giữ ghế.',metric:'Danh sách nhu cầu đủ căn cứ; báo cáo số hội thoại, số vé đã thanh toán và vướng mắc.'},
   {agent:'Content / Creative',deadline:initialDeadline,action:'Chuẩn bị 2 bản nội dung: nhắc lịch diễn và hướng dẫn chọn khu ghế; dùng poster đã được xác minh. Chưa đăng bài.',metric:'2 nội dung và brief hình ảnh để duyệt, đúng ngày, giá và nguồn ghế.'},
   {agent:'Ads / Auditor',deadline:initialDeadline,action:'Đối chiếu chi tiêu và hội thoại theo chiến dịch; chỉ đề xuất điều chỉnh khi có số liệu, giới hạn và quyền riêng. Không tăng chi hoặc chạy quảng cáo.',metric:'Báo cáo dữ liệu thiếu, chi phí trên vé nếu có phân bổ; ngân sách mới 0 đ.'},
   {agent:'Analyst / Director',deadline,action:'Đối chiếu số vé thanh toán tăng thêm so với mốc đầu, kiểm tra từng deadline; nếu hụt mục tiêu, nêu nguyên nhân có bằng chứng và trình phương án mới để chủ duyệt.',metric:'So sánh kết quả thật với '+n(goal)+' vé mới, và từng mốc trong kế hoạch.'}
  ]};
}
function musicPlan(day,finance,inventory,now=new Date(timeOf(day,'00:00')),period='day'){
 const source=finance?.status==='available'&&finance.data;
 const current=inventory?.showsAvailable===true&&inventory?.inventoryAvailable===true;
 if(!source||!current){
  return {title:'Khôi phục nguồn báo cáo Music',summary:'Chưa đủ nguồn xác minh để đề xuất bán hàng theo số liệu.',evidence:{finance:source?'available':'missing',inventory:current?'available':'missing'},tasks:[
   task('audit-source','Auditor','Kiểm tra API chỉ đọc','Kiểm tra nguồn dữ liệu thiếu; không suy diễn doanh thu, không sửa Music.','needs_input'),
   task('analyst-hold','Analyst','Tạm dừng kết luận kinh doanh','Chưa tính tỷ lệ bán, doanh thu hoặc mức chi khi nguồn chưa đủ.','needs_input')]};
 }
 const report=musicDay(finance.data,day);
 const byId=new Map(report.rows.map(r=>[r.showId,r]));
 const previousDay=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const previous=musicDay(finance.data,previousDay);
 const previousById=new Map(previous.rows.map(r=>[r.showId,r]));
 const signed=v=>(v>0?'+':'')+n(v);
 const historic=report.rows.filter(r=>r.date&&r.date<day).sort((a,b)=>b.date.localeCompare(a.date));
 const past=historic.map(r=>{
  const inv=inventory.rows.find(s=>s.id===r.showId)?.inventory??null;
  return {showId:r.showId,artist:r.artist,date:r.date,paidTickets:r.total.paidTickets,paidOrders:r.total.paidOrders,revenueVnd:r.total.revenueVnd,complimentaryTickets:r.total.complimentaryTickets,recordedCostVnd:r.recordedCostVnd,capacity:inv?.capacity??null,publicSold:inv?.sold??null};
 });
 const upcoming=inventory.rows.filter(r=>r.date>=day&&['announced','pending','sold_out','live'].includes(r.status))
 .sort((a,b)=>a.date.localeCompare(b.date)||(a.inventory?.sold??0)/(a.inventory?.capacity||1)-(b.inventory?.sold??0)/(b.inventory?.capacity||1));
 const portfolio=upcoming.map(s=>{
  const r=byId.get(s.id),prev=previousById.get(s.id),i=s.inventory,days=hoursToDay(s.date,day);
  const priority=days<=3?'urgent':days<=7?'high':'prepare';
  const available=s.status==='announced'&&i&&i.capacity>0&&i.remaining>0&&validCount(i.sold)&&i.sold<=i.capacity;
  const policy=s.status==='sold_out'?'Kiểm tra hết vé, điều phối check-in; không đẩy bán thêm.':s.status==='live'?'Theo dõi vận hành; không tự mở bán.':s.status==='pending'?'Chuẩn bị tư liệu, xác minh giá và ngày mở bán; chưa quảng bá mở bán.':!available?'Xác minh số ghế hoặc trạng thái mở bán trước khi tư vấn.':days<=3?'Ưu tiên chuyển đổi, chăm sóc khách đã hỏi, kiểm tra chỗ trống trước tư vấn.':days<=7?'Tăng nhận diện và chuyển đổi bằng nội dung đã duyệt; rà tiến độ bán hằng ngày.':'Chuẩn bị nghiên cứu khán giả, tư liệu, lịch nội dung và mục tiêu; theo dõi tốc độ bán.';
  return {showId:s.id,artist:s.artist,date:s.date,days,priority,status:s.status,inventory:i??null,daily:r?.daily??null,previous:prev?.daily??null,policy};
 });
 const candidates=upcoming.filter(r=>hoursToDay(r.date,day)<=7&&r.status==='announced'&&r.inventory&&r.inventory.capacity>0&&r.inventory.remaining>0&&validCount(r.inventory.sold)&&r.inventory.sold<=r.inventory.capacity).slice(0,2);
 const facts={daily:report.daily,previousDay,previous:previous.daily,historicalShows:past,upcomingShows:portfolio,shows:candidates.map(s=>({id:s.id,artist:s.artist,date:s.date,inventory:s.inventory,daySales:byId.get(s.id)?.daily??null,previousSales:previousById.get(s.id)?.daily??null})),adAttribution:null};
 const financeById=new Map(finance.data.rows.map(row=>[row.showId,row]));
 const campaigns=upcoming.map(show=>buildCampaign(day,show,financeById.get(show.id),now,period)).filter(Boolean);
 facts.campaigns=campaigns;
 const base=[task('daily-analysis','Analyst','Đọc và so sánh kết quả báo cáo ngày','Theo ngày thanh toán: '+n(report.daily.paidOrders)+' đơn trả tiền, '+n(report.daily.paidTickets)+' vé trả tiền, '+money(report.daily.revenueVnd)+'. Ngày trước ('+previousDay+'): '+n(previous.daily.paidTickets)+' vé, '+money(previous.daily.revenueVnd)+'. Chênh lệch đến thời điểm đọc: '+signed(report.daily.paidTickets-previous.daily.paidTickets)+' vé, '+signed(report.daily.revenueVnd-previous.daily.revenueVnd)+' đ; ngày hiện tại có thể chưa kết thúc. Chưa coi doanh thu xác nhận là tiền đã đối soát ngân hàng, không quy kết cho chiến dịch quảng cáo khi chưa có dữ liệu phân bổ.')];
 const retrospective=past.length?'Có '+n(past.length)+' show đã qua ngày diễn trong nguồn tài chính. So sánh vé trả tiền, doanh thu xác nhận, vé mời và chi phí khai báo từng show; cần kiểm tra trạng thái kết thúc, hoàn trả, chi phí thực và dữ liệu quảng cáo trước khi kết luận hiệu quả. Rút bài học về tốc độ bán, cơ cấu khách và truyền thông chỉ khi có chứng cứ.':'Chưa có show đã qua ngày diễn trong nguồn tài chính. Không tạo kết quả lịch sử giả; thu thập báo cáo show cũ và chứng từ để học.';
 const tasks=[...base,task('historical-review','Analyst','Tổng kết show đã qua và bài học cho show mới',retrospective,past.length?'draft_ready':'needs_input'),task('portfolio-plan','Planner','Phương án toàn bộ show chưa diễn','Đã lập danh sách '+n(portfolio.length)+' show theo ngày diễn và mức ưu tiên. Áp dụng bài học đã xác minh của show cũ; rà đối tượng khách, nội dung, giá, sức chứa và KPI từng show. Danh sách riêng bên dưới. Chờ chủ duyệt; không tự mở bán hoặc tăng ngân sách.',portfolio.length?'draft_ready':'needs_input')];
 if(!candidates.length)tasks.push(task('review-shows','Planner','Kiểm tra lịch show','Không có show đủ điều kiện lập chiến dịch bán vé chi tiết trong 7 ngày tới theo nguồn hiện tại; tiếp tục chuẩn bị các show xa hơn.','needs_input'));

 for(const s of candidates){
  const id=s.id,ratio=Math.round(s.inventory.sold*100/s.inventory.capacity),r=byId.get(id),prev=previousById.get(id),left=s.inventory.remaining;
  const price=Object.entries(s.prices||{}).filter(([,v])=>validCount(v)).map(([k,v])=>'Hạng '+k+': '+money(v)).join('; ');
  const headline=s.artist+' — '+s.date;
  const context='Show '+headline+'. API ghi '+n(s.inventory.sold)+'/'+n(s.inventory.capacity)+' ghế đã bán ('+ratio+'%); '+n(left)+' ghế còn theo API, chưa trừ giữ chỗ. '+(r?'Ngày chọn: '+n(r.daily.paidTickets)+' vé trả tiền, '+money(r.daily.revenueVnd)+'.':'Chưa khớp dữ liệu doanh thu theo mã show.')+(prev?' Ngày trước: '+n(prev.daily.paidTickets)+' vé, '+money(prev.daily.revenueVnd)+'.':'');
  tasks.push(
   task(id+':planner','Planner','Chiến dịch ưu tiên '+s.artist,context+' Biện pháp phát triển: tăng tỷ lệ chuyển đổi khách quan tâm thành vé đã thanh toán. KPI theo dõi: vé trả tiền, doanh thu xác nhận, tỷ lệ lấp đầy và hội thoại có kết quả; không đặt chỉ tiêu hoặc ngân sách giả. Sau khi duyệt, so lại báo cáo ngày tiếp theo với mốc này; kiểm tra lượng ghế và mục tiêu được duyệt. Ưu tiên nhắc lịch, tư vấn ghế và chăm sóc khách đã quan tâm.'),
   task(id+':content','Content','Bản nháp bài truyền thông '+s.artist,'Hẹn gặp bạn tại '+headline+'! Xem lịch, giá vé và ghế đang mở tại https://iextra.net. '+(price?'Giá niêm yết nguồn hiện tại: '+price+'. ':'')+'Liên hệ đội tư vấn nếu cần chọn khu ghế. Bản nháp chưa đăng; phải kiểm lại thông tin trước khi xuất bản.'),
   task(id+':creative','Creative','Brief hình ảnh '+s.artist,'Dùng poster đã được xác nhận quyền sử dụng của '+s.artist+'. Nhấn ngày '+s.date+', thương hiệu +1 Music Show và lời mời xem sơ đồ ghế. Không tự tạo hoặc công bố giá, ảnh nghệ sĩ khi chưa xác minh.'),
   task(id+':sale','Sale','Kịch bản tư vấn '+s.artist,'Xác nhận khách quan tâm '+headline+'; hỏi số vé và mức giá; gửi sơ đồ ghế hiện hành từ Music. Nhắc xác nhận chỗ trống trên hệ bán vé trước khi tư vấn. Không tạo đơn, giữ ghế hoặc gửi tin từ EXTRA OS.'),
   task(id+':crm','CRM','Rà nhóm khách cần chăm sóc','Đề xuất đội CRM lọc khách đã chủ động hỏi '+s.artist+' và khách đang chờ hỗ trợ. Chỉ liên hệ khi đúng quyền và quy định; chưa có dữ liệu hội thoại chi tiết, chưa gửi tin.','needs_input'),
   task(id+':ads','Ads','Phương án quảng cáo '+s.artist,'Đề xuất kiểm tra chi phí mỗi vé và chất lượng hội thoại; so sánh quảng cáo nhắc lịch với nội dung tư vấn ghế. Chưa có số liệu chi tiêu hay hạn mức được duyệt; ngân sách mới 0 đ. Không tạo hay sửa quảng cáo.','awaiting_approval'),
   task(id+':social','Social','Chuẩn bị lịch đăng '+s.artist,'Dùng bản nháp Content sau khi duyệt poster, giá và ngày; lên lịch dự kiến theo giờ Việt Nam. Chưa đăng lên Facebook hoặc TikTok.','awaiting_approval')
  );
 }
 for(const campaign of campaigns){
  const deadline=campaign.deadline;
  const attached=tasks.find(t=>t.id===campaign.showId+':planner');
  const goal='Mục tiêu đề xuất: thêm '+n(campaign.targetNewPaidTickets)+' vé trả tiền trước '+deadline.replace('T',' ').slice(0,16)+' (giờ VN); kịch bản theo nhịp 7 ngày: '+n(campaign.scenarioNewPaidTickets)+' vé mới. Chưa cam kết đạt. '+campaign.slots.map(s=>s.deadline.replace('T',' ').slice(0,16)+': '+n(s.targetNewPaidTickets)+' vé mới').join('; ')+'.';
  if(attached){attached.deliverable+=' '+goal;attached.deadline=deadline;}
  else tasks.push({...task(campaign.showId+':target','Planner','Chỉ tiêu và deadline '+campaign.artist,goal+' Chuẩn bị và đo kết quả theo số liệu thật; chưa triển khai bên ngoài.'),deadline});
  for(const person of campaign.staffPlan)tasks.push({...task(campaign.showId+':staff:'+person.id,'Nhân sự · '+person.person,'Đề xuất phân công '+person.person+' — '+campaign.artist,person.action+' '+person.metric,'needs_input'),deadline:person.deadline,staffId:person.id});
  for(const t of tasks.filter(t=>t.id.startsWith(campaign.showId+':')&&t!==attached&&!t.deadline)){
   t.deadline=campaign.steps[0].deadline;
  }
 }
 tasks.push(task('audit','Auditor','Kiểm tra quyền và nghiệm thu','Tất cả đầu ra là bản nháp nội bộ, nguồn Music chỉ đọc. Chưa có quyền đăng bài, tạo đơn, sửa dữ liệu hay chi tiền; không xác nhận thực thi bên ngoài.'));
 return {title:'Phương án kinh doanh Music theo vòng đời show',summary:'Tổng kết show đã qua, chuẩn bị toàn bộ show chưa diễn và lập bản nháp chiến dịch chi tiết cho tối đa hai show đủ điều kiện gần ngày diễn nhất. Đo hiệu quả bằng báo cáo tiếp theo; chưa có dữ liệu phân bổ theo quảng cáo nên không kết luận hiệu quả từng chiến dịch. Cần đối chiếu số ghế và ngân sách trước khi chạy thật.',evidence:facts,tasks};
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
 return pool.query(
  "create table if not exists os_daily_director (platform text not null check(platform in ('music','24h','music_week','music_month','24h_week','24h_month')), day date not null, fingerprint text not null, plan jsonb not null, revision integer not null default 1, updated_at timestamptz not null default now(), primary key(platform,day));"+
  "alter table os_daily_director drop constraint if exists os_daily_director_platform_check;"+
  "alter table os_daily_director add constraint os_daily_director_platform_check check(platform in ('music','24h','music_week','music_month','24h_week','24h_month'));"+
  "create table if not exists os_daily_approvals (platform text not null, day date not null, revision integer not null, fingerprint text not null, plan jsonb not null, approved_at timestamptz not null default now(), primary key(platform,day,revision));"+
  "create table if not exists os_daily_execution (platform text not null, day date not null, revision integer not null, task_id text not null, ordinal integer not null, task jsonb not null, status text not null check(status in ('queued','draft_prepared','blocked')), result jsonb, updated_at timestamptz not null default now(), primary key(platform,day,revision,task_id), foreign key(platform,day,revision) references os_daily_approvals(platform,day,revision));"+
  "create index if not exists os_daily_execution_queue on os_daily_execution(day,ordinal) where status='queued';");
}
async function savePlan(pool,platform,day,plan){
 if(!validProposalPlatform(platform))throw Error('platform');
 const fingerprint=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 const {rows}=await pool.query("insert into os_daily_director(platform,day,fingerprint,plan) values($1,$2::date,$3,$4::jsonb) on conflict(platform,day) do update set fingerprint=excluded.fingerprint,plan=excluded.plan,revision=os_daily_director.revision+1,updated_at=now() where os_daily_director.fingerprint<>excluded.fingerprint returning revision",[platform,day,fingerprint,JSON.stringify(plan)]);
 return {changed:rows.length===1,revision:rows[0]?.revision??null};
}
async function readPlan(pool,platform,day){
 const {rows}=await pool.query("select day::text as day,plan,revision,updated_at,fingerprint from os_daily_director where platform=$1 and day=$2::date",[platform,day]);
 return rows[0]??null;
}
const validApproval=(platform,day,revision,fingerprint,now)=>validProposalPlatform(platform)&&typeof day==='string'&&day===reportDay(null,now)&&Number.isSafeInteger(revision)&&revision>0&&typeof fingerprint==='string'&&/^[a-f0-9]{64}$/.test(fingerprint);
async function approvePlan(pool,{platform,day,revision,fingerprint},now=new Date()){
 if(!validApproval(platform,day,revision,fingerprint,now))return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('begin');
  const {rows:[proposal]}=await client.query("select revision,fingerprint,plan from os_daily_director where platform=$1 and day=$2::date for update",[platform,day]);
  if(!proposal||proposal.revision!==revision||proposal.fingerprint!==fingerprint){await client.query('rollback');return {status:'stale'};}
  const inserted=await client.query("insert into os_daily_approvals(platform,day,revision,fingerprint,plan) values($1,$2::date,$3,$4,$5::jsonb) on conflict(platform,day,revision) do nothing returning revision",[platform,day,revision,fingerprint,JSON.stringify(proposal.plan)]);
  if(inserted.rowCount===0){await client.query('commit');return {status:'already_approved'};}
  const tasks=proposal.plan.tasks;
  if(!Array.isArray(tasks)||!tasks.length||tasks.length>2500||new Set(tasks.map(t=>t.id)).size!==tasks.length)throw Error('invalid tasks');
  for(let index=0;index<tasks.length;index++){
   const t=tasks[index];
   if(typeof t.id!=='string'||!t.id||!['draft_ready','needs_input','awaiting_approval'].includes(t.state)||typeof t.deliverable!=='string')throw Error('invalid task');
   await client.query("insert into os_daily_execution(platform,day,revision,task_id,ordinal,task,status) values($1,$2::date,$3,$4,$5,$6::jsonb,'queued')",[platform,day,revision,t.id,index,JSON.stringify(t)]);
  }
  await client.query('commit');
  return {status:'approved',tasks:tasks.length};
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
function executeApprovedTask(task,day,now=new Date()){
 if(day!==reportDay(null,now))return {status:'blocked',result:{reason:'Đã qua ngày hiệu lực; cần phương án mới.',externalActions:0}};
 if(task.deadline&&(!Number.isFinite(Date.parse(task.deadline))||Date.parse(task.deadline)<=now.getTime()))return {status:'blocked',result:{reason:'Đã quá deadline nhiệm vụ; cần trình phương án mới.',externalActions:0}};
 if(task.state==='needs_input')return {status:'blocked',result:{reason:'Thiếu dữ liệu hoặc cần người phụ trách xác minh.',handoff:task.deliverable,externalActions:0}};
 if(task.state==='awaiting_approval')return {status:'blocked',result:{reason:'Quyền thực thi ngoài EXTRA OS chưa được cấp; không chi ngân sách hoặc đăng bài.',handoff:task.deliverable,externalActions:0}};
 if(task.state!=='draft_ready')return {status:'blocked',result:{reason:'Trạng thái đầu việc không hợp lệ.',externalActions:0}};
 return {status:'draft_prepared',result:{kind:'internal_prepared_artifact',agent:task.agent,title:task.title,content:task.deliverable,basis:'approved_rule_based_proposal',externalActions:0}};
}
// Work is limited to preparing the approved internal artifact; no provider credentials,
// network calls, Music writes, publication, or paid actions are available to this executor.
async function executeNextApprovedTask(pool,now=new Date()){
 const client=await pool.connect();
 try{
  await client.query('begin');
  const {rows:[row]}=await client.query("select e.platform,e.day::text as day,e.revision,e.task_id,e.task from os_daily_execution e join os_daily_approvals a on a.platform=e.platform and a.day=e.day and a.revision=e.revision where e.status='queued' order by e.day,e.ordinal,e.platform,e.revision for update of e skip locked limit 1");
  if(!row){await client.query('commit');return null;}
  const output=executeApprovedTask(row.task,row.day,now);
  await client.query("update os_daily_execution set status=$5,result=$6::jsonb,updated_at=now() where platform=$1 and day=$2::date and revision=$3 and task_id=$4 and status='queued'",[row.platform,row.day,row.revision,row.task_id,output.status,JSON.stringify(output.result)]);
  await client.query('commit');
  return {platform:row.platform,day:row.day,revision:row.revision,status:output.status,externalActions:0};
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
async function readApprovals(pool,platform,day){
 const {rows}=await pool.query("select a.revision,a.plan,a.approved_at,coalesce((select jsonb_agg(jsonb_build_object('task',e.task,'status',e.status,'result',e.result) order by e.ordinal) from os_daily_execution e where e.platform=a.platform and e.day=a.day and e.revision=a.revision),'[]'::jsonb) as tasks from os_daily_approvals a where a.platform=$1 and a.day=$2::date order by a.revision desc limit 20",[platform,day]);
 return rows;
}
function startApprovedWorker(pool,{interval=2000,onError=()=>{},onResult=()=>{}}={}){
 let stopped=false,timer=null,pending=null;
 async function run(){
  if(stopped)return;
  pending=(async()=>{for(let i=0;i<20&&!stopped;i++){const result=await executeNextApprovedTask(pool);if(!result)break;onResult(result);}})().catch(onError);
  try{await pending;}finally{pending=null;if(!stopped)timer=setTimeout(run,interval).unref();}
 }
 timer=setTimeout(run,1000).unref();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);if(pending)await pending;};
}
// Three planning horizons, each stored under a separate approval identity.
// Day plan covers the selected day; week means the next 7 days;
// month means the remaining days in the selected calendar month, VN time.
const periods=['day','week','month'];
function proposalPlatform(platform,period='day'){
 if(!['music','24h'].includes(platform)||!periods.includes(period))throw Error('proposal scope');
 return period==='day'?platform:platform+'_'+period;
}
function periodLabel(period){return period==='week'?'Kế hoạch tuần (7 ngày tới)':period==='month'?'Kế hoạch tháng (đến cuối tháng)':'Kế hoạch ngày (ngày được chọn)';}
function proposalPlan(platform,period,day,finance,inventory,retail,now){
 const base=platform==='music'?musicPlan(day,finance,inventory,now,period):retailPlan(retail);
 const end=period==='week'?shiftDay(day,6):period==='month'?new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).toISOString().slice(0,10):day;
 if(platform==='24h'){
  const strategy=buildRetailStrategy(day,end,period,now);
  base.title=strategy.name;
  base.summary='Thử nghiệm có kiểm soát để chuyển nhu cầu mua nhanh thành hóa đơn tại cửa hàng. Sapo FnB chưa kết nối; sử dụng chứng từ nội bộ đã xác minh để đánh giá, không lấy số mẫu.';
  base.evidence={...base.evidence,retailObjective:{objective:strategy.objective,deadline:strategy.deadline,budgetNewVnd:0,orderTarget:null,revenueTargetVnd:null,staff:strategy.staff},retailStrategy:strategy};
  base.tasks=base.tasks.map(t=>({...t,deadline:strategy.deadline}));
  for(const a of strategy.agents)base.tasks.push({...task('strategy:'+a.agent,a.agent,'Đề xuất triển khai · '+a.agent,a.action+' '+a.metric,a.agent.includes('Ads')?'awaiting_approval':'draft_ready'),deadline:a.deadline});
  for(const person of strategy.staff)base.tasks.push({...task('staff:'+person.id,'Nhân sự · '+person.person,'Đề xuất phân công '+person.person,person.action+' '+person.metric,'needs_input'),deadline:person.deadline,staffId:person.id});
 }

 return {...base,period,periodStart:day,periodEnd:end,title:periodLabel(period)+' · '+base.title};
}
function validProposalPlatform(platform){return ['music','24h','music_week','music_month','24h_week','24h_month'].includes(platform);}
function proposalBase(platform){return platform.startsWith('music')?'music':'24h';}
function proposalPeriod(platform){return platform.endsWith('_week')?'week':platform.endsWith('_month')?'month':'day';}
function proposalUrl(platform,day){return '/proposals/'+proposalBase(platform)+'?period='+proposalPeriod(platform)+'&day='+encodeURIComponent(day);}
function proposalPeriodValue(raw){return periods.includes(raw)?raw:'day';}
function renderProposalPage(record,platform,period,day,esc,options={}){
 const base=proposalBase(platform),route='/proposals/'+base,links=periods.map(p=>'<a class="period-link" '+(p===period?'aria-current="page" ':'')+'href="'+route+'?period='+p+'&day='+esc(day)+'">'+esc(p==='day'?'Kế hoạch ngày':p==='week'?'Kế hoạch tuần':'Kế hoạch tháng')+'</a>').join(' ');
 const form='<form method="get" action="'+route+'"><input type="hidden" name="period" value="'+esc(period)+'"><label>Ngày lập đề xuất <input type="date" name="day" value="'+esc(day)+'" required></label><button>Xem</button></form>';
 return '<main><section><h1>Đề xuất '+(base==='music'?'Music Show':'24H')+'</h1><nav>'+links+'</nav>'+form+'<p>'+esc(periodLabel(period))+' · Dữ liệu báo cáo ngày '+esc(day)+'. Mỗi kỳ là phương án riêng; không cộng dồn các kỳ trùng nhau.</p><a href="/reports/'+base+'?day='+esc(day)+'">Xem báo cáo nguồn</a></section>'+renderProposalPreview(record,day,esc,options.approvals??[])+renderDailyDirector(record,day,esc,{...options,platform})+'</main>';
}
async function runDailyDirector(pool,{now=new Date(),music=getMusicFinance,inventory=getMusicSnapshot,retail=day=>readRetailDaily(pool,day)}={}){
 const day=reportDay(null,now);
 const [f,i,r]=await Promise.allSettled([music(),inventory(),retail(day)]);
 const musicResult=f.status==='fulfilled'?f.value:null,inventoryResult=i.status==='fulfilled'?i.value:null,retailResult=r.status==='fulfilled'?r.value:null;
 const plans=periods.flatMap(period=>['music','24h'].map(platform=>[proposalPlatform(platform,period),proposalPlan(platform,period,day,musicResult,inventoryResult,retailResult,now)]));
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
function displayDeadline(value){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Chưa xác định';
 return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric',hourCycle:'h23'}).format(date)+' (giờ VN)';
}
function renderCampaign(campaign,esc,expanded=true){
 const k=campaign;
 const slots=k.slots.map(s=>'<tr><td>'+esc(displayDeadline(s.deadline))+'</td><td>'+esc(n(s.targetNewPaidTickets))+' vé mới</td></tr>').join('');
 const staff=(k.staffPlan??[]).map(s=>'<tr><td>'+esc(s.person+' · '+s.role)+'</td><td>'+esc(displayDeadline(s.deadline))+'</td><td>'+esc(s.action)+'</td><td>'+esc(s.metric)+'</td></tr>').join('');
 const media=(k.mediaPlan??[]).map(s=>'<tr><td>'+esc(s.channel)+'</td><td>'+esc(s.agent)+'</td><td>'+esc(s.asset)+'</td><td>'+esc(displayDeadline(s.deadline))+'</td><td>'+esc(s.metric)+'</td></tr>').join('');
 const scenario=k.paidScenario;
 const detail= (scenario?'<h4>Phương án ngân sách để xem xét (chưa duyệt chi)</h4><p>Giả định '+esc(money(scenario.budgetVnd))+' · '+esc(n(scenario.additionalLow))+'–'+esc(n(scenario.additionalHigh))+' vé tăng thêm từ quảng cáo theo giả định. Tổng kịch bản: '+esc(n(scenario.combinedLow))+'–'+esc(n(scenario.combinedHigh))+' vé mới. '+esc(scenario.basis)+'</p>':'')+(media?'<h4>Media & marketing</h4><div class="scroll"><table><thead><tr><th>Kênh</th><th>AI phụ trách</th><th>Sản phẩm</th><th>Deadline</th><th>Tiêu chí</th></tr></thead><tbody>'+media+'</tbody></table></div>':'')+(staff?'<h4>Nhân sự đề xuất (chờ phân công thực tế)</h4><div class="scroll"><table><thead><tr><th>Người phụ trách</th><th>Deadline</th><th>Việc cần làm</th><th>Báo cáo kết quả</th></tr></thead><tbody>'+staff+'</tbody></table></div>':'');
 const steps=k.steps.map(s=>'<tr><td>'+esc(s.agent)+'</td><td>'+esc(displayDeadline(s.deadline))+'</td><td>'+esc(s.action)+'</td><td>'+esc(s.metric)+'</td></tr>').join('');
 return '<details '+(expanded?'open':'')+'><summary>'+esc(k.artist)+' · Mục tiêu +'+esc(n(k.targetNewPaidTickets))+' vé mới · '+esc(displayDeadline(k.deadline))+'</summary><div class="grid"><div class="tile">Vé trả tiền tại mốc lập<strong>'+esc(k.baselinePaidTickets==null?'Chưa có':n(k.baselinePaidTickets))+'</strong></div><div class="tile">Kịch bản giữ nhịp bán<strong>+'+esc(n(k.scenarioNewPaidTickets))+' vé</strong></div><div class="tile">Chỉ tiêu đề xuất<strong>+'+esc(n(k.targetNewPaidTickets))+' vé</strong></div><div class="tile">Mục tiêu lũy kế<strong>'+esc(k.targetTotalPaidTickets==null?'Chưa có':n(k.targetTotalPaidTickets))+' vé</strong></div></div><p><strong>Deadline:</strong> '+esc(displayDeadline(k.deadline))+'</p><p><strong>Căn cứ:</strong> '+esc(n(k.last7PaidTickets))+' vé trong 7 ngày hoàn tất (bình quân '+esc(n(k.ratePerDay))+' vé/ngày). '+esc(k.forecastBasis)+'</p><p><strong>Lý do chọn chỉ tiêu:</strong> '+esc(k.targetBasis)+'</p><p>Đây là mục tiêu cần chủ duyệt, không phải cam kết doanh số. Ngân sách tăng thêm: '+esc(money(k.budgetNewVnd))+'.</p><h4>Mốc bán vé</h4><div class="scroll"><table><thead><tr><th>Deadline</th><th>Vé trả tiền tăng thêm</th></tr></thead><tbody>'+slots+'</tbody></table></div><h4>Biện pháp triển khai và đầu ra</h4><div class="scroll"><table><thead><tr><th>Phụ trách</th><th>Deadline</th><th>Việc phải làm</th><th>Kết quả cần kiểm tra</th></tr></thead><tbody>'+steps+'</tbody></table></div>'+detail+'</details>';
}
function renderProposalPreview(record,day,esc,approvals=[]){
 if(!record)return '<section class="director-preview"><h2>Phương án AI Director</h2><p>Chưa có phương án lưu cho ngày '+esc(day)+'. Chọn ngày hiện tại để xem đề xuất tự động.</p><a href="#daily-director">Xem trạng thái AI Director</a></section>';
 const p=record.plan,approved=approvals.find(a=>a.revision===record.revision),lead=p.evidence?.shows?.[0],portfolio=p.evidence?.upcomingShows??[];
 const campaigns=p.evidence?.campaigns??[],detailed=campaigns.length?'<h3>Chiến dịch đề xuất · mục tiêu và deadline</h3>'+campaigns.map((campaign,index)=>renderCampaign(campaign,esc,index===0)).join(''):'';
 const retail=p.evidence?.retailObjective;
 const retailHtml=p.evidence?.retailStrategy?renderRetailStrategy(p.evidence.retailStrategy,esc,displayDeadline):retail?'<p><strong>Mục tiêu:</strong> '+esc(retail.objective)+'</p><p><strong>Deadline:</strong> '+esc(displayDeadline(retail.deadline))+' · Ngân sách tăng thêm 0 đ · Chỉ tiêu đơn và doanh thu: chờ dữ liệu FnB.</p><details><summary>Nhân sự đề xuất</summary><ul>'+retail.staff.map(s=>'<li>'+esc(s.person+' · '+s.role+' — '+s.action+' Hạn: '+displayDeadline(s.deadline))+'</li>').join('')+'</ul></details>':'';
 const status=approved?'Đã phê duyệt · triển khai nội bộ':'Chờ anh phê duyệt';
 const engine='<p class="tag">Nguồn đề xuất: bộ quy tắc và kịch bản thử nghiệm nội bộ; chưa kết nối mô hình AI Director. Không phải kết quả dự báo đã đo.</p>';
 const title=lead?'Ưu tiên bán vé '+lead.artist+' · '+lead.date:p.title;
 const baseline=lead?'<p><strong>Căn cứ:</strong> '+esc(n(lead.inventory.sold)+'/'+n(lead.inventory.capacity)+' ghế đã bán theo API; '+n(lead.inventory.remaining)+' ghế còn theo API (chưa trừ giữ chỗ). '+(lead.daySales?'Trong ngày: '+n(lead.daySales.paidTickets)+' vé trả tiền, '+money(lead.daySales.revenueVnd)+'.':'Chưa có số thanh toán khớp mã show.'))+'</p>':'<p>'+esc(p.summary)+'</p>';
 const measures=lead?[
  'Sale / CRM: rà khách đã hỏi vé, ưu tiên xử lý nhu cầu chưa chốt, xác minh ghế trước khi tư vấn. Chưa tự gửi tin.',
  'Content / Creative: soạn bài nhắc lịch và hướng dẫn chọn ghế, dùng poster đã xác minh quyền sử dụng.',
  'Ads / Analyst: rà dữ liệu chi tiêu, số hội thoại và số vé thanh toán; chưa có căn cứ tăng ngân sách. So sánh kết quả ngày tiếp theo.'
 ]:p.tasks.slice(0,3).map(t=>t.title+': '+t.deliverable);
 const progress=approved?'<p>Tiến độ phiên bản đã duyệt: '+esc(n(approved.tasks.filter(t=>t.status==='draft_prepared').length))+' tài liệu nội bộ đã chuẩn bị · '+esc(n(approved.tasks.filter(t=>t.status==='blocked').length))+' việc bị chặn · '+esc(n(approved.tasks.filter(t=>t.status==='queued').length))+' việc chờ.</p>':'<p>Chưa tạo hàng đợi triển khai cho phiên bản này.</p>';
 return '<section class="director-preview"><h2>Phương án AI Director</h2><p class="tag">'+esc(status)+' · Phiên bản '+esc(record.revision)+' · '+esc(day)+'</p><h3>'+esc(title)+'</h3>'+engine+baseline+detailed+retailHtml+(p.evidence?.retailStrategy?'':'<h4>Biện pháp đề xuất</h4><ol>'+measures.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>')+(lead?'<p><strong>Đo kết quả:</strong> vé đã thanh toán, doanh thu xác nhận và số ghế bán; không quy kết cho quảng cáo khi chưa có dữ liệu phân bổ. '+esc(n(portfolio.length))+' show trong danh sách chuẩn bị.</p>':'')+progress+'<p>Ngân sách phát sinh: 0 đ. Chưa ghi Music, chưa đăng bài, chưa gửi tin.</p><p><a class="director-jump" href="#daily-director">Xem đầy đủ phương án, phê duyệt và kết quả →</a></p></section>';
}
function renderDailyDirector(record,day,esc,{platform,csrf,approvals=[],now=new Date()}={}){
 const states={draft_ready:'Bản nháp đề xuất · chờ duyệt',needs_input:'Chờ dữ liệu / nhân sự',awaiting_approval:'Khóa thực thi bên ngoài'};
 const executionStates={queued:'Đã giao · đang chờ xử lý',draft_prepared:'Đã chuẩn bị tài liệu nội bộ',blocked:'Đang bị chặn'};
 const history=approvals.map(a=>{
  const items=a.tasks.map(t=>'<tr><td>'+esc(t.task.agent)+'</td><td>'+esc(t.task.title)+'</td><td>'+esc(executionStates[t.status]??'Chưa xác định')+'</td><td>'+esc(t.result?.content??t.result?.reason??'Chờ xử lý')+'</td></tr>').join('');
  return '<details><summary>Phương án '+esc(a.revision)+' đã duyệt · '+esc(a.plan.title)+'</summary><p>Đã phê duyệt lúc '+esc(new Date(a.approved_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+' (giờ Việt Nam). Chỉ xử lý nội bộ; 0 hành động bên ngoài.</p><div class="scroll"><table><thead><tr><th>Agent</th><th>Nhiệm vụ</th><th>Tiến độ</th><th>Kết quả / vướng mắc</th></tr></thead><tbody>'+items+'</tbody></table></div></details>';
 }).join('');
 if(!record)return '<section id="daily-director"><h2>AI Director</h2><p>Chưa có bản phân tích tự động đã lưu cho ngày '+esc(day)+'. Hệ thống tạo bản phân tích cho ngày hiện tại; không dựng lại lịch sử bằng dữ liệu hôm nay.</p>'+history+'</section>';
 const p=record.plan,approved=approvals.some(a=>a.revision===record.revision);
 const priorityLabels={urgent:'Khẩn · 0–3 ngày',high:'Ưu tiên · 4–7 ngày',prepare:'Chuẩn bị · trên 7 ngày'};
 const prior=p.evidence?.historicalShows??[],next=p.evidence?.upcomingShows??[];
 const retrospective=prior.length?'<div class="scroll"><table><thead><tr><th>Show đã qua ngày diễn</th><th>Ngày diễn</th><th>Vé trả tiền</th><th>Doanh thu xác nhận</th><th>Chi phí khai báo</th></tr></thead><tbody>'+prior.map(r=>'<tr><td>'+esc(r.artist)+'</td><td>'+esc(r.date)+'</td><td>'+esc(n(r.paidTickets))+'</td><td>'+esc(money(r.revenueVnd))+'</td><td>'+esc(r.recordedCostVnd==null?'Chưa có':money(r.recordedCostVnd))+'</td></tr>').join('')+'</tbody></table></div>':'<p>Chưa có dữ liệu show đã qua trong nguồn hiện tại.</p>';
 const portfolio=next.length?'<div class="scroll"><table><thead><tr><th>Show chưa diễn / đang diễn</th><th>Ngày</th><th>Ưu tiên</th><th>Ghế đã bán / sức chứa</th><th>Vé bán trong ngày</th><th>Phương án</th></tr></thead><tbody>'+next.map(r=>'<tr><td>'+esc(r.artist)+'</td><td>'+esc(r.date)+'</td><td>'+esc(priorityLabels[r.priority]??'Chưa xác định')+'</td><td>'+esc(r.inventory?n(r.inventory.sold)+'/'+n(r.inventory.capacity):'Chưa có')+'</td><td>'+esc(r.daily?n(r.daily.paidTickets):'Chưa có')+'</td><td>'+esc(r.policy)+'</td></tr>').join('')+'</tbody></table></div>':'<p>Chưa có show đủ dữ liệu lịch trong nguồn hiện tại.</p>';
 const lifecycle=platform?.startsWith('music')||p.evidence?.upcomingShows?'<h3>Học từ kết quả show trước</h3>'+retrospective+'<p>Show qua ngày diễn chưa đồng nghĩa đã quyết toán. Không suy diễn lợi nhuận hay hiệu quả quảng cáo.</p><h3>Kế hoạch toàn bộ show chưa diễn</h3>'+portfolio+'<p>Ưu tiên đề xuất nội dung chi tiết cho tối đa hai show gần nhất đủ điều kiện; các show còn lại vẫn có phương án chuẩn bị riêng.</p>':'';

 const canApprove=!approved&&typeof csrf==='string'&&validApproval(platform,day,record.revision,record.fingerprint,now);
 const controls=approved?'<p><strong>Phương án hiện tại đã được duyệt.</strong></p>':canApprove?
  '<form method="post" action="/daily-director/approve"><input type="hidden" name="csrf" value="'+esc(csrf)+'"><input type="hidden" name="platform" value="'+esc(platform)+'"><input type="hidden" name="day" value="'+esc(day)+'"><input type="hidden" name="revision" value="'+esc(record.revision)+'"><input type="hidden" name="fingerprint" value="'+esc(record.fingerprint)+'"><p><strong>Chờ anh phê duyệt phương án '+esc(record.revision)+'.</strong> Phê duyệt chỉ cho phép giao nhiệm vụ và chuẩn bị tài liệu nội bộ, không mở quyền ghi Music hoặc chi tiêu.</p><button>Phê duyệt phương án nội bộ</button></form>':'<p>Chưa được phê duyệt. Chỉ có thể duyệt phương án ngày hiện tại bằng tài khoản quản trị.</p>';
 return '<section id="daily-director"><h2>AI Director</h2><p>Ngày '+esc(day)+' · Phiên bản '+esc(record.revision)+' · Cập nhật '+esc(new Date(record.updated_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+' (giờ Việt Nam).</p><h3>'+esc(p.title)+'</h3><p>'+esc(p.summary)+'</p>'+controls+'<details><summary>Chi tiết phân việc và dữ liệu đối chiếu</summary>'+lifecycle+'<p>Đang thử nghiệm bộ quy tắc phân việc nội bộ. Bản nháp tạo tự động, không đồng nghĩa Agent đã chạy mô hình hoặc đã đăng bài. Không có quyền ghi Music, gửi tin hoặc chi ngân sách.</p><div class="scroll"><table><thead><tr><th>Agent</th><th>Nhiệm vụ / Đề xuất</th><th>Đầu ra dự kiến</th><th>Trạng thái đề xuất</th></tr></thead><tbody>'+p.tasks.map(t=>'<tr><td>'+esc(t.agent)+'</td><td>'+esc(t.title)+'</td><td>'+esc(t.deliverable)+'</td><td>'+esc(states[t.state]??'Chưa xác định')+'</td></tr>').join('')+'</tbody></table></div></details>'+(history?'<h3>Tiến độ phương án đã duyệt</h3>'+history:'')+'</section>';
}
module.exports={proposalPlatform,proposalPlan,proposalUrl,proposalPeriodValue,renderProposalPage,buildCampaign,renderCampaign,renderProposalPreview,musicPlan,retailPlan,initDailyDirector,savePlan,readPlan,runDailyDirector,startDailyDirector,renderDailyDirector,approvePlan,readApprovals,executeApprovedTask,executeNextApprovedTask,startApprovedWorker};

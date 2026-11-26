'use strict';
const {staffPlan:buildStaffPlan}=require('./staff-scope.cjs');
// Business proposal, not actual performance. No network, publishing or spending capability.
const shift=(day,k)=>new Date(Date.parse(day+'T00:00:00Z')+k*86400000).toISOString().slice(0,10);
const time=(day,h='22:00')=>day+'T'+h+':00+07:00';
const fmt=n=>n.toLocaleString('vi-VN');
function buildRetailStrategy(day,end,period,now=new Date()){
 const remaining=Math.max(1,Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000)+1);
 // Pilot up to three days, not an unconditional daily budget multiplied by the full month.
 const days=Math.min(remaining,3);
 const pilotEnd=shift(day,days-1),deadline=time(pilotEnd);
 const prep=time(day,'17:00'),firstDeadline=Date.parse(prep)>now.getTime()?prep:time(day);
 const dailyBudget=100000,budget=dailyBudget*days;
 const chatLow=10000,chatHigh=5000;
 const conversationsLow=Math.floor(budget/chatLow),conversationsHigh=Math.floor(budget/chatHigh);
 const ordersLow=Math.floor(conversationsLow*0.2),ordersHigh=Math.floor(conversationsHigh*0.3);
 const minContribution=ordersHigh?Math.ceil(budget/ordersHigh):null,maxContribution=ordersLow?Math.ceil(budget/ordersLow):null;
 const name='Tăng lượt khách mua tại cửa hàng 24H';
 const staff=buildStaffPlan(['complaint','assets'],firstDeadline).concat(buildStaffPlan(['finance'],deadline));
 const agents=[
  {agent:'Research',deadline:firstDeadline,action:'Đề xuất phân khúc khách gần cửa hàng có nhu cầu mua nhanh; xác minh địa bàn, nhóm hàng và nhu cầu theo khung giờ từ nguồn được cấp.',metric:'Hai nhóm khách và lý do chọn, ghi rõ giả định.'},
  {agent:'Content / Creative',deadline:firstDeadline,action:'Soạn 2 bài Facebook và 1 kịch bản video 15–20 giây: một bài tiện lợi mua nhanh, một bài nhu cầu tối/đêm; dùng ảnh thật có quyền và chỉ nêu sản phẩm, giờ mở cửa, giá sau xác minh.',metric:'2 bài nháp, 1 kịch bản và brief hình ảnh.'},
  {agent:'Social / Sale / CRM',deadline:time(day),action:'Lập lịch đăng thử 2 khung giờ trưa và tối sau duyệt; chuẩn bị kịch bản hỏi nhu cầu, giá, tồn kho, địa chỉ. Gắn mã chiến dịch nội bộ để đối chiếu hóa đơn nếu nhân sự xác nhận được.',metric:'Lịch nội dung và kịch bản tư vấn; chưa đăng hoặc gửi tin.'},
  {agent:'Ads / Auditor',deadline:firstDeadline,action:'Đề xuất chia ngân sách thử 100.000 đ/ngày thành 50.000 đ/mẫu trong tối đa '+days+' ngày. Chỉ chạy khi có quyền riêng, địa chỉ và nội dung đúng, POS đo được kết quả và tài chính xác minh biên đóng góp.',metric:'Ngưỡng dừng: hết 100.000 đ của ngày mà chưa có dữ liệu mua xác nhận hoặc chi phí/đơn vượt đóng góp đã xác minh thì không tăng chi.'},
  {agent:'Analyst / Director',deadline,action:'Đối chiếu từng ngày theo hóa đơn, loại trùng và hoàn trả. Nếu không đạt hòa vốn hoặc không đo được nguồn đơn, dừng đề xuất quảng cáo; nếu có lãi, trình phương án tiếp theo với ngân sách riêng.',metric:'Báo cáo số khách, hóa đơn, doanh thu, phần đóng góp, chi phí quảng cáo và chênh mục tiêu.'}
 ];
 const milestones=[{deadline:firstDeadline,objective:'Xong bộ nội dung, kịch bản tư vấn và kiểm tra điều kiện đo POS.'},{deadline,objective:'Đánh giá thử nghiệm: '+conversationsLow+'–'+conversationsHigh+' hội thoại đủ nhu cầu, '+ordersLow+'–'+ordersHigh+' đơn thanh toán theo kịch bản giả định.'}];
 if(pilotEnd<end)milestones.push({deadline:time(end),objective:'Chỉ trình mở rộng nếu thử nghiệm có số liệu xác nhận và đóng góp sau quảng cáo dương; chưa đặt chỉ tiêu hoặc ngân sách cho giai đoạn mở rộng.'});
 return {name,period,day,end,pilotEnd,deadline,objective:'Chuyển nhu cầu mua nhanh của khách quanh cửa hàng thành hóa đơn thanh toán tại POS; không mở bán online khi chưa có tích hợp.',audience:'Khách ở khu vực phục vụ đã được xác minh, có nhu cầu mua hàng thiết yếu hoặc mua ngoài giờ thông thường; phân khúc và nhu cầu là giả thuyết cần kiểm tra.',days,budgetVnd:budget,dailyBudgetVnd:dailyBudget,budgetAuthorizedVnd:0,conversationsLow,conversationsHigh,ordersLow,ordersHigh,minContribution,maxContribution,revenueTargetVnd:null,
  basis:'Giả định thử nghiệm: 5.000–10.000 đ/hội thoại đủ nhu cầu, 20–30% chuyển thành hóa đơn. Đây không phải số liệu 24H đã đo, không phải doanh số bảo đảm. Không nhân rộng trước khi đo thực tế.',
  revenueFormula:'Doanh thu kịch bản = số hóa đơn thanh toán × giá trị hóa đơn bình quân đã xác minh. Chưa có giá trị bình quân hoặc giá vốn, nên chưa chốt tiền doanh thu/lãi.',
  stopRule:'Không mở quảng cáo khi chưa có quyền chi, xác nhận giá vốn, tồn kho, nội dung và cách đối chiếu hóa đơn; nếu đo không được hoặc chi phí/đơn lớn hơn đóng góp mỗi đơn đã xác minh thì dừng, không tự tăng ngân sách.',
  staff,agents,milestones};
}
function renderRetailStrategy(s,esc,displayDeadline){
 if(!s)return '';
 const money=v=>fmt(v)+' đ';
 const tr=(who,d,what,kpi)=>'<tr><td>'+esc(who)+'</td><td>'+esc(displayDeadline(d))+'</td><td>'+esc(what)+'</td><td>'+esc(kpi)+'</td></tr>';
 const table=rows=>'<div class="scroll"><table><thead><tr><th>Phụ trách</th><th>Hạn</th><th>Việc cụ thể</th><th>Kết quả phải báo</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
 return '<section class="retail-strategy"><h3>'+esc(s.name)+'</h3><p><strong>Mục tiêu:</strong> '+esc(s.objective)+'</p><p><strong>Khách hàng:</strong> '+esc(s.audience)+'</p><div class="grid"><div class="tile">Ngân sách đề xuất thử nghiệm<strong>'+esc(money(s.budgetVnd))+'</strong><small>'+esc(money(s.dailyBudgetVnd))+'/ngày · tối đa '+esc(s.days)+' ngày</small></div><div class="tile">Hội thoại mục tiêu giả định<strong>'+esc(s.conversationsLow)+'–'+esc(s.conversationsHigh)+'</strong></div><div class="tile">Đơn POS mục tiêu giả định<strong>'+esc(s.ordersLow)+'–'+esc(s.ordersHigh)+'</strong></div><div class="tile">Ngân sách đã được duyệt chi<strong>0 đ</strong></div></div><p><strong>Deadline thử nghiệm:</strong> '+esc(displayDeadline(s.deadline))+'</p><p>'+esc(s.basis)+'</p><p><strong>Điều kiện hòa vốn quảng cáo:</strong> đóng góp bình quân mỗi đơn cần khoảng '+esc(money(s.minContribution))+'–'+esc(money(s.maxContribution))+' theo kịch bản (chưa gồm chi phí cố định chưa phân bổ). '+esc(s.revenueFormula)+'</p><h4>Đường lối media và marketing · AI phụ trách</h4>'+table(s.agents.map(a=>tr(a.agent,a.deadline,a.action,a.metric)))+'<h4>Nhân sự đề xuất</h4>'+table(s.staff.map(a=>tr(a.person+' · '+a.role,a.deadline,a.action,a.metric)))+'<h4>Mốc kết quả</h4><ul>'+s.milestones.map(m=>'<li>'+esc(displayDeadline(m.deadline)+' — '+m.objective)+'</li>').join('')+'</ul><p><strong>Điều kiện dừng:</strong> '+esc(s.stopRule)+'</p><p>Chỉ là phương án để chủ duyệt nội bộ. 24H chưa có API doanh thu/tồn kho FnB; chưa quảng cáo, gửi tin hay tạo đơn thật.</p></section>';
}
module.exports={buildRetailStrategy,renderRetailStrategy};

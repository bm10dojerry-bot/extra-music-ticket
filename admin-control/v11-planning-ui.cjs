'use strict';

const {randomUUID, createHash} = require('node:crypto');
const {allowed} = require('./v11-auth.cjs');
const {fieldsVn:productFields} = require('./v11-products.cjs');
const {retailFields, cameraFields, opsScope} = require('./v11-operations.cjs');
const {goalScope, pipeline} = require('./v11-director.cjs');
const {renderLiveDirector} = require('./live-director.cjs');
const {dayVN} = require('./v11-core.cjs');
const {esc, link, hidden, input, select, post, section, grid, table, tile, tabs, date, number, money, pct, shown, labelStatus,
  withQuery, textArea, details, integer, periods} = require('./v11-views.cjs');

const formButton = label => '<button type="submit">'+esc(label)+'</button>';
const localTime = value => value ? new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,16) : '';
const periodSelect = value => select('period','Kỳ phân tích',periods,value);
const hours = Array.from({length:24},(_,hour)=>[hour,String(hour).padStart(2,'0')+' giờ']);
const allHours = [[-1,'Cả ngày'],...hours];

const pickLocation = (path,location,additional = '') => '<form method="get" action="'+esc(path)+'">'+grid(
  input('location','Mã địa điểm',location,{required:true})+additional)+formButton('Mở')+'</form>';

function musicAnalysis(shows, show, data, finance) {
  const path = '/v11/analysis/music';
  const form = '<form method="get">'+select('scope','Show',shows.map(row=>[row.id,row.date+' · '+row.artist]),show?.id,true)+
    formButton('Phân tích show')+'</form>';
  const head = section('ONE CLICK MUSIC',tabs('/v11/analysis','music')+(shows.length ? form : '<p>Chưa có show từ nguồn Music.</p>'));
  if (!show || !data) return head;
  const inventory = show.inventory;
  return head+section(show.artist, '<p>'+esc(show.date+' · '+show.time+' · '+show.venue)+
    ' · Nguồn lịch và ghế Music chỉ đọc</p>'+grid(tile('Sức chứa',number(inventory?.capacity))+
    tile('Ghế bán được',number(data.remaining))+tile('Ghế đã bán theo sơ đồ',number(inventory?.sold))+
    tile('Ghế giữ',number(inventory?.held))+tile('Ghế khóa',number(inventory?.blocked))+
    tile('Vé khách mời',number(finance?.total?.complimentaryTickets))+tile('Vé đã thanh toán',number(data.paid))+
    tile('Giờ còn lại',number(data.hours))+tile('Doanh thu xác nhận',money(data.revenue))+
    tile('Chi phí đã đối soát',money(data.expense))+tile('Lãi sau giảm trừ',money(data.profit))+
    tile('Chi phí mỗi vé đã thanh toán',money(data.costPerPaidCustomer))+tile('Cần bán thêm để hòa vốn',number(data.additionalAtBreakEven))+
    tile('Tỷ lệ lấp đầy tối thiểu',pct(data.minimumCapacity))+tile('Giá thực thu bình quân gần đây',money(data.price)))+
    table(['Hạng','Giá niêm yết'],Object.entries(show.prices??{}).map(([zone,price])=>[esc(zone),money(price)]))+
    (data.constrained ? '<p role="alert">Số ghế bán được còn lại thấp hơn mức cần bán để hòa vốn theo chi phí duyệt.</p>' : '')+
    '<p>'+link('Mở báo cáo chi tiết',withQuery('/reports/music',{show:show.id}))+' · '+
      link('Sổ chi phí show',withQuery('/v11/costs/music',{scope:show.id}))+' · '+
      link('Lập mục tiêu AI Director',withQuery('/v11/director/music',{scope:show.id}))+'</p>',2)+
    section('Kịch bản bán vé',data.scenarios.length ? table(['Kịch bản','Tốc độ vé / 24 giờ','Vé thêm','Doanh thu dự kiến','Lãi dự kiến'],
      data.scenarios.map(row=>[esc(row.label),number(row.rate),number(row.extra),money(row.revenue),money(row.profit)]))+
      '<p>Dựa trên ba ngày đủ dữ liệu, đơn giá thực thu bình quân, ghế bán được và chi phí đã duyệt. Chờ đối soát ngân sách quảng cáo trước khi đề xuất tăng chi.</p>' :
      '<p>Cần số ghế xác minh, tốc độ và giá thực thu trong ba ngày gần nhất, cùng sổ chi phí đủ độ phủ trước khi dự báo.</p>',2);
}

function retailAnalysis(location, day, period, analysis, counts, products) {
  const path = '/v11/analysis/24h';
  const heading = section('ONE CLICK 24H',tabs('/v11/analysis','24h')+pickLocation(path,location,
    input('day','Ngày bắt đầu',day,{type:'date',required:true})+periodSelect(period)));
  if (!analysis) return heading;
  const a = analysis.summary;
  const peakHours = analysis.peakHours.length ? analysis.peakHours.map(row=>row.day+' · '+row.hour+' giờ').join(', ') : '';
  return heading+section('Kinh doanh tại '+location,
    '<p>'+esc(analysis.range.start+' – '+analysis.range.end)+' · '+(analysis.complete ? 'Đã có báo cáo cho từng ngày' : 'Độ phủ chưa đủ để cộng toàn kỳ')+'</p>'+
    grid(tile('Doanh thu thuần',money(a.netRevenueVnd))+tile('Hóa đơn',number(a.orders))+tile('Khách phục vụ',number(a.customers))+
      tile('Hóa đơn bình quân',money(a.avgOrderVnd))+tile('Lợi nhuận kỳ',money(a.profitVnd))+
      tile('Doanh thu hòa vốn trong kỳ',money(a.breakEvenRevenueVnd))+tile('Tỷ lệ dùng ghế',pct(a.utilization))+
      tile('Thời gian chờ trung bình (giây)',number(a.avgWaitSeconds))+tile('Khung giờ đông khách đã ghi nhận',shown(peakHours)))+
    '<p>'+link('Nhập đối soát vận hành',withQuery('/v11/operations',{location,day}))+' · '+
    link('Lập mục tiêu AI Director',withQuery('/v11/director/24h',{location}))+'</p>',2)+
    section('Hiệu quả từng giờ',table(['Ngày','Giờ','Doanh thu','Lợi nhuận','Khách','Nhân sự','Hóa đơn / người','Sử dụng ghế','Nguồn'],
      analysis.hourly.slice(0,160).map(row=>[esc(row.day),number(row.hour),money(row.stats.netRevenueVnd),money(row.stats.profitVnd),
        number(row.stats.customers),number(row.fields.headcount),number(row.ordersPerStaff),pct(row.stats.utilization),esc(row.source)])),2)+
    section('Nhu cầu ngày tham chiếu và phân ca',
      (analysis.forecast ? '<p>Căn cứ '+esc(analysis.forecast.from+' – '+analysis.forecast.to)+
        ' · Số liệu của bảy ngày trước mốc chọn.</p>'+table(['Kịch bản','Hóa đơn / ngày','Khách / ngày'],
        analysis.forecast.scenarios.map(row=>[esc(row.label),number(row.orders),number(row.customers)])) :
        '<p>Cần đủ số khách và hóa đơn của bảy ngày trước mốc chọn.</p>')+
      (analysis.staffing.length ? table(['Ngày','Giờ','Mẫu so sánh','Đề xuất'],analysis.staffing.slice(-30).map(row=>
        [esc(row.day),number(row.hour),number(row.samples),esc(row.recommendation)])) :
        '<p>Cần số lượt phục vụ, nhân sự và thời gian chờ ở các ca tương đương để điều chỉnh ca.</p>'),2)+
    (products ? section('Sản phẩm và nhập hàng',productTable(products,false)+
      '<p>Số nhập tham chiếu dùng bảy ngày bán trước đó, giá trị tồn cùng đơn vị và thời gian chờ. Xem '+link('đối soát sản phẩm',withQuery('/v11/operations',{location,day}))+
      ' để cập nhật căn cứ.</p>',2) : '')+
    section('Lưu lượng vỉa hè',counts ? table(['Ngày','Giờ','Lượt qua','Mật độ cao nhất','Độ tin cậy','Nguồn'],counts.slice(0,160).map(row=>[
      esc(row.day),number(row.hour),number(row.fields.passers),number(row.fields.peakPeople),
      pct(row.fields.confidenceBps == null?null:row.fields.confidenceBps/10000),esc(row.source)]))+
      '<p>Dùng nguồn này để đánh giá lưu lượng trước cửa. Đề xuất phân ca cần số khách và khối lượng phục vụ của cửa hàng.</p>' :
      '<p>Chưa có số liệu camera được cấp cho địa điểm này.</p>',2);
}

function operationsPage(actor, location, day, analysis, counts, rule, alerts, selectedHour, products, activeProduct) {
  const path = '/v11/operations';
  const head = section('Vận hành 24H',pickLocation(path,location,
    input('day','Ngày',day,{type:'date',required:true})+select('hour','Khung giờ',allHours,selectedHour)));
  if (!analysis) return head;
  const selected = analysis.rows.find(row=>row.hour===selectedHour);
  const scope = opsScope(location);
  const fields = Object.entries(retailFields).map(([name,label])=>integer(name,label,selected?.fields[name])).join('');
  const shopForm = allowed(actor,'operations.write',scope) ? post(path+'/observation',actor,
    hidden('location',location)+hidden('day',day)+hidden('hour',selectedHour)+hidden('revision',selected?.revision ?? 0)+grid(
      fields+input('source','Nguồn đối soát',selected?.source,{required:true})),'Lưu đối soát') : '';
  const observed = table(['Khung giờ','Doanh thu','Hóa đơn','Khách','Chứng từ','Cập nhật'],analysis.rows.map(row=>[
    link(row.hour === -1?'Cả ngày':String(row.hour).padStart(2,'0')+' giờ',withQuery(path,{location,day,hour:row.hour})),
    money(row.fields.netRevenueVnd),number(row.fields.orders),number(row.fields.customers),esc(row.source),date(row.updated_at)]));
  let camera = '';
  if (counts) {
    const sideScope = opsScope('sidewalk');
    const canWrite = allowed(actor,'operations.write',sideScope);
    const canApprove = allowed(actor,'operations.approve',sideScope);
    const h = Math.max(0,selectedHour);
    const existing = counts.find(row=>row.hour===h);
    const settings = rule?.settings;
    camera = section('Thống kê vỉa hè', table(['Giờ','Lượt qua','Mật độ','Phút tập trung','Tin cậy','Nguồn'],counts.map(row=>[
      link(String(row.hour).padStart(2,'0')+' giờ',withQuery(path,{location,day,hour:row.hour})),number(row.fields.passers),
      number(row.fields.peakPeople),number(row.fields.crowdMinutes),pct(row.fields.confidenceBps == null ? null : row.fields.confidenceBps/10000),
      esc(row.source)]))+(canWrite ? details('Ghi thống kê ẩn danh · '+h+' giờ',post(path+'/counts',actor,
      hidden('day',day)+hidden('hour',h)+hidden('revision',existing?.revision ?? 0)+grid(Object.entries(cameraFields).map(([name,label])=>
        integer(name,label,existing?.fields[name])).join('')+input('source','Nguồn số đếm',existing?.source,{required:true})),'Lưu thống kê')) : '')+
      (canApprove ? details('Ngưỡng cảnh báo tập trung',post(path+'/rule',actor,hidden('revision',rule?.revision ?? 0)+grid(
        integer('people','Ngưỡng người',settings?.people,true)+integer('minutes','Phút tập trung',settings?.minutes,true)+
        integer('from','Giờ bắt đầu',settings?.from,true)+integer('to','Giờ kết thúc',settings?.to,true)+
        integer('cooldown','Phút tối thiểu giữa cảnh báo',settings?.cooldown,true)+
        input('exceptions','Giờ nghỉ hoặc hoạt động đã duyệt (cách nhau bằng dấu phẩy)',settings?.exceptions.join(','))),
      'Lưu ngưỡng')) : '')+'<p>Cảnh báo dựa trên số đếm nhập theo giờ. Quản lý xác minh ngữ cảnh trước khi kết luận.</p>'+
      table(['Giờ ghi nhận','Khu vực','Số người','Số phút','Tin cậy','Xử lý'],alerts.map(row=>[
        date(row.detected_at),esc(row.details.zone),number(row.details.people),number(row.details.minutes),
        pct(row.details.confidenceBps/10000),row.reviewed_at ? date(row.reviewed_at) :
          canApprove ? post(path+'/review',actor,hidden('alert',row.id),'Đã kiểm tra') : 'Chờ xác minh'])),2);
  }
  return head+section('Đối soát · '+location,observed+shopForm,2)+camera+
    (products ? section('Sản phẩm, giá vốn và tồn kho',productTable(products,true,location,day)+
      (allowed(actor,'operations.write',opsScope(location,'products')) ? details(activeProduct ? 'Cập nhật '+activeProduct.name : 'Ghi sản phẩm',
        productForm(actor,location,day,activeProduct)) : ''),2) : '');
}

function productTable(products, editable, location, day) {
  return table(['Mã','Sản phẩm','Số phần bán','Doanh thu thuần','Giá vốn / phần','Lãi gộp','Tồn cuối ngày','Hao hụt','Nhập tham chiếu','Chứng từ'],
    products.map(row=>[editable?link(row.code,withQuery('/v11/operations',{location,day,product:row.code})) : esc(row.code),esc(row.name),
      number(row.sold),money(row.revenue),money(row.unitCost),money(row.margin),number(row.stock),number(row.waste),number(row.restock),esc(row.source)]));
}

function productForm(actor, location, day, product) {
  const row=product?.editable;
  return post('/v11/operations/product',actor,hidden('location',location)+hidden('day',day)+hidden('revision',row?.revision ?? 0)+
    grid(input('code','Mã sản phẩm',row?.code,{required:true,attrs:row?'readonly':''})+input('name','Tên sản phẩm',row?.name,{required:true})+
      Object.entries(productFields).map(([key,label])=>integer(key,label,row?.fields[key])).join('')+
      input('recipe','Định mức / công thức tham chiếu',row?.fields.recipe)+input('source','Chứng từ sản phẩm',row?.source,{required:true})), 'Lưu số liệu sản phẩm');
}

function attendancePage(actor, location, rows, staff, selected) {
  const path = '/v11/attendance';
  const head = section('Chấm công',pickLocation(path,location));
  if (!rows) return head;
  const toMinutes = duration => duration != null ? number(Math.round(duration/60000))+' phút' : 'Chưa có dữ liệu';
  const scope = opsScope(location,'attendance');
  const canWrite = allowed(actor,'operations.write',scope);
  const approvals = allowed(actor,'operations.approve',scope);
  const pageRows = rows.map(row=>[esc(row.display_name),date(row.starts_at),date(row.ends_at),date(row.arrived_at),date(row.left_at),
    toMinutes(row.left_at && row.arrived_at ? row.left_at-row.arrived_at : null),
    toMinutes(row.arrived_at ? Math.max(0,row.arrived_at-row.starts_at) : null),
    toMinutes(row.left_at ? Math.max(0,row.ends_at-row.left_at) : null),
    toMinutes(row.arrived_at && row.left_at ? Math.max(0,(row.ends_at-row.starts_at)-(row.left_at-row.arrived_at)) : null),
    labelStatus(row.state),canWrite ? link('Mở ca',withQuery(path,{location,id:row.id})) : '—']);
  const options = staff.map(user=>[user.id,user.display_name+' ('+user.username+')']);
  const form = canWrite && options.length ? post(path+'/shift',actor,hidden('location',location)+hidden('id',selected?.id ?? randomUUID())+
    hidden('revision',selected?.revision ?? 0)+grid(select('staff','Nhân sự',options,selected?.staff_id,true)+
      [['starts','Bắt đầu ca','starts_at'],['ends','Kết thúc ca','ends_at'],['arrived','Giờ vào','arrived_at'],['left','Giờ ra','left_at']]
        .map(([key,name,field])=>input(key,name,localTime(selected?.[field]),{type:'datetime-local',required:['starts','ends'].includes(key)})).join('')+
      (approvals ? select('state','Xác nhận',[['pending','Chờ xác nhận'],['confirmed','Đã xác nhận']],selected?.state) : '')+
      input('note','Lý do khi sửa ca đã xác nhận',selected?.note)),'Lưu ca') : '';
  return head+section('Phân ca và chấm công thủ công',table(
    ['Nhân sự','Bắt đầu','Kết thúc','Vào','Ra','Giờ công','Muộn','Về sớm','Thiếu giờ','Trạng thái','Thao tác'],pageRows)+form,2);
}

const stepLabels = {collect:'Thu thập dữ liệu',verify:'Xác minh nguồn',coverage:'Kiểm tra độ đầy đủ',economics:'Tính chi phí và hòa vốn',
  DirectorBrief:'Director giao việc',Auditor:'Kiểm toán độc lập',DirectorFinal:'Director tổng hợp'};
const speech = `document.querySelector('[data-v11-speech]')?.addEventListener('click',()=> {
  const output=document.querySelector('#v11-speech-status');
  const runtime=window.speechSynthesis;
  const voice=runtime?.getVoices().find(item=>item.localService&&/^vi(-|$)/i.test(item.lang));
  if(!voice){output.textContent='Thiết bị chưa có giọng tiếng Việt cục bộ.';return;}
  runtime.cancel();
  const utterance=new SpeechSynthesisUtterance(document.querySelector('#v11-spoken-report').textContent);
  utterance.voice=voice;
  utterance.lang='vi-VN';
  utterance.onend=()=>{output.textContent='Đã đọc xong.'};
  runtime.speak(utterance);
  output.textContent='Đang đọc…';
});`;
const speechHash = createHash('sha256').update(speech).digest('base64');

function directorPage(actor, platform, scopeKey, view, shows) {
  const route = '/v11/director/'+platform;
  const choose = platform==='music' ?
    '<form method="get">'+select('scope','Show',shows.map(item=>[item.id,item.artist+' · '+item.date]),scopeKey,true)+formButton('Mở')+'</form>' :
    pickLocation(route,scopeKey);
  const heading = section('Mục tiêu AI Director',tabs('/v11/director',platform)+choose);
  if (!view) return heading;
  const scope = goalScope(platform,scopeKey);
  const field = platform==='music' ? 'scope' : 'location';
  const query = {[field]:scopeKey};
  const writable = allowed(actor,'director.write',scope);
  const owner = allowed(actor,'director.approve',scope);
  const add = writable ? post(route+'/submit',actor,hidden(field,scopeKey)+hidden('request',randomUUID())+periodSelect('day')+
    textArea('objective','Mục tiêu kinh doanh','',true),'Giao mục tiêu') : '';
  let output = '';
  if (view.goal) {
    const g = view.goal;
    const review = g.results.DirectorFinal?.output;
    const stepRows = pipeline.flatMap(step=>{
      const attempts = view.steps.filter(row=>row.step===step);
      return attempts.length ? attempts.map(row=>[esc(stepLabels[step]??step),number(row.attempt),labelStatus(row.state),
        date(row.started_at),date(row.finished_at),shown(row.reason)]) : [[esc(stepLabels[step]??step),'—','Đang chờ','—','—','—']];
    });
    const goalData = hidden(field,scopeKey)+hidden('goal',g.id);
    const approve = owner && g.status==='ready' ? post(route+'/decide',actor,goalData+
      select('decision','Quyết định',[['approved','Phê duyệt nội bộ'],['rejected','Từ chối']])+
      textArea('note','Lý do quyết định','',true),'Lưu quyết định') : '';
    const revision = owner && review && ['ready','approved','rejected'].includes(g.status) ? details('Yêu cầu chỉnh một phần',
      post(route+'/revise',actor,goalData+hidden('request',randomUUID())+
      select('section','Phạm vi sửa',[['staffing','Phân công'],['strategy','Tổng hợp chiến lược']])+
      textArea('note','Yêu cầu sửa','',true),'Tạo phiên bản')) : '';
    const retry = writable && g.status==='blocked' ? post(route+'/retry',actor,goalData,'Chạy lại bước bị chặn') : '';
    const talk = review ? [review.title,review.summary,review.decision,...review.campaigns.flatMap(c=>[c.title,c.rationale,c.target,c.deadline,c.stopRule,
      ...c.actions.map(a=>a.agent+' '+a.action+' '+a.metric),...c.staff.map(a=>a.staffId+' '+a.action+' '+a.metric)]),...review.blockers].join('. ') : '';
    const report = review ? renderLiveDirector({...g,status:'ready',day:g.facts.day},esc)+
      '<div id="v11-spoken-report" hidden>'+esc(talk)+'</div><button type="button" data-v11-speech>Nghe báo cáo</button>'+
      '<p id="v11-speech-status" role="status"></p><script>'+speech+'</script>' : '';
    const tasks = view.tasks.length ? section('Theo dõi công việc đã duyệt',table(['Phương án','Phụ trách','Công việc','KPI','Hạn','Trạng thái','Cập nhật'],
      view.tasks.map(task=>{
        const a = task.assignment;
        const next = {pending:'in_progress',in_progress:'submitted',submitted:'accepted'}[task.status];
        const control = writable && next && (next!=='accepted' || owner) ? post(route+'/task',actor,goalData+
          hidden('task',task.id)+hidden('revision',task.revision)+hidden('state',next)+input('note','Ghi chú','',{required:next!=='in_progress'}),
        ({in_progress:'Bắt đầu',submitted:'Nộp báo cáo',accepted:'Nghiệm thu'})[next]) : shown(task.note);
        return [esc(a.title),esc(a.agent??a.staffId),esc(a.action),esc(a.metric),esc(a.deadline),labelStatus(task.status),control];
      })),2) : '';
    output = section('Mục tiêu · Phiên bản '+g.version,'<p>'+esc(g.objective)+'</p><p>'+labelStatus(g.status)+' · '+shown(g.reason)+
      '</p>'+retry+details('Tiến độ từng bước',table(['Bước','Lần','Trạng thái','Bắt đầu','Kết thúc','Lý do'],stepRows))+
      (g.facts?.missing?.length ? details('Căn cứ còn thiếu','<ul>'+g.facts.missing.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>') : '')+
      report+approve+revision,2)+tasks;
  }
  const rows = view.goals.map(goal=>[link(goal.objective,withQuery(route,{...query,goal:goal.id})),number(goal.version),
    labelStatus(goal.status),date(goal.created_at)]);
  return heading+section('Lịch sử mục tiêu',add+table(['Mục tiêu','Phiên bản','Trạng thái','Tạo lúc'],rows),2)+output;
}

module.exports = {musicAnalysis, retailAnalysis, operationsPage, attendancePage, directorPage, speechHash};

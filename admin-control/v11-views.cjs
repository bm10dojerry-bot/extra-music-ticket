'use strict';

const {randomUUID,createHash} = require('node:crypto');
const {permissions, scopes, allowed} = require('./v11-auth.cjs');
const {classifications} = require('./v11-costs.cjs');
const {actions, adScope, budgetLayers} = require('./v11-ads.cjs');
const {cameraId, cameraScope} = require('./v11-imou.cjs');
const {dayVN} = require('./v11-core.cjs');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const shown = value => value === null || value === undefined || value === '' ? 'Chưa có dữ liệu' : esc(value);
const number = value => value == null ? 'Chưa có dữ liệu' : Number(value).toLocaleString('vi-VN',{maximumFractionDigits:2});
const money = value => value == null ? 'Chưa có dữ liệu' : number(value)+' đ';
const date = value => value ? new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}) : 'Chưa cập nhật';
const pct = value => value == null ? 'Chưa có dữ liệu' : number(value*100)+'%';
const basics = ['music','24h'];
const platformLabel = value => value === 'music' ? 'Music' : '24H';
const statusLabels = {
  pending:'Chờ duyệt', approved:'Đã duyệt', rejected:'Từ chối', simulated:'Đã diễn tập', expired:'Hết hạn',
  queued:'Đang chờ', running:'Đang chạy', ready:'Sẵn sàng duyệt', blocked:'Cần xử lý', succeeded:'Hoàn tất',
  accepted:'Đã nghiệm thu', submitted:'Đã nộp báo cáo', in_progress:'Đang làm', confirmed:'Đã xác nhận',
  MISSING:'Thiếu dữ liệu', UNAVAILABLE:'Nguồn lỗi', AVAILABLE:'Đã kết nối', PARTIAL:'Có một phần dữ liệu',
  online:'Online', offline:'Offline', unknown:'Chưa xác minh', sleep:'Tạm ngủ', upgrading:'Đang cập nhật'
};
const labelStatus = value => statusLabels[value] ?? shown(value);
const layerNames = {business:'Doanh nghiệp',account:'Tài khoản',show:'Show / đơn vị 24H',campaign:'Chiến dịch',adset:'Nhóm quảng cáo',day:'Ngày',term:'Thời hạn chiến dịch'};
const costAmounts = {
  unitPriceVnd:'Đơn giá', plannedVnd:'Dự kiến', plannedTaxVnd:'Thuế dự kiến', approvedVnd:'Đã duyệt',
  approvedTaxVnd:'Thuế đã duyệt', actualVnd:'Thực tế', actualTaxVnd:'Thuế thực tế', contractVnd:'Giá trị hợp đồng',
  depositVnd:'Đã đặt cọc', paidVnd:'Tổng đã thanh toán, gồm đặt cọc'
};
const classificationLabels = {behavior:'Biến động',relation:'Quy chi phí',taxTreatment:'Cách nhập thuế',booking:'Hạch toán'};
const choices = {fixed:'Cố định',variable:'Biến đổi',direct:'Trực tiếp',indirect:'Gián tiếp',allocated:'Phân bổ',
  included:'Giá đã gồm thuế',excluded:'Cộng thuế riêng',expense:'Chi phí kế toán',revenue_deduction:'Giảm trừ doanh thu',
  cash_only:'Dòng tiền thanh toán',shared_pool:'Khoản dùng chung chờ phân bổ'};
const periods = [['day','Ngày'],['week','Tuần'],['month','Tháng']];
const errorText = {
  FORBIDDEN:'Tài khoản chưa được cấp quyền cho phạm vi này.',
  STALE_REVISION:'Dữ liệu đã thay đổi. Tải lại trang để xem phiên bản mới.',
  DUPLICATE:'Mã hoặc chứng từ đã được ghi nhận.',
  USERNAME_EXISTS:'Tên tài khoản đã được sử dụng.',
  INVITE_INVALID:'Mã kích hoạt sai, đã dùng hoặc hết hạn.',
  EMERGENCY_STOP:'Nút dừng khẩn cấp đang bật.',
  BUDGET_DAY_CHANGED:'Ngày ngân sách đã đổi. Cần lập lại đề xuất.',
  OUTSIDE_CAMPAIGN:'Ngày hiện tại nằm ngoài thời hạn chiến dịch.',
  DONOR_NOT_VERIFIED:'Chưa có ngân sách nguồn phù hợp để điều chuyển.',
  DONOR_BUDGET_EXCEEDED:'Số điều chuyển vượt phần còn lại của nhóm nguồn.',
  IMOU_NOT_CONFIGURED:'Chưa có cấu hình đầy đủ cho camera vỉa hè.',
  IMOU_TERMS_UNVERIFIED:'Cần xác nhận hạn mức và chi phí của tài khoản Imou.',
  IMOU_MEDIA_HOST_UNVERIFIED:'Chưa xác nhận máy chủ cung cấp ảnh hoặc luồng.',
  IMOU_DAILY_LIMIT:'Đã đạt giới hạn camera trong ngày.',
  IMOU_SNAPSHOT_INTERVAL:'Chưa đến thời gian chụp ảnh tiếp theo.',
  IMOU_LIVE_NOT_PROVISIONED:'Imou chưa trả luồng HTTPS đang hoạt động cho kênh này.',
  GOAL_NOT_READY:'Phương án chưa đủ điều kiện phê duyệt.',
  ALLOCATION_EXCEEDS_SOURCE:'Phần phân bổ vượt số đã ghi nhận ở khoản gốc.'
};
function requestError(code, path) {
  const prefixes = {SPEND_UNVERIFIED:'Chi tiêu chưa được xác minh ở lớp',LIMIT_MISSING:'Chưa có hạn mức ở lớp',
    LIMIT_EXCEEDED:'Vượt hạn mức ở lớp'};
  let message = errorText[code];
  if (!message) {
    const layer = Object.entries(layerNames).find(([id]) => code?.endsWith('_'+id));
    const prefix = Object.keys(prefixes).find(id => code?.startsWith(id+'_'));
    if (prefix && layer) message = prefixes[prefix]+' '+layer[1]+'.';
  }
  return section('Yêu cầu cần kiểm tra','<p role="alert">'+esc(message ?? 'Hệ thống chưa xử lý được yêu cầu này.')+
    '</p><p><small>'+esc(code)+'</small></p><a href="'+esc(path)+'">Quay lại</a>');
}

function link(label, path) {
  return '<a href="'+esc(path)+'">'+esc(label)+'</a>';
}
function input(name, label, value = '', {type = 'text', required = false, attrs = ''} = {}) {
  return '<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'"'+
    (required ? ' required' : '')+(attrs ? ' '+attrs : '')+'></label>';
}
const integer = (name,label,value,required=false) => input(name,label,value,{type:'number',required,attrs:'min="0" step="1"'});
const hidden = (name,value) => '<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
const csrf = actor => hidden('csrf',actor.csrf);
const button = (label, attrs = '') => '<button type="submit"'+(attrs ? ' '+attrs : '')+'>'+esc(label)+'</button>';
const grid = html => '<div class="grid">'+html+'</div>';
const tile = (label,value,details = '') => '<div class="tile">'+esc(label)+'<strong>'+value+'</strong>'+
  (details ? '<small>'+esc(details)+'</small>' : '')+'</div>';
const section = (title,html, level = 1) => '<section><h'+level+'>'+esc(title)+'</h'+level+'>'+html+'</section>';
const details = (label,html) => '<details><summary>'+esc(label)+'</summary>'+html+'</details>';
const textArea = (name,label,value='',required=false) => '<label>'+esc(label)+'<textarea name="'+esc(name)+'" maxlength="3000"'+
  (required ? ' required' : '')+'>'+esc(value)+'</textarea></label>';
const post = (path,actor,html,label) => '<form method="post" action="'+esc(path)+'">'+csrf(actor)+html+button(label)+'</form>';
const select = (name,label,options,value = '',required = false) => '<label>'+esc(label)+'<select aria-label="'+esc(label)+'" name="'+esc(name)+'"'+
  (required ? ' required' : '')+'>'+options.map(([key,title])=>'<option value="'+esc(key)+'"'+
  (String(key)===String(value) ? ' selected' : '')+'>'+esc(title)+'</option>').join('')+'</select></label>';
const asChoices = (values, formatter = value => value) => values.map(value => [value,formatter(value)]);
const table = (columns, rows) => '<div class="scroll"><table><thead><tr>'+columns.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
  '</tr></thead><tbody>'+(rows.length ? rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('') :
  '<tr><td colspan="'+columns.length+'">Chưa có dữ liệu</td></tr>')+'</tbody></table></div>';
const withQuery = (path,params) => path+'?'+new URLSearchParams(params);
const tabs = (path,platform) => '<nav class="platform-tabs" aria-label="Lĩnh vực">'+basics.map(item=>
  '<a href="'+esc(path+'/'+item)+'"'+(platform===item ? ' aria-current="page"' : '')+'>'+platformLabel(item)+'</a>').join('')+'</nav>';

const modules = [
  ['/v11/analysis/music','Phân tích Music','analysis.read','music'],
  ['/v11/analysis/24h','Phân tích 24H','analysis.read','24h'],
  ['/v11/director/music','Mục tiêu AI Director','director.read'],
  ['/v11/costs/music','Input Cost Center','cost.read'],
  ['/v11/ads/music','AI Ads Manager','ads.read'],
  ['/v11/camera','Camera Management','camera.read','24h'],
  ['/v11/operations','Vận hành 24H','operations.read','24h'],
  ['/v11/attendance','Chấm công','operations.read','24h'],
  ['/v11/sources','Nguồn dữ liệu','source.read'],
  ['/v11/auditor','AI Auditor','audit.read'],
  ['/v11/memory/music','Trí nhớ doanh nghiệp','audit.read'],
  ['/v11/audit','Nhật ký hệ thống','audit.read'],
  ['/v11/access','Tài khoản và phân quyền','access.manage']
];

function visibleModules(actor) {
  if (!actor) return [];
  return modules.flatMap(([path,title,permission,platform]) => {
    const grants = actor.grants.filter(g => g.permission === permission && (!platform || !g.scope.platform || g.scope.platform === platform));
    if (actor.role !== 'OWNER' && !grants.length) return [];
    const grant = grants[0]?.scope;
    let href = path;
    if (!platform && grant?.platform === '24h') href = href.replace(/\/music$/,'/24h');
    const params = {};
    if (grant?.show && !href.startsWith('/v11/ads')) params.scope = grant.show;
    if (grant?.location && !href.startsWith('/v11/camera')) params.location = grant.location;
    if (Object.keys(params).length) href = withQuery(href,params);
    return [{path:href,title}];
  });
}

function home(actor) {
  const entries = visibleModules(actor);
  return section('EXTRA OS V1.1',grid(entries.map(({path,title})=>tile(title,link('Mở',path))).join(''))+
    (!entries.length ? '<p>Chưa có quyền truy cập module.</p>' : ''));
}

function accessView(actor, users, grants, invitation) {
  const rows = users.map(user => [esc(user.display_name),esc(user.username),esc(user.role),user.active ?
    (user.active_password ? 'Đã kích hoạt' : 'Chờ kích hoạt') : 'Vô hiệu hóa',
    esc(grants.filter(grant=>grant.user_id===user.id).map(grant=>grant.permission+' '+JSON.stringify(grant.scope)).join(' · '))]);
  const userChoices = users.filter(user => user.role!=='OWNER' && user.active).map(user => [user.id,user.display_name+' ('+user.username+')']);
  return section('Tài khoản và phân quyền',
    (invitation ? '<section><h2>Mã kích hoạt dùng một lần</h2>'+input('invitation','Mã kích hoạt',invitation,{attrs:'readonly'})+
      '<p>Nhân sự dùng mã trong vòng 24 giờ tại '+link('Kích hoạt tài khoản','/v11/activate')+'.</p></section>' : '')+
    table(['Nhân sự','Tên đăng nhập','Vai trò','Trạng thái','Quyền'],rows)+
    details('Mời nhân sự',post('/v11/access/invite',actor,
      grid(input('username','Tên đăng nhập','',{required:true,attrs:'pattern="[a-z][a-z0-9_.-]{2,39}"'})+
        input('displayName','Họ tên','',{required:true})+select('role','Vai trò',asChoices(Object.keys(permissions)),'ADS_MANAGER',true)),
      'Tạo mã kích hoạt'))+(userChoices.length ? details('Cấp hoặc thu hồi quyền',post('/v11/access/grant',actor,
      grid(select('userId','Nhân sự',userChoices,'',true)+select('permission','Quyền',asChoices([...new Set(Object.values(permissions).flat())]),'',true)+
      scopes.map(key=>key==='platform' ? select(key,'Lĩnh vực',[['','Mọi lĩnh vực'],...asChoices(basics,platformLabel)]) :
        input(key,({account:'Tài khoản Ads',location:'Địa điểm',show:'Show',camera:'Camera',dataGroup:'Nhóm dữ liệu'})[key])).join('')+
      select('operation','Thao tác',[['grant','Cấp'],['revoke','Thu hồi']])),'Lưu quyền'))+
    details('Vô hiệu hóa tài khoản',post('/v11/access/disable',actor,select('userId','Tài khoản',userChoices,'',true),'Vô hiệu hóa')) : ''));
}

function activateView() {
  return section('Kích hoạt tài khoản', '<form method="post" action="/v11/activate">'+
    input('code','Mã kích hoạt','',{type:'password',required:true,attrs:'autocomplete="one-time-code" minlength="64" maxlength="64"'})+
    input('password','Mật khẩu mới','',{type:'password',required:true,attrs:'autocomplete="new-password" minlength="16" maxlength="256"'})+
    button('Kích hoạt')+'</form><p>'+link('Đăng nhập','/')+'</p>');
}

function costForm(actor, path, platform, scopeKey, ledger, row) {
  const d = row?.details ?? {};
  const status = allowed(actor,'cost.approve',{platform,...(platform==='music' && scopeKey!=='shared' ? {show:scopeKey} : {}),dataGroup:'finance'});
  return post(path+'/save',actor,hidden('scope',scopeKey)+hidden('id',row?.id ?? randomUUID())+hidden('revision',row?.revision ?? 0)+grid(
    input('code','Mã chi phí',row?.code,{required:true})+
    input('sourceLine','Mã dòng chứng từ duy nhất',row?.source_line,{required:true,attrs:row ? 'readonly' : ''})+
    select('classification','Nhóm / loại chi phí',ledger.categories.map(c=>[c.category+' / '+c.cost_type,c.category+' / '+c.cost_type]),
      row ? row.category+' / '+row.cost_type : '',true)+
    select('supplier','Nhà cung cấp',[['','Chưa có dữ liệu'],...ledger.suppliers.map(s=>[s.id,s.name])],row?.supplier_id)+
    select('quote','Đơn giá tham chiếu',[['','Không chọn'],...ledger.quotes.map(q=>[q.id,q.name+' · '+q.cost_type+' · '+money(q.unit_price_vnd)+' · '+q.as_of])],
      d.referenceQuote?.id)+
    select('allocation','Khoản gốc để phân bổ',[['','Không chọn'],...ledger.sources.map(source=>[source.id,source.code]),
      ...(row?.allocation_of && !ledger.sources.some(source=>source.id===row.allocation_of) ? [[row.allocation_of,row.allocation_of]] : [])],row?.allocation_of)+
    Object.entries(classifications).map(([key,values])=>select(key,classificationLabels[key],asChoices(key==='booking' ?
      (scopeKey==='shared' ? ['shared_pool'] : values.filter(value=>value!=='shared_pool')) : values,value=>choices[value]),d[key],true)).join('')+
    input('quantity','Số lượng',d.quantity,{attrs:'inputmode="decimal"'})+input('unit','Đơn vị tính',d.unit)+
    Object.entries(costAmounts).map(([key,label])=>integer(key,label,key==='unitPriceVnd' && d.unitPriceBasis==='reference' ? null : d[key])).join('')+
    input('due','Hạn thanh toán',d.due,{type:'date'})+input('owner','Người phụ trách',d.owner)+
    input('contractDoc','Hợp đồng',d.contractDoc)+input('invoice','Hóa đơn',d.invoice)+input('evidence','Chứng từ',d.evidence)+
    input('source','Nguồn dữ liệu',d.source,{required:true})+
    (status ? select('status','Phê duyệt',asChoices(['pending','approved','rejected'],labelStatus),row?.status) : '')
  ),row ? 'Lưu phiên bản mới' : 'Ghi khoản chi');
}

function costView(actor, platform, scopeKey, ledger, options, history) {
  const path = '/v11/costs/'+platform;
  const selector = '<form method="get">'+input('scope',platform==='music' ? 'Mã show hoặc shared' : 'Ngày kinh doanh hoặc shared',scopeKey,
    {required:true,attrs:options.length ? 'list="v11-cost-shows"' : ''})+
    (options.length ? '<datalist id="v11-cost-shows">'+options.map(show=>'<option value="'+esc(show.id)+'">'+esc(show.artist)+'</option>').join('')+'</datalist>' : '')+
    button('Mở sổ chi phí')+'</form>';
  const heading = section('Input Cost Center',tabs('/v11/costs',platform)+selector);
  if (!ledger) return heading;
  const scoped = {platform,...(platform==='music' && scopeKey!=='shared' ? {show:scopeKey} : {}),dataGroup:'finance'};
  const write = allowed(actor,'cost.write',scoped);
  const variants = [['planned','Dự kiến'],['approved','Đã duyệt'],['actual','Thực tế']];
  const rows = ledger.costs.map(row=>[esc(row.code),esc(row.category+' / '+row.cost_type),labelStatus(row.status),
    money(row.details.plannedVnd),money(row.details.approvedVnd),money(row.details.actualVnd),money(row.details.remainingVnd),
    date(row.updated_at),link('Lịch sử',withQuery(path,{scope:scopeKey,history:row.id})),write ? details('Chỉnh sửa',costForm(actor,path,platform,scopeKey,ledger,row)) : '—']);
  const cards = grid(variants.map(([key,label])=>{
    const {expense,revenueDeduction} = ledger.totals[key];
    return tile(label,money(expense.total),expense.missing+' khoản thiếu số tiền · Đã ghi '+money(expense.known)+
      ' · Giảm trừ '+money(revenueDeduction.total));
  }).join(''));
  const approval = scopeKey !== 'shared' && allowed(actor,'cost.approve',scoped) ? details('Xác nhận độ đầy đủ của sổ',
    post(path+'/attest',actor,hidden('scope',scopeKey)+select('basis','Mốc đối soát',variants)+
      input('source','Mã bảng đối soát hoặc chứng từ','',{required:true}),'Xác nhận đủ dữ liệu')) : '';
  const library = table(['Nhà cung cấp','Khoản','Đơn vị','Đơn giá tham chiếu','Ngày','Nguồn'],
    ledger.quotes.map(quote=>[esc(quote.name),esc(quote.cost_type),esc(quote.unit),money(quote.unit_price_vnd),esc(quote.as_of),esc(quote.source)]));
  const canManage = allowed(actor,'cost.write',{platform,dataGroup:'finance'});
  return heading+section('Chi phí · '+scopeKey,
    cards+'<p>Ô trống biểu thị khoản chưa xác định. Tổng chỉ hiện khi sổ đã đối soát. Khoản giảm trừ, dòng tiền và chi phí kế toán được đối chiếu riêng.</p>'+
    (write ? details('Thêm khoản chi',costForm(actor,path,platform,scopeKey,ledger,null)) : '')+
    approval+table(['Mã','Loại','Trạng thái','Dự kiến','Đã duyệt','Thực tế','Còn phải trả','Cập nhật','Phiên bản','Thao tác'],rows)+
    (history ? details('Phiên bản chứng từ',table(['Phiên bản','Người cập nhật','Thời điểm','Bản ghi'],
      history.map(item=>[esc(item.revision),esc(item.username),date(item.recorded_at),'<pre>'+esc(JSON.stringify(item.snapshot,null,2))+'</pre>']))) : ''),2)+
    section('Nhà cung cấp và đơn giá',library+(canManage ? details('Thêm nhà cung cấp hoặc danh mục',
      post(path+'/supplier',actor,hidden('scope',scopeKey)+input('name','Tên nhà cung cấp','',{required:true}),'Thêm nhà cung cấp')+
      post(path+'/category',actor,hidden('scope',scopeKey)+grid(input('category','Nhóm','',{required:true})+
        input('type','Loại','',{required:true})),'Thêm loại chi phí'))+details('Ghi đơn giá đã xác minh',
      post(path+'/quote',actor,hidden('scope',scopeKey)+grid(
        select('supplier','Nhà cung cấp',ledger.suppliers.map(s=>[s.id,s.name]),'',true)+
        select('classification','Loại chi phí',ledger.categories.map(c=>[c.category+' / '+c.cost_type,c.category+' / '+c.cost_type]),'',true)+
        input('unit','Đơn vị','',{required:true})+integer('unitPriceVnd','Đơn giá (VND)',null,true)+
        input('asOf','Ngày tham chiếu',dayVN(),{type:'date',required:true})+input('source','Chứng từ','',{required:true})),
      'Lưu tham chiếu')) : ''),2);
}

function adsView(actor, platform, view, selected) {
  const path = '/v11/ads/'+platform;
  const owner = allowed(actor,'ads.configure');
  const targets = view.targets.map(target=>[target.id,[target.account,target.campaign,target.ad_set].join(' / ')]);
  const stop = allowed(actor,'ads.stop') ? post(path+'/stop',actor,hidden('revision',view.state.revision)+
    hidden('stopped',view.state.stopped ? 'false' : 'true'),view.state.stopped ? 'Bật lại diễn tập' : 'Dừng khẩn cấp') : '';
  const forms = owner ? details('Đăng ký nhóm quảng cáo',post(path+'/target',actor,
    grid(input('account','ID tài khoản Ads','',{required:true})+input('show','Mã show / đơn vị 24H','',{required:true})+
      input('campaign','ID chiến dịch','',{required:true})+input('adSet','ID nhóm quảng cáo','',{required:true})+
      input('starts','Bắt đầu',dayVN(),{type:'date',required:true})+input('ends','Kết thúc',dayVN(),{type:'date',required:true})+
      integer('allocation','Ngân sách nguồn diễn tập')),
  'Lưu nhóm')) : '';
  let config = '';
  let action = '';
  if (selected) {
    const scope = adScope(selected);
    const availableActions = Object.entries(actions).filter(([,permission])=>allowed(actor,permission,scope)).map(([name])=>[name,name]);
    const layers = budgetLayers(selected,dayVN()).map(([layer])=>layer);
    if (owner) {
      config = details('Khóa ngân sách theo 7 lớp',
        post(path+'/limit',actor,hidden('target',selected.id)+input('day','Ngày áp dụng',dayVN(),{type:'date',required:true})+
          grid(layers.map(layer=>integer('budget_'+layer,layerNames[layer],selected.limits?.[layer]?.cap_vnd)).join('')),'Lưu hạn mức'))+
        details('Nhập chi tiêu mô phỏng', '<p>Các số này chỉ dùng kiểm thử việc xét duyệt.</p>'+
          post(path+'/fixture',actor,hidden('target',selected.id)+hidden('day',dayVN())+
          grid(layers.map(layer=>integer('budget_'+layer,layerNames[layer],selected.limits?.[layer]?.fixtureSpend,true)).join('')),'Lưu số diễn tập'));
    }
    if (availableActions.length) action = details('Lập yêu cầu diễn tập',post(path+'/request',actor,
      hidden('target',selected.id)+hidden('request',randomUUID())+grid(
        select('action','Thao tác',availableActions,'',true)+integer('amount','Số tiền (PAUSE nhập 0)',null,true)+
        select('from','Nhóm nguồn (OPTIMIZE)',[['','Không điều chuyển'],...targets.filter(([id])=>id!==selected.id)])+
        select('basis','Dữ liệu kiểm tra',[['fixture','Số liệu diễn tập'],['meta','Kiểm tra dữ liệu Meta']])+
        select('spendMode','Chu kỳ ngân sách',[['lifetime','Tổng chiến dịch'],['daily','Mỗi ngày (dự phòng 75%)']])+
        input('reason','Lý do','',{required:true})),'Gửi duyệt'));
  }
  const requestRows = view.requests.map(item=>{
    const target = view.targets.find(row=>row.id===item.target_id);
    const scope = adScope(target);
    const token = hidden('request',item.id)+hidden('revision',item.revision)+hidden('target',item.target_id);
    let buttons = '';
    if (item.state==='pending' && allowed(actor,'ads.approve',scope)) {
      buttons = post(path+'/approve',actor,token,'Duyệt')+post(path+'/reject',actor,token,'Từ chối');
    }
    if (item.state==='approved' && allowed(actor,'ads.execute',scope) && allowed(actor,actions[item.action],scope)) {
      buttons = post(path+'/execute',actor,token,'Chạy diễn tập');
    }
    return [esc(item.action),esc(target.ad_set),money(item.proposal.amount),esc(item.proposal.basis==='fixture'?'Mô phỏng':'Meta'),
      labelStatus(item.state),date(item.expires_at),esc(item.proposal.reason),item.result ? '0 yêu cầu Meta · 0 đ' : buttons];
  });
  const targetRows = view.targets.map(target => [link(target.ad_set,withQuery(path,{target:target.id})),esc(target.account),esc(target.show_key),
    esc(target.campaign),shown(target.metrics?.name),money(target.metrics?.spendVnd),money(target.metrics?.dailyBudgetVnd),
    money(target.metrics?.projectedDailySpendVnd),date(target.observed_at),esc(target.metrics?.alerts?.join(', ') ?? '')]);
  const m = selected?.metrics;
  const canAnalyze = selected && allowed(actor,'ads.analyze',adScope(selected));
  const metrics = canAnalyze && m ? section('Phân tích nhóm '+selected.ad_set,grid(
    tile('Chi tiêu',money(m.spendVnd))+tile('Tốc độ mỗi giờ',money(m.spentPerHourVnd))+tile('Chi phí hội thoại',money(m.costPerConversationVnd))+
    tile('Chi phí chuyển đổi Meta',money(m.costPerMetaPurchaseVnd))+tile('Giá trị mua hàng do Meta báo',money(m.purchaseValueReportedByMetaVnd))+
    tile('ROAS Meta',number(m.roasReportedByMeta))+tile('Doanh thu vé đã quy thuộc',money(m.verifiedAttributedRevenueVnd))+
    tile('Chi phí mỗi vé',money(m.ticketAcquisitionVnd)))+
    details('Theo khung giờ',table(['Khung giờ','Chi','Lượt nhấp','Hội thoại'],(m.cohorts??[]).map(row=>[
      esc(row.hour),money(row.spendVnd),number(row.clicks),number(row.conversations)])))+
    details('Theo mẫu quảng cáo',table(['Mẫu','Chi','Lượt nhấp','Giá trị mua hàng Meta'],(m.ads??[]).map(row=>[
      esc(row.name||row.id),money(row.spendVnd),number(row.clicks),money(row.purchaseValueReportedByMetaVnd)]))),2) : '';
  return section('AI Ads Manager',tabs('/v11/ads',platform)+
    '<p>Diễn tập · '+(view.state.stopped ? 'Đang dừng khẩn cấp' : 'Đang nhận yêu cầu')+
    '. Meta có thể phân phối vượt ngân sách ngày và báo cáo có độ trễ.</p>'+stop+forms+
    table(['Nhóm','Tài khoản','Show / 24H','Chiến dịch','Tên','Chi tiêu','Ngân sách ngày','Dự báo ngày','Cập nhật','Cảnh báo'],targetRows)+
    config+action)+metrics+section('Yêu cầu và phê duyệt',
      table(['Thao tác','Nhóm','Ngân sách','Căn cứ','Trạng thái','Hết hạn','Lý do','Kết quả / Thao tác'],requestRows),2);
}

function cameraView(actor, view) {
  const {policy:p,status,usage} = view;
  const route = '/v11/camera';
  const data = hidden('camera',cameraId);
  const buttons = [['status','Kiểm tra kết nối'],['snapshot','Chụp ảnh thử nghiệm'],['live','Mở luồng đã cấp']].map(([action,label])=>
    allowed(actor,'camera.'+action,cameraScope) ? post(route+'/'+action,actor,data,label) : '').join('');
  const settings = allowed(actor,'camera.configure',cameraScope) ?
    details('Hạn mức, dữ liệu và quyền Imou',post(route+'/policy',actor,hidden('revision',p?.revision ?? 0)+grid(
      integer('calls','Lượt API / ngày',p?.api_daily ?? 0,true)+integer('snapshots','Ảnh / ngày',p?.snapshots_daily ?? 0,true)+
      integer('bytes','Byte tối đa / ngày',p?.media_bytes_daily ?? 0,true)+integer('interval','Giây giữa hai ảnh',p?.snapshot_interval_s ?? 900,true)+
      select('retention','Lưu trữ media',[['0','Không lưu sau phiên']],p?.retention_days ?? 0)+
      integer('aiDay','Trần dự toán AI / ngày',p?.ai_day_vnd ?? 0,true)+integer('aiMonth','Trần dự toán AI / tháng',p?.ai_month_vnd ?? 0,true)+
      input('host','Host HTTPS ảnh và video đã xác nhận',p?.media_host)+
      input('reference','Mã đối chiếu bảng giá hoặc gói tài khoản',p?.terms_reference)+
      '<label><span><input type="checkbox" name="verified"'+(p?.imou_terms_verified?' checked':'')+
        '> Đã kiểm tra hạn mức tài khoản cho thiết bị này</span></label>'),'Lưu hạn mức')) : '';
  return section('Camera Management',grid(
    tile('Camera',shown(status?.name ?? 'Camera thử nghiệm'))+tile('Khu vực','Vỉa hè · 24H')+tile('Model',shown(status?.model))+
    tile('Trạng thái',labelStatus(status?.status ?? 'unknown'),date(status?.checked_at))+
    tile('Lượt API hôm nay',number(usage?.calls ?? 0),p ? 'Giới hạn '+p.api_daily : 'Chưa cấp hạn mức')+
    tile('Ảnh hôm nay',number(usage?.snapshots ?? 0))+tile('Byte đã giữ chỗ',number(usage?.media_bytes ?? 0))+
    tile('Chi phí Imou',money(null),'Chưa có đối soát tài khoản'))+
    '<p>'+(!view.credentialsPresent ? 'Chưa cấp thông tin ứng dụng Imou.' : !view.configured ?
      'Đã có thông tin ứng dụng. Cần xác minh data center và camera cho phép.' : 'Đã có cấu hình thử nghiệm cho một camera.')+
      (status?.reason ? ' '+shown(status.reason) : '')+'</p><div class="v11-actions">'+buttons+'</div>'+settings+
    '<p>'+link('Xem nhật ký truy cập','/v11/audit')+'</p>');
}

const cameraPlayer = `const video=document.querySelector('[data-v11-stream]');
const state=document.querySelector('#v11-camera-state');
if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=video.dataset.v11Stream;}
else if(window.Hls?.isSupported()){
  const player=new Hls({enableWorker:false,maxBufferLength:6,liveSyncDurationCount:2});
  player.loadSource(video.dataset.v11Stream);
  player.attachMedia(video);
  player.on(Hls.Events.ERROR,(_,detail)=>{if(detail.fatal){state.textContent='Luồng đã hết hạn, đạt hạn mức hoặc không khả dụng.';player.destroy();}});
  window.addEventListener('pagehide',()=>player.destroy(),{once:true});
}else{state.textContent='Trình duyệt này chưa hỗ trợ luồng HLS.';}
video.addEventListener('error',()=>{state.textContent='Luồng đã hết hạn hoặc không khả dụng.';});`;
const cameraPlayerHash = createHash('sha256').update(cameraPlayer).digest('base64');

function cameraLive(key) {
  return section('Camera vỉa hè · Phát trực tiếp','<video controls muted playsinline preload="none" class="v11-video" data-v11-stream="/v11/camera/media/'+
    esc(key)+'/index"></video><p id="v11-camera-state" role="status"></p><p>Phiên xem tối đa hai phút trong hạn mức còn lại. '+
    link('Quay lại camera','/v11/camera')+'</p><script src="/v11/camera/player.js"></script><script>'+cameraPlayer+'</script>');
}

function sourcesView(rows,actor) {
  const refresh = allowed(actor,'source.refresh') ? post('/v11/sources/refresh',actor,'','Kiểm tra nguồn Music') : '';
  const evidence = allowed(actor,'source.write') ? details('Ghi chứng cứ có phạm vi',
    post('/v11/sources/evidence',actor,grid(
      select('source','Nguồn',[['weather','Thời tiết'],['tourism','Du lịch'],['market','Thị trường'],['drive','Google Drive']])+
      select('platform','Lĩnh vực',asChoices(basics,platformLabel))+input('scope','Mã show hoặc địa điểm','',{required:true})+
      input('evidenceDay','Ngày dữ liệu',dayVN(),{type:'date',required:true})+
      select('confidence','Độ tin cậy',[['high','Cao'],['medium','Vừa'],['low','Thấp']])+
      input('reference','Link nguồn HTTPS','',{type:'url',required:true}))+
      textArea('assessment','Nội dung đã đối chiếu','',true),'Lưu chứng cứ')) : '';
  return section('Nguồn dữ liệu',refresh+evidence+table(
    ['Nguồn','Trạng thái','Nguồn gốc','Quyền','Thiếu','Chi phí','Cập nhật','Kết quả'],
    rows.map(row=>[esc(row.label),labelStatus(row.state),esc(row.origin),esc(row.permission),esc(row.missing),
      money(row.costVnd),date(row.checked_at),esc(JSON.stringify(row.details))])));
}

function auditTable(rows) {
  return table(['Thời điểm','Sự kiện','Phạm vi','Bằng chứng'],rows.map(row=>[
    date(row.created_at),esc(row.event),shown(Object.values(row.scope).join(' · ')),
    '<pre>'+esc(JSON.stringify(row.details,null,2))+'</pre>']));
}

function auditPage(actor, rows, kind, platform) {
  const heading = {audit:'Nhật ký hệ thống',auditor:'AI Auditor',memory:'Trí nhớ doanh nghiệp'}[kind];
  let controls = '';
  if (kind==='memory') controls = tabs('/v11/memory',platform)+(allowed(actor,'memory.write') ?
    details('Ghi kết quả hoặc bài học',post('/v11/memory/'+platform+'/outcome',actor,
      grid(input('scope',platform==='music'?'Mã show':'Mã địa điểm','',{required:true})+input('goal','ID mục tiêu nếu có')+
        integer('actualVnd','Thực tế (VND)')+integer('forecastVnd','Dự báo đã lưu (VND)')+
        input('source','Chứng từ đối chiếu','',{required:true}))+textArea('outcome','Kết quả và bài học','',true),'Lưu kết quả')) : '');
  if (kind==='auditor' && (actor.role==='OWNER' || actor.grants.some(grant=>grant.permission==='audit.report'))) {
    const domain = select('platform','Lĩnh vực',asChoices(basics,platformLabel));
    controls = details('Ghi phát hiện độc lập',post('/v11/auditor/report',actor,grid(domain+
      select('subject','Nhóm',asChoices(['finance','advertising','camera','access','planning','ai']))+
      select('severity','Mức độ',[['note','Ghi chú'],['warning','Cảnh báo'],['critical','Nghiêm trọng']]))+
      textArea('summary','Phát hiện','',true)+input('evidence','Nguồn bằng chứng','',{required:true}),'Gửi phát hiện'))+
      post('/v11/auditor/check',actor,domain,'Đối chiếu kiểm soát nội bộ');
  }
  return section(heading,controls+auditTable(rows));
}

module.exports = {
  esc, link, hidden, input, select, post, section, grid, table, tile, tabs, date, number, money, pct, shown, statusLabels, labelStatus,
  withQuery, textArea, details, integer, periods, basics, cameraView, cameraLive, sourcesView, auditPage, accessView, activateView,
  adsView, costView, visibleModules, home, requestError, cameraPlayerHash
};

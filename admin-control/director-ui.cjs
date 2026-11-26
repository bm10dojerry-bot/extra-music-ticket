'use strict';

const {permissionLabels} = require('./director-program.cjs');

const statuses = {
  queued:'Chờ thực thi',running:'Đang thực thi',reported:'Chờ Director đánh giá',
  accepted:'Director đã nghiệm thu',blocked:'Chờ quyền hoặc dữ liệu',failed:'Thực thi thất bại'
};
const costLabels = {
  packingVnd:'Đóng gói (₫/đơn vị)',deliveryVnd:'Giao hàng phân bổ (₫/đơn vị)',taxVnd:'Thuế phân bổ (₫/đơn vị)',
  paymentVnd:'Phí thanh toán (₫/đơn vị)',otherUnitVnd:'Chi phí khác (₫/đơn vị)',otherFixedVnd:'Chi phí cố định ngoài quảng cáo (₫)'
};
const versions = {
  Director:'V 1.0',Research:'V 0.1',Planner:'V 0.1',Content:'V 0.1',Creative:'V 0.1',
  Social:'V 0.1',Ads:'V 0.1',Sale:'V 2.3',CRM:'V 0.1',Analyst:'V 1.0',Auditor:'V 0.1'
};
const isSample = run => run.input.mode==='sample';
const runMode = run => isSample(run) ? 'Dữ liệu mẫu' : 'Diễn tập kết nối';
const reports = {
  research:'Nghiên cứu',plan:'Chiến lược',direction:'Chỉ đạo triển khai',forecast:'Dự kiến tài chính',audit:'Kiểm tra quyền và ngân sách',
  content:'Nội dung',creative:'Tư liệu',training:'Kiến thức Sale',sale_rehearsal:'Diễn tập Sale',
  crm:'Chăm sóc khách hàng',social:'Mạng xã hội',ads:'Quảng cáo',catalog:'Giá và tồn kho',
  actuals:'Đối soát',publication_checks:'Kiểm tra trước xuất bản',report:'Báo cáo tổng hợp',brief:'Chỉ đạo'
};

function renderDirector({runs,selected,jobs,versions:knowledge}, {esc,money,csrfField,s,agents,saleLinkHtml,requestId,sampleRequestId,financeHtml=''}) {
  const field = (key,label,max) => '<label>'+esc(label)+'<input required name="'+key+'" maxlength="'+max+'"></label>';
  const amount = (key,label,required) => '<label>'+esc(label)+'<input type="number" name="'+key+
    '" min="'+(key==='priceVnd'?'1':'0')+'" max="1000000000" step="1"'+(required?' required':'')+'></label>';
  const brief = '<form action="/director/run" method="post">'+csrfField(s)+'<input type="hidden" name="request_id" value="'+requestId+'">'+
    '<div class="grid">'+field('product','Sản phẩm',160)+amount('purchaseVnd','Giá nhập (₫)',true)+
    amount('priceVnd','Giá bán (₫)',true)+amount('budgetVnd','Ngân sách quảng cáo tối đa (₫)',true)+field('region','Khu vực',100)+
    '</div><label>Mục tiêu kinh doanh<textarea name="objective" maxlength="1000" required></textarea></label>'+
    '<details><summary>Chi phí để tính hòa vốn đầy đủ</summary><p>Để trống khoản chưa biết. Nhập 0 khi đã xác minh khoản đó bằng 0.</p><div class="grid">'+
    Object.entries(costLabels).map(([key,label])=>amount(key,label,false)).join('')+'</div></details>'+
    '<p>Diễn tập 24H cho khách từ 18 tuổi. Director tự giao việc, kiểm tra kết quả và ghi rõ các bước còn thiếu quyền.</p>'+
    '<button>Chạy ONE CLICK 24H</button></form>';

  const sampleForm = '<form class="director-sample" action="/director/sample" method="post">'+csrfField(s)+
    '<input type="hidden" name="request_id" value="'+esc(sampleRequestId)+'">'+
    '<div><h3>Kiểm thử 24H bằng dữ liệu mẫu</h3><p>Chạy 11 Agent với danh mục, báo giá và biên nhận thử nghiệm.</p></div>'+
    '<button>Chạy dữ liệu mẫu</button></form>';
  const runUrl = id => '/?directorRun='+id+'#oneclick24';
  const runLinks = runs.map(run=>{
    const counts = run.counts ?? {};
    return '<li><a href="'+runUrl(run.id)+'"'+(run.id===selected?.id?' aria-current="true"':'')+'>'+
      esc(run.input.product)+'</a> · '+esc(runMode(run))+' · '+esc(counts.accepted ?? 0)+' đã nghiệm thu · '+esc((counts.blocked ?? 0)+(counts.failed ?? 0))+
      ' cần xử lý · '+esc(new Date(run.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+'</li>';
  }).join('');

  function renderJob(job) {
    const missing = job.issues.map(issue=>permissionLabels[issue] ?? issue).map(esc);
    const awaiting = (job.status==='accepted' ? job.result?.remaining ?? [] : []).map(issue=>esc(permissionLabels[issue] ?? issue));
    const forecast = job.kind==='forecast' && job.result?.basis==='forecast' ? '<p>Biên gộp '+esc(money(job.result.grossMarginVnd))+
      ' / đơn vị · Hòa vốn chỉ tính giá vốn và quảng cáo: '+esc(job.result.subtotalBreakEvenUnits ?? '—')+
      ' · Hòa vốn đủ chi phí: '+esc(job.result.breakEvenUnits ?? '—')+'</p>' : '';
    const report = job.kind==='report' && job.result?.actuals ? (() => {
      const sample=job.result.sample;
      if (sample) {
        const receipt=sample.receipt ? 'Biên nhận '+sample.receipt+' · '+sample.units+' đơn vị · '+money(sample.checkoutVnd) : 'Chưa có biên nhận mẫu';
        const budget=sample.adsStop ? 'Đã thử dừng ở '+money(sample.spendVnd) : 'Chưa kiểm tra được ngưỡng dừng';
        return '<p>'+esc(receipt+' · '+budget)+'</p>'+
          (sample.profitVnd!==null ? '<p>Lãi/lỗ mô phỏng '+esc(money(sample.profitVnd))+'</p>' : '');
      }
      const row=job.result.actuals;
      const known = row.basis==='sapo_tagged_paid_orders';
      return '<p>'+esc(known?'Đã đọc các đơn gắn thẻ từ Sapo. Tổng đã thanh toán '+money(row.grossPaidVnd)+
        ' · '+row.orders+' đơn · '+row.units+' đơn vị.':'Chưa có số liệu thanh toán cho chiến dịch.')+
        '</p><p>Doanh thu ròng và lợi nhuận chờ đối soát thuế, phí, khuyến mại và giá vốn thực tế.</p>';
    })() : '';
    const reopen = ['accepted','blocked','failed'].includes(job.status) ? '<form action="/director/revise" method="post">'+csrfField(s)+
      '<input type="hidden" name="job_id" value="'+job.id+'"><label>Phản hồi cho Agent<input required name="feedback" maxlength="1000"></label>'+
      '<button>Yêu cầu làm lại</button></form>' : '';
    return '<details class="director-job"><summary>'+esc(isSample(selected)&&job.kind==='actuals'?'Đối chiếu biên nhận mẫu':reports[job.kind] ?? job.kind)+' · '+esc(agents[job.agent]?.label ?? job.agent)+
      ' · '+esc(statuses[job.status])+'</summary><p>'+esc(job.objective)+'</p>'+
      '<p><small>Mã '+esc(job.id)+' · Giao bởi '+esc(job.assigned_by)+' · Phiên '+esc(job.revision+1)+' · Lượt chạy '+esc(job.attempts)+
      ' · Hạn '+esc(new Date(job.deadline).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+'</small></p>'+
      (job.needs.length ? '<p>Phụ thuộc '+job.needs.map(kind=>esc(reports[kind] ?? kind)).join(', ')+'</p>' : '')+
      (job.permissions.length ? '<p>Quyền cần dùng '+job.permissions.map(key=>esc(permissionLabels[key] ?? key)).join(', ')+'</p>' : '')+
      (Number(job.budget_vnd) > 0 ? '<p>Hạn mức '+esc(money(job.budget_vnd))+'</p>' : '')+
      (missing.length ? '<p class="tag">'+missing.join(' · ')+'</p>' : '')+
      (awaiting.length ? '<p class="tag">Chờ tích hợp '+awaiting.join(' · ')+'</p>' : '')+
      (job.feedback ? '<p>Phản hồi Director / chủ doanh nghiệp '+esc(job.feedback)+'</p>' : '')+forecast+report+
      (job.kind==='creative' && job.result?.asset ? '<p><a target="_blank" rel="noopener" href="/director/asset?id='+esc(job.id)+
        '&amp;revision='+esc(job.result.asset.revision)+'">Mở ảnh diễn tập</a></p>' : '')+
      (job.result ? '<details><summary>Kết quả và báo cáo</summary><pre class="director-result">'+esc(JSON.stringify(job.result,null,2))+'</pre></details>' : '')+
      (job.events.length ? '<details><summary>Nhật ký gần đây</summary><ul>'+job.events.map(event=>
        '<li>'+esc(event.event)+' · '+esc(new Date(event.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+'</li>').join('')+'</ul></details>' : '')+
      reopen+'</details>';
  }

  const history = !knowledge.length ? '' : '<h3>Phiên bản kiến thức Sale</h3><ul class="director-versions">'+knowledge.map(v=>{
    const state = v.active ? 'Đang áp dụng trong diễn tập' : v.validated_at ? 'Đã kiểm thử' : 'Chờ diễn tập';
    const button = v.validated_at && !v.active ? '<form action="/director/knowledge" method="post">'+csrfField(s)+
      '<input type="hidden" name="run_id" value="'+selected.id+'"><input type="hidden" name="version" value="'+v.version+'">'+
      '<button>Khôi phục</button></form>' : '';
    return '<li>Phiên bản '+v.version+' · '+state+button+'</li>';
  }).join('')+'</ul>';

  const reported = jobs.some(job=>job.kind==='report'&&job.status==='accepted');
  const current = selected ? '<div class="director-run"><h3>'+esc(selected.input.product)+'</h3><p>'+esc(selected.input.objective)+'</p>'+
    '<p>'+esc(selected.input.region)+' · 18+ · '+esc(money(selected.input.priceVnd))+' · '+esc(runMode(selected))+'</p>'+
    '<p class="director-links"><a href="'+runUrl(selected.id)+'">Cập nhật trạng thái</a>'+
      (reported?'<a href="/director/report?run='+esc(selected.id)+'">Tải báo cáo JSON</a>':'')+'</p>'+financeHtml+jobs.map(renderJob).join('')+history+'</div>' : '';
  const retail = sampleForm+brief+'<h3>Chiến dịch 24H</h3>'+(runLinks?'<ul class="director-runs">'+runLinks+'</ul>':'<p>Chưa có chiến dịch.</p>')+current;

  const panel = '<section class="os-panel" id="agents"><h2>AI Director</h2><p><a href="/crm">Mở hàng đợi CRM 24H</a></p>'+
    (selected?'<p>Hiển thị từ lượt điều hành <a href="'+runUrl(selected.id)+'">'+esc(selected.input.product)+'</a>.</p>':'')+
    '<div class="scroll"><table class="director-agents"><thead><tr><th scope="col">Agent</th>'+
    '<th scope="col">Tiến độ lượt chạy</th><th scope="col">Kết quả / Việc còn chờ</th></tr></thead><tbody>'+
    Object.entries(agents).map(([key,agent])=>{
      const records=jobs.filter(job=>job.agent===key);
      const open=records.find(job=>['running','reported','queued'].includes(job.status));
      const last=records.find(job=>['accepted','blocked','failed'].includes(job.status));
      const verified=records.filter(job=>job.status==='accepted').length;
      const missing=[...new Set(records.flatMap(job=>[...job.issues,...(job.result?.remaining ?? [])]))];
      const complete=records.length>0 && verified===records.length && missing.length===0;
      const progress=complete
        ? '<span class="director-pass"><span aria-hidden="true">✓ </span>Nghiệm thu lượt '+(isSample(selected)?'mẫu':'diễn tập')+'</span>'
        : '<span>'+esc(open?statuses[open.status]:(last&&last.status!=='accepted'?statuses[last.status]:records.length?'Chờ tích hợp':'Chưa có lượt chạy'))+'</span>';
      return '<tr><th scope="row"><strong>'+esc(agent.label+' '+versions[key])+'</strong><br><small>'+
        esc(agent.responsibility)+'</small></th><td>'+progress+
        (records.length?'<br><small>'+verified+'/'+records.length+' nhiệm vụ được nghiệm thu</small>':'')+'</td><td>'+
        (last?'<strong>'+esc(reports[last.kind] ?? last.kind)+'</strong><br>':'')+
        (missing.length?'<small>'+missing.map(key=>esc(permissionLabels[key] ?? key)).join(' · ')+'</small>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>'+
    '<details><summary>Kết nối AI Sale V 2.3</summary>'+saleLinkHtml+'</details></section>';
  return {retail,panel};
}

const directorCss = `
.director-run {border-top:1px solid #e7e7e9;padding-top:14px}
.director-job {padding:10px 12px;border:1px solid #e7e7e9;border-radius:7px}
.director-job summary,.director-job p {overflow-wrap:anywhere}
.director-result {white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f8;border-radius:6px;padding:12px;font-size:.85rem;line-height:1.5}
.director-runs,.director-versions {padding-left:20px;line-height:1.65}
.director-versions form {display:inline-block;margin-left:10px}
.director-agents th:first-child {min-width:160px}
.director-agents td {min-width:125px}
.director-agents small {font-weight:400}
.director-pass {background:#eaf7ef;color:#125d36;display:inline-block;padding:4px 8px;border-radius:5px;font-weight:700}
.director-sample {display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#f5f8f6;border:1px solid #dae9e0;border-radius:8px;padding:12px;margin-bottom:20px}
.director-sample h3,.director-sample p {margin:0}
.director-links {display:flex;gap:16px;flex-wrap:wrap}
.os-content :is(#agents,#oneclick24) {max-width:1350px}
@media(max-width:480px){.director-job {padding:9px}.director-job summary{font-size:14px}}
`;

module.exports = {renderDirector,directorCss};

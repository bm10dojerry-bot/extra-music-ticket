'use strict';

const {people}=require('./staff-scope.cjs');
const {showMedia}=require('./show-media.cjs');
const {economicSections}=require('./show-economics.cjs');
const amount=n=>Number.isFinite(n)?n.toLocaleString('vi-VN')+' đồng':'chưa có dữ liệu';
const date=s=>s?s.slice(0,10).split('-').reverse().join('/'):'chưa xác định';
const when=s=>s?date(s)+' lúc '+s.slice(11,16):'chưa xác định';
const roles=['Research','Analyst','Planner','Content','Creative','Social','Ads','Sale','CRM','Operations','Auditor'];
const label=s=>s.artist+' · '+date(s.date);
const readableStatuses=new Set(['announced','pending','sold_out','live']);
function showCatalog(snapshot,finance,today){
  const known=new Map();
  for(const row of finance.data?.rows??[])known.set(row.showId,{id:row.showId,artist:row.artist,date:row.date});
  for(const row of snapshot.rows??[])known.set(row.id,row);
  const shows=[...known.values()].sort((a,b)=>String(a.date??'9999').localeCompare(String(b.date??'9999'))||String(a.time??'23:59').localeCompare(String(b.time??'23:59'))||a.artist.localeCompare(b.artist,'vi'));
  return {
    active:shows.filter(s=>s.status==='live'||(readableStatuses.has(s.status)&&s.date>=today)),
    ended:shows.filter(s=>s.status==='ended'||(s.status!=='live'&&s.date&&s.date<today))
  };
}
function buildReport(show,day,finance,run,ended,context){
  const row=finance.data?.rows.find(r=>r.showId===show.id);
  const daily=row?.days[day];
  const moneyLines=row?['Doanh thu ngày '+date(day)+': '+amount(daily?.revenueVnd??0)+'.',
    'Doanh thu lũy kế tại thời điểm cập nhật: '+amount(row.total.revenueVnd)+'.']:['Chưa có số liệu doanh thu xác nhận của show này.'];
  const brief=[...moneyLines],sections=[],images=ended?[]:showMedia(show,run);
  if(ended)return {title:'Doanh thu '+label(show),brief,sections,images};
  if(row)brief.push('Trong ngày: '+(daily?.paidTickets??0)+' vé thanh toán, '+(daily?.complimentaryTickets??0)+' vé mời.');
  const summary=run?.results?.DirectorFinal;
  const campaign=run?.status==='ready'?summary?.output?.campaigns?.find(c=>c.showId===show.id):null;
  if(campaign){
    brief.push(campaign.title,'Mục tiêu: '+campaign.target+'.',(campaign.economicReview?'Ngân sách Meta đề xuất chi thêm: ':'Ngân sách đề xuất: ')+amount(campaign.proposedBudgetVnd)+'. Hạn: '+when(campaign.deadline)+'.');
    const assigned=(summary.staffPolicyVersion===1?campaign.staff:[]).map(task=>({
      person:people.find(p=>p.id===task.staffId)?.name??task.staffId,...task
    }));
    if(assigned.length)brief.push('Nhân sự hỗ trợ: '+[...new Set(assigned.map(a=>a.person))].join(', ')+'.');
    const forecast=campaign.expectedLow===null?'Chưa đủ căn cứ dự báo vé.':'Dự kiến '+campaign.expectedLow+' đến '+campaign.expectedHigh+' vé mới.';
    sections.push({title:'Căn cứ và điều kiện dừng',lines:[campaign.rationale,forecast,campaign.budgetBasis,campaign.stopRule,...campaign.missing]});
    const review=campaign.economicReview;
    if(review){
      const actions={hold:'Giữ ngân sách',reduce:'Giảm ngân sách',pause:'Tạm dừng',reallocate:'Điều chuyển ngân sách',increase:'Tăng ngân sách'};
      sections.push({title:'Quyết định quảng cáo và bán vé',lines:[actions[review.adAction],review.paidChannelPlan,review.followUpPlan,review.forecastBasis,review.gapResponse,review.checkpoint&&'Kiểm tra lại lúc '+when(review.checkpoint)].filter(Boolean)});
    }
    sections.push({title:'Việc của AI',lines:campaign.actions.map(a=>[a.agent,a.action,'Đầu ra: '+a.deliverable,'Đo bằng '+a.metric,'Hạn '+when(a.deadline)].join('. '))});
    if(assigned.length)sections.push({title:'Việc cần người hỗ trợ',lines:assigned.map(a=>[a.person,a.action,a.metric,'Hạn '+when(a.deadline)].join('. '))});

  }else{
    brief.push(run?.status==='ready'?'Director chưa đưa ra chiến dịch riêng cho show này trong kỳ đã chọn.':'Chưa có đề xuất hoàn chỉnh của Director cho kỳ đã chọn.');
  }
  const insights=[];
  for(const [agent,result] of Object.entries(run?.results??{})){
    if(!roles.includes(agent))continue;
    for(const action of result.output?.actions??[]){
      if(action.showId!==show.id)continue;
      // Earlier staff handoffs have been superseded by the new Director synthesis.
      if(result.staffPolicyVersion!==1&&people.some(p=>[action.action,action.deliverable,action.metric].some(text=>text?.includes(p.name))))continue;
      insights.push([agent,action.action,action.deliverable,action.metric,'Hạn '+when(action.deadline)].join('. '));
    }
  }
  if(insights.length)sections.push({title:'Các báo cáo Agent có việc gắn với show',lines:insights});
  const signals=context?.signals??run?.facts?.musicSignals;
  const signalsText=[];
  for(const d of signals?.adDays??[]){
    for(const r of d.rows.filter(r=>r.showId===show.id))signalsText.push(date(d.day)+', tài khoản '+r.accountId+': '+amount(r.spendVnd)+'.');
  }
  for(const r of signals?.messenger??[])if(r.showId===show.id)signalsText.push(r.quotedChats+' hội thoại đã báo giá, '+r.linkedPaidChats+' hội thoại liên kết với đơn thanh toán.');
  if(signalsText.length)sections.push({title:'Nguồn quảng cáo và hội thoại',lines:[...signalsText,signals.limits].filter(Boolean)});
  if(row)sections.push({title:'Đối soát vé',lines:['Số liệu theo đơn đã xác nhận thanh toán. Cập nhật lúc '+new Date(finance.data.checkedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+'.','Số đơn đã thanh toán trong ngày: '+(daily?.paidOrders??0)+'.','Vé thanh toán lũy kế tại kỳ cập nhật: '+row.total.paidTickets+'.','Chi phí đã khai báo: '+amount(row.recordedCostVnd)+'.']});
  sections.unshift(...economicSections(show,day,finance,run,context));
  if(images.length)sections.push({title:'Tư liệu được đề xuất',lines:images.map(a=>a.label)});
  return {title:label(show),brief,sections,images};
}
function reading(report,mode){
  const text=[report.title,...report.brief];
  if(mode==='full')for(const section of report.sections)text.push(section.title,...section.lines);
  return text.join('\n');
}
function renderShowPage({path,day,period,catalog,show,ended,report,snapshot,run,esc,player,approvalPanel=''}){
  const url=(path,id,archive=false)=>path+'?'+new URLSearchParams({day,period,...(id?{show:id}:{}),...(archive?{view:'revenue'}:{})}).toString();
  const options=shows=>shows.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===show?.id?' selected':'')+'>'+esc(label(s))+'</option>').join('');
  const groups=(catalog.active.length?'<optgroup label="Show đang diễn và sắp diễn">'+options(catalog.active)+'</optgroup>':'')+
    (catalog.ended.length?'<optgroup label="Doanh thu show đã kết thúc">'+options([...catalog.ended].reverse())+'</optgroup>':'');
  const periods='<label>Kỳ đề xuất<select name="period">'+[['day','Ngày'],['week','Tuần'],['month','Tháng']].map(([value,name])=>'<option value="'+value+'" '+(value===period?'selected':'')+'>'+name+'</option>').join('')+'</select></label>';
  const form=groups?'<form method="get" action="'+esc(path)+'"><div class="grid"><label>Chọn show<select name="show" required>'+(!show?'<option value="" selected disabled>Chọn show</option>':'')+groups+'</select></label><label>Ngày báo cáo<input type="date" name="day" required value="'+esc(day)+'"></label>'+periods+'</div><button>Xem</button></form>':'';
  const nav='<section><h1>'+(path==='/reports/music'?'Báo cáo':'Đề xuất')+' Music theo show</h1>'+form+(!snapshot.showsAvailable?'<p>Chưa xác minh được lịch show hiện tại.</p>':'')+'</section>';
  if(!show)return '<main>'+nav+'<p>'+(!catalog.active.length?'Chưa có show đang diễn hoặc sắp diễn để chọn.':'Chọn một show trong danh sách để xem báo cáo.')+'</p></main>';
  const sections=report.sections.map(s=>'<details><summary>'+esc(s.title)+'</summary>'+s.lines.map(line=>'<p>'+esc(line)+'</p>').join('')+'</details>').join('');
  const media=report.images.length?'<section><h3>Poster và media</h3>'+report.images.map(a=>'<p><strong>'+esc(a.label)+'</strong> · <a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">Xem</a> · <a href="'+esc(a.downloadUrl)+'" download>Tải về</a></p>').join('')+'</section>':'';
  const other=ended?'':'<p><a href="'+esc(url(path==='/reports/music'?'/proposals/music':'/reports/music',show.id))+'">'+(path==='/reports/music'?'Đề xuất':'Báo cáo')+' của '+esc(show.artist)+'</a></p>';
  const progress=ended||!run?'':'<details><summary>Tiến độ Director của kỳ</summary><p>'+esc(({ready:'Đã tổng hợp',running:'Đang xử lý',queued:'Đang chờ',blocked:'Đang bị chặn'})[run.status]??run.status)+' · '+roles.filter(role=>run.results?.[role]?.responseId).length+'/11 báo cáo cho toàn kỳ.</p></details>';
  return '<main>'+nav+'<section id="live-director"><h2>'+esc(report.title)+'</h2>'+player+report.brief.map(x=>'<p>'+esc(x)+'</p>').join('')+sections+media+progress+other+approvalPanel+'</section></main>';
}
module.exports={showCatalog,buildReport,reading,renderShowPage};

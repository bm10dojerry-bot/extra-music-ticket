'use strict';

const costLabels = {
  artist_fee:'Cát-xê',venue_fee:'Địa điểm',sound_lighting:'Âm thanh, ánh sáng',
  labor:'Nhân công',advertising:'Quảng cáo',band:'Ban nhạc',tax:'Thuế',
  sale_commission:'Hoa hồng sale',logistics:'Hậu cần',security:'An ninh',miscellaneous:'Phát sinh'
};
const accountIds=['1915621506464312','1482182900406200'];
const count=n=>Number.isSafeInteger(n)&&n>=0;
const validId=id=>typeof id==='string'&&/^[a-z0-9_-]{1,150}$/i.test(id);
const dateKey=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d);
const dayInVN=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+7*3600000).toISOString().slice(0,10):null;
const daysBefore=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
const sum=(values)=>{const n=values.reduce((a,b)=>a+b,0);if(!count(n))throw Error('economic total');return n;};
const currency=n=>Number.isFinite(n)?n.toLocaleString('vi-VN')+' đ':'chưa có dữ liệu';
const displayDate=d=>d?.split('-').reverse().join('/')??'chưa rõ';
const timestamp=t=>new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
function parseEconomicsSource(raw){
  if(raw?.version!==1||!dateKey(raw.priorTo)||(raw.historyStart!==null&&!dateKey(raw.historyStart))||
     !Array.isArray(raw.costs)||raw.costs.length>1000||!Array.isArray(raw.coverage)||raw.coverage.length>7||
     !Array.isArray(raw.campaigns)||raw.campaigns.length>2000||!raw.oldAds||Array.isArray(raw.oldAds)||typeof raw.oldAds!=='object')throw Error('economic source');
  const costs=raw.costs.map(row=>{
    if(!validId(row.showId)||!dayInVN(row.updatedAt)||!Object.keys(costLabels).every(k=>count(row.categories?.[k])))throw Error('economic cost');
    return {showId:row.showId,updatedAt:row.updatedAt,categories:Object.fromEntries(Object.keys(costLabels).map(k=>[k,row.categories[k]]))};
  });
  const oldAds=Object.fromEntries(Object.entries(raw.oldAds).map(([id,v])=>{if(!validId(id)||!count(v))throw Error('economic ad history');return [id,v];}));
  const coverage=raw.coverage.map(row=>{
    if(!dateKey(row.day)||!count(row.unassignedVnd)||!accountIds.every(id=>count(row.accounts?.[id])))throw Error('economic coverage');
    return {day:row.day,unassignedVnd:row.unassignedVnd,accountTotalVnd:sum(accountIds.map(id=>row.accounts[id]))};
  });
  const campaigns=raw.campaigns.map(row=>{
    if(!validId(row.showId)||!accountIds.includes(row.accountId)||!/^\d{5,30}$/.test(row.campaignId)||
       typeof row.campaignName!=='string'||!row.campaignName.length||row.campaignName.length>500||!count(row.spendVnd))throw Error('economic campaign');
    return {showId:row.showId,accountId:row.accountId,campaignId:row.campaignId,campaignName:row.campaignName,spendVnd:row.spendVnd};
  });
  if(new Set(costs.map(c=>c.showId)).size!==costs.length||new Set(coverage.map(c=>c.day)).size!==coverage.length)throw Error('duplicate economics');
  return {oldAds,costs,coverage,campaigns,historyStart:raw.historyStart,priorTo:raw.priorTo};
}
function computeShowEconomics(show,day,finance,signals,checkedAt){
  const economicSource=signals?.economics;
  const row=finance?.showId===show.id&&finance.days?finance:null;
  const dailyRow=row?.days[day];
  const paidTickets=row?dailyRow?.paidTickets??0:null;
  const dailyRevenue=row?dailyRow?.revenueVnd??0:null;
  const dailySnapshot=signals?.adDays?.find(snapshot=>snapshot.day===day);
  const coverage=economicSource?.coverage.find(entry=>entry.day===day);
  const attributedAds=(dailySnapshot?.rows??[]).filter(entry=>entry.showId===show.id);
  const assignedAdsVnd=attributedAds.length||(dailySnapshot&&coverage)?sum(attributedAds.map(entry=>entry.spendVnd)):null;
  const daily={
    paidTickets,paidOrders:row?dailyRow?.paidOrders??0:null,revenueVnd:dailyRevenue,
    assignedAdsVnd,afterAssignedAdsVnd:dailyRevenue!==null&&assignedAdsVnd!==null?dailyRevenue-assignedAdsVnd:null,
    adAsOf:dailySnapshot?.fetchedAt??null,unassignedAccountSpendVnd:coverage?.unassignedVnd??null,
    attributedContributionAfterAdsVnd:null
  };
  const dataDays=row?Object.entries(row.days).filter(([d])=>d<=day).map(([,v])=>v):[];
  const revenueVnd=row?sum(dataDays.map(v=>v.revenueVnd)):null;
  const paidToDate=row?sum(dataDays.map(v=>v.paidTickets)):null;
  const recorded=economicSource?.costs.find(cost=>cost.showId===show.id&&dayInVN(cost.updatedAt)<=day);
  const declaredCost=recorded?sum(Object.values(recorded.categories)):row&&dayInVN(row.costUpdatedAt)&&dayInVN(row.costUpdatedAt)<=day&&count(row.recordedCostVnd)?row.recordedCostVnd:null;
  const adWindowContainsDay=economicSource&&day>=economicSource.priorTo&&day<=signals.toDay;
  const recent=(signals?.adDays??[]).filter(snapshot=>snapshot.day<=day&&(!economicSource||snapshot.day>=economicSource.priorTo))
    .flatMap(snapshot=>snapshot.rows.filter(entry=>entry.showId===show.id));
  const observedBeforeWindow=adWindowContainsDay?economicSource.oldAds[show.id]??null:null;
  const observedAds=recent.length||observedBeforeWindow!==null?sum([observedBeforeWindow??0,...recent.map(r=>r.spendVnd)]):null;
  // Declared advertising can include the same Meta invoices. Without item-level
  // reconciliation, the greater amount is a conservative combined basis.
  const costBasisVnd=recorded?declaredCost-recorded.categories.advertising+Math.max(recorded.categories.advertising,observedAds??0):declaredCost;
  const provisionalNetVnd=revenueVnd!==null&&costBasisVnd!==null?revenueVnd-costBasisVnd:null;
  const cumulative={revenueVnd,paidTickets:paidToDate,declaredCostVnd:declaredCost,observedAdsVnd:observedAds,
    costBasisVnd,provisionalNetVnd,declaredCategories:recorded?.categories??null,
    missingCosts:recorded?Object.keys(costLabels).filter(k=>recorded.categories[k]===0):[],
    costAsOf:recorded?.updatedAt??(declaredCost===null?null:row?.costUpdatedAt),
    adsFrom:economicSource?.historyStart??(recent.length?signals?.fromDay:null)};
  const inventory=show.inventory;
  const asOfDay=dayInVN(checkedAt);
  const startsAt=show.date&&show.time?Date.parse(show.date+'T'+show.time+'+07:00'):NaN;
  const hours=asOfDay===day&&Number.isFinite(startsAt)?(startsAt-Date.parse(checkedAt))/3600000:null;
  // Old snapshots only carry numeric seat counts. Subtracting overlapping
  // blocked/sold seats twice would exaggerate the sales pace.
  const availableSeats=asOfDay===day&&inventory&&count(inventory.remaining)?
    (count(inventory.sellable)?inventory.sellable:inventory.held===0?inventory.remaining:null):null;
  const pastThree=row?sum([1,2,3].map(n=>row.days[daysBefore(day,n)]?.paidTickets??0)):null;
  const pace={availableSeats,hoursToShow:hours===null?null:Math.max(0,Math.round(hours*10)/10),
    requiredPer24h:availableSeats!==null&&hours>0?Math.ceil(availableSeats*24/hours):null,
    last3FullDaysPaidTickets:pastThree,averagePer24h:pastThree===null?null:Math.round(pastThree/3*10)/10};
  const allQuotes=signals?.messenger?.find(m=>m.showId===show.id);
  const cohort=signals?.saleAudit?.rows?.find(entry=>entry.showId===show.id&&entry.day===day);
  const coverageDay=signals?.saleAudit?.coverage?.find(entry=>entry.day===day);
  const review=signals?.saleAudit?.review;
  const findings=review?.status==='completed'&&review.day===day?review.reviews.find(entry=>entry.showId===show.id)?.findings??[]:[];
  const funnel={cohort:cohort??null,coverage:coverageDay??null,findings,quotedChats:allQuotes?.quotedChats??null,linkedPaidChats:allQuotes?.linkedPaidChats??null,
    fromDay:signals?.fromDay??null,toDay:signals?.toDay??null};
  const campaigns=day===signals?.toDay?(economicSource?.campaigns??[]).filter(c=>c.showId===show.id).sort((a,b)=>b.spendVnd-a.spendVnd).slice(0,8):[];
  const constraints=['Doanh thu vé đã thanh toán đã loại trùng theo mã đơn; vé mời và đơn chờ chỉ theo dõi riêng.','Chưa có phân bổ tiền thu từng đơn cho từng chiến dịch; chưa đo được lợi nhuận riêng của kênh Meta.'];
  if(cumulative.provisionalNetVnd===null)constraints.push('Thiếu doanh thu hoặc giá vốn show để kết luận chênh lệch lũy kế.');
  return {daily,cumulative,pace,funnel,campaigns,constraints};
}
function adIncreaseBlockReason(econ){
  if(!econ||econ.daily.afterAssignedAdsVnd===null)return 'Chưa đủ số thu vé và chi Meta quy được cho show trong ngày.';
  if(econ.daily.afterAssignedAdsVnd<=0)return 'Tiền vé trong ngày chưa bù được tiền quảng cáo đã nhận diện.';
  if(econ.cumulative.provisionalNetVnd===null)return 'Chưa đủ giá vốn để đánh giá chênh lệch thu chi của show.';
  if(econ.cumulative.provisionalNetVnd<0)return 'Show còn thiếu '+currency(-econ.cumulative.provisionalNetVnd)+' để bù chi phí đang ghi nhận.';
  if(!(econ.daily.attributedContributionAfterAdsVnd>0))return 'Chưa đối chiếu được doanh thu và chi phí của các đơn mà quảng cáo mang về.';
  return null;
}
function economicSections(show,day,finance,run,context={}){
  const row=finance?.data?.rows?.find(entry=>entry.showId===show.id);
  const live=context.signals,stored=run?.facts?.musicSignals;
  const signals=live&&live.fromDay<=day&&day<=live.toDay?live:stored??live;
  const econ=computeShowEconomics(show,day,row,signals,context.checkedAt??finance?.data?.checkedAt);
  const {daily,cumulative,pace}=econ;
  const dayLines=['Tiền vé thu nhận ngày '+displayDate(day)+': '+currency(daily.revenueVnd)+'.',
    'Chi Meta nhận diện riêng cho show: '+currency(daily.assignedAdsVnd)+(daily.adAsOf?' · lấy dữ liệu lúc '+timestamp(daily.adAsOf):'')+'.',
    'Tiền vé trừ chi quảng cáo nhận diện: '+currency(daily.afterAssignedAdsVnd)+'.'];
  if(count(daily.unassignedAccountSpendVnd))dayLines.push('Chi chung chưa phân về show trên hai tài khoản: '+currency(daily.unassignedAccountSpendVnd)+'.');
  for(const campaign of econ.campaigns)dayLines.push(campaign.campaignName+' · '+currency(campaign.spendVnd)+'.');
  dayLines.push('Chi phí vận hành, thuế và hoa hồng chưa có bảng phân theo ngày. Chênh lệch trên là số trước các khoản đó.',econ.constraints[1]);
  const cumulativeLines=['Tiền vé thu lũy kế đến '+displayDate(day)+': '+currency(cumulative.revenueVnd)+'.',
    'Chi phí show đã khai báo: '+currency(cumulative.declaredCostVnd)+'.'];
  if(cumulative.declaredCategories){
    for(const [key,value] of Object.entries(cumulative.declaredCategories))if(value>0)cumulativeLines.push(costLabels[key]+': '+currency(value)+'.');
    if(cumulative.missingCosts.length)cumulativeLines.push('Các khoản đang ghi 0, cần kiểm tra khi chốt sổ: '+cumulative.missingCosts.map(k=>costLabels[k]).join(', ')+'.');
  }
  if(cumulative.observedAdsVnd!==null)cumulativeLines.push('Chi Meta đã ghi nhận'+(cumulative.adsFrom?' từ '+displayDate(cumulative.adsFrom):'')+': '+currency(cumulative.observedAdsVnd)+'.');
  if(cumulative.declaredCategories)cumulativeLines.push('Khoản quảng cáo dùng số lớn hơn giữa chi khai báo và chi Meta đã nhận diện để tránh tính trùng. Phần quảng cáo ngoài Meta cần đối chiếu riêng.');
  cumulativeLines.push('Tổng chi dùng để tạm tính: '+currency(cumulative.costBasisVnd)+'.',
    'Chênh lệch lũy kế tạm tính theo tiền vé và các khoản chi đã biết: '+currency(cumulative.provisionalNetVnd)+'.',
    'Tiền vé đã gộp đơn online và sale bán thủ công theo mã đơn; các khoản thu khác và hoàn trả chưa có nguồn đối chiếu.');
  const result=[{title:'Hiệu quả quảng cáo trong ngày',lines:dayLines},{title:'Kinh tế lũy kế của show',lines:cumulativeLines}];
  if(pace.availableSeats!==null&&pace.hoursToShow>0)result.push({title:'Tiến độ bán trước giờ diễn',lines:[
    'Còn '+pace.availableSeats+' ghế bán được, còn '+pace.hoursToShow.toLocaleString('vi-VN')+' giờ trước giờ diễn.',
    'Để bán hết số ghế này cần tốc độ tương đương '+pace.requiredPer24h+' vé trong 24 giờ.',
    pace.averagePer24h===null?'Chưa có lịch sử đủ để đo tốc độ bán.':'Tốc độ ba ngày trọn vẹn trước ngày báo cáo: '+pace.averagePer24h.toLocaleString('vi-VN')+' vé thanh toán/ngày.'
  ]});
  const {cohort,coverage,findings}=econ.funnel;
  if(cohort||coverage){
    const lines=[];
    if(coverage)lines.push('Phạm vi rà soát: '+coverage.identifiedChats+' trong '+coverage.allInboundChats+' hội thoại khách nhắn trong ngày xác định được duy nhất một show.');
    if(cohort){
      lines.push('Riêng show này có '+cohort.inquiryChats+' hội thoại hỏi vé, '+cohort.engagedChats+' được phản hồi, '+cohort.quotedChats+' nhận báo giá, '+cohort.checkoutChats+' tạo đơn và '+cohort.paidChats+' ghi nhận thanh toán trong nhóm hội thoại theo dõi.');
      lines.push('Cần rà soát '+cohort.repeatedContactChats+' hội thoại có dấu hiệu hỏi lại thông tin và '+cohort.paidRepromptChats+' hội thoại có dấu hiệu nhắc thanh toán sau khi đơn đã trả tiền.');
    }else lines.push('Chưa thấy hội thoại gắn chắc chắn với show này trong dữ liệu rà soát.');
    lines.push(...findings);
    result.push({title:'AI Sale 2.3 · Rà soát hội thoại trong ngày',lines});
  }
  return result;
}
module.exports={computeShowEconomics,economicSections,parseEconomicsSource,adIncreaseBlockReason};

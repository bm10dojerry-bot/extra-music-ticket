'use strict';

const {randomUUID} = require('node:crypto');
const {getMusicSnapshot} = require('./music-readonly.cjs');
const {getMusicFinance} = require('./daily-reports.cjs');
const {allowed, check} = require('./v11-auth.cjs');
const {cleanText,readNumber} = require('./v11-costs.cjs');
const {cameraId, imouConfig} = require('./v11-imou.cjs');
const {requireValue, keyPattern, uuidPattern, validDay, dayVN, transaction, recordAudit} = require('./v11-core.cjs');

const sourceCatalog = {
  music: {label:'Music',scope:{platform:'music'},origin:'iextra.net và API báo cáo Music',permission:'READ ONLY', missing:'Giờ thanh toán, đối chiếu hoàn tiền và phân bổ quảng cáo'},
  retail: {label:'24H',scope:{platform:'24h'},origin:'Chứng từ nội bộ',permission:'Đọc tổng hợp',missing:'Sapo FnB, tồn kho và định mức tự động'},
  meta: {label:'Meta Ads',scope:{dataGroup:'advertising'},origin:'Meta Marketing API · Insights',permission:'GET',missing:'Đối soát hoàn chỉnh các lớp ngân sách và doanh thu quy thuộc theo vé'},
  imou: {label:'Imou Camera',scope:{platform:'24h',location:'sidewalk',camera:cameraId},origin:'Imou Open Platform',permission:'Danh sách giới hạn một camera, đọc trạng thái và media',missing:'Xác nhận hạn mức tài khoản và khả năng thiết bị'},
  drive: {label:'Google Drive',scope:{dataGroup:'media'},origin:'Google Drive',permission:'Chưa có nguồn đọc chuyên dụng',missing:'Quyền và thư mục được cấp'},
  finance: {label:'Tài chính',scope:{dataGroup:'finance'},origin:'Input Cost Center · chứng từ và đơn giá',permission:'Dữ liệu riêng EXTRA OS',missing:'Chi phí ngoài danh mục đã đối soát, công nợ và dòng tiền tự động'},
  weather: {label:'Thời tiết',scope:{dataGroup:'research'},origin:'Chưa có nhà cung cấp',permission:'Chưa cấp',missing:'Địa điểm, thời điểm và nguồn kiểm chứng'},
  tourism: {label:'Du lịch',scope:{dataGroup:'research'},origin:'Chưa có nhà cung cấp',permission:'Chưa cấp',missing:'Lượng khách và công suất lưu trú'},
  market: {label:'Thị trường',scope:{dataGroup:'research'},origin:'Chưa có nhà cung cấp',permission:'Chưa cấp',missing:'Đối thủ, sự kiện, nhu cầu, tìm kiếm và giao thông'},
  history: {label:'Dữ liệu lịch sử',scope:{dataGroup:'planning'},origin:'Nhật ký quyết định và phiên bản EXTRA OS',permission:'Đọc theo quyền',missing:'Kết quả thực thi và sai lệch dự báo cần đối soát'}
};

async function refreshSources(pool, actor) {
  const viewContext = {dataGroup:'sources'};
  check(actor,'source.refresh',viewContext);
  const [snapshot, finance] = await Promise.all([getMusicSnapshot(),getMusicFinance()]);
  const available = [snapshot.showsAvailable,snapshot.inventoryAvailable,finance.status === 'available'].filter(Boolean).length;
  const state = available === 3 ? 'AVAILABLE' : available ? 'PARTIAL' : 'UNAVAILABLE';
  await transaction(pool,async client => {
    await client.query(`
      insert into os_v11_sources(source,state,details) values('music',$1,$2) on conflict(source) do update
      set state=excluded.state,details=excluded.details,checked_at=clock_timestamp()
    `, [state,JSON.stringify({respondingParts:available, expectedParts:3, paymentReport:finance.status,
      error:state === 'UNAVAILABLE' ? 'MUSIC_SOURCE_UNAVAILABLE' : null})]);
    await recordAudit(client,actor,'source.checked', {platform:'music',dataGroup:'sources'}, {source:'music',state});
  });
}

async function sourcesView(pool, actor, env = process.env) {
  requireValue(actor && (actor.role === 'OWNER' || actor.grants.some(grant => grant.permission === 'source.read')), 'FORBIDDEN',403);
  const [snapshots,summaries] = await Promise.all([
    pool.query('select source,state,checked_at,details from os_v11_sources'),
    pool.query(`select
      (select max(updated_at) from os_v11_operations) as retail,
      (select max(updated_at) from os_v11_costs) as finance,
      (select max(updated_at) from os_v11_goals) as history,
      (select to_jsonb(s) from os_v11_camera_status s where camera=$1) as camera,
      (select to_jsonb(t) from os_v11_ads_ticks t order by slot desc limit 1) as ads,
      (select jsonb_agg(entry) from (select source,max(evidence_at) as last,count(*)::int as count
        from os_v11_external_evidence group by source) entry) as external`, [cameraId])
  ]);
  const sources = new Map(snapshots.rows.map(row => [row.source,row]));
  const summary = summaries.rows[0];
  const stamp = (source, state, checkedAt, details = {}) => sources.set(source,{state,checked_at:checkedAt,details});
  if (summary.ads) stamp('meta',summary.ads.status === 'available' ? 'PARTIAL' : summary.ads.status === 'error' ? 'UNAVAILABLE' : 'MISSING',
    summary.ads.completed_at,{...summary.ads.details,error:summary.ads.status === 'error' ? 'META_SOURCE_UNAVAILABLE' : null});
  const imou = imouConfig(env);
  if (summary.camera) stamp('imou',summary.camera.reason ? 'UNAVAILABLE' : 'PARTIAL',summary.camera.checked_at,
    {status:summary.camera.status,error:summary.camera.reason,exactCamera:true});
  else if (imou.credentialsPresent) stamp('imou','PARTIAL',null,{status:'CREDENTIALS_CONFIGURED',exactCamera:imou.deviceConfigured});
  for (const entry of summary.external ?? []) stamp(entry.source,'PARTIAL',entry.last,{count:entry.count,origin:'Chứng cứ ghi nhận thủ công'});
  for (const source of ['retail','finance','history']) if (summary[source]) stamp(source,'PARTIAL',summary[source],{scope:'internal'});
  return Object.entries(sourceCatalog).flatMap(([id,item]) => {
    const scope = {dataGroup:'sources',...item.scope};
    if (!allowed(actor,'source.read',scope)) return [];
    return [{id,...item,state:'MISSING',checked_at:null,details:{},...sources.get(id),costVnd:null}];
  });
}

async function auditView(pool, actor, onlyFindings = false) {
  requireValue(actor.role === 'OWNER' || actor.grants.some(grant => grant.permission === 'audit.read'), 'FORBIDDEN',403);
  const filter = actor.grants.filter(grant => grant.permission === 'audit.read').map(grant => grant.scope);
  const {rows} = await pool.query(`
    select id,actor_id,event,scope,details,created_at from os_v11_audit
    where ($1::boolean or exists(select 1 from jsonb_array_elements($2::jsonb) s where os_v11_audit.scope @> s))
      and (not $3::boolean or event like 'audit.%' or event in ('ads.blocked','operations.crowd.alerted'))
    order by id desc limit 200
  `, [actor.role === 'OWNER',JSON.stringify(filter),onlyFindings]);
  return rows.filter(row => allowed(actor,'audit.read',row.scope));
}

async function auditReport(pool, actor, input) {
  const {platform, subject, severity} = input;
  requireValue(['music','24h'].includes(platform) && ['finance','advertising','camera','access','planning','ai'].includes(subject) &&
    ['warning','critical','note'].includes(severity));
  const scope = {platform,dataGroup:subject};
  check(actor,'audit.report',scope);
  const summary = cleanText(input.summary,1500,true);
  const evidence = cleanText(input.evidence,500,true);
  await recordAudit(pool,actor,'audit.independent.finding',scope,{severity,summary,evidence});
}

async function checkInternalControls(pool, actor, platform) {
  requireValue(['music','24h'].includes(platform));
  const scope = {platform,dataGroup:'audit'};
  check(actor,'audit.report',scope);
  await transaction(pool,async client => {
    const {rows:[report]} = await client.query(`select
      (select count(*)::int from os_v11_costs c where platform=$1 and status<>'rejected' and
        details->>'booking' in ('expense','revenue_deduction') and (
        (details->>'actualVnd' is null) or (details->>'taxTreatment'='excluded' and details->>'actualTaxVnd' is null))) as missing_costs,
      (select count(*)::int from os_v11_costs c where platform=$1 and status='approved' and
        (details->>'remainingVnd')::bigint>0 and (details->>'due')::date< (now() at time zone 'Asia/Ho_Chi_Minh')::date) as overdue,
      (select count(*)::int from os_v11_ads_targets t where platform=$1 and not exists(
        select 1 from os_v11_ads_observations o where o.layer='adset' and o.key=t.account||':'||t.campaign||':'||t.ad_set
        and o.source='meta' and o.verified and o.observed_at>now()-interval '15 minutes')) as unverified_ads,
      (select count(*)::int from os_v11_goals where platform=$1 and status='blocked') as blocked_director,
      (select coalesce(sum(calls),0)::int from os_live_director_call_budget where day=(now() at time zone 'Asia/Ho_Chi_Minh')::date) as model_calls`,
    [platform]);
    await recordAudit(client,actor,'audit.control.reviewed',scope,{...report,verifiedAttributedRevenueVnd:null,
      aiCostVnd:null,cameraCloudCostVnd:null,forecastVarianceVnd:null});
  });
}


async function saveExternalEvidence(pool, actor, form) {
  check(actor,'source.write');
  const source = form.get('source'), platform = form.get('platform'), key = form.get('scope');
  const day = form.get('evidenceDay'), confidence = form.get('confidence');
  const assessment = cleanText(form.get('assessment')?.replace(/\s+/g,' '),750,true);
  requireValue(['weather','tourism','market','drive'].includes(source) && ['music','24h'].includes(platform) &&
    keyPattern.test(key ?? '') && validDay(day) && day <= dayVN() && ['high','medium','low'].includes(confidence));
  const raw = cleanText(form.get('reference'),450,true);
  let reference;
  try { reference = new URL(raw); } catch { requireValue(false,'EVIDENCE_URL'); }
  requireValue(reference.protocol==='https:' && !reference.username && !reference.password && !reference.search && !reference.hash,
    'EVIDENCE_URL');
  const scope={platform,[platform==='music'?'show':'location']:key,dataGroup:'research'};
  return transaction(pool,async client=>{
    const {rowCount} = await client.query(`
      insert into os_v11_external_evidence(id,source,platform,scope_key,evidence_at,reference,assessment,confidence,actor_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing
    `,[randomUUID(),source,platform,key,day+'T12:00:00+07:00',reference.href,assessment,confidence,actor.id]);
    requireValue(rowCount===1,'DUPLICATE',409);
    await recordAudit(client,actor,'source.evidence.recorded',scope,{source,day,confidence});
  });
}

async function externalFor(pool, platform, scopeKey, day) {
  const {rows} = await pool.query(`
    select id,source,reference,assessment,confidence,evidence_at from os_v11_external_evidence where platform=$1 and scope_key=$2
    and evidence_at<($3::date+interval '1 day') at time zone 'Asia/Ho_Chi_Minh'
    and evidence_at>=($3::date-interval '14 days') at time zone 'Asia/Ho_Chi_Minh'
    order by evidence_at desc,id limit 20
  `, [platform,scopeKey,day]);
  return rows;
}

async function saveOutcome(pool,actor,platform,form) {
  check(actor,'memory.write');
  requireValue(['music','24h'].includes(platform));
  const scopeKey=form.get('scope');
  requireValue(keyPattern.test(scopeKey ?? ''));
  const goalId=form.get('goal') || null;
  const outcome = cleanText(form.get('outcome')?.replace(/\s+/g,' '),550,true);
  const source = cleanText(form.get('source'),180,true);
  const actual = readNumber(form.get('actualVnd'));
  const forecast = readNumber(form.get('forecastVnd'));
  let version = null;
  if (goalId) {
    requireValue(uuidPattern.test(goalId));
    const {rows:[goal]}=await pool.query('select version,platform,scope_key from os_v11_goals where id=$1',[goalId]);
    requireValue(goal?.platform===platform && goal?.scope_key===scopeKey,'GOAL_MISSING',404);
    version = goal.version;
  }
  await recordAudit(pool,actor,'memory.outcome.recorded',{platform,[platform==='music'?'show':'location']:scopeKey,dataGroup:'planning'},
    {goalId,version,outcome,source,actualVnd:actual,forecastVnd:forecast,varianceVnd:actual!==null&&forecast!==null ? actual-forecast : null});
}

async function decisionHistory(pool, actor, platform) {
  requireValue(['music','24h'].includes(platform));
  const rows = await auditView(pool,actor);
  return rows.filter(row => row.scope.platform === platform && /^(director\.|audit\.|memory\.|ads\.(approved|rejected|simulated)|cost\.coverage)/.test(row.event));
}

module.exports = {sourceCatalog, refreshSources, sourcesView, auditView, auditReport, checkInternalControls, decisionHistory, saveExternalEvidence, externalFor, saveOutcome};

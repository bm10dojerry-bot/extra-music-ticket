'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {checkDeployment, dayVN} = require('./v11-core.cjs');
const {allowed} = require('./v11-auth.cjs');
const {parseCost,summarizeCosts} = require('./v11-costs.cjs');
const {budgetLayers,parseMetaRow,makeMetaReader} = require('./v11-ads.cjs');
const {signImou,makeImou,safeMediaUrl,rewritePlaylist} = require('./v11-imou.cjs');
const {musicAssessment,retailSummary,bounds} = require('./v11-operations.cjs');

const env = {RAILWAY_ENVIRONMENT_NAME:'staging-v11',DATABASE_URL:'postgresql://admin:x@extra.railway.internal/extra_os_v11'};
test('V1.1 only starts in separate Railway staging with its own database and read-only provider credentials',()=>{
  assert.doesNotThrow(()=>checkDeployment(env));
  for (const forbidden of [
    {RAILWAY_ENVIRONMENT_NAME:'production'},{RAILWAY_ENVIRONMENT_NAME:'staging'},
    {DATABASE_URL:'postgresql://admin:x@extra.railway.internal/railway'},
    {DATABASE_URL:'postgresql://admin:x@prod.example/extra_os_v11'},
    {SUPABASE_SERVICE_ROLE_KEY:'fixture'},{EXTRA_OS_MARKETING_LIVE:'true'},{EXTRA24H_META_ADS_TOKEN:'fixture'},
    {EXTRA_OS_OPENAI_API_KEY:'fixture'}
  ]) assert.throws(()=>checkDeployment({...env,...forbidden}));
});

test('RBAC intersects module, platform, ad account and show scopes on the server',()=>{
  const scope = {platform:'music',account:'10000',show:'show-1',dataGroup:'advertising'};
  const operator = {role:'ADS_MANAGER',grants:[{permission:'ads.pause',scope},{permission:'ads.approve',scope}],displayName:'OWNER'};
  assert.equal(allowed(operator,'ads.pause',scope),true);
  assert.equal(allowed(operator,'ads.pause',{...scope,account:'20000'}),false);
  assert.equal(allowed(operator,'ads.pause',{...scope,show:'show-2'}),false);
  assert.equal(allowed(operator,'ads.approve',scope),false);
  assert.equal(allowed(operator,'ads.pause',{platform:'music'}),false);
  assert.equal(allowed({role:'AI_DIRECTOR',grants:[{permission:'ads.increase',scope}]},'ads.increase',scope),false);
});

test('planned and actual ledger amounts keep unknown, tax basis, revenue deduction and payment separate',()=>{
  const base = {source:'Fixture receipt',behavior:'fixed',relation:'direct',taxTreatment:'included',booking:'expense'};
  const cost = (values,status='approved') => ({status,details:parseCost(new URLSearchParams({...base,...values}))});
  const rows = [
    cost({actualVnd:'1000',actualTaxVnd:'100',plannedVnd:'960',approvedVnd:'1100',contractVnd:'2000',paidVnd:'500',depositVnd:'200'}),
    cost({actualVnd:'200',actualTaxVnd:'20',taxTreatment:'excluded'}),
    cost({actualVnd:'125',booking:'revenue_deduction'}),
    cost({actualVnd:'50',booking:'cash_only'}),
    cost({actualVnd:'5000',booking:'shared_pool'})
  ];
  assert.equal(rows[0].details.remainingVnd,1500);
  const summary = summarizeCosts(rows,['actual']);
  assert.equal(summary.actual.expense.total,1220);
  assert.equal(summary.actual.revenueDeduction.total,125);
  assert.equal(summary.planned.expense.total,null);
  assert.equal(summarizeCosts([...rows,cost({actualVnd:'100',taxTreatment:'excluded'})],['actual']).actual.expense.total,null);
  assert.equal(summarizeCosts(rows).actual.expense.total,null);
  assert.throws(()=>cost({paidVnd:'100',depositVnd:'101'}),/DEPOSIT_EXCEEDS_PAID/);
});

test('budget keys include shared business cap, platform-specific show and seven distinct layers',()=>{
  const item = {account:'10000',platform:'music',show_key:'a',campaign:'20000',ad_set:'30000',starts_on:'2030-01-01',ends_on:'2030-01-02'};
  const a = budgetLayers(item,'2030-01-01');
  const b = budgetLayers({...item,platform:'24h'},'2030-01-01');
  assert.equal(a.length,7);
  assert.deepEqual(a[0],b[0]);
  assert.notDeepEqual(a[2],b[2]);
  assert.deepEqual(a[5],['day','2030-01-01']);
});

test('Meta reads the configured account only and keeps purchase value separate from attributed ticket revenue',async()=>{
  const target = {account:'10000',campaign:'20000',ad_set:'30000'};
  const options = {EXTRA_OS_V11_META_READ_TOKEN:'fixture',EXTRA_OS_V11_META_VERSION:'v27.0',EXTRA_OS_V11_META_ACCOUNTS:'10000'};
  let called = 0;
  const mock = async (url,init) => {
    assert.equal(init.method,'GET');
    called++;
    const path = new URL(url).pathname;
    if (path.endsWith('/act_10000')) return Response.json({account_id:'10000',currency:'VND',timezone_name:'Asia/Ho_Chi_Minh',account_status:1});
    if (path.endsWith('/30000')) return Response.json({id:'30000',account_id:'10000',campaign_id:'20000',daily_budget:'1000'});
    return Response.json({data:[{date_start:'2030-01-01',date_stop:'2030-01-01',spend:'100.00',
      action_values:[{action_type:'omni_purchase',value:'500'}],actions:[{action_type:'omni_purchase',value:'2'}]}]});
  };
  const source = makeMetaReader(options,mock);
  const metrics = await source.metrics(target,'2030-01-01');
  assert.equal(metrics.roasReportedByMeta,5);
  assert.equal(metrics.verifiedAttributedRevenueVnd,null);
  assert.equal(metrics.ticketAcquisitionVnd,null);
  assert.equal(called,5);
  await assert.rejects(source.metrics({...target,account:'55555'},'2030-01-01'),/META_NOT_CONFIGURED/);
  assert.equal(called,5);
  assert.equal(parseMetaRow({spend:'0'}).roasReportedByMeta,null);
});

test('Imou implements the provider signature, token lifetime, refresh and one-device/channel allowlist',async()=>{
  const nonce = 'f5a1ae2d-c09c-4d39-a744-83a5c2c653c2';
  assert.equal(signImou('test123456789test123456789',1706511734,nonce),'xjhCQBoJ9hRDsCjyDcHjtDNzRZ3ZJezcawsfWeiaoxU=');
  let now = 1706511734000;
  let authCalls = 0, statusCalls = 0;
  const options = {IMOU_APP_ID:'fixture-app',IMOU_APP_SECRET:'fixture-secret',IMOU_DATA_CENTER:'sg',
    IMOU_PILOT_SERIAL:'ONLYFIXTURECAM',IMOU_PILOT_CHANNEL:'0'};
  const mock = async (url,init) => {
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'error');
    const body = JSON.parse(init.body);
    assert.equal(body.system.time,Math.floor(now/1000));
    assert.equal(body.system.sign,signImou(options.IMOU_APP_SECRET,body.system.time,body.system.nonce));
    const path = new URL(url).pathname;
    const result = (data, code='0')=>Response.json({id:body.id,result:{code,data}});
    if (path==='/openapi/accessToken') return result({accessToken:'fixture-token-'+(++authCalls),expireTime:180});
    assert.equal(body.params.deviceId ?? body.params.deviceList[0].deviceId,options.IMOU_PILOT_SERIAL);
    assert.equal(body.params.token,'fixture-token-'+authCalls);
    if (path==='/openapi/v2/device.status.get') {
      if (++statusCalls===2) return result(null,'TK1002');
      return result({deviceId:'ONLYFIXTURECAM',online:1,channels:[{channelId:'0',online:statusCalls===1?1:0}]});
    }
    if (path==='/openapi/v2/device.detail.list') return result({deviceList:[{deviceId:'NOT_ALLOWED',deviceName:'hidden'},
      {deviceId:'ONLYFIXTURECAM',deviceModel:'fixture-model',deviceName:'Vỉa hè',playTokenV2:'sensitive-ignored'}]});
    if (path==='/openapi/setDeviceSnap') return result({url:'https://snap.imoulife.com/test.jpg?Signature=example'});
    return result({streams:[{status:'1',hls:'https://snap.imoulife.com/index.m3u8'}]});
  };
  const connector = makeImou({env:options,request:mock,clock:()=>now});
  await assert.rejects(connector.status('outside-allowlist'),/FORBIDDEN/);
  assert.equal(authCalls,0);
  await Promise.all([connector.status('imou-sidewalk'),connector.list('imou-sidewalk')]);
  assert.equal(authCalls,1);
  assert.equal(await connector.status('imou-sidewalk'),'offline');
  assert.equal(authCalls,2);
  now += 200000;
  assert.match(await connector.snapshot('imou-sidewalk'),/test.jpg/);
  assert.equal(authCalls,3);
  assert.match(await connector.live('imou-sidewalk'),/index.m3u8/);
  assert.equal(authCalls,3);
});

test('Imou media rewrites stream resources to same-origin opaque paths and rejects encrypted or foreign media',()=>{
  const base = new URL('https://snap.imoulife.com/stream/index.m3u8?token=fixture');
  const manifest = '#EXTM3U\n#EXTINF:2,\nfile.ts?token=fixture\n';
  let called = 0;
  const rewritten = rewritePlaylist(manifest,base,base.hostname,(url,playlist)=> {
    assert.equal(url.hostname,base.hostname);
    assert.equal(playlist,false);
    return '/v11/camera/media/fixture/'+(++called);
  });
  assert.doesNotMatch(rewritten,/token|https/);
  assert.match(rewritten,/\/v11\/camera\/media\/fixture\/1/);
  assert.throws(()=>safeMediaUrl('http://snap.imoulife.com/file',base.hostname),/IMOU_MEDIA_URL/);
  assert.throws(()=>safeMediaUrl('https://example.com/file',base.hostname),/IMOU_MEDIA_URL/);
  assert.throws(()=>rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n',base,base.hostname,()=>''),/IMOU_ENCRYPTED_STREAM/);
});

test('analysis withholds forecasts when sources are missing and computes three bounded Music scenarios with evidence',()=>{
  const today=new Date('2030-01-04T05:00:00Z');
  const show={id:'fixture',date:'2030-01-05',time:'19:00',inventory:{capacity:100,sellable:30}};
  const financialRows=[{showId:'fixture',total:{paidTickets:20,revenueVnd:5000},days:Object.fromEntries([1,2,3].map((n)=>
    ['2030-01-0'+n,{paidTickets:n,revenueVnd:n*250}]))}];
  const approval={expense:{total:8000},revenueDeduction:{total:0}};
  const ledger={totals:{actual:{expense:{total:6000},revenueDeduction:{total:0}},approved:approval},costs:[]};
  const item=musicAssessment(show,{data:{rows:financialRows}},ledger,today);
  assert.equal(item.profit,-1000);
  assert.equal(item.additionalAtBreakEven,12);
  assert.equal(item.scenarios.length,3);
  assert.ok(item.scenarios.every(row=>row.extra<=30 && row.revenue>=item.revenue));
  assert.equal(musicAssessment(show,null,ledger,today).scenarios.length,0);
  assert.equal(musicAssessment(show,{data:{rows:financialRows}},null,today).profit,null);
  assert.equal(dayVN(today),'2030-01-04');
});

test('24H contribution break-even and hourly profitability require covered, non-overlapping metrics',()=>{
  const rows=[{fields:{netRevenueVnd:1000,cogsVnd:400,laborVnd:120,otherCostVnd:180,orders:5,customers:7}}];
  const summary=retailSummary(rows,true);
  assert.equal(summary.profitVnd,300);
  assert.equal(summary.breakEvenRevenueVnd,500);
  assert.equal(summary.avgOrderVnd,200);
  assert.equal(retailSummary(rows,false).profitVnd,null);
  assert.equal(retailSummary([{fields:{netRevenueVnd:1000}}],true).profitVnd,null);
  assert.deepEqual(bounds('2028-02-21','month'),{start:'2028-02-01',end:'2028-02-29',expected:29});
});

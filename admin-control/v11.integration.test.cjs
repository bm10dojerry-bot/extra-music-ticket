'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Pool} = require('pg');
const core = require('./v11-core.cjs');
const auth = require('./v11-auth.cjs');
const cost = require('./v11-costs.cjs');
const ads = require('./v11-ads.cjs');
const camera = require('./v11-imou.cjs');
const ops = require('./v11-operations.cjs');
const director = require('./v11-director.cjs');
const live = require('./live-director.cjs');
const evidence = require('./v11-evidence.cjs');

const databaseUrl = process.env.DIRECTOR_TEST_DATABASE_URL;
const pg = {skip: !databaseUrl};
const ownerPassword = 'test-only-owner-account-access';
let owner;

async function database(t) {
  const admin = new Pool({connectionString:databaseUrl});
  const schema = 'test_v11_'+randomUUID().replaceAll('-','');
  await admin.query('create schema '+schema);
  const pool = new Pool({connectionString:databaseUrl,options:'-c search_path='+schema});
  t.after(async()=>{
    await pool.end();
    await admin.query('drop schema '+schema+' cascade');
    await admin.end();
  });
  await core.migrateV11(pool,{verifyDatabase:false});
  await core.migrateV11(pool,{verifyDatabase:false});
  await auth.setupOwner(pool,ownerPassword);
  const id = await auth.authenticate(pool,'owner',ownerPassword);
  owner = {id,role:'OWNER',grants:[]};
  return pool;
}

function testCost(overrides = {}) {
  return new URLSearchParams({
    id:randomUUID(),code:'cost-1', sourceLine:'fixture-invoice/1',classification:'Nghệ sĩ / MC',
    source:'Chứng từ kiểm thử',behavior:'fixed',relation:'direct',taxTreatment:'included',
    booking:'expense',status:'approved',actualVnd:'500',approvedVnd:'500',...overrides
  });
}

async function person(pool, username, role) {
  const code = await auth.invite(pool,owner,{username,displayName:'Nhân sự kiểm thử',role});
  const result = await auth.acceptInvite(pool,code,'test-only-member-account-password');
  assert.equal(result,username);
  await assert.rejects(auth.acceptInvite(pool,code,'test-only-member-account-password'),/INVITE_INVALID/);
  const id = await auth.authenticate(pool,username,'test-only-member-account-password');
  await pool.query("insert into os_v11_sessions(token_hash,csrf,expires_at,actor_id) values($1,'fixture',now()+interval '1 hour',$2)",
    ['session-'+username,id]);
  return {id,actor:()=>auth.currentActor(pool,'session-'+username)};
}

test('V1.1 activates unique accounts, revokes grants in active sessions, and isolates independent auditor reports',pg,async t=>{
  const pool = await database(t);
  const user = await person(pool,'trang','ADS_MANAGER');
  const scope = {platform:'24h',account:'10000',show:'pilot',dataGroup:'advertising'};
  assert.equal(auth.allowed(await user.actor(),'ads.pause',scope),false);
  await auth.setGrant(pool,owner,{userId:user.id,permission:'ads.pause',scope});
  assert.equal(auth.allowed(await user.actor(),'ads.pause',scope),true);
  await assert.rejects(auth.setGrant(pool,owner,{userId:user.id,permission:'ads.approve',scope}),/FORBIDDEN/);
  await auth.setGrant(pool,owner,{userId:user.id,permission:'ads.pause',scope,revoke:true});
  assert.equal(auth.allowed(await user.actor(),'ads.pause',scope),false);
  const auditor = await person(pool,'auditor','AI_AUDITOR');
  await auth.setGrant(pool,owner,{userId:auditor.id,permission:'audit.report',scope:{platform:'music',dataGroup:'finance'}});
  await auth.setGrant(pool,owner,{userId:auditor.id,permission:'audit.read',scope:{platform:'music'}});
  const report = {platform:'music',subject:'finance',severity:'warning',summary:'Thiếu chứng từ',evidence:'Biên bản fixture'};
  const auditorActor = await auditor.actor();
  await evidence.auditReport(pool,auditorActor,report);
  const holder = await person(pool,'director','AI_DIRECTOR');
  const directActor = await holder.actor();
  await assert.rejects(evidence.auditReport(pool,directActor,report),/FORBIDDEN/);
  assert((await evidence.auditView(pool,owner,true)).some(row=>row.actor_id===auditor.id));
  assert((await evidence.auditView(pool,auditorActor,true)).some(row=>row.details.summary==='Thiếu chứng từ'));
  await assert.rejects(pool.query("update os_v11_audit set details='{}'"),/append-only/);
  await auth.disableAccount(pool,owner,user.id);
  assert.equal(await user.actor(),null);
});

test('V1.1 ledger versions, scoped receipts, prices and allocations cannot be written twice',pg,async t=>{
  const pool=await database(t);
  await cost.seedCategories(pool);
  const find = (scope,actor=owner)=>cost.readLedger(pool,actor,'music',scope);
  const pending = testCost();
  const id = await cost.saveCost(pool,owner,'music','show-a',pending);
  const total = async scope => (await find(scope)).totals.actual.expense.total;
  assert.equal(await total('show-a'),null);
  await cost.attestCosts(pool,owner,'music','show-a','actual','Đối soát fixture');
  assert.equal(await total('show-a'),500);
  await assert.rejects(cost.saveCost(pool,owner,'music','show-b',testCost()),/DUPLICATE/);
  pending.set('revision','1');
  pending.set('actualVnd','900');
  await cost.saveCost(pool,owner,'music','show-a',pending);
  assert.equal(await total('show-a'),null);
  await assert.rejects(cost.saveCost(pool,owner,'music','show-a',pending),/STALE_REVISION/);
  const histories=await pool.query('select snapshot from os_v11_cost_history where cost_id=$1 order by revision',[id]);
  assert.deepEqual(histories.rows.map(row=>row.snapshot.details.actualVnd),[500,900]);
  const parent = await cost.saveCost(pool,owner,'music','shared',testCost({code:'pool',sourceLine:'POOL/1',booking:'shared_pool'}));
  const allocated = testCost({code:'fraction',sourceLine:'POOL/1/25PCT',allocation:parent,relation:'allocated',
    actualVnd:'125',approvedVnd:'125'});
  await cost.saveCost(pool,owner,'music','show-b',allocated);
  await assert.rejects(cost.saveCost(pool,owner,'music','show-c',testCost({
    code:'fraction',sourceLine:'POOL/1/REST',allocation:parent,relation:'allocated',actualVnd:'400'
  })),/ALLOCATION_EXCEEDS_SOURCE/);
  assert.equal((await find('shared')).totals.actual.expense.known,0);
  await cost.saveSupplier(pool,owner,'music','Nhà cung cấp fixture');
  const supplier = (await find('show-a')).suppliers[0];
  const quote = new URLSearchParams({supplier:supplier.id,classification:'Nghệ sĩ / MC',unit:'lượt',unitPriceVnd:'100',
    source:'Báo giá fixture',asOf:core.dayVN()});
  await cost.saveQuote(pool,owner,'music',quote);
  const selected = (await find('show-a')).quotes[0];
  await cost.saveCost(pool,owner,'music','show-a',testCost({code:'quote',sourceLine:'QUOTE/1',supplier:supplier.id,quote:selected.id}));
  const priced = (await find('show-a')).costs.find(row=>row.code==='quote');
  assert.equal(priced.details.unitPriceBasis,'reference');
  assert.equal(priced.details.unitPriceVnd,100);
  const scoped = await person(pool,'hai','FINANCE_MANAGER');
  await auth.setGrant(pool,owner,{userId:scoped.id,permission:'cost.read',scope:{platform:'music',show:'show-a',dataGroup:'finance'}});
  assert.equal((await find('show-a',await scoped.actor())).costs.length,2);
  const member = await scoped.actor();
  await assert.rejects(find('show-b',member),/FORBIDDEN/);
});

async function adsFixture(pool, adSet, show='pilot', platform='music') {
  const day=core.dayVN();
  return ads.configureTarget(pool,owner,{platform,account:'12345',show,campaign:'23456',adSet,starts:day,ends:day,allocation:500});
}
const actionFixture = (targetId,overrides={}) => ({id:randomUUID(),targetId,action:'INCREASE_TOTAL_BUDGET',amount:100,
  basis:'fixture',from:null,reason:'Dry-run fixture',...overrides});

test('Ads rejects every missing or exceeded layer, stale and unverified data before spend approval',pg,async t=>{
  const pool=await database(t);
  const target=await adsFixture(pool,'34567');
  const day=core.dayVN();
  const limits=[1000,1000,1000,1000,1000,1000,1000];
  const zero=[0,0,0,0,0,0,0];
  const request = await ads.requestAction(pool,owner,actionFixture(target));
  await assert.rejects(ads.transitionAction(pool,owner,request.id,'approve',1),/LIMIT_MISSING_business/);
  await ads.setBudget(pool,owner,target,day,limits);
  await assert.rejects(ads.transitionAction(pool,owner,request.id,'approve',1),/SPEND_UNVERIFIED_business/);
  await ads.fixtureSpend(pool,owner,target,day,zero);
  for (const [i,layer] of ['business','account','show','campaign','adset','day','term'].entries()) {
    const caps = limits.map((value, index)=>index===i ? 99 : value);
    await ads.setBudget(pool,owner,target,day,caps);
    await assert.rejects(ads.transitionAction(pool,owner,request.id,'approve',1),new RegExp('LIMIT_EXCEEDED_'+layer));
  }
  await ads.setBudget(pool,owner,target,day,limits);
  const meta = await ads.requestAction(pool,owner,actionFixture(target,{basis:'meta'}));
  await assert.rejects(ads.transitionAction(pool,owner,meta.id,'approve',1),/SPEND_UNVERIFIED_business/);
  await pool.query("update os_v11_ads_observations set observed_at=now()-interval '16 minutes'");
  await assert.rejects(ads.transitionAction(pool,owner,request.id,'approve',1),/SPEND_UNVERIFIED_business/);
  assert.equal((await pool.query('select count(*)::int n from os_v11_ads_reservations')).rows[0].n,0);
  assert.equal((await evidence.auditView(pool,owner,true)).filter(row=>row.event==='ads.blocked').length,11);
});

test('Ads serializes competing execution, deduplicates, expires approvals and preserves emergency stop',pg,async t=>{
  const pool=await database(t);
  const target=await adsFixture(pool,'34567');
  const targetTwo=await adsFixture(pool,'34568','store','24h');
  const day=core.dayVN();
  const request = actionFixture(target,{amount:600});
  assert.equal((await ads.requestAction(pool,owner,request)).id,request.id);
  assert.equal((await ads.requestAction(pool,owner,request)).id,request.id);
  await assert.rejects(ads.requestAction(pool,owner,{...request,amount:599}),/DUPLICATE/);
  for (const id of [target,targetTwo]) {
    await ads.setBudget(pool,owner,id,day,[1000,1000,1000,1000,1000,1000,1000]);
    await ads.fixtureSpend(pool,owner,id,day,[0,0,0,0,0,0,0]);
  }
  const other=await ads.requestAction(pool,owner,actionFixture(targetTwo,{amount:600}));
  for (const id of [request.id,other.id]) assert.equal((await ads.transitionAction(pool,owner,id,'approve',1)).state,'approved');
  const attempts = await Promise.allSettled([request.id,other.id].map(id=>ads.transitionAction(pool,owner,id,'execute',2)));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.match(attempts.find(result=>result.status==='rejected').reason.message,/LIMIT_EXCEEDED_business/);
  const executed = attempts.find(result=>result.status==='fulfilled').value;
  const duplicate = await ads.transitionAction(pool,owner,executed.id,'execute',2);
  assert.deepEqual(duplicate.result,{mode:'dry_run',externalRequests:0,externalSpendVnd:0,
    checkedLayers:['business','account','show','campaign','adset','day','term']});
  assert.equal((await pool.query('select count(*)::int n from os_v11_ads_reservations')).rows[0].n,7);
  assert.equal((await ads.adsView(pool,owner,'music')).targets.length,1);
  const pending=await ads.requestAction(pool,owner,actionFixture(target,{amount:10}));
  await ads.transitionAction(pool,owner,pending.id,'approve',1);
  await ads.setStop(pool,owner,true,1);
  await assert.rejects(ads.transitionAction(pool,owner,pending.id,'execute',2),/EMERGENCY_STOP/);
  const pause=await ads.requestAction(pool,owner,actionFixture(target,{action:'PAUSE',amount:0}));
  await ads.transitionAction(pool,owner,pause.id,'approve',1);
  assert.equal((await ads.transitionAction(pool,owner,pause.id,'execute',2)).state,'simulated');
  await pool.query("update os_v11_ads_actions set expires_at=now()-interval '1 minute' where id=$1",[pending.id]);
  assert.equal((await ads.transitionAction(pool,owner,pending.id,'execute',2)).state,'expired');
  await assert.rejects(ads.setStop(pool,owner,false,1),/STALE_REVISION/);
});

test('camera checks RBAC and quota before requests, bounds snapshots and serves a private HLS manifest',pg,async t=>{
  const pool=await database(t);
  const options={IMOU_APP_ID:'fixture-app',IMOU_APP_SECRET:'secret-only-fixture',IMOU_DATA_CENTER:'sg',
    IMOU_PILOT_SERIAL:'FIXTURE001',IMOU_PILOT_CHANNEL:'0'};
  let network=0;
  const mock=async (where,init)=>{
    network++;
    const url=new URL(where);
    if(url.hostname==='snap.imoulife.com'){
      assert.equal(init.method,'GET');
      if(url.pathname.endsWith('.jpg')) return new Response(Buffer.from([255,216,255,224,0]));
      if(url.pathname.endsWith('.ts')) return new Response(Buffer.from([0x47,0,0,0]));
      return new Response('#EXTM3U\n#EXTINF:2,\nsegment.ts?signature=fixture-secret\n');
    }
    const body=JSON.parse(init.body);
    const data={
      accessToken:{accessToken:'opaque-fixture-token',expireTime:1000},
      'device.status.get':{deviceId:options.IMOU_PILOT_SERIAL,online:0,channels:[]},
      'device.detail.list':{deviceList:[{deviceId:options.IMOU_PILOT_SERIAL,deviceName:'Thử nghiệm',deviceModel:'Fixture',devicePasswordV2:'secret-only-fixture'}]},
      setDeviceSnap:{url:'https://snap.imoulife.com/test.jpg?signature=fixture-secret'},
      getLiveStreamInfo:{streams:[{status:'1',hls:'https://snap.imoulife.com/live.m3u8?signature=fixture-secret'}]}
    }[url.pathname.split('/').at(-1)];
    return Response.json({id:body.id,result:{code:'0',data}});
  };
  const cameraUi=camera.cameraService(pool,{env:options,request:mock});
  await assert.rejects(cameraUi.status(owner,'another-camera'),/FORBIDDEN/);
  await assert.rejects(cameraUi.status(owner,camera.cameraId),/IMOU_TERMS_UNVERIFIED/);
  assert.equal(network,0);
  await camera.configureCamera(pool,owner,{calls:5,snapshots:1,bytes:4500000,interval:900,retention:0,aiDay:0,aiMonth:0,
    host:'snap.imoulife.com',termsVerified:true,termsReference:'Fixture no paid account',revision:0});
  const viewer={...owner,token_hash:'test-session'};
  assert.equal((await cameraUi.status(viewer,camera.cameraId)).state,'offline');
  assert.equal((await cameraUi.snapshot(viewer,camera.cameraId)).type,'image/jpeg');
  await assert.rejects(cameraUi.snapshot(viewer,camera.cameraId),/IMOU_DAILY_LIMIT/);
  const session=await cameraUi.openLive(viewer,camera.cameraId);
  assert.doesNotMatch(session,/fixture/);
  await assert.rejects(cameraUi.media({...viewer,token_hash:'another'},session,'index'),/FORBIDDEN/);
  const media=await cameraUi.media(viewer,session,'index');
  assert.doesNotMatch(media.bytes.toString(),/fixture-secret|https:/);
  assert.match(media.bytes.toString(),new RegExp('/v11/camera/media/'+session+'/'));
  const segment = media.bytes.toString().split('\n').find(value=>value.startsWith('/v11/')).split('/').at(-1);
  assert.equal((await cameraUi.media(viewer,session,segment)).type,'video/mp2t');
  await assert.rejects(cameraUi.media(viewer,session,segment),/IMOU_DAILY_LIMIT/);
  const remaining=await cameraUi.view(viewer);
  assert.equal(remaining.usage.calls,5);
  assert.equal(remaining.usage.snapshots,1);
  await assert.rejects(cameraUi.status(viewer,camera.cameraId),/IMOU_DAILY_LIMIT/);
  const audit=await pool.query('select scope,details from os_v11_audit');
  assert.doesNotMatch(JSON.stringify(audit.rows),/secret-only-fixture|opaque-fixture-token|signature|FIXTURE001/);
});

test('24H protects attendance revisions, counts separately and records anonymous crowd alerts and review',pg,async t=>{
  const pool=await database(t);
  const day='2025-01-14';
  await ops.saveRetailObservation(pool,owner,'sidewalk',day,-1,new URLSearchParams({
    source:'Fixture daily receipt',netRevenueVnd:'8000',orders:'40',cogsVnd:'2600',laborVnd:'1000',otherCostVnd:'400'
  }));
  const obs = new URLSearchParams({source:'Fixture hourly report',netRevenueVnd:'2000',orders:'10',headcount:'2'});
  await ops.saveRetailObservation(pool,owner,'sidewalk',day,9,obs);
  await assert.rejects(ops.saveRetailObservation(pool,owner,'sidewalk',day,9,obs),/STALE_REVISION/);
  await ops.saveCrowdRule(pool,owner,{from:8,to:14,people:5,minutes:8,cooldown:90,exceptions:[11]},0);
  const anonymized=new URLSearchParams({source:'Manual fixture count',peakPeople:'8',crowdMinutes:'12',passers:'69',confidenceBps:'8500'});
  for (const hour of [9,10,11]) await ops.saveCounts(pool,owner,day,hour,anonymized);
  const {rows:[alert]} = await pool.query('select * from os_v11_operational_alerts');
  assert.equal((await pool.query('select count(*)::int n from os_v11_operational_alerts')).rows[0].n,1);
  assert.equal(alert.details.people,8);
  await ops.reviewAlert(pool,owner,alert.id);
  const analysis=await ops.readOperations(pool,'sidewalk',day);
  assert.equal(analysis.summary.orders,40);
  assert.equal(analysis.summary.customers,null);
  assert.equal(analysis.hourly[0].ordersPerStaff,5);
  assert.equal((await ops.readCounts(pool,day,day)).length,3);
  assert.equal((await ops.readOperations(pool,'sidewalk',day,'week')).summary.orders,null);
  const staff=await person(pool,'dieu','SALE_MANAGER');
  const shift=new URLSearchParams({id:randomUUID(),staff:staff.id,starts:day+'T07:00',ends:day+'T15:00',arrived:day+'T07:10',
    left:day+'T14:55',state:'confirmed'});
  await ops.saveShift(pool,owner,'24h-counter',shift);
  shift.set('revision','1');
  await assert.rejects(ops.saveShift(pool,owner,'24h-counter',shift),/CORRECTION_REASON_REQUIRED/);
  shift.set('note','Đã đối chiếu ca kiểm thử');
  await ops.saveShift(pool,owner,'24h-counter',shift);
  assert.equal((await pool.query('select revision from os_v11_staff_shifts')).rows[0].revision,2);
});

test('Director persists real step states, gates paid calls, assembles 11 replies and retains independent audit and revisions',pg,async t=>{
  const pool=await database(t);
  await live.initLiveDirector(pool);
  const now=new Date('2031-01-04T02:00:00Z');
  const day=core.dayVN(now);
  const deadline=day+'T16:30:00+07:00';
  const id=randomUUID();
  const objective='Rà soát doanh thu\nca sáng';
  await ops.saveRetailObservation(pool,owner,'sidewalk',core.dayVN(),-1,new URLSearchParams({
    source:'Chứng từ mô phỏng',netRevenueVnd:'7000',orders:'20'
  }));
  await director.submitGoal(pool,owner,{id,platform:'24h',scopeKey:'sidewalk',objective,period:'day'});
  await director.submitGoal(pool,owner,{id,platform:'24h',scopeKey:'sidewalk',objective,period:'day'});
  const scopeArgs=[pool,owner,'24h','sidewalk',id];
  await assert.rejects(director.decideGoal(pool,owner,id,'approved','Fixture'),/GOAL_NOT_READY/);
  for(let n=0;n<4;n++) assert.equal(await director.runGoalStep(pool,{env:{},now}),'queued');
  assert.equal(await director.runGoalStep(pool,{env:{},now}),null);
  let result=await director.goalsView(...scopeArgs);
  assert.equal(result.goal.reason,'model_not_configured');
  assert.equal(result.steps.length,5);
  await director.retryGoal(pool,owner,id);

  const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fictional-test-only',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'15'};
  let called=0;
  const provider=async (url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const args=JSON.parse(JSON.parse(init.body).input);
    assert.equal(args.facts.objective,'Rà soát doanh thu ca sáng');
    assert.ok(args.facts.v11Operations);
    const action={agent:'Analyst',action:'Rà chứng từ cửa hàng',deadline,deliverable:'Báo cáo fixture',metric:'Biên nhận được đối chiếu'};
    let output;
    if (args.revisionTargets) {
      assert.equal(args.facts.revisionSection,'staffing');
      output={assignments:{campaign_1:{actions:[{...action,action:'Báo cáo tại quầy'}],staff:[]}}};
    } else if (args.role==='DirectorBrief') {
      output={summary:'Giao việc fixture',assignments:live.roleNames.map(agent=>({agent,mission:'Xem nguồn fixture',deadline,
        deliverable:'Báo cáo',metric:'Đối chiếu'})),blockers:[]};
    } else if (args.role==='DirectorFinal') {
      output={title:'Phương án fixture',summary:'Báo cáo có nguồn',decision:'Xác minh số liệu',blockers:[],
        reportReview:live.roleNames.map(agent=>({agent,reportId:args.reportIds[agent],decisionImpact:'Đã đọc báo cáo'})),
        campaigns:[{showId:'',title:'Cải thiện 24H',rationale:'Đối chiếu nguồn',target:'Có bản kê',deadline,
          proposedBudgetVnd:0,expectedLow:null,expectedHigh:null,budgetBasis:'Chưa có chi phí',assetIds:[],staff:[],
          actions:[action],stopRule:'Kiểm tra độ phủ',missing:['Tồn kho']} ]};
    } else {
      output={summary:'Báo cáo '+args.role,sourceIds:[],actions:[],assetIds:[],assumptions:[],blockers:['Chưa đủ dữ liệu']};
    }
    return Response.json({id:'response-fixture-'+(++called),status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  };
  for(let n=0;n<13;n++){
    const state=await director.runGoalStep(pool,{env,now,request:provider});
    assert.equal(state,n===12?'ready':'queued');
  }
  result=await director.goalsView(...scopeArgs);
  assert.equal(result.goal.status,'ready');
  assert.equal(result.steps.filter(step=>step.state==='succeeded').length,17);
  assert.equal(called,13);
  assert((await evidence.auditView(pool,owner,true)).some(row=>row.event==='audit.director.finding'));
  await director.decideGoal(pool,owner,id,'approved','Đã kiểm tra fixture');
  result=await director.goalsView(...scopeArgs);
  assert.equal(result.tasks.length,1);
  const revised=randomUUID();
  await director.reviseGoal(pool,owner,id,revised,'staffing','Giao lại báo cáo đúng người');
  assert.equal(await director.runGoalStep(pool,{env,now,request:provider}),'ready');
  const revision=await director.goalsView(pool,owner,'24h','sidewalk',revised);
  assert.equal(revision.goal.version,2);
  assert.equal(revision.goal.results.DirectorFinal.output.campaigns[0].actions[0].action,'Báo cáo tại quầy');
  assert.equal(revision.goal.results.DirectorFinal.output.campaigns[0].target,result.goal.results.DirectorFinal.output.campaigns[0].target);
  assert.equal((await director.goalsView(...scopeArgs)).goal.status,'approved');
});

test('24H products and history use dated evidence and suppress unproven values',pg,async t=>{
  const pool=await database(t);
  const {saveProduct,readProducts}=require('./v11-products.cjs');
  const day=core.dayVN();
  const previous=ops.previousDays(day,7);
  for(const date of previous){
    await ops.saveRetailObservation(pool,owner,'counter',date,-1,new URLSearchParams({
      source:'Biên nhận kiểm thử',orders:'15',customers:'20'
    }));
    await saveProduct(pool,owner,'counter',date,new URLSearchParams({
      code:'coffee',name:'Cà phê',source:'Biên nhận sản phẩm',sold:'10'
    }));
  }
  const product=new URLSearchParams({code:'coffee',name:'Cà phê',source:'Biên nhận kiểm thử',sold:'9',revenueVnd:'450000',
    cogsVnd:'270000',stock:'7',leadDays:'2'});
  await saveProduct(pool,owner,'counter',day,product);
  const [coffee]=await readProducts(pool,owner,'counter',day,'day');
  assert.equal(coffee.margin,180000);
  assert.equal(coffee.unitCost,30000);
  assert.equal(coffee.restock,13);
  await assert.rejects(saveProduct(pool,owner,'counter',day,product),/STALE_REVISION/);
  const operations=await ops.readOperations(pool,'counter',day);
  assert.equal(operations.forecast.scenarios.length,3);
  assert.equal(operations.forecast.scenarios[1].customers,20);
  assert.equal((await ops.readOperations(pool,'other',day)).forecast,null);
});

test('sources preserve human-entered provenance and scoped variance without making provider calls',pg,async t=>{
  const pool=await database(t);
  const day=core.dayVN();
  const args={source:'weather',platform:'music',scope:'fixture',evidenceDay:day,confidence:'medium',assessment:'Dữ liệu thử nghiệm',
    reference:'https://weather.example/observations'};
  await evidence.saveExternalEvidence(pool,owner,new URLSearchParams(args));
  await assert.rejects(evidence.saveExternalEvidence(pool,owner,new URLSearchParams({...args,reference:args.reference+'?token=test'})),/EVIDENCE_URL/);
  const rows=await evidence.externalFor(pool,'music','fixture',day);
  assert.equal(rows.length,1);
  assert.equal(rows[0].confidence,'medium');
  assert.equal((await evidence.externalFor(pool,'music','other',day)).length,0);
  await evidence.saveOutcome(pool,owner,'music',new URLSearchParams({scope:'fixture',source:'Ledger evidence',
    outcome:'Phương án kiểm thử',actualVnd:'900',forecastVnd:'1100'}));
  const entries=await evidence.decisionHistory(pool,owner,'music');
  assert.equal(entries.find(entry=>entry.event==='memory.outcome.recorded').details.varianceVnd,-200);
  assert.equal((await evidence.decisionHistory(pool,owner,'24h')).length,0);
});

test('Ads daily budgets reserve the delivery buffer and a transfer cannot exceed the donor allocation',pg,async t=>{
  const pool=await database(t);
  const selected=await adsFixture(pool,'34567');
  const donor=await adsFixture(pool,'34568');
  const day=core.dayVN();
  await ads.setBudget(pool,owner,selected,day,[1000,1000,1000,1000,1000,174,1000]);
  await ads.fixtureSpend(pool,owner,selected,day,[0,0,0,0,0,0,0]);
  const daily=await ads.requestAction(pool,owner,actionFixture(selected,{spendMode:'daily'}));
  await assert.rejects(ads.transitionAction(pool,owner,daily.id,'approve',1),/LIMIT_EXCEEDED_day/);
  await ads.setBudget(pool,owner,selected,day,[null,null,null,null,null,1000,null]);
  const transfer=await ads.requestAction(pool,owner,actionFixture(selected,{action:'OPTIMIZE',from:donor,amount:400}));
  await ads.transitionAction(pool,owner,transfer.id,'approve',1);
  assert.equal((await ads.transitionAction(pool,owner,transfer.id,'execute',2)).state,'simulated');
  await assert.rejects(ads.requestAction(pool,owner,actionFixture(selected,{action:'OPTIMIZE',from:donor,amount:101})),/DONOR_BUDGET_EXCEEDED/);
});

'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Pool} = require('pg');
const {
  readRetailBrief,financialPlan,definitions,makeExecutor,review,adsPlan
} = require('./director-program.cjs');
const queue = require('./director-queue.cjs');

const request = new URLSearchParams({
  request_id:randomUUID(),product:'Đồ uống diễn tập',purchaseVnd:'28000',priceVnd:'35000',
  budgetVnd:'100000',region:'Lào Cai',objective:'Bán hàng không thua lỗ'
});
const {input} = readRetailBrief(request);

test('ONE CLICK preserves approved prices, budget and missing costs',()=>{
  assert.equal(input.priceVnd,35000);
  assert.equal(input.ageMin,18);
  const base = financialPlan(input);
  assert.equal(base.grossMarginVnd,7000);
  assert.equal(base.subtotalBreakEvenUnits,15);
  assert.equal(base.breakEvenUnits,null);
  assert.equal(base.missingCosts.length,6);
  assert.equal(base.actualProfitVnd,null);
  const full = financialPlan({...input,packingVnd:1000,deliveryVnd:1000,taxVnd:500,paymentVnd:100,otherUnitVnd:400,otherFixedVnd:10000});
  assert.equal(full.contributionVnd,4000);
  assert.equal(full.breakEvenUnits,28);
  assert.equal(financialPlan({...input,priceVnd:27000}).viability,'margin_non_positive');
  const plan = adsPlan(input);
  assert(plan.stopThresholdVnd < plan.proposedLifetimeVnd && plan.proposedLifetimeVnd < input.budgetVnd);
  assert.equal(plan.campaignId,null);
});

test('Director assigns all 11 agents and waits for terminal evidence',()=>{
  const jobs = definitions(input);
  assert.equal(new Set(jobs.map(j=>j.agent)).size,11);
  assert.equal(jobs.find(j=>j.kind==='ads').budgetVnd,100000);
  assert.deepEqual(jobs.find(j=>j.kind==='sale_rehearsal').needs,['training']);
  assert.equal(jobs.at(-1).observes.length,jobs.length-1);
  assert.match(review({kind:'research',result:{text:'invented',sources:{}}}),/nguồn/);
  assert.match(review({kind:'sale_rehearsal',result:{ordersCreated:1}}),/xác nhận/);
});

async function database(t) {
  const owner = new Pool({connectionString:process.env.DIRECTOR_TEST_DATABASE_URL});
  const schema = 'test_'+randomUUID().replaceAll('-','');
  await owner.query('create schema '+schema);
  const pool = new Pool({connectionString:process.env.DIRECTOR_TEST_DATABASE_URL, options:'-c search_path='+schema});
  t.after(async ()=>{
    await pool.end();
    await owner.query('drop schema '+schema+' cascade');
    await owner.end();
  });
  await queue.initDirectorQueue(pool);
  return pool;
}

async function drain(pool, execute) {
  for (let step=0;step<120;step++) {
    if (await queue.reviewNext(pool,review)) continue;
    const job = await queue.claim(pool);
    if (!job) {
      const {rows} = await pool.query("select count(*)::int n from os_director_jobs where status='queued'");
      if (!rows[0].n) return;
      continue;
    }
    try {
      const result = await execute(job,await queue.jobContext(pool,job));
      assert.equal(await queue.report(pool,job,{status:'reported',result}),true);
    } catch (error) {
      if (!error.permissions) throw error;
      await queue.report(pool,job,{status:'blocked',issues:error.permissions,result:error.result});
    }
  }
  assert.fail('Director did not reach a terminal state');
}

const usePg = {skip:!process.env.DIRECTOR_TEST_DATABASE_URL};

test('PostgreSQL serializes duplicate intake, reclaims a lease, and rejects stale reports',usePg,async t=>{
  const pool = await database(t);
  const definitionsByRun = definitions(input);
  const [left,right] = await Promise.all([
    queue.queueDirector(pool,request.get('request_id'),input,definitionsByRun),
    queue.queueDirector(pool,request.get('request_id'),input,definitionsByRun)
  ]);
  assert.equal(left,right);
  const candidates = await Promise.all([queue.claim(pool),queue.claim(pool)]);
  assert.equal(candidates.filter(Boolean).length,1);
  const first = candidates.find(Boolean);
  assert.equal(first.kind,'brief');
  await pool.query("update os_director_jobs set lease_until=now()-interval '1 second' where id=$1",[first.id]);
  const next = await queue.claim(pool);
  assert.equal(next.id,first.id);
  assert.equal(next.attempts,2);
  assert.notEqual(next.lease_id,first.lease_id);
  assert.equal(await queue.report(pool,first,{status:'reported',result:{stale:true}}),false);
  assert.equal(await queue.report(pool,next,{status:'reported',result:{mode:'rehearsal'}}),true);
  assert(await queue.reviewNext(pool,review));
});

test('PostgreSQL runs real scheduling and reviews with controlled provider fixtures',usePg,async t=>{
  const pool = await database(t);
  const id = await queue.queueDirector(pool,randomUUID(),input,definitions(input));
  const sources = [{title:'Nguồn fixture độc lập',url:'https://example.com/fixture'}];
  const long = 'Đây là nội dung kiểm thử để đo khả năng nhận dữ liệu, kiểm tra báo cáo và chuyển kết quả cùng phiên bản.';
  let salesRehearsals = 0;
  const execute = makeExecutor(pool,{
    model:async (kind,job,deps)=>{
      if (kind==='training') {
        assert.equal(deps.research.sources[0].url,sources[0].url);
        return {playbook:long+' '+(job.feedback || 'Báo giá đã kiểm tra.'),objections:long,validation:long};
      }
      if (kind==='direction') return {contentBrief:long,creativeBrief:long,saleBrief:long,channels:long,budget:long,acceptance:long};
      if (kind==='content') return {website:long,facebook:long,tiktok:long,ads:long,video:long};
      return {text:long,sources};
    },
    creative:async ()=>({asset:'fixture',remaining:['asset_rights']}),
    sale:async (job,version)=>{
      if (++salesRehearsals === 1) return {knowledgeVersion:version.version,passed:false};
      return {knowledgeVersion:version.version,reply:long,objectionReply:long,ordersCreated:0,liveSales:false,
        quote:{priceVerified:true,stockChecked:true,explicitConfirmation:true}};
    }
  });

  await drain(pool,execute);
  let state = await queue.listRuns(pool,id);
  const report = state.jobs.find(job=>job.kind==='report');
  assert.equal(report.status,'accepted');
  assert.equal(report.result.actuals.revenueVnd,null);
  assert.equal(new Set(report.result.work.map(job=>job.agent)).size,11);
  assert.equal(state.jobs.find(job=>job.kind==='social').status,'blocked');
  assert.equal(state.jobs.find(job=>job.kind==='ads').result.campaignId,null);
  assert.equal(state.versions.length,2);
  assert.equal(state.versions.find(version=>version.active).version,2);
  assert.equal(await queue.restoreKnowledge(pool,id,1),false);

  const training = state.jobs.find(job=>job.kind==='training');
  assert.equal(await queue.revise(pool,training.id,'Xem lại phần chuyển đối thoại cho người phụ trách.'),true);
  await drain(pool,execute);
  assert.equal(await queue.restoreKnowledge(pool,id,2),true);
  state = await queue.listRuns(pool,id);
  assert.equal(state.versions.length,3);
  assert.equal(state.versions.find(version=>version.active).version,2);
  assert.equal((await queue.knowledgeVersion(pool,id)).version,2);
  assert(state.jobs.find(job=>job.kind==='training').events.some(event=>event.event==='knowledge_restored'));
});

test('missing credentials block individual jobs, and Director still completes a partial report',usePg,async t=>{
  const pool = await database(t);
  const id = await queue.queueDirector(pool,randomUUID(),input,definitions(input));
  await drain(pool,makeExecutor(pool,{env:{}}));
  const {jobs} = await queue.listRuns(pool,id);
  assert.equal(jobs.find(job=>job.kind==='research').status,'blocked');
  assert.equal(jobs.find(job=>job.kind==='plan').status,'blocked');
  assert.equal(jobs.find(job=>job.kind==='forecast').result.subtotalBreakEvenUnits,15);
  assert.equal(jobs.find(job=>job.kind==='report').status,'accepted');
});

test('Messenger accepts signed 24H events only and deduplicates network retries',usePg,async t=>{
  const {createHmac}=require('node:crypto');
  const {createServer}=require('node:http');
  const {once}=require('node:events');
  const {initCrm,messengerWebhook,crmExecutor}=require('./director-crm.cjs');
  const pool=await database(t);
  await initCrm(pool);
  const secret='fixture-app-secret-for-messenger-tests';
  const verify='fixture-verification-token-for-tests';
  const env={
    EXTRA24H_MESSENGER_APP_SECRET:secret,EXTRA24H_MESSENGER_VERIFY_TOKEN:verify,
    EXTRA24H_CRM_HASH_KEY:'fixture-hash-key-for-messenger-tests'
  };
  const server=createServer(messengerWebhook(pool,env)).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  const challenge=await fetch(url+'/?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=246');
  assert.equal(await challenge.text(),'246');
  const pageId='1413936608477545';
  const event={sender:{id:'855555123456'},recipient:{id:pageId},timestamp:Date.now(),
    message:{mid:'sample_msg_124',text:'Mình muốn mua thử.'}};
  const other={...event,recipient:{id:'23452345'}};
  const payload=JSON.stringify({object:'page',entry:[{id:pageId,messaging:[event,other,{...event,message:{...event.message,is_echo:true}}]}]});
  const headers={'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(payload).digest('hex')};
  assert.equal((await fetch(url,{method:'POST',body:payload})).status,403);
  const send=()=>fetch(url,{method:'POST',body:payload,headers});
  assert.deepEqual((await Promise.all([send(),send()])).map(response=>response.status),[200,200]);
  const {rows:[stored]}=await pool.query('select * from os_24h_inbound_events');
  assert.match(stored.thread_key,/^[a-f0-9]{64}$/);
  assert(!JSON.stringify(stored).includes(event.sender.id));
  const report=await crmExecutor(pool,env)({input},'blocked');
  assert.equal(report.watch.events,1);
  assert.equal(report.watch.sale_intents,1);
  assert.equal(report.conversations,null);
  assert.equal(report.outboundMessages,0);
});

test('Creative reserves one paid generation and keeps the preview private',usePg,async t=>{
  const {initMedia,mediaExecutor}=require('./director-media.cjs');
  const pool=await database(t);
  await initMedia(pool);
  const record={
    kind:'creative',agent:'Creative',objective:'Ảnh diễn tập',needs:[],observes:[],permissions:['images'],budgetVnd:0
  };
  await queue.queueDirector(pool,randomUUID(),input,[record]);
  const job=await queue.claim(pool);
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9sAAAAASUVORK5CYII=';
  let calls=0;
  const execute=mediaExecutor(pool,{EXTRA24H_IMAGE_API_KEY:'fixture'},async ()=>{
    calls++;
    return Response.json({data:[{b64_json:png}]});
  });
  const brief={text:'Thiết kế trừu tượng dùng để kiểm thử.'};
  const first=await execute(job,brief,{sources:[]});
  const replay=await execute(job,brief,{sources:[]});
  assert.equal(calls,1);
  assert.deepEqual(replay.asset,first.asset);
  assert.equal(first.rights.publicationApproved,false);
  assert.deepEqual(first.remaining,['drive','asset_rights']);
});

test('Auditor detects copy with a different price and requires catalog and asset evidence',()=>{
  const {checkPublication}=require('./director-program.cjs');
  const audit=checkPublication(input,{website:'Giá 35.000 ₫',facebook:'Chỉ 31k',ads:'Giá ưu đãi 32 000 đồng'},{
    source:'sapo_web',verifiedPriceVnd:35000
  },{rights:{publicationApproved:false}});
  assert.deepEqual(audit.wrongAmounts,[{channel:'facebook',amountVnd:31000},{channel:'ads',amountVnd:32000}]);
  assert.equal(audit.verifiedCatalog,true);
  assert.equal(audit.assetRightsVerified,false);
  assert.equal(audit.publicationAllowed,false);
});

test('Analyst reports verified Sapo payments separately from revenue and excludes unrelated or refunded orders',async ()=>{
  const {ordersExecutor}=require('./director-actuals.cjs');
  const runId=randomUUID(),tag='24h-'+runId.replaceAll('-','');
  const job={run_id:runId,run_created_at:new Date(Date.now()-15000)};
  const order={id:1,tags:tag,currency:'VND',cancelled_on:null,financial_status:'paid',test:false,
    total_price:'71000.00',created_on:new Date(Date.now()-3000).toISOString(),line_items:[{variant_id:'63',quantity:2}]};
  const orders=[order,order,{...order,id:2,tags:'OTHER'},
    {...order,id:3,financial_status:'partially_refunded'},{...order,id:4,test:true},
    {...order,id:5,line_items:[{variant_id:'99',quantity:9}]}];
  const execute=ordersExecutor({EXTRA24H_SAPO_SHOP:'retail.mysapo.net',EXTRA24H_SAPO_ORDERS_READ_TOKEN:'fixture'},
    async (url,opts)=>{
      assert.equal(new URL(url).pathname,'/admin/orders.json');
      assert.equal(opts.method,undefined);
      assert.equal(opts.headers['x-sapo-access-token'],'fixture');
      assert(!new URL(url).searchParams.get('fields').includes('customer'));
      return Response.json({orders});
    });
  const result=await execute(job,{source:'sapo_web',productId:'sapo-63'});
  assert.equal(result.paidOrders,1);
  assert.equal(result.paidUnits,2);
  assert.equal(result.grossPaidVnd,71000);
  assert.equal(result.excludedOrders,3);
  assert.equal(result.revenueVnd,null);
  assert.equal(result.profitVnd,null);
});

test('Meta preflight reads the exact Page and checks the reserved lifetime budget against the account minimum',async ()=>{
  const {makeConnectors}=require('./director-connectors.cjs');
  const paths=[];
  const tokens={EXTRA24H_META_GRAPH_VERSION:'v27.0',EXTRA24H_META_PAGE_TOKEN:'page-fixture',EXTRA24H_META_ADS_TOKEN:'ads-fixture'};
  const check=makeConnectors(null,tokens,async (url,opts)=>{
    const path=new URL(url).pathname;
    assert.equal(opts.method,undefined);
    assert.equal(opts.redirect,'error');
    paths.push(path);
    if(path.endsWith('/me'))return Response.json({id:'1413936608477545'});
    if(path.endsWith('/minimum_budgets'))return Response.json({data:[{currency:'VND',min_daily_budget_imp:150000}]});
    return Response.json({account_id:'1915621506464312',currency:'VND',account_status:1});
  });
  const page=await check.facebookReadiness({mode:'rehearsal'});
  assert.equal(page.pageIdentityVerified,true);
  const ad=await check.advertisingReadiness(adsPlan(input));
  assert.equal(ad.verifiedAdAccount,true);
  assert.equal(ad.budgetAllowsImpressionsDay,false);
  assert.deepEqual(paths.sort(),['/v27.0/act_1915621506464312','/v27.0/act_1915621506464312/minimum_budgets','/v27.0/me']);
  assert.equal(ad.campaignId,null);
});

test('sample workflow runs all eleven agents with verified demo receipt and isolated figures',usePg,async t=>{
  const {sampleBrief,sampleReleaseRequestId}=require('./director-sample.cjs');
  const {makeConnectors}=require('./director-connectors.cjs');
  const pool=await database(t);
  const downloadPaths=[];
  const saleUrl='http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director';
  const env={EXTRA_OS_SALE_LINK_URL:saleUrl,EXTRA_OS_SALE_LINK_TOKEN:'local-fixture-token-used-for-testing-the-sale-connector-x'};
  const request=async (url,options)=>{
    const path=new URL(url).pathname;
    downloadPaths.push(path);
    if (url===saleUrl) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.kind,'retail_sample');
      assert.equal(payload.input.stock,10);
      assert.equal(payload.input.knowledgeVersion,1);
      assert(payload.input.rules.includes('confirm_quantity'));
      const text='Báo giá mẫu đúng đơn giá và số lượng sau khi xác nhận.';
      return Response.json({
        id:payload.id,agent:'Sale',version:'2.3',kind:payload.kind,mode:'dry_run',status:'succeeded',
        report:{knowledgeVersion:1,source:'sample_rules',generatedByModel:false,reply:text,objectionReply:text,
          quote:{inventorySource:'fixture',priceVnd:15000,quantity:2,totalVnd:30000,
            priceVerified:true,stockChecked:true,explicitConfirmation:true},
          ordersCreated:0,liveSales:false}
      });
    }
    assert.equal(new URL(url).origin,'https://extra-24h.onrender.com');
    if (path==='/api/demo/catalog') return Response.json({source:'demo_fixture',demo:true,
      products:[{id:'demo-a',name:'Nước uống mẫu',stock:10,price:15000}]});
    assert.equal(path,'/api/demo/orders');
    const order=JSON.parse(options.body);
    assert.deepEqual(order.items,[{id:'demo-a',quantity:2}]);
    assert.match(order.requestId,/^[a-f0-9-]{36}$/);
    return Response.json({code:'DEMO-123456789ABCDEF0',demo:true,persisted:false,total:30000,
      items:[{id:'demo-a',quantity:2,unitPrice:15000}]});
  };
  const integration=makeConnectors(pool,env,request);
  const execute=makeExecutor(pool,{...integration,model:()=>assert.fail('sample called a live model')});
  const blueprint=definitions(sampleBrief);
  const id=await queue.queueDirector(pool,sampleReleaseRequestId,sampleBrief,blueprint);
  assert.equal(await queue.queueDirector(pool,sampleReleaseRequestId,sampleBrief,blueprint),id);
  await drain(pool,execute);
  const {jobs,versions}=await queue.listRuns(pool,id);
  assert(jobs.every(job=>job.status==='accepted'),JSON.stringify(jobs.map(job=>[job.kind,job.status,job.issues])));
  const report=jobs.find(job=>job.kind==='report').result;
  assert.equal(Object.keys(report.agentPerformance).length,11);
  assert.equal(report.mode,'sample');
  assert.equal(versions[0].active,true);
  assert.equal(report.actuals.basis,'unknown');
  assert.equal(report.actuals.orders,null);
  assert.equal(report.actuals.revenueVnd,null);
  assert.equal(report.sample.receipt,'DEMO-123456789ABCDEF0');
  assert.equal(report.sample.checkoutVnd,30000);
  assert.equal(report.sample.spendVnd,8160);
  assert.equal(report.sample.profitVnd,840);
  assert.equal(jobs.find(job=>job.kind==='ads').result.decisions[0].action,'ignore');
  const crm=jobs.find(job=>job.kind==='crm').result;
  assert.deepEqual([crm.saleIntents,crm.supportIntents,crm.optOuts,crm.outboundMessages],[1,1,1,0]);
  assert.deepEqual(downloadPaths,['/api/demo/catalog','/api/extra-os/director','/api/demo/orders']);
});

test('regular retail intake cannot select sample mode and budget exercise excludes foreign campaigns',()=>{
  const {sampleBrief,exerciseSampleBudget}=require('./director-sample.cjs');
  const form=new URLSearchParams(request);
  form.set('mode','sample');
  assert.equal(readRetailBrief(form).input.mode,'rehearsal');
  const details=exerciseSampleBudget(adsPlan(sampleBrief),'sample');
  assert.deepEqual(details.decisions.map(item=>item.action),['ignore','continue','pause']);
  assert.equal(details.campaignCreated,false);
});

test('staff assignment preserves old show data, scopes access, and rejects stale reports',usePg,async t=>{
  const {initStaffWork,issueCode,signIn,listStaffTasks,reportStaffTask,updateShowTask}=require('./staff-work.cjs');
  const pool=await database(t);
  await pool.query(`
    create table os_shows (id uuid primary key,intake jsonb not null);
    create table os_tasks (show_id uuid references os_shows(id),key text,definition jsonb,status text,note text,primary key(show_id,key));
    create table os_audit (id bigint generated always as identity, event text,details jsonb);
  `);
  const id=randomUUID();
  await pool.query('insert into os_shows values($1,$2)',[id,{artist:'Show mẫu'}]);
  await pool.query('insert into os_tasks values($1,$2,$3,$4,$5)',[id,'venue',{title:'Kiểm tra sân khấu'},'pending','Ghi chú cũ']);
  await initStaffWork(pool);
  await initStaffWork(pool);
  const {rows:[original]}=await pool.query('select note,assignee,revision from os_tasks');
  assert.deepEqual(original,{note:'Ghi chú cũ',assignee:null,revision:0});

  const dieu=await issueCode(pool,'dieu');
  const trang=await issueCode(pool,'trang');
  assert.equal(await issueCode(pool,'unknown'),null);
  const {rows:[stored]}=await pool.query("select code_hash from os_staff_access where staff_id='dieu'");
  assert.notEqual(stored.code_hash,dieu);
  const sessions=await Promise.all([signIn(pool,dieu),signIn(pool,dieu)]);
  assert.equal(sessions.filter(Boolean).length,1);
  assert.equal(sessions.find(Boolean).staffId,'dieu');
  assert.equal((await signIn(pool,trang)).staffId,'trang');
  assert.equal(await signIn(pool,trang),null);
  const expiring=await issueCode(pool,'hai');
  await pool.query("update os_staff_access set expires_at=now()-interval '1 minute' where staff_id='hai'");
  assert.equal(await signIn(pool,expiring),null);

  const key='venue';
  assert(await updateShowTask(pool,{id,key,status:'pending',assignee:'dieu',note:'Kiểm tra bố cục',revision:0}));
  const assigned=await listStaffTasks(pool,'dieu');
  assert.equal(assigned[0].definition.title,'Kiểm tra sân khấu');
  assert.equal(assigned[0].revision,1);
  assert.deepEqual(await listStaffTasks(pool,'trang'),[]);
  assert.equal(await reportStaffTask(pool,'trang',{id,key,action:'submit',note:'Xem việc của người khác',revision:1}),false);
  assert.equal(await reportStaffTask(pool,'dieu',{id,key,action:'submit',note:'',revision:1}),false);
  assert(await reportStaffTask(pool,'dieu',{id,key,action:'start',note:'',revision:1}));
  assert.equal(await reportStaffTask(pool,'dieu',{id,key,action:'submit',note:'Báo cáo cũ',revision:1}),false);
  assert(await reportStaffTask(pool,'dieu',{id,key,action:'submit',note:'Đã kiểm tra',revision:2}));
  assert.equal(await updateShowTask(pool,{id,key,status:'accepted',note:'Qua',assignee:'dieu',revision:2}),false);
  assert(await updateShowTask(pool,{id,key,status:'accepted',note:'Đã duyệt',assignee:'dieu',revision:3}));
  assert.equal(await reportStaffTask(pool,'dieu',{id,key,action:'submit',note:'Báo cáo sau khi duyệt',revision:4}),false);
  assert.equal((await listStaffTasks(pool,'dieu'))[0].status,'accepted');
  const {rows:events}=await pool.query('select event from os_audit order by id');
  assert.deepEqual(events.map(row=>row.event),['task.updated','staff.task.in_progress','staff.task.submitted','task.updated']);
});

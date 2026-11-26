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

test('manual reconciliation keeps unknown values empty and recognizes explicit zero expenses',()=>{
  const {parseFinance,calculateFinance}=require('./director-finance.cjs');
  const form=new URLSearchParams({
    request_id:randomUUID(),run_id:randomUUID(),version:'0',as_of:'2026-11-26',reference:'Bảng nội bộ M-01',
    grossSalesVnd:'1000000',discountsVnd:'50000',refundsVnd:'100000',
    cogsVnd:'400000',adsVnd:'100000',shippingVnd:'10000',packingVnd:'5000',
    paymentVnd:'0',taxVnd:'25000',otherVnd:'20000',unitsSold:'30',unitsReturned:'2'
  });
  const now=new Date('2026-11-25T19:00:00Z');
  const entry=parseFinance(form,now);
  assert(entry);
  const result=calculateFinance(entry.data,75000);
  assert.equal(result.basis,'operator_recorded');
  assert.equal(result.netRevenueVnd,850000);
  assert.equal(result.expenseVnd,560000);
  assert.equal(result.profitVnd,290000);
  assert.equal(result.unitsNet,28);
  assert.equal(result.adBudgetRemainingVnd,-25000);

  form.set('paymentVnd','');
  const partial=calculateFinance(parseFinance(form,now).data);
  assert.equal(partial.expenseVnd,null);
  assert.equal(partial.profitVnd,null);
  assert(partial.missingAmounts.includes('paymentVnd'));
  assert.equal(partial.grossProfitVnd,450000);
  form.set('as_of','2025-02-29');
  assert.equal(parseFinance(form,now),null);
  form.set('as_of','2026-11-27');
  assert.equal(parseFinance(form,now),null);
});

test('manual reconciliation keeps versions, dedupes retry and rejects edits from stale tabs',usePg,async t=>{
  const {initDirectorFinance,saveFinance,listFinance}=require('./director-finance.cjs');
  const {sampleBrief}=require('./director-sample.cjs');
  const pool=await database(t);
  await pool.query('create table os_audit(id bigint generated always as identity,event text,details jsonb)');
  await initDirectorFinance(pool);
  await initDirectorFinance(pool);
  const runId=await queue.queueDirector(pool,randomUUID(),input,[]);
  const sampleId=await queue.queueDirector(pool,randomUUID(),sampleBrief,[]);
  const submission={runId,requestId:randomUUID(),baseVersion:0,asOf:'2026-11-26',reference:'Biên nhận 24H',note:'',
    data:{grossSalesVnd:1000000,discountsVnd:0,refundsVnd:0}};
  assert.deepEqual(await saveFinance(pool,{...submission,runId:sampleId}),{status:'unavailable'});
  assert.deepEqual(await saveFinance(pool,submission),{status:'saved',version:1});
  assert.deepEqual(await saveFinance(pool,submission),{status:'saved',version:1});
  assert.deepEqual(await saveFinance(pool,{...submission,note:'Đã sửa'}),{status:'conflict'});
  const results=await Promise.all(['Bảng chi phí A','Bảng chi phí B'].map(reference=>
    saveFinance(pool,{...submission,reference,baseVersion:1,requestId:randomUUID()})));
  assert.deepEqual(results.map(result=>result.status).sort(),['conflict','saved']);
  const versions=await listFinance(pool,runId);
  assert.deepEqual(versions.map(row=>row.version),[2,1]);
  assert.equal(versions[1].reference,'Biên nhận 24H');
  assert.equal(versions[0].metrics.netRevenueVnd,1000000);
  assert.equal(versions[0].metrics.profitVnd,null);
  assert.equal((await pool.query('select * from os_audit')).rowCount,2);
});

test('CRM assigns only existing conversations, scopes staff updates and honors opt-outs after later messages',usePg,async t=>{
  const {initCrm}=require('./director-crm.cjs');
  const {initCrmFollowup,listFollowups,saveFollowup,readFollowup}=require('./crm-followup.cjs');
  const pool=await database(t);
  await pool.query('create table os_audit(id bigint generated always as identity,event text,details jsonb)');
  await initCrm(pool);
  await initCrmFollowup(pool);
  const threadKey='a'.repeat(64),supportKey='b'.repeat(64);
  const inbound=(key,category)=>pool.query(
    'insert into os_24h_inbound_events(event_id,thread_key,occurred_at,category) values($1,$2,now(),$3)',
    [randomUUID(),key,category]
  );
  await inbound(threadKey,'sales');
  await inbound(supportKey,'support');
  assert.deepEqual((await listFollowups(pool)).rows.map(row=>row.thread_key),[supportKey,threadKey]);
  assert.deepEqual((await listFollowups(pool,{staffId:'dieu'})).rows,[]);
  const owner=readFollowup(new URLSearchParams({thread_key:threadKey,status:'new',assignee:'dieu',revision:'0',note:'Vào hàng đợi Sale'}));
  assert(owner);
  assert.equal(await saveFollowup(pool,{...owner,threadKey:'c'.repeat(64)}),false);
  assert(await saveFollowup(pool,owner));
  assert.equal(await saveFollowup(pool,owner),false);
  assert.deepEqual((await listFollowups(pool,{staffId:'dieu'})).rows.map(row=>row.thread_key),[threadKey]);
  const close={...owner,assignee:null,revision:1,status:'resolved',note:'Đã phân loại'};
  assert.equal(await saveFollowup(pool,close,'trang'),false);
  assert.equal(await saveFollowup(pool,{...close,assignee:'trang'},'dieu'),false);
  assert(await saveFollowup(pool,close,'dieu'));
  await inbound(threadKey,'general');
  assert.deepEqual((await listFollowups(pool,{view:'resolved'})).rows.map(row=>row.thread_key),[threadKey]);
  await inbound(threadKey,'support');
  assert((await listFollowups(pool,{staffId:'dieu'})).rows.some(row=>row.thread_key===threadKey&&row.status==='new'));

  await inbound(threadKey,'opt_out');
  await inbound(threadKey,'sales');
  assert.deepEqual((await listFollowups(pool,{staffId:'dieu'})).rows,[]);
  assert((await listFollowups(pool)).rows.every(row=>row.thread_key!==threadKey));
  const [suppressed]=(await listFollowups(pool,{view:'opt_out'})).rows;
  assert.equal(suppressed.thread_key,threadKey);
  assert.equal(suppressed.assignee,null);
  assert.equal(suppressed.note,null);
  assert.equal(await saveFollowup(pool,{...owner,revision:2}),false);
  assert.equal((await pool.query('select * from os_audit')).rowCount,2);
});


test('Daily Director approval gates queue, rejects stale version, deduplicates clicks and never unlocks external actions',usePg,async t=>{
 const {initDailyDirector,savePlan,readPlan,approvePlan,executeNextApprovedTask,readApprovals}=require('./daily-director.cjs');
 const pool=await database(t);await initDailyDirector(pool);
 const day='2030-01-02',now=new Date('2030-01-02T03:00:00Z');
 const p={title:'Test approved plan',summary:'Test',evidence:{},tasks:[
  {id:'draft',agent:'Content',title:'Prepare draft',deliverable:'Internal material',state:'draft_ready'},
  {id:'missing',agent:'Auditor',title:'Missing data',deliverable:'Verify data',state:'needs_input'},
  {id:'ads',agent:'Ads',title:'Ads',deliverable:'Do not spend',state:'awaiting_approval'}
 ]};
 await savePlan(pool,'music',day,p);
 const initial=await readPlan(pool,'music',day);
 assert.equal(await executeNextApprovedTask(pool,now),null);
 await savePlan(pool,'music',day,{...p,title:'Updated proposal'});
 const current=await readPlan(pool,'music',day);
 assert.equal((await approvePlan(pool,{platform:'music',day,revision:initial.revision,fingerprint:initial.fingerprint},now)).status,'stale');
 const request={platform:'music',day,revision:current.revision,fingerprint:current.fingerprint};
 const result=await Promise.all([approvePlan(pool,request,now),approvePlan(pool,request,now)]);
 assert.deepEqual(result.map(r=>r.status).sort(),['already_approved','approved']);
 let history=await readApprovals(pool,'music',day);
 assert.equal(history.length,1);assert.equal(history[0].tasks.length,3);
 assert(history[0].tasks.every(t=>t.status==='queued'));
 const outcomes=[];for(let i=0;i<3;i++)outcomes.push(await executeNextApprovedTask(pool,now));
 assert.deepEqual(outcomes.map(r=>r.status),['draft_prepared','blocked','blocked']);
 assert(outcomes.every(r=>r.externalActions===0));
 assert.equal(await executeNextApprovedTask(pool,now),null);
 await savePlan(pool,'music',day,{...p,title:'New proposal requiring separate approval'});
 history=await readApprovals(pool,'music',day);
 assert.equal(history[0].plan.title,'Updated proposal');
 assert.equal(history[0].tasks[0].result.content,'Internal material');
 assert.equal(history[0].tasks[2].result.externalActions,0);
 assert.equal((await readPlan(pool,'music',day)).revision,3);
 assert.equal(await executeNextApprovedTask(pool,now),null);
 assert.equal((await approvePlan(pool,request,new Date('2030-01-03T03:00:00Z'))).status,'invalid');
});


test('Daily, weekly and monthly proposal approvals are isolated in PostgreSQL',usePg,async t=>{
 const {initDailyDirector,savePlan,readPlan,approvePlan,readApprovals,executeNextApprovedTask}=require('./daily-director.cjs');
 const pool=await database(t);await initDailyDirector(pool);await initDailyDirector(pool);
 const day='2030-01-02',now=new Date('2030-01-02T03:00:00Z');
 const plan={title:'Period test',summary:'Test only',evidence:{},tasks:[{id:'draft',agent:'Content',title:'Prepare draft',deliverable:'Internal material',state:'draft_ready'}]};
 for(const platform of ['music','music_week','music_month','24h','24h_week','24h_month'])await savePlan(pool,platform,day,{...plan,title:platform});
 const weekly=await readPlan(pool,'music_week',day);
 assert.equal((await approvePlan(pool,{platform:'music_week',day,revision:weekly.revision,fingerprint:weekly.fingerprint},now)).status,'approved');
 assert.equal((await readApprovals(pool,'music_week',day)).length,1);
 assert.equal((await readApprovals(pool,'music',day)).length,0);
 assert.equal((await readApprovals(pool,'music_month',day)).length,0);
 assert.equal((await readApprovals(pool,'24h_week',day)).length,0);
 const result=await executeNextApprovedTask(pool,now);assert.equal(result.platform,'music_week');assert.equal(result.externalActions,0);
 assert.equal(await executeNextApprovedTask(pool,now),null);
});


test('Live Director persists all 13 distinct provider response checkpoints and blocks without credentials',usePg,async t=>{
 const live=require('./live-director.cjs');
 const pool=await database(t);await live.initLiveDirector(pool);
 const now=new Date('2030-01-02T05:00:00Z'),day='2030-01-02',deadline=day+'T22:00:00+07:00';
 const asset='https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/public/extra-media/test-poster.png';
 const show={id:'fixture-show',artist:'Nghệ sĩ kiểm thử',date:'2030-01-03',time:'19:30',venue:'ccc',status:'announced',prices:{A:500000,B:null,C:null,D:null},posterUrl:asset,inventory:{capacity:100,sold:20,remaining:75,held:1,blocked:4}};
 const sources={now,music:async()=>({status:'available',data:{checkedAt:now.toISOString(),rows:[{showId:show.id,artist:show.artist,date:show.date,total:{paidOrders:1,paidTickets:2,revenueVnd:1000000,complimentaryTickets:0},recordedCostVnd:null,costUpdatedAt:null,days:{[day]:{paidOrders:1,paidTickets:2,revenueVnd:1000000,complimentaryTickets:0}}}]}}),inventory:async()=>({showsAvailable:true,inventoryAvailable:true,checkedAt:now.toISOString(),rows:[show]}),media:async()=>({available:true,assets:[]}),retail:async()=>({records:[],crm:null})};
 await live.seedLiveRuns(pool,{...sources,env:{}});
 assert.equal((await live.readLiveRun(pool,'music',day)).reason,'missing_model_key');
 assert.equal(await live.runNext(pool,{env:{},now}),null);
 const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fixture-only',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13'};
 await live.seedLiveRuns(pool,{...sources,env});
 const action={showId:show.id,action:'Đối chiếu nguồn',deadline,deliverable:'Báo cáo kiểm thử',metric:'Có căn cứ'};
 let calls=0;
 const request=async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(opts.method,'POST');
  const args=JSON.parse(JSON.parse(opts.body).input);
  const output=args.role==='DirectorBrief'?{summary:'Giao việc kiểm thử',assignments:live.roleNames.map(agent=>({agent,mission:'Phân tích nguồn kiểm thử',deadline,deliverable:'Báo cáo',metric:'Số liệu đúng'})),blockers:[]}:args.role==='DirectorFinal'?{title:'Phương án fixture',reportReview:live.roleNames.map(agent=>({agent,reportId:args.reportIds[agent],decisionImpact:'Đối chiếu trong bài kiểm thử'})),summary:'Tổng hợp fixture',decision:'Duyệt nội bộ',blockers:[],campaigns:[{showId:show.id,title:'Chiến dịch kiểm thử',rationale:'Đọc dữ liệu fixture',target:'Mục tiêu thử nghiệm',deadline,proposedBudgetVnd:0,expectedLow:1,expectedHigh:2,budgetBasis:'Giả định fixture',assetIds:['poster:'+show.id],actions:[{agent:'Creative',action:'Chọn poster',deadline,deliverable:'Ảnh nguồn',metric:'Đúng show'}],staff:[],stopRule:'Không chi',missing:['Chưa có video']}]}:{summary:'Kết quả fixture '+args.role,sourceIds:['finance:'+show.id],actions:[action],assetIds:args.role==='Creative'?['poster:'+show.id]:[],assumptions:[],blockers:[]};
  if(args.role==='DirectorFinal')assert(live.roleNames.every(role=>args.completed[role]));
  return Response.json({id:'resp_fixture_'+(++calls),status:'completed',model:'fixture',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
 };
 for(let n=0;n<13;n++){const result=await live.runNext(pool,{env,request,now});assert(result);assert.equal(result.externalActions,0);}
 assert.equal(calls,13);
 const run=await live.readLiveRun(pool,'music',day);
 assert.equal(run.status,'ready');assert.equal(Object.keys(run.results).length,13);
 assert.equal(new Set(Object.values(run.results).map(r=>r.responseId)).size,13);
 assert.equal(await live.runNext(pool,{env,request,now}),null);
 const other=await live.readLiveRun(pool,'24h',day);assert.equal(other.step_index,0);
});

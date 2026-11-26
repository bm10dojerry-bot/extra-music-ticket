const {test}=require('node:test');const assert=require('node:assert/strict');
const {agents,planMarketing,planStaffWork}=require('./marketing-director.ts');
const {parseShowIntake,prepareShow}=require('./marketing-show-intake.ts');
const now=new Date('2030-01-01T00:00:00Z');
const fixture={artist:'Test',venue:'Test',venueId:'',startsAt:'2030-01-08T19:30',capacity:100,bookingVnd:5000000,productionVnd:3000000,adsVnd:2000000,printingVnd:1000000,otherVnd:500000,startingPriceVnd:200000,targetProfitVnd:3000000,mediaDriveUrl:'https://drive.google.com/drive/folders/test',setlist:'Test',artistConfirmed:true,mediaRightsConfirmed:true,permissions:[]};
test('existing planning engine and 11 agents preserved; no external action',()=>{const s=parseShowIntake(fixture);const p=prepareShow(s,now);assert.equal(Object.keys(agents).length,11);assert.equal(p.plannedCostVnd,11500000);assert.equal(p.breakEvenTicketsAtStartingPrice,58);assert.equal(p.layoutMatches,false);assert.equal(planStaffWork(s,p,now).length,3);assert(!planMarketing(s,now).some(j=>['website','facebook','ads','ads_monitor','close_sales'].includes(j.kind)));});
test('invalid permission or rights fails',()=>{assert.throws(()=>parseShowIntake({...fixture,permissions:['ads']}));assert.throws(()=>prepareShow(parseShowIntake({...fixture,mediaRightsConfirmed:false}),now));});

test('analyst separates internal forecasts and unavailable actuals',()=>{
 const {analyzeInternalPlans}=require('./marketing-director.ts');
 const result=analyzeInternalPlans([{intake:{artist:'Test'},finance:{plannedCostVnd:100,targetRevenueVnd:200,projectedRevenueVnd:150,layoutMatches:false}},{intake:{artist:'Missing'},finance:{}}],[{intake:{budget:20}}]);
 assert.equal(result.showCost,100);assert.equal(result.projectedRevenue,150);assert.equal(result.risks[0].gap,50);assert.equal(result.missing,1);assert.equal(result.retailBudget,20);assert.equal(result.actualRevenue,null);assert.equal(result.actualCost,null);assert.equal(result.actualProfit,null);
});

test('Director dispatches internal analyst plan but does not claim actual reconciliation',()=>{
 const {executeAnalystPlan,planMarketing}=require('./marketing-director.ts');
 const s=parseShowIntake(fixture),f=prepareShow(s,now);
 const jobs=planMarketing(s,now);assert(jobs.some(j=>j.kind==='analyst_plan'&&j.agent==='Analyst'));assert(jobs.some(j=>j.kind==='analyst'));
 const result=executeAnalystPlan(s,f);assert.equal(result.status,'succeeded');assert.equal(result.analysis.actualRevenue,null);assert.match(result.note,/không phải doanh thu thực tế/);
 assert.equal(executeAnalystPlan(s,{}).status,'blocked');
});


const {readMusicSnapshot,renderMusicSnapshot,createMusicSnapshotReader}=require('./music-readonly.cjs');
const publicShow={id:'show-1',artist:'<Nghệ sĩ>',date:'2030-01-08',time:'19:30',venue:'ccc',status:'announced',posterUrl:'ignored',buyer_email:'not-for-admin',prices:{A:100000,B:'invalid'}};
const fixedTime=()=>new Date('2030-01-01T00:00:00Z');
const escapeMusic=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('Music snapshot reads public GET APIs, keeps counts and excludes unrelated data',async()=>{
 const calls=[];
 const data=await readMusicSnapshot(async(url,opts)=>{
  calls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert(!opts.headers.authorization);
  if(url.endsWith('/shows'))return Response.json({shows:[publicShow]});
  return Response.json({available:true,inventory:[{showId:'show-1',capacity:100,sold:20,remaining:75,soldSeats:['A01'],heldSeats:['B01','B01'],blockedSeats:['C01','C02']}]});
 },fixedTime);
 assert.deepEqual(calls.sort(),['https://iextra.net/api/public/show-inventory','https://iextra.net/api/public/shows']);
 assert.equal(data.showsAvailable,true);assert.equal(data.inventoryAvailable,true);
 assert.deepEqual(data.rows[0].inventory,{capacity:100,sold:20,remaining:75,held:1,blocked:2});
 assert.equal(data.rows[0].prices.A,100000);assert.equal(data.rows[0].prices.B,null);assert(!JSON.stringify(data).includes('B01'));
 assert(!JSON.stringify(data).includes('not-for-admin'));assert(!JSON.stringify(data).includes('A01'));
 const rendered=renderMusicSnapshot(data,escapeMusic);
 assert.match(rendered,/&lt;Nghệ sĩ&gt;/);assert(!rendered.includes('<Nghệ sĩ>'));assert.match(rendered,/chưa trừ ghế đang giữ/);
});
test('Music snapshot leaves inventory unknown when upstream unavailable or counts invalid',async()=>{
 for(const inventory of [new Response('{}',{status:503}),Response.json({available:true,inventory:[{showId:'show-1',capacity:10,sold:20,remaining:0}]})]){
  const data=await readMusicSnapshot(async url=>url.endsWith('/shows')?Response.json({shows:[publicShow]}):inventory,fixedTime);
  assert.equal(data.showsAvailable,true);assert.equal(data.inventoryAvailable,false);assert.equal(data.rows[0].inventory,null);
 }
});
test('Music snapshot never invents show data when public schedule fails',async()=>{
 const data=await readMusicSnapshot(async url=>url.endsWith('/shows')?Response.json({shows:[publicShow,publicShow]}):Response.json({available:true,inventory:[]}),fixedTime);
 assert.equal(data.showsAvailable,false);assert.deepEqual(data.rows,[]);
 assert.match(renderMusicSnapshot(data,escapeMusic),/Chưa có lịch/);
});

test('Music public snapshot coalesces concurrent reads and limits refresh to once a minute',async()=>{
 let calls=0,ms=Date.parse('2030-01-01T00:00:00Z');
 const read=createMusicSnapshotReader({request:async url=>{calls++;return url.endsWith('/shows')?Response.json({shows:[publicShow]}):Response.json({available:true,inventory:[]});},now:()=>new Date(ms)});
 await Promise.all([read(),read(),read()]);assert.equal(calls,2);
 ms+=59000;await read();assert.equal(calls,2);ms+=1001;await read();assert.equal(calls,4);
});
const {reportDay,musicDay,parseMusicFinance,createMusicFinanceReader,readRetailDaily,renderMusicDaily,renderRetailDaily}=require('./daily-reports.cjs');
const reportTotals={paidOrders:1,paidTickets:2,revenueVnd:1500000,complimentaryTickets:0};
const reportFixture={source:'music_confirmed_payment_readonly_v1',timezone:'Asia/Ho_Chi_Minh',checkedAt:'2030-01-02T00:00:00Z',rows:[{showId:'music-1',artist:'<Music>',date:'2030-01-07',total:reportTotals,days:{'2030-01-02':reportTotals},recordedCostVnd:null,costUpdatedAt:null,buyer_phone:'not included'}]};
test('Music reports select payment day in Vietnam and keep cumulative amounts separate',()=>{
 assert.equal(reportDay(null,new Date('2030-01-01T18:00:00Z')),'2030-01-02');
 const parsed=parseMusicFinance(reportFixture);
 assert.equal(musicDay(parsed,'2030-01-02').daily.revenueVnd,1500000);
 assert.equal(musicDay(parsed,'2030-01-01').daily.revenueVnd,0);
 assert(!JSON.stringify(parsed).includes('not included'));
 const body=renderMusicDaily({status:'available',data:parsed},'2030-01-02',escapeMusic);
 assert.match(body,/&lt;Music&gt;/);assert.match(body,/chưa đối soát ngân hàng/);
 assert.throws(()=>parseMusicFinance({...reportFixture,rows:[{...reportFixture.rows[0],total:{...reportTotals,revenueVnd:1}}]}));
});
test('Music finance connector requires dedicated token and sends only GET to the reporting endpoint',async()=>{
 let calls=0;const request=async (url,opts)=>{calls++;assert.match(url,/\/functions\/v1\/extra-os-music-report-v1$/);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.authorization,undefined);assert.equal(opts.headers['x-extra-music-report-key'],'a'.repeat(64));return Response.json(reportFixture);};
 assert.equal((await createMusicFinanceReader({request,env:{}})()).status,'not_configured');assert.equal(calls,0);
 const read=createMusicFinanceReader({request,env:{EXTRA_OS_MUSIC_REPORT_READ_TOKEN:'a'.repeat(64)}});
 const results=await Promise.all([read(),read(),read()]);
 assert.equal(calls,1);assert(results.every(r=>r.status==='available'));
 const denied=await createMusicFinanceReader({request:async()=>new Response('{}',{status:401}),env:{EXTRA_OS_MUSIC_REPORT_READ_TOKEN:'a'.repeat(64)}})();
 assert.equal(denied.status,'unavailable');assert.equal(denied.data,null);
});
test('24H daily reporting reads internal records only and excludes sample runs',async()=>{
 const queries=[];
 const pool={query:async (sql,params)=>{queries.push(sql);assert.equal(params[0],'2030-01-02');assert.match(sql,/^select /);if(sql.includes('count(*)::int as created'))return {rows:[{created:2}]};if(sql.includes('os_director_events'))return {rows:[{accepted:3,blocked:1,failed:0}]};if(sql.includes('os_director_finance')){assert.equal(params[1],'2030-01-01');return {rows:[]};}return {rows:[{events:0,threads:0,sale_intents:0}]};}};
 const report=await readRetailDaily(pool,'2030-01-02');
 assert.equal(report.created,2);assert.equal(report.crm,null);assert.equal(queries.length,4);
 assert(queries.slice(0,3).every(q=>q.includes("<>'sample'")));
 assert.match(renderRetailDaily(report,'2030-01-02',escapeMusic),/Chưa kết nối/);
 assert.deepEqual(report.records,[]);
});


const {renderSidebar,renderPlatformTabs}=require('./workspace-sidebar.cjs');
const {musicPlan,retailPlan,renderDailyDirector}=require('./daily-director.cjs');
test('sidebar groups reports and approvals and links dashboard sections correctly',()=>{
 const paths=['/reports/24h','/reports/music','/proposals/24h','/proposals/music'];
 for(const path of ['home',...paths]){
  const sidebar=renderSidebar(path);
  const menu=Array.from(sidebar.matchAll(/<a href="(\/[^"#]+)"[^>]*>.*?<span>([^<]+)<\/span>/g),m=>[m[1],m[2]]);
  assert.deepEqual(menu,[['/reports/24h','Báo cáo'],['/proposals/24h','Phê duyệt đề xuất']]);
  assert(!sidebar.includes('Tổng quan báo cáo'));
  const current=Array.from(sidebar.matchAll(/href="([^"]+)" aria-current="location"/g),m=>m[1]);
  assert.deepEqual(current,path==='home'?[]:[path.startsWith('/reports/')?'/reports/24h':'/proposals/24h']);
  for(const anchor of ['overview','agents'])assert(sidebar.includes('href="'+(path==='home'?'':'/')+'#'+anchor+'"'));
  assert.match(sidebar,/>ONE CLICK MUSIC</);assert.match(sidebar,/>ONE CLICK 24H</);
 }
});
test('each workspace has exactly two platform tabs in order and keeps the relevant filters',()=>{
 for(const [section,title] of [['/reports','Báo cáo'],['/proposals','Phê duyệt đề xuất']]){
  for(const platform of ['24h','music']){
   const path=section+'/'+platform;
   const switcher=renderPlatformTabs(path,{day:'2026-11-27',period:'week',show:'test&show'});
   const nav=switcher.match(/<nav[^>]*>.*?<\/nav>/)[0];
   assert(nav.includes('aria-label="'+title+'"'));
   assert.deepEqual(Array.from(nav.matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g),
    m=>[m[1],Boolean(m[2]),m[3]]),[
    [section+'/24h?day=2026-11-27&amp;period=week',platform==='24h','24H'],
    [section+'/music?day=2026-11-27&amp;period=week&amp;show=test%26show',platform==='music','Music'],
   ]);
   assert.equal(switcher.includes('href="/#reports"'),section==='/reports');
  }
 }
 const overview=renderPlatformTabs('/reports');
 assert(overview.includes('href="/reports/24h"')&&overview.includes('href="/reports/music"'));
 assert(!overview.includes('aria-current'));
});
const planInventory={showsAvailable:true,inventoryAvailable:true,rows:[{id:'music-1',artist:'Nghệ sĩ mẫu',date:'2030-01-07',status:'announced',prices:{A:500000},inventory:{capacity:100,sold:20,remaining:75,held:1,blocked:2}}]};
test('Daily Director turns the same Music report into grounded campaign drafts without live permissions',()=>{
 const plan=musicPlan('2030-01-02',{status:'available',data:parseMusicFinance(reportFixture)},planInventory);
 assert.equal(plan.evidence.daily.revenueVnd,1500000);
 assert.equal(plan.evidence.previousDay,'2030-01-01');assert.equal(plan.evidence.adAttribution,null);assert.match(plan.tasks[0].deliverable,/ngày hiện tại có thể chưa kết thúc/);
 assert(plan.tasks.some(t=>t.agent==='Content'&&t.state==='draft_ready'&&t.deliverable.includes('Nghệ sĩ mẫu')));
 assert(plan.tasks.some(t=>t.agent==='Sale'&&t.state==='draft_ready'));
 assert(plan.tasks.some(t=>t.agent==='Ads'&&t.state==='awaiting_approval'&&t.deliverable.includes('0 đ')));
 const body=renderDailyDirector({plan,revision:1,updated_at:'2030-01-02T00:00:00Z'},'2030-01-02',escapeMusic);
 assert.match(body,/AI Director/);assert.match(body,/Bản nháp đề xuất · chờ duyệt/);assert.match(body,/không đồng nghĩa/);assert.doesNotMatch(body,/Đã chuẩn bị tài liệu nội bộ/);
 const missing=musicPlan('2030-01-02',{status:'unavailable',data:null},planInventory);
 assert(missing.tasks.every(t=>t.state==='needs_input'));
 assert.equal(missing.evidence.finance,'missing');
 const past=musicPlan('2030-02-01',{status:'available',data:parseMusicFinance(reportFixture)},planInventory);
 assert(!past.tasks.some(t=>t.agent==='Ads'));
});
test('Daily Director 24H gates product strategy on actual FnB data and never substitutes sample numbers',()=>{
 const plan=retailPlan({created:0,accepted:0,blocked:0,failed:0,crm:null,records:[]});
 assert(plan.tasks.some(t=>t.id==='sapo'&&t.state==='needs_input'));
 assert(plan.tasks.some(t=>t.agent==='Planner'&&t.state==='needs_input'));
 assert(plan.tasks.some(t=>t.agent==='Ads'&&t.state==='awaiting_approval'));
 assert(plan.tasks.some(t=>t.agent==='Content'&&t.state==='draft_ready'));
 assert(!plan.tasks.some(t=>t.state==='completed'));
 assert.match(renderDailyDirector(null,'2030-01-01',escapeMusic),/Chưa có bản phân tích/);
});


test('Director uses historical shows and prepares the entire upcoming portfolio, not just immediate campaigns',()=>{
 const oldTotals={paidOrders:3,paidTickets:8,revenueVnd:3200000,complimentaryTickets:1};
 const historical={showId:'past',artist:'Show đã qua',date:'2029-12-28',total:oldTotals,days:{'2029-12-27':oldTotals},recordedCostVnd:2000000,costUpdatedAt:'2030-01-01T00:00:00Z'};
 const data=parseMusicFinance({...reportFixture,rows:[...reportFixture.rows,historical]});
 const future=[
  {...planInventory.rows[0],id:'future-far',artist:'Show xa',date:'2030-02-15',status:'pending',inventory:null},
  {...planInventory.rows[0],id:'future-2',artist:'Show 2',date:'2030-01-08'},
  {...planInventory.rows[0],id:'future-full',artist:'Show hết vé',date:'2030-01-03',status:'sold_out',inventory:{capacity:100,sold:100,remaining:0,held:0,blocked:0}}
 ];
 const plan=musicPlan('2030-01-02',{status:'available',data},{...planInventory,rows:[...planInventory.rows,...future]});
 assert.equal(plan.evidence.historicalShows.length,1);
 assert.equal(plan.evidence.historicalShows[0].revenueVnd,3200000);
 assert.equal(plan.evidence.upcomingShows.length,4);
 const far=plan.evidence.upcomingShows.find(r=>r.showId==='future-far');
 assert.equal(far.priority,'prepare');assert.match(far.policy,/chưa quảng bá mở bán/);
 assert.match(plan.evidence.upcomingShows.find(r=>r.showId==='future-full').policy,/không đẩy bán thêm/);
 assert(plan.tasks.some(t=>t.id==='historical-review'&&t.state==='draft_ready'));
 assert(plan.tasks.some(t=>t.id==='portfolio-plan'&&t.state==='draft_ready'));
 assert(!plan.tasks.some(t=>t.id==='future-full:ads'));
 const body=renderDailyDirector({plan,revision:1,updated_at:'2030-01-02T00:00:00Z'},'2030-01-02',escapeMusic,{platform:'music'});
 assert.match(body,/Học từ kết quả show trước/);assert.match(body,/Show đã qua/);assert.match(body,/Show xa/);assert.match(body,/Kế hoạch toàn bộ show chưa diễn/);
});


const {proposalPlatform,proposalPlan,proposalUrl,proposalPeriodValue,renderProposalPage,buildCampaign}=require('./daily-director.cjs');
test('Music financial report keeps its financial summary separate from proposal actions',()=>{
 const report=renderMusicDaily({status:'available',data:parseMusicFinance(reportFixture)},'2030-01-02',escapeMusic);
 assert.doesNotMatch(report,/daily-director\/approve|Phương án AI Director/);
});
test('Campaign proposal separates period-specific targets, cost scenarios and named human roles',()=>{
 const day='2030-01-02',now=new Date('2030-01-02T05:00:00Z');
 const show={...planInventory.rows[0],date:'2030-01-20',time:'19:30'};
 const finance={...parseMusicFinance(reportFixture).rows[0],total:{...reportTotals,paidTickets:2}};
 const d=buildCampaign(day,show,finance,now,'day'),w=buildCampaign(day,show,finance,now,'week'),m=buildCampaign(day,show,finance,now,'month');
 assert.equal(d.slots.length,1);assert.equal(w.slots.length,7);assert(m.slots.length>w.slots.length);
 assert(m.targetNewPaidTickets<=show.inventory.remaining-show.inventory.held);
 assert(d.staffPlan.some(t=>t.person==='Diệu'));assert(d.mediaPlan.some(t=>t.channel.includes('TikTok')));
 assert.equal(d.budgetNewVnd,0);assert(d.paidScenario.budgetVnd>0);assert.match(d.paidScenario.basis,/giả định/i);
 const week=proposalPlan('music','week',day,{status:'available',data:parseMusicFinance(reportFixture)},{...planInventory,rows:[show]},null,now);
 assert.equal(week.periodEnd,'2030-01-08');
 const page=renderProposalPage({plan:week,revision:1,updated_at:now.toISOString(),fingerprint:'a'.repeat(64)},'music_week','week',day,escapeMusic,{csrf:'test',now});
 assert.match(page,/Đề xuất Music Show/);assert.match(page,/name="platform" value="music_week"/);assert.match(page,/Kế hoạch tuần/);assert.match(page,/Nhân sự đề xuất/);assert.match(page,/Media & marketing/);assert.match(page,/Phê duyệt phương án nội bộ/);
 assert.equal(proposalPlatform('music','month'),'music_month');
 assert.equal(proposalUrl('music_week',day),'/proposals/music?period=week&day=2030-01-02');
 assert.equal(proposalPeriodValue('bad'),'day');
 const retail=proposalPlan('24h','month',day,null,null,{created:0,accepted:0,blocked:0,failed:0,crm:null,records:[]},now);
 assert.equal(retail.periodEnd,'2030-01-31');assert.equal(retail.evidence.retailObjective.revenueTargetVnd,null);
});


const {buildRetailStrategy}=require('./retail-strategy.cjs');
test('24H proposals contain a concrete pilot and honest conversion assumptions rather than only a source checklist',()=>{
 const day='2030-01-02',now=new Date('2030-01-02T05:00:00Z'),retail={created:0,accepted:0,blocked:0,failed:0,crm:null,records:[]};
 const daily=proposalPlan('24h','day',day,null,null,retail,now);
 const s=daily.evidence.retailStrategy;
 assert.equal(s.budgetVnd,100000);assert.equal(s.budgetAuthorizedVnd,0);
 assert.deepEqual([s.conversationsLow,s.conversationsHigh,s.ordersLow,s.ordersHigh],[10,20,2,6]);
 assert.equal(s.revenueTargetVnd,null);assert.equal(s.minContribution,16667);assert.equal(s.maxContribution,50000);
 assert(s.staff.some(a=>a.person==='Diệu'));assert(s.agents.some(a=>a.agent.includes('Creative')));
 const week=buildRetailStrategy(day,'2030-01-08','week',now);assert.equal(week.budgetVnd,300000);assert.equal(week.days,3);assert.equal(week.milestones.length,3);
 const month=buildRetailStrategy(day,'2030-01-31','month',now);assert.equal(month.budgetVnd,300000);
 const page=renderProposalPage({plan:daily,revision:2,updated_at:now.toISOString(),fingerprint:'a'.repeat(64)},'24h','day',day,escapeMusic,{csrf:'test',now});
 assert.match(page,/Tăng lượt khách mua tại cửa hàng 24H/);assert.match(page,/100\.000 đ/);assert.match(page,/2–6/);assert.match(page,/Điều kiện hòa vốn/);assert.match(page,/chưa có API doanh thu/);
 assert(daily.tasks.some(t=>t.id==='strategy:Ads / Auditor'&&t.state==='awaiting_approval'));
});


const live=require('./live-director.cjs');
const {publicMusicAsset,readMusicMedia}=require('./music-readonly.cjs');
const mediaFixture='https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/public/extra-media/poster.png';
test('Live Director media connector reads only public assets and excludes arbitrary or signed URLs',async()=>{
 assert.equal(publicMusicAsset(mediaFixture),mediaFixture);
 for(const url of ['https://example.com/banner.png','http://iextra.net/banner.png',mediaFixture+'?token=secret','https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/sign/extra-media/secret.png'])assert.equal(publicMusicAsset(url),null);
 const result=await readMusicMedia(async(url,opts)=>{assert.equal(url,'https://iextra.net/api/public/media');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return Response.json({images:{'artist-music-1':mediaFixture,'bad':'https://example.com/unknown.png'}})});
 assert.equal(result.available,true);assert.equal(result.assets.length,1);assert.equal(result.assets[0].printVerified,false);
});
test('Live Director cannot call a model or show a completed AI plan without a configured model',async()=>{
 const f=live.makeFacts('music','2030-01-02',{status:'available',data:parseMusicFinance(reportFixture)},{...planInventory,checkedAt:'2030-01-02T00:00:00Z'}, {available:true,assets:[]},null);
 assert.equal(live.roleNames.length,11);assert.equal(live.stages.length,13);
 assert(f.missing.some(x=>x.includes('Video')));
 let calls=0;
 await assert.rejects(live.callRole('DirectorBrief',f,{}, {},async()=>{calls++;throw Error('unexpected');}),/model_not_configured/);
 assert.equal(calls,0);
 const page=live.renderLiveDirector({status:'blocked',reason:'missing_model_key',facts:f,results:{}},escapeMusic,{});
 assert.match(page,/0\/11 Agent/);assert.match(page,/Chưa cấp API key/);assert.match(page,/Chưa có phương án đủ điều kiện/);
 assert.doesNotMatch(page,/Phê duyệt phương án AI/);
});
test('Live Director requires distinct assignments and actual model reports before synthesis',async()=>{
 const day='2030-01-02',deadline=day+'T22:00:00+07:00';
 const f=live.makeFacts('music',day,{status:'available',data:parseMusicFinance(reportFixture)},{...planInventory,checkedAt:day+'T00:00:00Z',rows:[{...planInventory.rows[0],posterUrl:mediaFixture}]},{available:true,assets:[]},null);
 const assignment=agent=>({agent,mission:'Phân tích theo dữ liệu đã cấp',deadline,deliverable:'Báo cáo kết quả',metric:'Đối chiếu báo cáo'});
 const brief={summary:'Director phân việc',assignments:live.roleNames.map(assignment),blockers:[]};
 assert(live.validBrief(brief,f));assert(!live.validBrief({...brief,assignments:brief.assignments.slice(1)},f));
 const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fixture-only',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13'};
 let calls=0;
 const request=async(url,opts)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(opts.method,'POST');
  const body=JSON.parse(opts.body),input=JSON.parse(body.input);
  if(input.role==='Research'){
   assert.equal(input.assignment.agent,'Research');
   const fields=body.text.format.schema.properties;
   assert(fields.sourceIds.items.enum.includes('finance:music-1'));
   assert(fields.assetIds.items.enum.includes('poster:music-1'));
   assert(fields.actions.items.properties.showId.enum.includes('music-1'));
   const pattern=new RegExp(fields.actions.items.properties.deadline.pattern);
   assert(pattern.test(deadline));assert(!pattern.test('2030-01-03T09:00:00+07:00'));
  }
  const output=input.role==='DirectorBrief'?brief:{summary:'Báo cáo mô hình fixture',sourceIds:['finance:music-1'],actions:[],assetIds:[],assumptions:[],blockers:[]};
  return Response.json({id:'resp_fixture_'+calls,status:'completed',model:'fixture',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
 };
 const b=await live.callRole('DirectorBrief',f,{},env,request);
 assert.equal(b.responseId,'resp_fixture_1');
 const r=await live.callRole('Research',f,{DirectorBrief:b},env,request);assert.equal(r.responseId,'resp_fixture_2');
 await assert.rejects(live.callRole('DirectorFinal',f,{DirectorBrief:b,Research:r},env,request),/missing_agent_reports/);
 assert.equal(calls,2);
 const wrongSource=async()=>Response.json({id:'resp_unsupported',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...r.output,sourceIds:['finance:other']})}]}]});
 await assert.rejects(live.callRole('Research',f,{DirectorBrief:b},env,wrongSource),/invalid_evidence/);
});

test('Live Director retains only the allowlisted provider failure code and honors Retry-After',async()=>{
 const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fixture-only',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13'};
 const facts=live.makeFacts('music','2030-01-02',null,null,null,null);
 for(const [code,reason,seconds] of [['insufficient_quota','provider_quota_exhausted',3600],['rate_limit_exceeded','provider_rate_limited',300],['unknown','provider_http_429',300]]){
  const request=async()=>Response.json({error:{code,message:'private diagnostic'}},{status:429,headers:{'Retry-After':'300'}});
  await assert.rejects(live.callRole('DirectorBrief',facts,{},env,request),e=>e.message===reason&&e.retrySeconds===seconds);
 }
});

test('An incomplete audit stays unverified and records only the provider reason',async()=>{
 const facts=live.makeFacts('music','2030-01-02',null,null,null,null);
 const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fixture-only',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13'};
 const results={DirectorBrief:{responseId:'resp_brief',output:{assignments:[{agent:'Auditor'}]}}};
 for(const [reason,expected] of [['max_output_tokens','provider_output_limit'],['content_filter','provider_content_filter'],['unknown detail','provider_not_completed']]){
  const request=async(url,opts)=>{
   const body=JSON.parse(opts.body);
   assert.equal(body.text.format.schema.properties.actions.maxItems,5);
   return Response.json({id:'resp_incomplete',status:'incomplete',incomplete_details:{reason}});
  };
  await assert.rejects(live.callRole('Auditor',facts,results,env,request),e=>e.message===expected);
 }
 const page=live.renderLiveDirector({day:facts.day,step_index:live.stages.indexOf('Auditor'),calls_today:13,status:'blocked',results,facts},escapeMusic,env);
 assert.match(page,/Đã dùng hết lượt gọi của ngày.*Auditor/);
});
test('Music signals separate quoted conversations from verified linked buyers and isolate show-specific ad spend',()=>{
 const {parseSignals}=require('./music-signals.cjs');
 const input={source:'music_sales_signals_v1',checkedAt:'2030-01-02T08:00:00Z',fromDay:'2029-12-27',toDay:'2030-01-02',
  messenger:[{showId:'music-1',quotedChats:4,linkedPaidChats:2,phone:'not allowed'}],
  adDays:[{day:'2030-01-02',fetchedAt:'2030-01-02T08:00:00Z',rows:[{showId:'music-1',accountId:'1915621506464312',spendVnd:100,campaigns:1}]}]};
 const data=parseSignals(input);
 assert.equal(data.messenger[0].linkedPaidChats,2);
 assert.equal(data.messenger[0].phone,undefined);
 assert.throws(()=>parseSignals({...input,messenger:[{showId:'music-1',quotedChats:1,linkedPaidChats:2}]}));
 assert.throws(()=>parseSignals({...input,adDays:[{...input.adDays[0],rows:[{...input.adDays[0].rows[0],accountId:'unrelated'}]}]}));
 assert.equal(live.makeFacts('24h','2030-01-02',null,null,null,null,data).musicSignals,undefined);
 assert.deepEqual(live.makeFacts('music','2030-01-02',null,null,null,null,data).musicSignals,data);
});

test('A one-day allowance expires on the following reporting day',()=>{
 const env={EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13',EXTRA_OS_DIRECTOR_OVERRIDE_TOTAL:'26',EXTRA_OS_DIRECTOR_OVERRIDE_DAY:'2030-01-02'};
 assert.equal(live.dailyCallLimit(env,'2030-01-02'),26);
 assert.equal(live.dailyCallLimit(env,'2030-01-03'),13);
 assert.equal(live.dailyCallLimit({...env,EXTRA_OS_DIRECTOR_OVERRIDE_TOTAL:'90'},'2030-01-02'),13);
 const unlimited={...env,EXTRA_OS_DIRECTOR_OVERRIDE_TOTAL:'unlimited'};
 assert.equal(live.dailyCallLimit(unlimited,'2030-01-02'),null);
 assert.equal(live.dailyCallLimit(unlimited,'2030-01-03'),13);
 assert.equal(live.dailyCallLimit({...unlimited,EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:''},'2030-01-02'),0);
 const page=live.renderLiveDirector({day:'2030-01-02',calls_today:100,step_index:11,status:'queued'},escapeMusic,unlimited);
 assert.match(page,/100 \/ không giới hạn/);
 assert.doesNotMatch(page,/Đã dùng hết lượt gọi/);
});

test('Music readers isolate active shows and keep ended shows in revenue only',()=>{
 const {showCatalog,buildReport,reading}=require('./show-report.cjs');
 const shows=[{id:'a',artist:'Alpha',date:'2030-01-03',status:'announced'},{id:'b',artist:'Beta',date:'2030-01-02',status:'live'},{id:'c',artist:'Closed',date:'2030-01-02',status:'ended'},{id:'d',artist:'Past',date:'2030-01-01',status:'announced'}];
 const finance={data:{checkedAt:'2030-01-02T05:00:00Z',rows:shows.map(s=>({...reportFixture.rows[0],showId:s.id,artist:s.artist}))}};
 const catalog=showCatalog({rows:shows},finance,'2030-01-02');
 assert.deepEqual(catalog.active.map(s=>s.id),['b','a']);assert.deepEqual(catalog.ended.map(s=>s.id),['d','c']);
 const assignments=require('./staff-scope.cjs');
 const first=assignments.assignDuty('print','2030-01-02T17:00:00+07:00');
 assert.equal(first.staffId,'trang');assert.throws(()=>assignments.assignDuty('advertising','2030-01-02'));
 const campaign=id=>({showId:id,title:id==='a'?'Alpha campaign':'Beta campaign',target:'Mục tiêu',rationale:'Có nguồn',deadline:first.deadline,staff:[first],actions:[],assetIds:[],missing:[],expectedLow:null,stopRule:'Ngưỡng dừng',budgetBasis:'Căn cứ',proposedBudgetVnd:500000});
 const run={status:'ready',facts:{assets:[]},results:{DirectorFinal:{staffPolicyVersion:1,output:{campaigns:[campaign('a'),campaign('b')]}}}};
 const normal=buildReport(shows[0],'2030-01-02',finance,run,false);
 assert.match(reading(normal,'full'),/Alpha campaign/);assert.doesNotMatch(reading(normal,'full'),/Beta|Closed/);
 assert.match(reading(normal,'full'),/Nhận file đã duyệt/);assert.doesNotMatch(reading(normal,'brief'),/Nhận file đã duyệt/);
 const ended=buildReport(shows[2],'2030-01-02',finance,run,true);
 assert.deepEqual(ended.sections,[]);assert.doesNotMatch(reading(ended,'full'),/Ngân sách|AI|Alpha/);
});
test('Vietnamese report audio preserves all words across bounded immutable parts',()=>{
 const {segments,playerHtml}=require('./report-audio.cjs');
 const text='Báo cáo của nghệ sĩ. '.repeat(120)+'Kết thúc.';
 const parts=segments(text);assert(parts.length>1);
 assert(parts.every(p=>p.input.length<=800));assert.equal(parts.map(p=>p.input).join(' '),text);
 assert.equal(parts.at(-1).key,segments(text).at(-1).key);
 const html=playerHtml({full:parts.map(p=>p.key)});
 assert.doesNotMatch(html,/data-mode="brief"|Nghe tóm tắt/);
 assert.match(html,/Nghe toàn bộ báo cáo/);assert.match(html,/audio preload="none"/);
});
test('A staffing-only revision preserves validated targets, budgets and 11 report references',async()=>{
 const facts=live.makeFacts('music','2030-01-02',null,null,null,null);
 // Historical staffing-only checkpoints predate the per-show economics protocol.
 delete facts.analysisVersion;
 const env={EXTRA_OS_DIRECTOR_MODEL_ENABLED:'true',EXTRA_OS_OPENAI_API_KEY:'fixture',EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY:'13'};
 const results={DirectorBrief:{responseId:'brief',output:{assignments:[]}}};
 for(const agent of live.roleNames)results[agent]={responseId:'resp_'+agent,output:{assetIds:[],actions:[]}};
 const deadline='2030-01-02T18:00:00+07:00';
 const action={agent:'Ads',action:'Vận hành quảng cáo',deliverable:'Báo cáo chi',metric:'Chi theo nguồn',deadline};
 const old={title:'Kế hoạch',summary:'Tổng hợp',decision:'Duyệt mức chi',blockers:[],
  reportReview:live.roleNames.map(agent=>({agent,reportId:results[agent].responseId,decisionImpact:'Đã rà soát'})),
  campaigns:[{title:'Bán vé',showId:'',target:'Hai vé',rationale:'Căn cứ báo cáo',proposedBudgetVnd:100000,expectedLow:1,expectedHigh:2,budgetBasis:'Đã ghi nhận',stopRule:'Dừng khi đủ',deadline,assetIds:[],missing:[],actions:[action],staff:[]}]};
 results.PreviousDirectorFinal={responseId:'old',output:old};
 const makeRequest=duty=>async(url,req)=>{
   const schema=JSON.parse(req.body).text.format;
   assert.equal(schema.name,'director_staff_revision');
   assert.deepEqual(Object.keys(schema.schema.properties.assignments.properties),['campaign_1']);
   return Response.json({id:'new',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({assignments:{campaign_1:{actions:[action],staff:[{duty,deadline}]}}})}]}]});
 };
 const updated=await live.callRole('DirectorFinal',facts,results,env,makeRequest('print'));
 assert.equal(updated.staffPolicyVersion,1);assert.equal(updated.output.campaigns[0].proposedBudgetVnd,100000);
 assert.equal(updated.output.campaigns[0].staff[0].staffId,'trang');
 assert.deepEqual(updated.output.reportReview,old.reportReview);
 await assert.rejects(live.callRole('DirectorFinal',facts,results,env,makeRequest('run_ads')),/invalid_campaign_fields/);
});
test('Full-report playback advances every part and can pause, resume and replay',async()=>{
 const vm=require('node:vm'),{playerHtml}=require('./report-audio.cjs');
 const html=playerHtml({full:['a','b','c']});
 const elem=()=>{const listeners={};return {dataset:{},addEventListener:(t,fn)=>{listeners[t]=fn;},fire:t=>listeners[t]?.()};};
 const audio=elem(),status=elem(),window=elem(),buttons=[elem()],played=[];
 buttons[0].dataset={mode:'full',track:'a,b,c',label:'Full'};
 audio.paused=true;audio.pause=()=>{audio.paused=true;audio.fire('pause');};
 audio.play=()=>{played.push(audio.src);audio.paused=false;audio.fire('playing');return Promise.resolve();};
 const panel={querySelector:s=>s==='audio'?audio:status,querySelectorAll:()=>buttons};
 vm.runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)[1],{document:{querySelector:()=>panel},window});
 buttons[0].fire('click');audio.fire('ended');audio.fire('ended');audio.fire('ended');
 assert.deepEqual(played,['/report-audio/a.mp3','/report-audio/b.mp3','/report-audio/c.mp3']);
 assert.equal(status.textContent,'Đã đọc hết.');buttons[0].fire('click');
 assert.equal(played.at(-1),'/report-audio/a.mp3');
 buttons[0].fire('click');assert.equal(audio.paused,true);buttons[0].fire('click');assert.equal(audio.paused,false);
});

test('Show picker scopes dates, nearest-first options and blocked approval to the selected show',()=>{
 const {renderShowPage,showCatalog}=require('./show-report.cjs');
 const {proposalState,approvalPanel}=require('./show-approval.cjs');
 const snapshot={showsAvailable:true,rows:[
   {id:'next',date:'2030-01-03',time:'19:30',artist:'Sau',status:'announced'},
   {id:'soon',date:'2030-01-02',time:'19:30',artist:'Gần',status:'announced'}]};
 const catalog=showCatalog(snapshot,{},'2030-01-01'),show=catalog.active[0],esc=String;
 assert.equal(show.id,'soon');
 const run={status:'blocked',reason:'invalid_model_report',results:{}};
 const panel=approvalPanel({run,show,state:proposalState(run,show),esc});
 const html=renderShowPage({path:'/proposals/music',day:'2030-01-01',period:'week',catalog,show,report:{title:'Gần',brief:['Phần đầu'],sections:[{title:'Quyết định quảng cáo và bán vé',lines:['Hạn xử lý']},{title:'Đối soát vé',lines:['Kiểm tra doanh thu']}],images:[{label:'Tệp thử',url:'/show-media/test/poster',downloadUrl:'/show-media/test/poster?download=1'}]},snapshot,run,esc,player:'<button data-mode="full">Nghe toàn bộ báo cáo</button>',approvalPanel:panel});
 const order=['<h2>Gần</h2>','data-mode="full"','Phần đầu','Hạn xử lý','Phê duyệt đề xuất','Kiểm tra doanh thu','Tải về'].map(label=>html.indexOf(label));
 assert(order.every((index,i)=>index>=0&&(i===0||order[i-1]<index)));
 assert.match(html,/<select name="show" required><optgroup[^>]*><option value="soon" selected/);
 assert.match(html,/name="period"/);assert.match(html,/name="day"/);
 assert.match(html,/disabled[^>]*>Phê duyệt đề xuất/);assert.match(html,/0\/11 Agent/);
 assert.doesNotMatch(html,/action="\/proposals\/music\/approve"/);
});

test('Approval requires a checked, unexpired final campaign for the selected show',()=>{
 const {proposalState,approvalPanel}=require('./show-approval.cjs');
 const show={id:'soon',date:'2030-01-02',time:'19:30',artist:'Nghệ sĩ',status:'announced'};
 const now=new Date('2030-01-01T08:00:00Z');
 const campaign={showId:show.id,proposedBudgetVnd:0,deadline:'2030-01-02T17:00:00+07:00'};
 const results=Object.fromEntries(live.roleNames.map(r=>[r,{responseId:r}]));
 const final={analysisVersion:1,responseId:'v2',output:{campaigns:[campaign]}};
 const run={id:'test',status:'ready',results:{...results,DirectorFinal:final}};
 const state=proposalState(run,show,now);
 assert.equal(state.campaign,campaign);assert.match(approvalPanel({run,show,day:'2030-01-01',period:'day',csrf:'c',state,esc:String}),/action="\/proposals\/music\/approve"/);
 assert.match(proposalState(run,{...show,id:'other'},now).reason,/chưa có đề xuất/);
 assert.match(proposalState(run,show,new Date('2030-01-02T17:01:00+07:00')).reason,/qua thời hạn/);
 assert.match(proposalState({...run,results:{...run.results,DirectorFinal:{...final,analysisVersion:0}}},show,now).reason,/phân tích lại/);
 assert.match(proposalState({...run,results:{...run.results,Ads:{}}},show,now).reason,/10\/11/);
});

test('Staging saves a proposal revision once and rejects stale or cross-show submissions',{skip:!process.env.DIRECTOR_TEST_DATABASE_URL},async()=>{
 const {Pool}=require('pg'),{randomUUID}=require('node:crypto');
 const {initShowApprovals,approveShow}=require('./show-approval.cjs');
 const db=new Pool({connectionString:process.env.DIRECTOR_TEST_DATABASE_URL});
 const connection=await db.connect();
 const isolated={query:(...args)=>connection.query(...args),connect:async()=>({query:(...args)=>connection.query(...args),release(){}})};
 try{
  // Use a separate schema for this test because the production ledger has a real foreign key.
  const schema='test_show_approval_'+randomUUID().replaceAll('-','');
  await connection.query('create schema '+schema);
  try{
   await connection.query('set search_path to '+schema);
   await connection.query('create table os_live_director_runs (id uuid primary key,platform text,day date,status text,reason text,results jsonb)');
   await initShowApprovals(isolated);
   const runId=randomUUID(),now=new Date('2030-01-01T10:00:00+07:00');
   const show={id:'show-1',date:'2030-01-02',time:'19:30',status:'announced'};
   const campaign={showId:show.id,proposedBudgetVnd:0,deadline:'2030-01-01T18:00:00+07:00'};
   const results=Object.fromEntries(live.roleNames.map(r=>[r,{responseId:r}]));
   results.DirectorFinal={analysisVersion:1,responseId:'v1',output:{campaigns:[campaign]}};
   await connection.query("insert into os_live_director_runs values($1,'music',$2,'ready',null,$3::jsonb)",[runId,'2030-01-01',JSON.stringify(results)]);
   const fields=new URLSearchParams({run:runId,period:'day',day:'2030-01-01',show:show.id,revision:'v1'});
   assert.equal(await approveShow(isolated,fields,show,{},now),true);
   assert.equal(await approveShow(isolated,fields,show,{},now),true);
   assert.equal(await approveShow(isolated,fields,{...show,id:'other'},{},now),false);
   fields.set('revision','stale');assert.equal(await approveShow(isolated,fields,show,{},now),false);
   assert.equal((await connection.query('select count(*)::int as n from os_music_show_approvals')).rows[0].n,1);
  }finally{await connection.query('reset search_path');await connection.query('drop schema '+schema+' cascade');}
 }finally{connection.release();await db.end();}
});

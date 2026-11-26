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


const {renderSidebar}=require('./workspace-sidebar.cjs');
const {musicPlan,retailPlan,renderDailyDirector}=require('./daily-director.cjs');
test('main menu shows both requested report labels and preserves navigation within reports',()=>{
 const html=renderSidebar();
 assert.match(html,/href="\/reports\/24h"/);assert.match(html,/>Báo cáo 24H</);
 assert.match(html,/href="\/reports\/music"/);assert.match(html,/>Báo cáo \+1 Music Show</);
 const selected=renderSidebar('/reports/music');
 assert.match(selected,/href="\/reports\/music" aria-current="page"/);
 assert.match(selected,/href="\/#overview"/);assert.match(selected,/href="\/#agents"/);
 assert.match(html,/>ONE CLICK MUSIC</);assert.match(html,/>ONE CLICK 24H</);
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
 assert.match(body,/AI Director/);assert.match(body,/Bản nháp nội bộ/);assert.match(body,/không đồng nghĩa/);
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

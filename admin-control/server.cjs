'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {parseShowIntake,prepareShow}=require('./marketing-show-intake.ts');
const {agents,jobDefinitions,planMarketing,planStaffWork,analyzeInternalPlans,executeAnalystPlan}=require('./marketing-director.ts');
const {departmentLabels}=require('./marketing-workspace.ts');
const {initDirectorQueue,queueDirector,listRuns,revise,restoreKnowledge,startDirectorWorker}=require('./director-queue.cjs');
const {uuid,readRetailBrief,definitions,review,makeExecutor,permissionLabels}=require('./director-program.cjs');
const {renderDirector,directorCss}=require('./director-ui.cjs');
const {sampleBrief,sampleReleaseRequestId}=require('./director-sample.cjs');
const {makeConnectors}=require('./director-connectors.cjs');
const {getMusicSnapshot,renderMusicSnapshot}=require('./music-readonly.cjs');
const {renderSidebar,renderPlatformTabs,pages:workspacePages}=require('./workspace-sidebar.cjs');
const {musicOverview}=require('./music-overview.cjs');
const {initDailyDirector,readApprovals,startApprovedWorker,proposalPlatform,proposalUrl,proposalPeriodValue}=require('./daily-director.cjs');
const {initLiveDirector,readLiveRun,startLiveDirector,renderLiveDirector,roleNames}=require('./live-director.cjs');
const {reportDay,getMusicFinance,readRetailDaily,renderMusicDaily,renderRetailDaily}=require('./daily-reports.cjs');
const {initMedia}=require('./director-media.cjs');
const {initCrm,messengerWebhook}=require('./director-crm.cjs');
const {parseFinance,initDirectorFinance,saveFinance,listFinance,renderFinance}=require('./director-finance.cjs');
const {initCrmFollowup,listFollowups,readFollowup,saveFollowup,renderFollowups}=require('./crm-followup.cjs');
const {initStaffWork,issueCode,updateShowTask,assigneeField,staffAccessPage,makeStaffPortal}=require('./staff-work.cjs');
const {showCatalog,buildReport,reading,renderShowPage}=require('./show-report.cjs');
const {initShowApprovals,proposalState,readShowApproval,approvalPanel,approveShow}=require('./show-approval.cjs');
const {getMusicSignals}=require('./music-signals.cjs');
const {serveShowMedia}=require('./show-media.cjs');
const {initAudio,saveTracks,serveAudio,playerHtml,scriptHash}=require('./report-audio.cjs');
const {checkDeployment,migrateV11,recordAudit,transaction,staging}=require('./v11-core.cjs');
const {setupOwner,authenticate,currentActor}=require('./v11-auth.cjs');
const {seedCategories}=require('./v11-costs.cjs');
const {monitorAds}=require('./v11-ads.cjs');
const {startGoals,meteredModelRequest}=require('./v11-director.cjs');
const {makeWorkspace,styles:v11Styles,speechHash,cameraPlayerHash}=require('./v11-workspace.cjs');
const port=Number(process.env.PORT||3000);
const password=process.env.ADMIN_BOOTSTRAP_PASSWORD||'';
const db=process.env.DATABASE_URL||'';
if(password.length<24||!db) throw Error('Admin credentials or database missing');
checkDeployment(process.env);
const pool=new Pool({connectionString:db,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
const handleMessenger24=messengerWebhook(pool);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(32).toString('hex');
const eq=(a,b)=>crypto.timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('vi-VN')+' đ';
const formField=(name,label,type='text',value='')=>'<label>'+esc(label)+'<input required name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" step="1"':'')+'></label>';
const csrfField=s=>'<input type="hidden" name="csrf" value="'+esc(s.csrf)+'">';
const statusLabels={pending:'Chờ xử lý',in_progress:'Đang làm',submitted:'Đã báo cáo',accepted:'Đã nghiệm thu',blocked:'Chờ kết nối',queued:'Đang chờ',succeeded:'Đã hoàn tất'};
const css='*{box-sizing:border-box}body{margin:0;background:#101116;color:#f4f4f6;font:15px system-ui,sans-serif}header{padding:16px 20px;border-bottom:1px solid #34343c;display:flex;justify-content:space-between;align-items:center;gap:12px}main{max-width:1160px;margin:auto;padding:24px 4% 60px}h1,h2{margin:0 0 16px}h2{font-size:20px}p,small{color:#b7b9c4;line-height:1.6}.brand{font-weight:900;font-size:23px}.brand b{color:#fa4055}section{background:#191b23;border:1px solid #373943;border-radius:13px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:13px}.tile{padding:15px;background:#12141a;border:1px solid #343640;border-radius:10px}.tile strong{display:block;margin:8px 0;font-size:21px}label{display:grid;gap:6px;margin:8px 0;font-size:13px}input,textarea,select{width:100%;background:#11131b;color:white;border:1px solid #555863;border-radius:8px;padding:11px;font:inherit}input[type=checkbox]{width:auto;display:inline}button{border:0;border-radius:8px;padding:11px 17px;background:#d72c43;color:white;font-weight:700;cursor:pointer}a{color:#ff8494}nav{display:flex;gap:15px;flex-wrap:wrap;margin-bottom:18px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;border-bottom:1px solid #373943;text-align:left;vertical-align:top}.scroll{overflow:auto}.tag{color:#e8b77e}.login{max-width:440px;margin:8vh auto}details{margin:12px 0}summary{cursor:pointer;font-weight:700}textarea{min-height:75px} .os-layout{display:grid;grid-template-columns:254px minmax(0,1fr);grid-template-areas:"sidebar content";gap:20px;width:100%;max-width:none;margin:0;padding:0 20px 40px 0;align-items:start}.os-content{grid-area:content;min-width:0;max-width:none;width:100%;margin:0;padding:24px 0 0}.os-sidebar{grid-area:sidebar;position:sticky;top:0;display:flex;flex-direction:column;height:100vh;height:100svh;min-height:0;border:0;border-right:1px solid #323440;border-radius:0;background:linear-gradient(175deg,#1a1a25,#12151e 65%);padding:23px 15px 15px;box-shadow:0 18px 50px #0002}.os-brand{display:flex;align-items:center;gap:11px;color:#fff;text-decoration:none;padding:3px 10px 23px}.os-mark{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:42px;height:42px;background:#c72b40;border-radius:11px;color:white;font-size:22px;font-weight:900;letter-spacing:-2px}.os-brand strong{display:block;font-size:22px;letter-spacing:1px;line-height:1.05;font-weight:900}.os-brand small{display:block;margin-top:5px;font-size:9px;letter-spacing:1.6px;color:#c8b9c0}.os-sidebar nav{display:block;flex:1;min-height:0;overflow:auto;margin:0;scrollbar-width:thin}.nav-group{margin-bottom:18px}.menu-label{margin:0 10px 8px;color:#8d8b9c;font-size:10px;font-weight:800;letter-spacing:1.2px;line-height:1.6}.os-sidebar nav a{display:flex;align-items:center;gap:10px;min-height:45px;margin:0 0 4px;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:#b1b6c5;font-size:13px;font-weight:600;line-height:1.55;text-align:left;text-decoration:none}.os-sidebar nav svg{flex-shrink:0}.os-sidebar nav a>span:not(.nav-arrow){min-width:0;overflow-wrap:anywhere}.nav-arrow{margin-left:auto;font-size:22px;line-height:1;color:#c88c99;opacity:0}.os-sidebar nav a:hover{color:#f3f4f8;background:#252631}.os-sidebar nav a:focus-visible{outline:2px solid #ffc996;outline-offset:1px}.os-layout:has(.os-panel#overview:target) .os-sidebar nav a[href="#overview"],.os-layout:has(.os-panel#reports:target) .os-sidebar nav a[href="/reports/24h"],.os-layout:has(.os-panel#platforms:target) .os-sidebar nav a[href="#platforms"],.os-layout:has(.os-panel#oneclick24:target) .os-sidebar nav a[href="#oneclick24"],.os-layout:has(.os-panel#oneclick:target) .os-sidebar nav a[href="#oneclick"],.os-layout:has(.os-panel#shows:target) .os-sidebar nav a[href="#shows"],.os-layout:has(.os-panel#agents:target) .os-sidebar nav a[href="#agents"],.os-layout:has(.os-panel#audit:target) .os-sidebar nav a[href="#audit"],.os-layout:not(:has(.os-panel:target)) .os-sidebar nav a[href="#overview"]:not(.os-brand){color:#be2536;background:#fff0f1;border-color:transparent;box-shadow:none}.os-layout:has(.os-panel#overview:target) .os-sidebar nav a[href="#overview"] .nav-arrow,.os-layout:has(.os-panel#reports:target) .os-sidebar nav a[href="/reports/24h"] .nav-arrow,.os-layout:has(.os-panel#platforms:target) .os-sidebar nav a[href="#platforms"] .nav-arrow,.os-layout:has(.os-panel#oneclick24:target) .os-sidebar nav a[href="#oneclick24"] .nav-arrow,.os-layout:has(.os-panel#oneclick:target) .os-sidebar nav a[href="#oneclick"] .nav-arrow,.os-layout:has(.os-panel#shows:target) .os-sidebar nav a[href="#shows"] .nav-arrow,.os-layout:has(.os-panel#agents:target) .os-sidebar nav a[href="#agents"] .nav-arrow,.os-layout:has(.os-panel#audit:target) .os-sidebar nav a[href="#audit"] .nav-arrow,.os-layout:not(:has(.os-panel:target)) .os-sidebar nav a[href="#overview"]:not(.os-brand) .nav-arrow{opacity:1}.os-sidebar-foot{padding:15px 8px 0;border-top:1px solid #30313e;color:#9ca5b7;font-size:11px}.os-content>.os-panel{display:none;scroll-margin-top:20px}.os-content>#overview{display:block}.os-content:has(>.os-panel:target)>#overview:not(:target){display:none}.os-content>.os-panel:target{display:block}.os-content .grid{grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))}.os-status{font-size:12px;margin:0 0 20px}.os-content>section{margin-top:0}@media(max-width:1260px){.os-layout{grid-template-columns:232px minmax(0,1fr);gap:20px}.os-sidebar{padding-left:12px;padding-right:12px}}@media(max-width:760px){.os-layout{grid-template-columns:minmax(0,1fr);grid-template-areas:"sidebar" "content";gap:12px;padding:0 12px 32px 0}.os-sidebar{position:static;height:auto;padding:12px;border-radius:0 12px 12px 0}.os-content{padding:4px 0 0 12px}.os-brand{padding:4px 8px 12px}.os-sidebar nav{display:flex;flex-wrap:wrap;gap:8px}.nav-group{flex:1 1 145px;margin:0}.os-sidebar nav a{font-size:12px;min-height:42px}.os-sidebar-foot{display:none}header{flex-wrap:wrap}}.report-heading{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.report-note{white-space:pre-wrap;overflow-wrap:anywhere;min-width:170px}.report-pagination{display:flex;gap:16px;align-items:center;flex-wrap:wrap}@media(min-width:761px){body:has(>.os-layout){height:100vh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}body:has(>.os-layout)>header{min-width:0;padding:12px 20px}body:has(>.os-layout)>header .brand{font-size:21px}.os-layout{height:100%;min-height:0;min-width:0;grid-template-rows:minmax(0,1fr);align-items:stretch;gap:20px;padding:0;margin:0;width:100%;overflow:hidden}.os-sidebar{height:100%;min-height:0;max-height:100%;position:relative;top:auto;overflow:hidden;padding:18px 15px 12px;box-shadow:none}.os-sidebar nav{min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin}.os-brand,.os-sidebar-foot{flex-shrink:0}.os-content{height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:20px 20px 20px 0;scrollbar-gutter:stable}.os-content input,.os-content select,.os-content textarea{min-width:0;max-width:100%}.os-content .os-panel{min-width:0}.os-content .scroll{max-width:100%}}@media(min-width:761px) and (max-height:850px){.os-sidebar{padding-top:12px}.os-brand{padding-bottom:13px}.nav-group{margin-bottom:10px}.menu-label{margin-bottom:5px}.os-sidebar nav a{min-height:36px;margin-bottom:2px;padding:7px 9px}.os-sidebar-foot{padding-top:9px}.os-content{padding-top:12px;padding-bottom:12px}.os-status{margin-bottom:10px}#oneclick{padding:16px}#oneclick h2{margin-bottom:8px}#oneclick p{margin:0 0 8px}#oneclick .grid{gap:6px 12px}#oneclick label{margin:4px 0;gap:4px}#oneclick input:not([type=checkbox]),#oneclick textarea{padding:8px}#oneclick textarea{min-height:56px}#oneclick button{padding:9px 14px}}body:has(>.os-layout),.os-content,.os-sidebar nav,.os-content .scroll{scrollbar-width:none;-ms-overflow-style:none;scrollbar-gutter:auto}body:has(>.os-layout)::-webkit-scrollbar,.os-content::-webkit-scrollbar,.os-sidebar nav::-webkit-scrollbar,.os-content .scroll::-webkit-scrollbar{display:none;width:0;height:0}@media(max-width:760px){body:has(>.os-layout){height:100vh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}body:has(>.os-layout)>header{padding:8px 12px;flex-wrap:nowrap;gap:8px}body:has(>.os-layout)>header .brand{font-size:15px}body:has(>.os-layout)>header button{padding:8px 10px;font-size:12px}.os-layout{height:100%;min-height:0;grid-template-rows:auto minmax(0,1fr);align-items:stretch;gap:0;padding:0;overflow:hidden}.os-sidebar{height:auto;min-height:0;max-height:32dvh;overflow:hidden;border-radius:0;padding:8px 10px;border-right:0;border-bottom:1px solid #323440}.os-sidebar .os-brand{display:none}.os-sidebar nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;overflow-y:auto;overflow-x:hidden;min-height:0}.os-sidebar .nav-group{display:contents}.os-sidebar .menu-label{display:none}.os-sidebar nav a{min-height:34px;padding:5px 6px;margin:0;gap:5px;font-size:11px;line-height:1.2}.os-sidebar nav a svg{width:15px;height:15px}.os-sidebar .nav-arrow{display:none}.os-content{height:100%;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:10px 12px 16px;scrollbar-width:none}.os-status{margin-bottom:8px;font-size:10px}.os-content section{padding:12px}.os-content h1{font-size:21px}.os-content h2{font-size:17px}.os-content input,.os-content select,.os-content textarea{min-width:0;max-width:100%}.os-content .grid{grid-template-columns:repeat(auto-fit,minmax(min(145px,100%),1fr));gap:8px}#oneclick label{margin:4px 0;gap:4px}#oneclick input:not([type=checkbox]),#oneclick textarea{padding:8px}#oneclick textarea{min-height:52px}}body{background:#fff;color:#202124;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif}header{background:#fff;border-bottom:1px solid #ececee}.brand{color:#242424}.brand b{color:#cb2839}p,small{color:#68686d}section{background:#fff;border:1px solid #e7e7e9;border-radius:10px}.tile{background:#fafafa;border:1px solid #ededee;border-radius:8px}.tile strong{color:#252529}input,textarea,select{background:#fff;color:#242424;border-color:#d9d9dd;outline-offset:2px}input:focus,textarea:focus,select:focus{outline:1px solid #ce3646;border-color:#ce3646}button{background:#c92d3d;color:#fff;border-radius:7px}button:hover{background:#ad2030}a{color:#b82939}td,th{border-bottom:1px solid #ececee}.tag{color:#777277}.os-sidebar{background:#fafafa;border-right:1px solid #ededee;box-shadow:none}.os-brand{color:#222;padding-bottom:16px}.os-mark{background:#c92d3d;color:#fff;border-radius:8px;width:34px;height:34px;font-size:19px}.os-brand strong{font-size:19px;letter-spacing:.1px}.os-brand small{color:#777;font-size:9px;letter-spacing:.8px}.nav-group{margin-bottom:12px}.menu-label{color:#777;font-size:10px;letter-spacing:.5px;font-weight:650}.os-sidebar nav a{color:#303036;border:1px solid transparent;border-radius:7px;font-size:13px;font-weight:500;min-height:40px;padding:8px 10px}.os-sidebar nav a:hover{background:#efeff0;color:#202124}.os-sidebar nav a:focus-visible{outline:2px solid #c92d3d;outline-offset:1px}.os-sidebar nav a .nav-arrow{display:none}.os-sidebar-foot{border-color:#e8e8eb;color:#777}.os-content h1,.os-content h2{font-weight:650}.os-content .os-status{color:#777}.login section{box-shadow:0 8px 30px #00000008}.login .brand{margin-bottom:20px}.login h1{font-weight:650}body:has(>.os-layout)>header button{background:#fff;color:#555;border:1px solid #ddd}body:has(>.os-layout)>header button:hover{background:#fff0f1;color:#b82939}@media(max-width:760px){.os-sidebar{background:#fff;border-bottom:1px solid #ededee;border-right:0}.os-sidebar nav a{min-height:36px;padding:5px 6px;font-size:11px}.os-content section{border-radius:8px}}html:has(body>.os-layout){height:100%;overflow:hidden}body:has(>.os-layout){position:fixed;inset:0 0 auto;height:100vh;height:100dvh;min-height:0;max-height:100dvh;width:100%;margin:0;overflow:hidden;grid-template-rows:auto minmax(0,1fr)}body:has(>.os-layout)>header{min-height:0;margin:0;flex-shrink:0}.os-layout{min-height:0;max-height:100%;height:100%;min-width:0;overflow:hidden}.os-content{min-height:0;max-height:100%;overflow-y:auto;scrollbar-width:none;scrollbar-gutter:auto}.os-content>.os-panel:last-child,.os-content>section{margin-bottom:0}.os-sidebar{min-height:0;overflow:hidden}.os-sidebar nav{min-height:0;scrollbar-width:none}@media(min-width:761px){body:has(>.os-layout)>header{padding:10px 20px}.os-content{padding:12px 20px 10px 0}.os-status{margin:0 0 9px}.os-sidebar{padding-top:12px;padding-bottom:10px}.os-brand{padding-bottom:12px}.nav-group{margin-bottom:9px}.menu-label{margin-bottom:4px}.os-sidebar nav a{min-height:36px;margin-bottom:2px;padding:6px 10px}#oneclick{padding:14px 16px;margin:0}#oneclick h2{margin:0 0 6px}#oneclick p{margin:0 0 8px;line-height:1.45}#oneclick .grid{gap:5px 10px}#oneclick label{margin:3px 0;gap:3px;line-height:1.4}#oneclick input:not([type=checkbox]),#oneclick textarea{padding:7px 9px}#oneclick textarea{min-height:48px}#oneclick button{padding:8px 14px}}@media(min-width:1150px){#oneclick .grid{grid-template-columns:repeat(5,minmax(0,1fr))}}@media(max-width:760px){.os-layout{grid-template-rows:minmax(0,auto) minmax(0,1fr)}.os-sidebar{max-height:30dvh}.os-content{padding-bottom:10px}.os-content section{margin-bottom:0}}.os-accent{color:#cb2839}#oneclick24 textarea{min-height:48px}#oneclick24 .grid{gap:8px 12px}#oneclick24 label{margin:5px 0}#oneclick24 h2{margin-bottom:8px}.os-report-page .os-sidebar nav a[aria-current="location"]{color:#be2536;background:#fff0f1;border-color:transparent;font-weight:650}.os-report-page .os-content>section{margin-bottom:12px}.os-report-page .os-content>nav{margin-bottom:12px}.director-preview{border-left:4px solid #c92d3d;background:#fff}.director-preview h3{margin:12px 0 8px}.director-preview ol{padding-left:22px;line-height:1.6}.director-preview li{margin:6px 0}.director-jump{font-weight:650}.period-link{display:inline-block;padding:9px 14px;border:1px solid #d9d9dd;border-radius:7px;text-decoration:none}.period-link[aria-current="page"]{background:#fff0f1;color:#b82939;font-weight:650;border-color:#f1d9df}';

const platformTabCss=`
.report-switcher{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px;border-bottom:1px solid #dedee1}
.platform-tabs{display:flex;flex-wrap:nowrap;gap:4px;margin:0}
.platform-tabs a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:78px;padding:8px 16px;border-bottom:3px solid transparent;color:#4e4e56;font-weight:600;text-decoration:none}
.platform-tabs a[aria-current="page"]{color:#ac2334;border-bottom-color:#be2536}
.platform-tabs a:hover{background:#fff0f1}
.platform-tabs a:focus-visible,.report-overview-link:focus-visible{outline:2px solid #ac2334;outline-offset:-2px}
.report-overview-link{padding:8px 4px}
`;
function html(res,body,status=200,audio=false,media=false){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':(media==='camera'?"script-src 'self' 'sha256-"+cameraPlayerHash+"'; connect-src 'self'; media-src 'self' blob:; ":
 (audio||media?"script-src "+[audio&&scriptHash,media&&speechHash].filter(Boolean).map(value=>"'sha256-"+value+"'").join(' ')+"; media-src 'self'; ":""))+"default-src 'none'; img-src 'self' https://iextra.net https://fokntdvgzfldxbaglrdc.supabase.co; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EXTRA OS</title><style>'+css+directorCss+platformTabCss+v11Styles+'</style>'+body+'</html>')}
const redirect=(res,to,cookie)=>{res.writeHead(303,{'Location':to,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end()};
const cookie=(v,age)=>'__Host-extra_os_v11='+v+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
async function form(req){if(!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded'))throw Error('Invalid form');let n=0, chunks=[];for await(const c of req){n+=c.length;if(n>32000)throw Error('Form too large');chunks.push(c)}return new URLSearchParams(Buffer.concat(chunks).toString())}
const staffPageTools={esc,csrfField};
const pageNumber=value=>/^\d{1,6}$/.test(value||'')&&Number(value)>0?Number(value):1;
const crm={
 display:async(req,session)=>{
  const page=pageNumber(new URL(req.url,'http://localhost').searchParams.get('crmPage'));
  const data=await listFollowups(pool,{staffId:session.staff_id,page});
  return renderFollowups(data,{esc,csrfField,s:session,staffId:session.staff_id,page});
 },
 update:(res,session,fields)=>updateCrm(res,fields,session.staff_id)
};
const handleStaff=makeStaffPortal(pool,{form,eq,esc,html,redirect,statusLabels,csrfField,crm});
async function session(req){
 const value=String(req.headers.cookie||'').match(/(?:^|;\s*)__Host-extra_os_v11=([a-f0-9]{64})(?:;|$)/)?.[1];
 return value ? currentActor(pool,hash(value)) : null;
}
const v11=makeWorkspace(pool,{html,redirect,form,eq,csrfField});
const modelRequest=meteredModelRequest(pool,process.env);
async function audit(client,event,details){await client.query('insert into os_audit(event,details) values($1,$2)',[event,JSON.stringify(details)])}
async function init(){await pool.query('create table if not exists os_sessions(token_hash text primary key,csrf text not null,expires_at timestamptz not null);create table if not exists os_shows(id uuid primary key,request_id uuid not null unique,intake jsonb not null,finance jsonb not null,created_at timestamptz default now());create table if not exists os_jobs(show_id uuid references os_shows(id),kind text,agent text,definition jsonb,status text not null,note text not null,primary key(show_id,kind));create table if not exists os_tasks(show_id uuid references os_shows(id),key text,definition jsonb,status text not null default \'pending\',note text not null default \'\',primary key(show_id,key));create table if not exists os_audit(id bigint generated always as identity primary key,event text,details jsonb,created_at timestamptz default now());create table if not exists os_login_rate(bucket bigint primary key,attempts integer not null);create table if not exists os_retail_plans(id uuid primary key,request_id uuid not null unique,intake jsonb not null,created_at timestamptz not null default now());')}
async function login(req,res){
 if(req.headers['sec-fetch-site']==='cross-site')return html(res,loginPage(),403);
 const fields=await form(req);
 const username=(fields.get('username')||'owner').trim().toLowerCase().slice(0,64);
 const bucket=Math.floor(Date.now()/300000);
 const {rows:[limit]}=await pool.query('insert into os_login_rate(bucket,attempts) values($1,1) on conflict(bucket) do update set attempts=os_login_rate.attempts+1 returning attempts',[bucket]);
 if(limit.attempts>120)return html(res,loginPage('Quá nhiều lần thử. Vui lòng thử lại sau 5 phút.'),429);
 const {rows:[rate]}=await pool.query(`insert into os_v11_signin_rate(bucket,identity_hash,attempts) values($1,$2,1)
  on conflict(bucket,identity_hash) do update set attempts=os_v11_signin_rate.attempts+1 returning attempts`,[bucket,hash(username)]);
 if(rate.attempts>12)return html(res,loginPage('Quá nhiều lần thử. Vui lòng thử lại sau 5 phút.'),429);
 const actorId=await authenticate(pool,username,fields.get('password'));
 if(!actorId)return html(res,loginPage('Tên đăng nhập hoặc mật khẩu không đúng.'),401);
 const value=token();
 await transaction(pool,async client=>{
  await client.query('delete from os_v11_sessions where expires_at<=now()');
  await client.query('delete from os_v11_signin_rate where bucket<$1',[bucket-12]);
  await client.query('delete from os_login_rate where bucket<$1',[bucket-12]);
  await client.query("insert into os_v11_sessions(token_hash,csrf,actor_id,expires_at) values($1,$2,$3,now()+interval '8 hours')",[hash(value),token(),actorId]);
  await audit(client,'login',{actorId});
  await recordAudit(client,{id:actorId},'access.login');
 });
 return redirect(res,username==='owner'?'/':'/v11',cookie(value,28800));
}
function loginPage(msg=''){
 return '<main class="login"><section><div class="brand"><b>+1</b> EXTRA <span class="os-accent">OS</span></div>'+
 '<h1>Đăng nhập EXTRA OS</h1><p>'+esc(msg)+'</p><form method="post" action="/login">'+
 '<label>Tên đăng nhập<input name="username" autocomplete="username" value="owner" required></label>'+
 '<label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>'+
 '<button>Đăng nhập</button></form><p><a href="/v11/activate">Kích hoạt tài khoản</a> · <a href="/staff">Cổng công việc V1.0</a></p></section></main>';
}
async function dispatchAnalystPlan(c,id,input,finance,now){
 const definition={kind:'analyst_plan',agent:'Analyst',dependencies:[],run_at:now.toISOString(),priority:80,scope:'internal_plan'};
 const result=executeAnalystPlan(input,finance);
 await c.query("insert into os_jobs(show_id,kind,agent,definition,status,note) values($1,$2,$3,$4,$5,$6) on conflict(show_id,kind) do update set definition=excluded.definition,status=excluded.status,note=excluded.note",[id,'analyst_plan','Analyst',JSON.stringify(definition),result.status,result.note]);
 await audit(c,'director.analyst_plan.returned',{show_id:id,agent:'Analyst',scope:'internal_plan',status:result.status});
}
async function rerunAnalystPlan(res,f){
 const id=f.get('id')||'';
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return html(res,'<main>ID không hợp lệ.</main>',400);
 const c=await pool.connect();try{await c.query('begin');const v=await c.query('select intake,finance from os_shows where id=$1 for update',[id]);if(!v.rowCount){await c.query('rollback');return html(res,'<main>Không tìm thấy kế hoạch.</main>',404)}await dispatchAnalystPlan(c,id,v.rows[0].intake,v.rows[0].finance,new Date());await c.query('commit')}catch(e){await c.query('rollback');throw e}finally{c.release()}return redirect(res,'/#reports');
}
async function createShow(req,res,s,f){const raw={};for(const k of ['artist','startsAt','venue','mediaDriveUrl','setlist'])raw[k]=f.get(k)||'';raw.venueId='';for(const k of ['capacity','bookingVnd','productionVnd','adsVnd','printingVnd','otherVnd','startingPriceVnd','targetProfitVnd']){if(!/^\d+$/.test(f.get(k)||''))throw Error('Số liệu không hợp lệ');raw[k]=Number(f.get(k))}raw.artistConfirmed=f.has('artistConfirmed');raw.mediaRightsConfirmed=f.has('mediaRightsConfirmed');raw.permissions=[];const input=parseShowIntake(raw),now=new Date(),finance=prepareShow(input,now);const request=f.get('request_id');if(!/^[0-9a-f-]{36}$/.test(request||''))throw Error('Invalid request');const c=await pool.connect();try{await c.query('begin');const id=crypto.randomUUID();const v=await c.query('insert into os_shows(id,request_id,intake,finance) values($1,$2,$3,$4) on conflict(request_id) do nothing returning id',[id,request,JSON.stringify(input),JSON.stringify(finance)]);if(v.rowCount){for(const j of planMarketing(input,now))if(j.kind!=='analyst_plan')await c.query('insert into os_jobs values($1,$2,$3,$4,$5,$6)',[id,j.kind,j.agent,JSON.stringify(j),'blocked','Chưa kết nối bộ thực thi hoặc nhà cung cấp; không chạy tự động.']);await dispatchAnalystPlan(c,id,input,finance,now);for(const t of planStaffWork(input,finance,now))await c.query('insert into os_tasks(show_id,key,definition) values($1,$2,$3)',[id,t.key,JSON.stringify(t)]);await audit(c,'show.planned',{show_id:id})}await c.query('commit')}catch(e){await c.query('rollback');throw e}finally{c.release()}redirect(res,'/#shows')}
async function reportsPanel(page,finance){
 const limit=30,offset=(page-1)*limit;
 const [financial,counts,returned,analystShows,analystRetail]=await Promise.all([
  pool.query("select count(*)::int as shows,coalesce(sum((finance->>'plannedCostVnd')::numeric),0)::text as cost,coalesce(sum((finance->>'targetRevenueVnd')::numeric),0)::text as revenue from os_shows"),
  pool.query("select (select count(*) from os_tasks)::int as tasks,(select count(*) from os_tasks where status='submitted')::int as submitted,(select count(*) from os_tasks where status='accepted')::int as accepted,(select count(*) from os_tasks where status='blocked')::int as blocked,(select count(*) from os_jobs where status='succeeded')::int as ai_done,(select count(*) from os_jobs where status='blocked')::int as ai_blocked"),
  pool.query("select * from (select s.id as show_id,s.intake->>'artist' as artist,s.intake->>'startsAt' as show_date,'Nhân sự / nội bộ' as source,t.definition->>'department' as department,t.definition->>'title' as title,t.status,t.note,t.key as item_key from os_tasks t join os_shows s on s.id=t.show_id where t.status in ('submitted','accepted') union all select s.id,s.intake->>'artist',s.intake->>'startsAt','AI',j.agent,j.kind,j.status,j.note,j.kind from os_jobs j join os_shows s on s.id=j.show_id where j.status='succeeded') q order by show_date desc,show_id,source,item_key limit $1 offset $2",[limit,offset]),
  pool.query('select intake,finance from os_shows order by created_at desc limit 500'),
  pool.query("select intake from (select intake,created_at from os_retail_plans union all select jsonb_build_object('budget',input->'budgetVnd'),created_at from os_director_runs where platform='24h' and coalesce(input->>'mode','rehearsal')<>'sample') plans order by created_at desc limit 500")
 ]);
 const f=financial.rows[0],k=counts.rows[0],total=k.submitted+k.accepted+k.ai_done;
 const tile=(label,value,note)=>'<div class="tile"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';
 const analysis=analyzeInternalPlans(analystShows.rows,analystRetail.rows);
 const analystHtml='<section><h2>AI Analyst V 1.0 · Phân tích kế hoạch nội bộ</h2><p>Tối đa 500 kế hoạch gần nhất mỗi nền tảng; chưa có dữ liệu thực tế từ API.</p><div class="grid">'+tile('Doanh thu dự kiến',analysis.showCount===analysis.missing?'—':money(analysis.projectedRevenue),'Không phải tiền đã thu')+tile('Chi phí show dự kiến',analysis.showCount===analysis.missing?'—':money(analysis.showCost),'Kế hoạch hợp lệ')+tile('Ngân sách 24H',analysis.retailCount===analysis.missingRetail?'—':money(analysis.retailBudget),'Ngân sách dự thảo')+tile('Kế hoạch có cảnh báo',analysis.risks.length,'Thiếu mục tiêu hoặc sơ đồ ghế chưa xác minh')+'</div><p>Thiếu dữ liệu: '+esc(analysis.missing)+' show, '+esc(analysis.missingRetail)+' kế hoạch 24H.</p>'+analysis.risks.slice(0,20).map(x=>'<p><strong>'+esc(x.artist)+'</strong> · Thiếu mục tiêu dự kiến: '+money(x.gap)+' · '+esc(x.recommendation)+'</p>').join('')+'</section>';
 const reportPage=(n)=>'/?reportPage='+n+'#reports';
 const pagination='<p class="report-pagination">'+(page>1?'<a href="'+reportPage(page-1)+'">‹ Trang trước</a> ':'')+'Trang '+page+' / '+Math.max(1,Math.ceil(total/limit))+(offset+limit<total?' <a href="'+reportPage(page+1)+'">Trang sau ›</a>':'')+'</p>';
 return '<div class="os-panel" id="reports"><h1>Tổng quan báo cáo</h1>'+renderPlatformTabs('/reports')+'<p>Trung tâm kiểm tra tài chính và báo cáo trả về · dữ liệu quản trị độc lập.</p><section><div class="report-heading"><h2>Tài chính thực tế</h2><a href="/#reports">↻ Cập nhật</a></div><div class="grid">'+tile('Doanh thu vé Music lũy kế',finance?.data?money(finance.data.rows.reduce((sum,r)=>sum+r.total.revenueVnd,0)):'Chưa có số liệu','Đơn đã thanh toán trên Music')+tile('Chi phí thực tế','Chưa kết nối','Chưa nhận đối soát')+tile('Lợi nhuận thực tế','Chưa kết nối','Chưa đủ dữ liệu xác minh')+'</div><div class="scroll"><table><thead><tr><th>Nền tảng</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Nguồn báo cáo</th></tr></thead><tbody><tr><td>Music Show</td><td>'+esc(finance?.data?money(finance.data.rows.reduce((sum,r)=>sum+r.total.revenueVnd,0)):'—')+'</td><td>—</td><td>—</td><td><a href="/reports/music">Xem báo cáo ngày Music</a></td></tr><tr><td>24H</td><td>—</td><td>—</td><td>—</td><td><a href="/reports/24h">Xem báo cáo ngày 24H</a></td></tr><tr><td>EXTRA OS</td><td>—</td><td>—</td><td>—</td><td>Chỉ có kế hoạch nội bộ</td></tr></tbody></table></div><p class="tag">Không ghi nhận số 0 khi chưa có nguồn dữ liệu thật.</p></section><section><h2>Kế hoạch tài chính nội bộ</h2><p>Toàn bộ show đã lập trong EXTRA OS, không phải doanh thu đã thu.</p><div class="grid">'+tile('Show đã lập',f.shows,'Tất cả show nội bộ')+tile('Doanh thu mục tiêu',money(f.revenue),'Dự tính')+tile('Chi phí dự kiến',money(f.cost),'Dự tính')+tile('Lợi nhuận dự kiến',money(Number(f.revenue)-Number(f.cost)),'Mục tiêu trừ chi phí dự kiến')+'</div></section>'+analystHtml+'<section><h2>Báo cáo trả về</h2><div class="grid">'+tile('Chờ duyệt',k.submitted,'Nhiệm vụ đã báo cáo')+tile('Đã nghiệm thu',k.accepted,'Nhiệm vụ đã chấp nhận')+tile('AI hoàn tất',k.ai_done,'Chỉ tính trạng thái thành công')+tile('Vướng kết nối',k.blocked+k.ai_blocked,'Nhiệm vụ nội bộ và AI')+'</div><p>'+esc(total)+' báo cáo trả về / '+esc(k.tasks)+' nhiệm vụ nội bộ; AI bên ngoài chưa được kích hoạt.</p><div class="scroll"><table><thead><tr><th>Show / nguồn</th><th>Nội dung</th><th>Trạng thái</th><th>Báo cáo / ghi chú</th></tr></thead><tbody>'+ (returned.rows.length?returned.rows.map(t=>'<tr><td><strong>'+esc(t.artist)+'</strong><br><small>'+esc(t.show_date)+' · '+esc(t.source)+'</small></td><td>'+esc(t.source==='AI'?(jobDefinitions[t.title]?.title||t.title):t.title)+'<br><small>'+esc(departmentLabels[t.department]||t.department)+'</small></td><td>'+esc(statusLabels[t.status]||t.status)+'</td><td class="report-note">'+esc(t.note||'Chưa có ghi chú')+'</td></tr>').join(''):'<tr><td colspan="4">Chưa có báo cáo trên trang này.</td></tr>')+'</tbody></table></div>'+pagination+'<p><a href="#shows">Mở Công việc để xem và nghiệm thu báo cáo nội bộ ›</a></p></section></div>';
}
async function createRetailPlan(res,f){
 const request=f.get('request_id')||'';
 const campaign=(f.get('campaign')||'').trim(),products=(f.get('products')||'').trim(),goal=(f.get('goal')||'').trim(),notes=(f.get('notes')||'').trim(),date=f.get('date')||'',rawBudget=f.get('budget')||'0';
 const budget=Number(rawBudget);
 if(!/^[0-9a-f-]{36}$/.test(request)||!campaign||campaign.length>150||!products||products.length>1000||!goal||goal.length>1000||notes.length>2000||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!/^\d+$/.test(rawBudget)||!Number.isSafeInteger(budget)||budget<0) return html(res,'<main>Dữ liệu kế hoạch 24H không hợp lệ. <a href="/#oneclick24">Quay lại</a></main>',400);
 const data={platform:'24h',targetPageLabel:'24h EXTRA',targetPageId:'1413936608477545',adAccountId:'1915621506464312',adAccountLabel:'Lào Cai',campaignNamespace:'EXTRA24H',campaignWriteScope:'new_explicitly_registered_24h_campaigns_only',campaign,products,goal,notes,date,budget,mode:'draft'};
 const client=await pool.connect();
 try{await client.query('begin');const id=crypto.randomUUID();const v=await client.query('insert into os_retail_plans(id,request_id,intake) values($1,$2,$3) on conflict(request_id) do nothing returning id',[id,request,JSON.stringify(data)]);if(v.rowCount)await audit(client,'24h.plan.created',{plan_id:id,platform:'24h'});await client.query('commit')}catch(e){await client.query('rollback');throw e}finally{client.release()}
 redirect(res,'/#oneclick24');
}
async function retailPanel(s,newBrief){
 const {rows}=await pool.query('select id,intake,created_at from os_retail_plans order by created_at desc limit 50');
 return '<section class="os-panel" id="oneclick24"><h2>ONE CLICK 24H</h2>'+newBrief+'<details><summary>Kế hoạch 24H trước đây</summary><p>Lập kế hoạch kinh doanh cửa hàng tiện lợi. Page mục tiêu: 24h EXTRA (ID 1413936608477545). Page và tài khoản quảng cáo Lào Cai (ID 1915621506464312) đã xác nhận trên Windsor. Tài khoản dùng chung với Music; chỉ phân bổ chiến dịch 24H mới có ID riêng, không sửa chiến dịch Music. Chưa tích hợp bộ thực thi trực tiếp hoặc API Sapo. Không tự đăng hoặc phát sinh chi phí.</p><form action="/retail-plan" method="post">'+csrfField(s)+'<input type="hidden" name="request_id" value="'+crypto.randomUUID()+'"><div class="grid">'+formField('campaign','Tên chương trình')+formField('date','Ngày triển khai dự kiến','date')+formField('budget','Ngân sách dự kiến (đ)','number',0)+'</div><label>Sản phẩm / nhóm hàng<textarea name="products" maxlength="1000" required></textarea></label><label>Mục tiêu kinh doanh<textarea name="goal" maxlength="1000" required></textarea></label><label>Ghi chú / yêu cầu<textarea name="notes" maxlength="2000"></textarea></label><button>Lưu kế hoạch 24H</button></form><h2 style="margin-top:20px">Kế hoạch đã lưu</h2><p>Chờ AI Director và kết nối riêng của 24H; không phải nhiệm vụ AI đã thực thi.</p><div class="scroll"><table><thead><tr><th>Chương trình</th><th>Ngày dự kiến</th><th>Ngân sách dự kiến</th><th>Trạng thái</th></tr></thead><tbody>'+(rows.length?rows.map(x=>'<tr><td><details><summary>'+esc(x.intake.campaign)+'</summary><p>'+esc(x.intake.products)+'</p><p>'+esc(x.intake.goal)+'</p><p>'+esc(x.intake.notes)+'</p></details></td><td>'+esc(x.intake.date)+'</td><td>'+money(x.intake.budget)+'</td><td>Bản nháp · Chờ kết nối</td></tr>').join(''):'<tr><td colspan="4">Chưa có kế hoạch 24H.</td></tr>')+'</tbody></table></div></details></section>';
}
async function directorSaleCheck(){
 const id=crypto.randomUUID(),token=process.env.EXTRA_OS_SALE_LINK_TOKEN||'',url=process.env.EXTRA_OS_SALE_LINK_URL||'';
 let status='blocked',reason='Chưa cấu hình kết nối riêng',report=null;
 if(token.length>=48&&url==='http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director'){
  try{const response=await fetch(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id,kind:'connection_check',mode:'dry_run'}),signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.json();
   if(data.id!==id||data.agent!=='Sale'||data.version!=='2.3'||data.kind!=='connection_check'||data.status!=='succeeded'||data.mode!=='dry_run'||data.report?.liveSales!==false||data.report?.ordersCreated!==0)throw Error('Invalid agent response');
   status='succeeded';reason='Director gửi lệnh thử và Sale V 2.3 trả kết quả đúng mã nhiệm vụ';report={liveSales:false,ordersCreated:0,returnedAt:data.returnedAt};
  }catch(e){reason='Chưa nhận được phản hồi hợp lệ ('+(e.message.match(/^HTTP \d{3}$/)?e.message:'kiểm tra mạng hoặc xác thực')+')';}
 }
 await audit(pool,'director.sale.connection_check',{id,status,reason,report,scope:'dry_run'});
 console.log('Director Sale connection check: '+status);
 return status;
}
async function startupSaleCheck(){for(let n=0;n<4;n++){if(await directorSaleCheck()==='succeeded')return;if(n<3)await new Promise(r=>setTimeout(r,15000));}}
async function dashboard(res,s,reportPage=1,directorRun=null,selectedShow=null){const [snapshot,finance,directorState]=await Promise.all([getMusicSnapshot(),getMusicFinance(),listRuns(pool,directorRun)]);const reportHtml=await reportsPanel(reportPage,finance);const overview=musicOverview(snapshot,finance,reportDay(null),selectedShow,esc);const [{rows:shows},{rows:jobs},{rows:tasks},{rows:logs}]=await Promise.all([pool.query('select * from os_shows order by created_at desc limit 50'),pool.query('select * from os_jobs order by show_id,kind limit 1000'),pool.query('select * from os_tasks order by show_id,key limit 1000'),pool.query('select event,created_at from os_audit order by id desc limit 20')]);const saleCheck=(await pool.query("select details,created_at from os_audit where event='director.sale.connection_check' order by id desc limit 1")).rows[0];const saleLinkHtml=(saleCheck?'<p><small>'+esc(saleCheck.details.reason)+' · '+esc(new Date(saleCheck.created_at).toISOString())+'</small></p>':'<p><small>Chưa có kết quả kiểm tra hai chiều.</small></p>')+'<form action="/sale-check" method="post">'+csrfField(s)+'<button>Director: Kiểm tra kết nối AI Sale</button></form>';const campaign=directorState.selected;const financeHtml=campaign&&campaign.input.mode!=='sample'?renderFinance(campaign,await listFinance(pool,campaign.id),{esc,money,csrfField,s,requestId:crypto.randomUUID()}):'';const director=renderDirector(directorState,{esc,money,csrfField,s,agents,saleLinkHtml,requestId:crypto.randomUUID(),sampleRequestId:crypto.randomUUID(),financeHtml});const retailHtml=await retailPanel(s,director.retail);const field=(k,l,v=0)=>formField(k,l,'number',v);let body='<header><div class="brand"><b>+1</b> EXTRA <span class="os-accent">OS</span> · ADMIN</div><form action="/logout" method="post">'+csrfField(s)+'<button>Đăng xuất</button></form></header><div class="os-layout">'+renderSidebar('home',{actor:s})+'<main class="os-content"><p class="tag os-status">STAGING · Dữ liệu riêng · Không chạy quảng cáo hoặc thanh toán thật</p><div class="os-panel" id="overview"><h1>Trung tâm điều hành</h1>'+overview+'<div class="grid"><div class="tile">Show nội bộ<strong>'+shows.length+'</strong><small>Tối đa 50 show gần nhất</small></div><div class="tile">Nhiệm vụ đã lập<strong>'+tasks.length+'</strong><small>Tối đa 1.000 mục</small></div><div class="tile">Doanh thu vé Music hôm nay<strong>'+esc(finance.data?money(finance.data.rows.reduce((sum,r)=>sum+(r.days[reportDay(null)]?.revenueVnd??0),0)):'Chưa có dữ liệu')+'</strong><small>Tổng các show · đơn đã thanh toán</small></div></div><p><a href="#reports">Mở tổng quan báo cáo ›</a></p></div>'+reportHtml+'<section class="os-panel" id="platforms"><h2>Nền tảng</h2><div class="grid"><div class="tile">Music<strong>Lịch show · chỉ đọc</strong><small>Báo cáo và lịch show chỉ đọc; không mở bán.</small><p><a href="/reports/music">Báo cáo Music theo ngày ›</a> · <a href="/music">Lịch show và số ghế</a></p></div><div class="tile">24H<strong>24h EXTRA</strong><small>Page ID: 1413936608477545 · Đã xác nhận Page trên Windsor · Tài khoản quảng cáo Lào Cai: 1915621506464312 (dùng chung với Music, phân tách chiến dịch) · Chờ tích hợp thực thi và API Sapo.</small><p><a href="/reports/24h">Báo cáo 24H theo ngày ›</a></p><p><a href="https://www.facebook.com/profile.php?id=1413936608477545" target="_blank" rel="noopener noreferrer">Mở Page 24H</a></p></div><div class="tile">EXTRA OS<strong>Staging</strong><small>PostgreSQL riêng.</small></div></div></section><section class="os-panel" id="oneclick"><h2>ONE CLICK MUSIC · Lập kế hoạch show nội bộ</h2><p><a href="/v11/analysis/music">Phân tích show và điểm hòa vốn ›</a></p><p>Kế thừa logic EXTRA OS hiện có. Giá và doanh thu là dự tính; chưa kiểm chứng sơ đồ ghế. Không mở bán.</p><form action="/show" method="post">'+csrfField(s)+'<input type="hidden" name="request_id" value="'+crypto.randomUUID()+'"><div class="grid">'+formField('artist','Nghệ sĩ')+formField('startsAt','Ngày giờ diễn (Việt Nam)','datetime-local')+formField('venue','Địa điểm')+field('capacity','Sức chứa',550)+field('bookingVnd','Cát-xê')+field('productionVnd','Chi phí tổ chức')+field('adsVnd','Ngân sách quảng cáo dự kiến')+field('printingVnd','In ấn')+field('otherVnd','Chi phí khác')+field('startingPriceVnd','Giá vé khởi điểm',199000)+field('targetProfitVnd','Lợi nhuận mục tiêu')+'</div>'+formField('mediaDriveUrl','Link Drive tư liệu','url')+'<label>Danh sách bài hát<textarea name="setlist" required></textarea></label><label><span><input type="checkbox" name="artistConfirmed" required> Đã xác nhận nghệ sĩ</span></label><label><span><input type="checkbox" name="mediaRightsConfirmed" required> Đã xác nhận quyền tư liệu</span></label><button>Tạo kế hoạch và giao việc nội bộ</button></form></section>'+retailHtml+'<section class="os-panel" id="shows"><h2>Show và công việc</h2><p><a href="/staff/access">Quản lý truy cập nhân sự</a> · <a href="/staff">Cổng nhân sự staging</a></p>';
for(const sh of shows){body+='<details open><summary>'+esc(sh.intake.artist)+' · '+esc(sh.intake.startsAt)+'</summary><p>Chi phí dự kiến: '+money(sh.finance.plannedCostVnd)+' · Doanh thu mục tiêu: '+money(sh.finance.targetRevenueVnd)+' · Số vé hòa vốn theo giá khởi điểm: '+esc(sh.finance.breakEvenTicketsAtStartingPrice)+'</p><div class="scroll"><table><tr><th>Nhiệm vụ</th><th>Trạng thái / Báo cáo</th></tr>';for(const t of tasks.filter(t=>t.show_id===sh.id)){body+='<tr><td>'+esc(t.definition.title)+'<br><small>'+esc(departmentLabels[t.definition.department])+' · '+esc(t.definition.acceptance)+'</small></td><td><form action="/task" method="post">'+csrfField(s)+'<input type="hidden" name="id" value="'+sh.id+'"><input type="hidden" name="key" value="'+esc(t.key)+'"><select name="status">'+['pending','in_progress','submitted','accepted','blocked'].map(v=>'<option value="'+v+'" '+(v===t.status?'selected':'')+'>'+statusLabels[v]+'</option>').join('')+'</select><label>Ghi chú<input name="note" maxlength="2000" value="'+esc(t.note)+'"></label><input type="hidden" name="revision" value="'+t.revision+'">'+assigneeField(t.assignee,esc)+'<button>Lưu</button></form></td></tr>'}body+='</table></div><p>Hàng đợi AI: '+jobs.filter(j=>j.show_id===sh.id).length+' mục. Chỉ phân tích kế hoạch nội bộ đã có bộ thực thi.</p><form action="/analyst-plan" method="post">'+csrfField(s)+'<input type="hidden" name="id" value="'+esc(sh.id)+'"><button>Director: Giao AI Analyst phân tích kế hoạch</button></form><div class="scroll"><table><tr><th>Agent</th><th>Nhiệm vụ</th><th>Trạng thái</th></tr>'+jobs.filter(j=>j.show_id===sh.id).map(j=>'<tr><td>'+esc(j.agent)+'</td><td>'+esc(jobDefinitions[j.kind]?.title||j.kind)+'</td><td>'+esc(statusLabels[j.status])+'<br><small>'+esc(j.note)+'</small></td></tr>').join('')+'</table></div></details>'}
body+='</section>'+director.panel+'<section class="os-panel" id="audit"><h2>Nhật ký quản trị</h2>'+logs.map(l=>'<p>'+esc(l.event)+' · '+esc(new Date(l.created_at).toISOString())+'</p>').join('')+'</section></main></div>';html(res,body)}
function reportWorkspace(s,path,content,filters){
 const body=content.replace(/^<main>/,'').replace(/<\/main>$/,'');
 return '<header><div class="brand"><b>+1</b> EXTRA <span class="os-accent">OS</span> · ADMIN</div><form action="/logout" method="post">'+csrfField(s)+'<button>Đăng xuất</button></form></header><div class="os-layout os-report-page">'+renderSidebar(path,{actor:s.role?s:undefined})+'<main class="os-content">'+renderPlatformTabs(path,filters)+body+'</main></div>';
}
async function musicShowPage(req,res,session,path){
 const params=new URL(req.url,'http://localhost').searchParams;
 const day=reportDay(params.get('day')),period=proposalPeriodValue(params.get('period'));
 const [snapshot,finance,signals]=await Promise.all([getMusicSnapshot(),getMusicFinance(),getMusicSignals()]);
 const catalog=showCatalog(snapshot,finance,reportDay(null));
 const wanted=params.get('show');
 const archived=catalog.ended.find(s=>s.id===wanted);
 if(archived&&path==='/proposals/music')return redirect(res,'/reports/music?'+new URLSearchParams({day,period,show:wanted,view:'revenue'}));
 const show=archived??(wanted?catalog.active.find(s=>s.id===wanted):catalog.active[0]);
 const run=show&&!archived?await readLiveRun(pool,proposalPlatform('music',period),day):null;
 const context={signals,checkedAt:snapshot.checkedAt};
 const report=show?buildReport(show,day,finance,run,Boolean(archived),context):null;
 const tracks=report?await saveTracks(pool,reading(report,'full')):null;
 let approval='';
 if(show&&!archived){
  const state=proposalState(run,show,new Date(),{...context,finance});
  const approvedAt=await readShowApproval(pool,run,show,state);
  approval=approvalPanel({run,show,period,day,csrf:session.csrf,state,approvedAt,esc});
 }
 const content=renderShowPage({path,day,period,catalog,show,approvalPanel:approval,ended:Boolean(archived),report,snapshot,run,esc,player:tracks?playerHtml(tracks):''});
 return html(res,reportWorkspace(session,path,content,{day,period,show:show?.id}),wanted&&!show?404:200,Boolean(tracks));
}
async function workspacePage(req,res,session,path){
 if(path.endsWith('/music'))return musicShowPage(req,res,session,path);
 const params=new URL(req.url,'http://localhost').searchParams;
 const day=reportDay(params.get('day')),period=proposalPeriodValue(params.get('period'));
 if(path==='/reports/24h'){
  const content=renderRetailDaily(await readRetailDaily(pool,day),day,esc);
  return html(res,reportWorkspace(session,path,content,{day,period}));
 }
 const platform=proposalPlatform('24h',period);
 const [run,approvals]=await Promise.all([readLiveRun(pool,platform,day),readApprovals(pool,platform,day)]);
 const periods=[['day','Kế hoạch ngày'],['week','Kế hoạch tuần'],['month','Kế hoạch tháng']];
 const nav=periods.map(([value,label])=>'<a class="period-link" '+(value===period?'aria-current="page" ':'')+'href="'+path+'?period='+value+'&amp;day='+esc(day)+'">'+label+'</a>').join(' ');
 const legacy=approvals.length?'<details><summary>Lịch sử '+approvals.length+' phương án quy tắc đã duyệt (không phải AI)</summary><p>Giữ lại hồ sơ cũ để đối chiếu. Không tự chạy lại.</p></details>':'';
 const content='<main><section><h1>Đề xuất 24H</h1><nav>'+nav+'</nav><form method="get"><input type="hidden" name="period" value="'+esc(period)+'"><label>Ngày báo cáo<input type="date" name="day" value="'+esc(day)+'" required></label><button>Xem</button></form><a href="/reports/24h?day='+esc(day)+'">Xem báo cáo nguồn</a></section>'+renderLiveDirector(run,esc)+legacy+'</main>';
 return html(res,reportWorkspace(session,path,content,{day,period}));
}
// Verify the actual report renderer and its DB-backed audio track on each staging release.
async function verifyMusicReportPage(allTabs=false){
 const snapshot=await getMusicSnapshot();
 const show=showCatalog(snapshot,{},reportDay(null)).active[0];
 if(!show)return console.log('Music admin release check',JSON.stringify({showFound:false}));
 const render=async path=>{
  let status,markup;
  const res={writeHead(code){status=code;},end(body){markup=String(body);}};
  await workspacePage({url:path+'?'+new URLSearchParams({show:show.id})},res,{csrf:''},path);
  return {status,markup};
 };
 const proposal=await render('/proposals/music');
 if(allTabs){
  for(const path of workspacePages){
   const page=path==='/proposals/music'?proposal:await render(path);
   const [group,platform]=path.slice(1).split('/');
   const section=group==='reports'?'Báo cáo':'Phê duyệt đề xuất';
   const heading=(group==='reports'?'Báo cáo':'Đề xuất')+(platform==='music'?' Music theo show':' 24H');
   const target=path.endsWith('/24h')?'24H':'Music';
   const tabs=page.markup.match(/<nav class="platform-tabs"[^>]*>(.*?)<\/nav>/)?.[0]??'';
   const sidebar=page.markup.match(/<aside class="os-sidebar">(.*?)<\/aside>/)?.[1]??'';
   const valid=tabs.includes('aria-label="'+section+'"')&&tabs.includes('aria-current="page">'+target+'</a>')&&
    tabs.indexOf('>24H</a>')>=0&&tabs.indexOf('>Music</a>')>tabs.indexOf('>24H</a>')&&
    sidebar.includes('href="/'+group+'/24h" aria-current="location"')&&page.markup.includes('<h1>'+heading+'</h1>');
   console.log('Workspace navigation check',JSON.stringify({path,status:page.status,valid}));
  }
 }
 const {status,markup}=proposal;
 const tracks=markup.match(/data-mode="full"[^>]+data-track="([a-f0-9,]+)"/)?.[1]?.split(',')??[];
 const checks={show:show.id,status,fullPlayer:tracks.length>0,fullTrackParts:tracks.length,summaryButtons:(markup.match(/data-mode="brief"/g)??[]).length,
  selector:markup.includes('name="show"'),approval:/<button[^>]*>Phê duyệt đề xuất<\/button>|Đã phê duyệt đề xuất/.test(markup),
  dailyEconomics:markup.includes('Hiệu quả quảng cáo trong ngày'),showEconomics:markup.includes('Kinh tế lũy kế của show'),
  review:markup.includes('Sale 2.3'),mediaLinks:markup.includes('Tải về')};
 const reportStart=markup.indexOf('<section id="live-director">');
 const listening=markup.indexOf('data-report-player',reportStart),approval=markup.indexOf('Phê duyệt đề xuất',listening);
 checks.listenBeforeApproval=listening>=0&&approval>listening&&approval<markup.indexOf('Kinh tế lũy kế của show');
 checks.approvalEnabled=markup.includes('action="/proposals/music/approve"');
 const run=await readLiveRun(pool,'music',reportDay(null));
 checks.runStatus=run?.status??null;
 checks.agentReports=Object.keys(run?.results??{}).filter(role=>roleNames.includes(role)&&run.results[role].responseId).length;
 const campaign=run?.results?.DirectorFinal?.output?.campaigns?.find(item=>item.showId===show.id);
 if(run?.status==='ready'&&campaign)checks.director={adAction:campaign.economicReview?.adAction,budgetVnd:campaign.proposedBudgetVnd,deadline:campaign.deadline};

 console.log('Music admin release check',JSON.stringify(checks));
}
async function handle(req,res){const path=new URL(req.url,'http://localhost').pathname;if(['/staff','/staff/login','/staff/task','/staff/crm','/staff/logout'].includes(path))return handleStaff(req,res,path);if(path==='/api/24h/messenger/webhook')return handleMessenger24(req,res);if(path==='/health'&&req.method==='GET'){await pool.query('select 1');res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('ok')}if(path==='/login'&&req.method==='POST')return login(req,res);if(path==='/v11/activate')return v11.activate(req,res);const s=await session(req);if(!s)return html(res,loginPage(),path==='/'?200:401);
 if(path==='/v11'||path.startsWith('/v11/'))return v11.handle(req,res,s);
 if(path==='/logout'&&req.method==='POST'){
  const fields=await form(req);
  if(!eq(fields.get('csrf')||'',s.csrf))return html(res,'<main>Yêu cầu không hợp lệ.</main>',403);
  await pool.query('delete from os_v11_sessions where token_hash=$1',[s.token_hash]);
  await recordAudit(pool,s,'access.logout');
  return redirect(res,'/',cookie('',0));
 }
 if(s.role!=='OWNER'){
  if(req.method==='GET'&&path==='/')return redirect(res,'/v11');
  return html(res,'<main>Tài khoản chưa được cấp quyền cho trang này. <a href="/v11">Về EXTRA OS</a></main>',403);
 }
 if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/show-media/'))return serveShowMedia(req,res);if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/report-audio/')){
  const match=/^\/report-audio\/([a-f0-9]{64})\.mp3$/.exec(path);
  return serveAudio(req,res,pool,match?.[1]??'',process.env.EXTRA_OS_V11_AUDIO_APPROVED==='true'?process.env.EXTRA_OS_OPENAI_API_KEY:'',modelRequest);
 }
 if(req.method==='GET'&&workspacePages.includes(path))return workspacePage(req,res,s,path);
 if(req.method==='GET'&&path==='/music')return html(res,renderMusicSnapshot(await getMusicSnapshot(),esc));
 if(req.method==='GET'&&path==='/crm')return readCrm(req,res,s);if(req.method==='GET'&&path==='/staff/access')return html(res,staffAccessPage(staffPageTools,s));if(req.method==='GET'&&path==='/director/asset')return readDirectorAsset(req,res);if(req.method==='GET'&&path==='/director/report')return readDirectorReport(req,res);if(req.method==='GET'&&path==='/'){const rawPage=Number(new URL(req.url,'http://localhost').searchParams.get('reportPage')||1);const run=new URL(req.url,'http://localhost').searchParams.get('directorRun');return dashboard(res,s,Number.isSafeInteger(rawPage)&&rawPage>0&&rawPage<=1000000?rawPage:1,uuid.test(run||'')?run:null,new URL(req.url,'http://localhost').searchParams.get('show'));}if(req.method!=='POST')return html(res,'<main>Không tìm thấy.</main>',404);const f=await form(req);if(!eq(f.get('csrf')||'',s.csrf))return html(res,'<main>Yêu cầu không hợp lệ.</main>',403);if(path==='/proposals/music/approve'){
  const [snapshot,finance,signals]=await Promise.all([getMusicSnapshot(),getMusicFinance(),getMusicSignals()]);
  const show=snapshot.rows.find(s=>s.id===f.get('show'));
  if(!await approveShow(pool,f,show,{finance,signals,checkedAt:snapshot.checkedAt}))return html(res,'<main><p>Đề xuất đã thay đổi hoặc chưa đủ điều kiện phê duyệt.</p><a href="/proposals/music">Xem lại đề xuất</a></main>',409);
  return redirect(res,'/proposals/music?'+new URLSearchParams({show:show.id,day:f.get('day'),period:f.get('period')}));
 }if(path==='/daily-director/approve')return html(res,'<main><h1>Phương án cũ đã ngừng duyệt</h1><p>Chỉ trình phương án mới từ kết quả điều phối AI. Không thực thi phương án mẫu.</p><a href="/proposals/music">Xem đề xuất Music</a></main>',409);if(path==='/show')return createShow(req,res,s,f);if(path.startsWith('/director/'))return handleDirector(res,path,f);if(path==='/retail-plan')return createRetailPlan(res,f);if(path==='/analyst-plan')return rerunAnalystPlan(res,f);if(path==='/sale-check'){await directorSaleCheck();return redirect(res,'/#agents')}if(path==='/crm')return updateCrm(res,f);if(path==='/staff/access'){
 const staffId=f.get('staff_id');
 const code=await issueCode(pool,staffId);
 if(!code)return html(res,'<main>Nhân sự không hợp lệ.</main>',400);
 return html(res,staffAccessPage(staffPageTools,s,{staffId,code}));
}if(path==='/task'){
 const revision=f.get('revision');
 const changed=await updateShowTask(pool,{
  id:f.get('id'),key:f.get('key'),status:f.get('status'),note:f.get('note')||'',assignee:f.get('assignee'),
  revision:revision===null?null:(/^\d+$/.test(revision)?Number(revision):NaN)
 });
 if(!changed)return html(res,'<main>Việc đã được cập nhật hoặc dữ liệu không hợp lệ. <a href="/#shows">Tải lại công việc</a></main>',409);
 return redirect(res,'/#shows');
}html(res,'<main>Không tìm thấy.</main>',404)}
async function readCrm(req,res,s){
 const params=new URL(req.url,'http://localhost').searchParams;
 const requested=params.get('view');
 const view=['resolved','opt_out'].includes(requested)?requested:'active',page=pageNumber(params.get('page'));
 const data=await listFollowups(pool,{view,page});
 return html(res,'<main><a href="/#agents">‹ AI Director</a>'+renderFollowups(data,{esc,csrfField,s,view,page})+'</main>');
}
async function updateCrm(res,fields,staffId=null){
 const change=readFollowup(fields);
 const back=staffId===null?'/crm':'/staff#crm-followups';
 if(!change)return html(res,'<main>Dữ liệu xử lý hội thoại không hợp lệ. <a href="'+back+'">Quay lại CRM</a></main>',400);
 if(!await saveFollowup(pool,change,staffId))return html(res,'<main>Hội thoại đã thay đổi hoặc không nằm trong công việc hiện có. <a href="'+back+'">Mở danh sách</a></main>',409);
 return redirect(res,back);
}
async function readDirectorAsset(req,res){
 const params=new URL(req.url,'http://localhost').searchParams;
 const id=params.get('id')||'',revision=Number(params.get('revision'));
 if(uuid.test(id)&&Number.isInteger(revision)&&revision>=0&&revision<=2147483647){
  const {rows:[asset]}=await pool.query('select image from os_director_assets where job_id=$1 and revision=$2',[id,revision]);
  if(asset?.image){
   res.writeHead(200,{'Content-Type':'image/png','Content-Length':asset.image.length,'Cache-Control':'private, no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});
   return res.end(asset.image);
  }
 }
 return html(res,'<main>Không tìm thấy ảnh diễn tập.</main>',404);
}
async function readDirectorReport(req,res){
 const id=new URL(req.url,'http://localhost').searchParams.get('run');
 if(!uuid.test(id||''))return html(res,'<main>Mã lượt chạy không hợp lệ.</main>',400);
 const {rows:[record]}=await pool.query(`
   select j.result as report,j.updated_at as reviewed_at,r.id as run_id,r.platform,r.created_at
   from os_director_runs r join os_director_jobs j on j.run_id=r.id
   where r.id=$1 and j.kind='report' and j.status='accepted'
 `,[id]);
 if(!record)return html(res,'<main>Báo cáo chưa được nghiệm thu. <a href="/#oneclick24">Mở ONE CLICK 24H</a></main>',404);
 const [manualFinance]=record.report.mode==='sample'?[]:await listFinance(pool,id);
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Content-Disposition':'attachment; filename="extra-24h-'+id+'.json"','X-Content-Type-Options':'nosniff'});
 return res.end(JSON.stringify(manualFinance?{...record,manualFinance}:record,null,2)+'\n');
}
async function handleDirector(res,path,f){
 const invalid=(status=400)=>html(res,'<main>Không thể thực hiện yêu cầu này. <a href="/#oneclick24">Mở ONE CLICK 24H</a></main>',status);
 if(path==='/director/finance'){
  const entry=parseFinance(f);
  if(!entry)return invalid();
  const result=await saveFinance(pool,entry);
  if(result.status==='unavailable')return invalid(404);
  const back='/?directorRun='+entry.runId+'#oneclick24';
  if(result.status==='conflict')return html(res,'<main>Bản đối soát đã được cập nhật. <a href="'+back+'">Mở bản mới nhất</a></main>',409);
  return redirect(res,back);
 }
 if(path==='/director/sample'){
  const requestId=f.get('request_id')||'';
  if(!uuid.test(requestId))return invalid();
  const id=await queueDirector(pool,requestId,sampleBrief,definitions(sampleBrief));
  return redirect(res,'/?directorRun='+id+'#oneclick24');
 }
 if(path==='/director/run'){
  const parsed=readRetailBrief(f);
  if(!parsed)return invalid();
  const id=await queueDirector(pool,parsed.requestId,parsed.input,definitions(parsed.input));
  return redirect(res,'/?directorRun='+id+'#oneclick24');
 }
 if(path==='/director/revise'){
  const id=f.get('job_id')||'',feedback=(f.get('feedback')||'').trim();
  if(!uuid.test(id)||!feedback||feedback.length>1000)return invalid();
  const changed=await revise(pool,id,feedback);
  if(!changed)return invalid(409);
  const {rows:[job]}=await pool.query('select run_id from os_director_jobs where id=$1',[id]);
  return redirect(res,'/?directorRun='+job.run_id+'#oneclick24');
 }
 if(path==='/director/knowledge'){
  const id=f.get('run_id')||'',version=Number(f.get('version'));
  if(!uuid.test(id)||!Number.isInteger(version)||version<1||version>2147483647)return invalid();
  if(!await restoreKnowledge(pool,id,version))return invalid(409);
  return redirect(res,'/?directorRun='+id+'#oneclick24');
 }
 return invalid(404);
}
// Log only allowlisted task names and reason codes from an isolated sample.
async function observeSampleRun(id,once=false){
 let previous='';
 for(let n=0;n<40;n++){
  const snapshot=await listRuns(pool,id);
  if(snapshot.selected?.input?.mode!=='sample')return;
  const counts={queued:0,running:0,reported:0,accepted:0,blocked:0,failed:0};
  for(const job of snapshot.jobs)if(Object.hasOwn(counts,job.status))counts[job.status]++;
  const report=snapshot.jobs.find(job=>job.kind==='report'&&job.status==='accepted')?.result;
   const knownKinds=new Set(definitions(sampleBrief).map(job=>job.kind));
  const reasonCode=issue=>Object.hasOwn(permissionLabels,issue)?issue:
   issue==='Đầu việc phụ thuộc đang chờ hoặc đã thất bại'?'dependency':
   issue==='Hết hạn thực thi'?'deadline':
   issue==='Bộ thực thi tạm thời không phản hồi'?'executor_unavailable':'review_or_other';
  const blockedTasks=snapshot.jobs.filter(job=>knownKinds.has(job.kind)&&['blocked','failed'].includes(job.status))
   .map(job=>({kind:job.kind,status:job.status,reasons:[...new Set(job.issues.map(reasonCode))],
    dependencies:job.needs.filter(kind=>knownKinds.has(kind)&&snapshot.jobs.some(other=>other.kind===kind&&other.status!=='accepted'))}));
  const state={...counts,total:snapshot.jobs.length,receipt:Boolean(report?.sample?.receipt),blockedTasks};
  const line=JSON.stringify(state);
  if(line!==previous){console.log('24H sample progress',id,line);previous=line;}
  if(once||(snapshot.jobs.length>0&&counts.queued+counts.running+counts.reported===0))return;
  await new Promise(resolve=>setTimeout(resolve,15000).unref());
 }
}
migrateV11(pool).then(()=>init()).then(()=>setupOwner(pool,password)).then(()=>seedCategories(pool)).then(()=>initDirectorQueue(pool)).then(()=>initMedia(pool)).then(()=>initCrm(pool)).then(()=>initStaffWork(pool)).then(()=>initCrmFollowup(pool)).then(()=>initDirectorFinance(pool)).then(()=>initDailyDirector(pool)).then(()=>initLiveDirector(pool)).then(()=>initShowApprovals(pool)).then(()=>initAudio(pool)).then(()=>{
 const stopApproved=startApprovedWorker(pool,{onResult:result=>console.log('Approved daily Director task',JSON.stringify(result)),onError:error=>console.error('Approved daily task error',error.code||error.name)});
 const stopAds=monitorAds(pool);
 const stopGoals=startGoals(pool);
 const legacyDirectorEnv=process.env.EXTRA_OS_V11_LEGACY_AUTO_AI==='true'?process.env:{...process.env,EXTRA_OS_DIRECTOR_MODEL_ENABLED:'false'};
 const stopDaily=startLiveDirector(pool,{env:legacyDirectorEnv,onResult:result=>{
  console.log('Live Director cycle',JSON.stringify(result));
  if(result.platform==='music'&&result.stage==='DirectorFinal'&&result.status==='ready'&&process.env.RAILWAY_ENVIRONMENT_NAME===staging){
   verifyMusicReportPage().catch(error=>console.error('Music admin release check failed',error.code||error.name));
  }
 },onError:error=>console.error('Live Director cycle unavailable',error.code||error.name)});
 const stopWorker=startDirectorWorker(pool,makeExecutor(pool,makeConnectors(pool,process.env.EXTRA_OS_V11_LEGACY_AUTO_AI==='true' ?
   process.env : {...process.env,EXTRA_OS_OPENAI_API_KEY:undefined},modelRequest)),review,{
  onError:(kind,error)=>console.error('Director task error',kind,error.code||error.name),
  onReport:({runId,mode,report})=>{
   if(mode!=='sample')return;
   const accepted=report.work.filter(job=>job.status==='accepted').length+1;
   const agents=Object.values(report.agentPerformance).filter(agent=>agent.accepted===agent.assigned).length;
   console.log('24H sample report',runId,'tasks',accepted+'/'+(report.work.length+1),'agents',agents+'/11','receipt',Boolean(report.sample.receipt));
  }
 });
 const server=http.createServer((req,res)=>handle(req,res).catch(e=>{console.error('Request failed',e.code||e.name);if(!res.headersSent)html(res,'<main>Không xử lý được yêu cầu. <a href="/">Quay lại</a></main>',400);else res.end()}));server.requestTimeout=20000;server.headersTimeout=10000;server.listen(port,'0.0.0.0',()=>{console.log('EXTRA OS staging ready');
  if(process.env.EXTRA_OS_V11_RELEASE_CHECKS!=='true')return;
  startupSaleCheck().then(async()=>{
   verifyMusicReportPage(true).catch(error=>console.error('Music admin release check failed',error.code||error.name));
   getMusicFinance().then(status=>console.log('Music daily read-only verification',status.status)).catch(()=>console.error('Music daily verification unavailable'));
   readRetailDaily(pool,reportDay(null)).then(result=>console.log('24H daily report verification',JSON.stringify({ok:true,internalCampaigns:result.created,financeRecords:result.records.length,hasInboundData:result.crm!==null,sapoFnB:'not_connected'}))).catch(()=>console.error('24H daily report verification unavailable'));
   getMusicSnapshot().then(snapshot=>console.log('Music public snapshot',JSON.stringify({showsAvailable:snapshot.showsAvailable,inventoryAvailable:snapshot.inventoryAvailable,shows:snapshot.rows.length,rowsWithInventory:snapshot.rows.filter(row=>row.inventory!==null).length,rowsWithHeld:snapshot.rows.filter(row=>row.inventory?.held!==null&&row.inventory?.held!==undefined).length,rowsWithPrices:snapshot.rows.filter(row=>Object.values(row.prices??{}).some(v=>v!==null)).length}))).catch(()=>console.error('Music public snapshot unavailable'));
   const {rows:[previous]}=await pool.query('select id from os_director_runs where request_id=$1 and input->>\'mode\'=\'sample\'',[sampleReleaseRequestId]);
   if(previous)await observeSampleRun(previous.id,true);
   // One fresh, deduplicated release rehearsal after the Sale startup check. Keep earlier evidence.
   const retryRequestId='b8bd8842-8ea4-4b28-9b7d-31e372e58461';
   const id=await queueDirector(pool,retryRequestId,sampleBrief,definitions(sampleBrief));
   console.log('24H sample run available',id);
   return observeSampleRun(id);
  }).catch(error=>console.error('24H sample or Sale startup check could not complete',error.code||error.name));
 });process.on('SIGTERM',()=>server.close(()=>Promise.allSettled([stopWorker(),stopDaily(),stopApproved(),stopAds(),stopGoals()]).finally(()=>pool.end()).finally(()=>process.exit(0))))}).catch(e=>{console.error('Database initialization failed',e.code||e.name);process.exit(1)});

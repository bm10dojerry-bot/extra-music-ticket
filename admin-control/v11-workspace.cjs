'use strict';

const {readFile} = require('node:fs/promises');
const {dirname,join} = require('node:path');
const {V11Error, dayVN, validDay, requireValue, recordAudit} = require('./v11-core.cjs');
const access = require('./v11-auth.cjs');
const finance = require('./v11-costs.cjs');
const ads = require('./v11-ads.cjs');
const {cameraId, cameraScope, cameraService, configureCamera} = require('./v11-imou.cjs');
const evidence = require('./v11-evidence.cjs');
const operations = require('./v11-operations.cjs');
const products = require('./v11-products.cjs');
const director = require('./v11-director.cjs');
const ui = require('./v11-views.cjs');
const planning = require('./v11-planning-ui.cjs');
const {getMusicSnapshot} = require('./music-readonly.cjs');
const {getMusicFinance} = require('./daily-reports.cjs');
const {renderSidebar} = require('./workspace-sidebar.cjs');

const styles = `
.os-v11 .os-content>section{display:block;max-width:1160px;margin:0 0 12px}
.os-v11 .platform-tabs{margin-bottom:12px}
.os-v11 input,.os-v11 textarea,.os-v11 select{max-width:100%}
.os-v11 form{margin:.7rem 0}
.os-v11 td form{min-width:125px}
.os-v11 td details[open]{min-width:min(680px,76vw)}
.os-v11 pre{white-space:pre-wrap;overflow-wrap:anywhere;min-width:180px}
.os-v11 .v11-video{width:min(100%,850px);max-height:70vh;background:#222}
.os-v11 .v11-actions{display:flex;gap:.75rem;flex-wrap:wrap}
.os-v11 td a,.os-v11 td small{overflow-wrap:anywhere}
.os-v11 h1,.os-v11 h2{overflow-wrap:anywhere}
.os-v11 a:focus-visible,.os-v11 button:focus-visible,.os-v11 summary:focus-visible{outline:2px solid #a82335;outline-offset:3px}
@media(max-width:760px){.os-v11 .v11-actions{gap:.4rem}.os-v11 td details[open]{min-width:70vw}}
`;

function makeWorkspace(pool, {html,redirect,form,eq,csrfField}, {env = process.env, imouRequest = fetch} = {}) {
  const camera = cameraService(pool,{env,request:imouRequest});
  const page = (res, actor, path, content, status = 200, media = false) => html(res,
    '<header><div class="brand"><b>+1</b> EXTRA <span class="os-accent">OS</span> · V1.1</div>'+
    '<form method="post" action="/logout">'+csrfField(actor)+'<button>Đăng xuất</button></form></header>'+
    '<div class="os-layout os-report-page os-v11">'+renderSidebar(path,{actor})+
    '<main class="os-content">'+content+'</main></div>', status, false, media);
  const failure = (res, actor, path, error) => page(res,actor,path,ui.requestError(error.code,path),error.status);
  const dashboard = (res,actor) => page(res,actor,'/v11',ui.home(actor));

  async function activate(req,res) {
    if (req.method === 'GET') return html(res,'<main class="login">'+ui.activateView()+'</main>');
    if (req.method !== 'POST') return html(res,'<main>Không tìm thấy.</main>',404);
    if (req.headers['sec-fetch-site'] === 'cross-site') return html(res,'<main>Yêu cầu không hợp lệ.</main>',403);
    const fields = await form(req);
    try {
      await access.acceptInvite(pool,fields.get('code'),fields.get('password'));
      return redirect(res,'/');
    } catch (error) {
      if (!(error instanceof V11Error)) throw error;
      return html(res,'<main class="login">'+ui.requestError(error.code,'/v11/activate')+'</main>',error.status);
    }
  }

  async function listAccess(res,actor,invitation) {
    access.check(actor,'access.manage');
    const [users,grants] = await Promise.all([pool.query(`
      select id,username,display_name,role,active,password_hash is not null as active_password
      from os_v11_users order by username limit 500
    `),pool.query('select user_id,permission,scope from os_v11_grants order by permission')]);
    return page(res,actor,'/v11/access',ui.accessView(actor,users.rows,grants.rows,invitation));
  }

  function modulePermissions(actor,name,platform) {
    if (actor.role === 'OWNER') return;
    requireValue(actor.grants.some(grant => grant.permission === name && (!platform || !grant.scope.platform || grant.scope.platform === platform)),
      'FORBIDDEN',403);
  }

  async function costsPage(res,actor,path,platform,params) {
    modulePermissions(actor,'cost.read',platform);
    const scopeKey = params.get('scope') ?? (platform==='24h' ? dayVN() : '');
    let history;
    let ledger;
    if (scopeKey) {
      ledger = await finance.readLedger(pool,actor,platform,scopeKey);
      const id = params.get('history');
      if (id) {
        requireValue(ledger.costs.some(row=>row.id===id),'COST_MISSING',404);
        const {rows} = await pool.query(`
          select h.revision,h.snapshot,h.recorded_at,u.username from os_v11_cost_history h join os_v11_users u on u.id=h.actor_id
          where h.cost_id=$1 order by h.revision desc limit 80
        `,[id]);
        history = rows;
      }
    }
    const options = platform === 'music' ? (await getMusicSnapshot()).rows.filter(show =>
      access.allowed(actor,'cost.read',{platform:'music',show:show.id,dataGroup:'finance'})) : [];
    return page(res,actor,path,ui.costView(actor,platform,scopeKey,ledger,options,history));
  }

  async function adsPage(res,actor,path,platform,params) {
    modulePermissions(actor,'ads.read',platform);
    const view = await ads.adsView(pool,actor,platform);
    const id = params.get('target');
    const selected = id ? view.targets.find(row=>row.id===id) : view.targets[0];
    requireValue(!id || selected,'TARGET_MISSING',404);
    if (selected && access.allowed(actor,'ads.configure')) {
      const layers = ads.budgetLayers(selected,dayVN());
      const {rows} = await pool.query(`
        select l.layer,l.cap_vnd,f.spend_vnd as "fixtureSpend" from os_v11_ads_limits l
        left join os_v11_ads_observations f on f.layer=l.layer and f.key=l.key and f.source='fixture'
        where (l.layer,l.key) in (select * from unnest($1::text[],$2::text[]))
      `,[layers.map(([layer])=>layer),layers.map(([,key])=>key)]);
      selected.limits = Object.fromEntries(rows.map(row=>[row.layer,row]));
    }
    return page(res,actor,path,ui.adsView(actor,platform,view,selected));
  }

  async function analysisPage(res,actor,path,platform,params) {
    modulePermissions(actor,'analysis.read',platform);
    if (platform === 'music') {
      const snapshot = await getMusicSnapshot();
      const shows = snapshot.rows.filter(show=>access.allowed(actor,'analysis.read',{platform:'music',show:show.id,dataGroup:'finance'}));
      const id = params.get('scope');
      const show = id ? shows.find(row=>row.id===id) : shows[0];
      requireValue(!id || !snapshot.showsAvailable || show,'SHOW_MISSING',404);
      if (!show) return page(res,actor,path,planning.musicAnalysis(shows));
      const scope = finance.costScope('music',show.id);
      const [costs,musicFinance] = await Promise.all([
        access.allowed(actor,'cost.read',scope) ? finance.readLedger(pool,actor,'music',show.id) : null,
        getMusicFinance()
      ]);
      await recordAudit(pool,actor,'analysis.music.opened',scope);
      return page(res,actor,path,planning.musicAnalysis(shows,show,operations.musicAssessment(show,musicFinance,costs,new Date()),
        musicFinance.data?.rows.find(row=>row.showId===show.id)));
    }
    const location = params.get('location') ?? '';
    const day = params.get('day') ?? dayVN();
    const period = params.get('period') ?? 'day';
    if (!location) return page(res,actor,path,planning.retailAnalysis(location,day,period));
    access.check(actor,'analysis.read',operations.opsScope(location));
    const result = await operations.readOperations(pool,location,day,period);
    const counts = location==='sidewalk' && access.allowed(actor,'analysis.read',operations.opsScope(location,'camera')) ?
      await operations.readCounts(pool,result.range.start,result.range.end) : null;
    const catalog = access.allowed(actor,'analysis.read',operations.opsScope(location,'products')) ?
      await products.readProducts(pool,actor,location,day,period) : null;
    return page(res,actor,path,planning.retailAnalysis(location,day,period,result,counts,catalog));
  }

  async function operationsView(res,actor,path,params) {
    modulePermissions(actor,'operations.read','24h');
    const location = params.get('location') ?? '';
    const day = params.get('day') ?? dayVN();
    const hour = Number(params.get('hour') ?? -1);
    requireValue(validDay(day) && Number.isInteger(hour) && hour >= -1 && hour <= 23);
    if (!location) return page(res,actor,path,planning.operationsPage(actor,location,day));
    access.check(actor,'operations.read',operations.opsScope(location));
    const result = await operations.readOperations(pool,location,day);
    const catalog = access.allowed(actor,'operations.read',operations.opsScope(location,'products')) ?
      await products.readProducts(pool,actor,location,day,'input') : null;
    const product = catalog?.find(row=>row.code===params.get('product'));
    if (location !== 'sidewalk') return page(res,actor,path,planning.operationsPage(actor,location,day,result,null,null,null,hour,catalog,product));
    const [counts,policy,alerts] = await Promise.all([
      operations.readCounts(pool,day,day),
      pool.query('select settings,revision from os_v11_crowd_rules where camera=$1',[cameraId]),
      pool.query('select * from os_v11_operational_alerts where camera=$1 order by detected_at desc limit 40',[cameraId])
    ]);
    return page(res,actor,path,planning.operationsPage(actor,location,day,result,counts,policy.rows[0],alerts.rows,hour,catalog,product));
  }

  async function attendanceView(res,actor,path,params) {
    modulePermissions(actor,'operations.read','24h');
    const location = params.get('location') ?? '';
    if (!location) return page(res,actor,path,planning.attendancePage(actor,location));
    const scope = operations.opsScope(location,'attendance');
    access.check(actor,'operations.read',scope);
    const [shifts,staff] = await Promise.all([pool.query(`
      select s.*,u.display_name from os_v11_staff_shifts s join os_v11_users u on u.id=s.staff_id
      where location=$1 order by starts_at desc limit 150
    `,[location]),access.allowed(actor,'operations.write',scope) ?
      pool.query("select id,display_name,username from os_v11_users where active and role not in ('AI_DIRECTOR','AI_AGENT','AI_AUDITOR') order by username limit 300") :
      {rows:[]}]);
    const id = params.get('id');
    const selected = id ? shifts.rows.find(row=>row.id===id) : null;
    requireValue(!id || selected,'SHIFT_MISSING',404);
    await recordAudit(pool,actor,'operations.attendance.viewed',scope);
    return page(res,actor,path,planning.attendancePage(actor,location,shifts.rows,staff.rows,selected));
  }

  async function directorView(res,actor,path,platform,params) {
    modulePermissions(actor,'director.read',platform);
    const shows = platform==='music' ? (await getMusicSnapshot()).rows.filter(show =>
      access.allowed(actor,'director.read',director.goalScope(platform,show.id))) : [];
    const scopeKey = params.get(platform==='music'?'scope':'location') ?? (platform==='music' ? shows[0]?.id : '') ?? '';
    const view = scopeKey ? await director.goalsView(pool,actor,platform,scopeKey,params.get('goal')) : null;
    const media = Boolean(view?.goal?.results.DirectorFinal);
    return page(res,actor,path,planning.directorPage(actor,platform,scopeKey,view,shows),200,media);
  }

  function sendMedia(res, data, name) {
    res.writeHead(200, {'Content-Type':data.type,'Content-Length':data.bytes.length,'Cache-Control':'private, no-store',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer',
      'Content-Disposition':name ? 'inline; filename="'+name+'"' : 'inline','X-Content-Type-Options':'nosniff'});
    res.end(data.bytes);
  }

  async function dispatchRead(res,actor,path,params) {
    if (path === '/v11/camera/player.js') {
      access.check(actor,'camera.live',cameraScope);
      const bytes = await readFile(join(dirname(require.resolve('hls.js')),'hls.min.js'));
      return sendMedia(res,{bytes,type:'text/javascript; charset=utf-8'});
    }
    if (path === '/v11') return dashboard(res,actor);
    if (path === '/v11/access') return listAccess(res,actor);
    if (path === '/v11/sources') return page(res,actor,path,ui.sourcesView(await evidence.sourcesView(pool,actor,env),actor));
    if (path === '/v11/camera') return page(res,actor,path,ui.cameraView(actor,await camera.view(actor)));
    const media = /^\/v11\/camera\/media\/([a-f0-9-]+)\/([a-z0-9-]+)$/.exec(path);
    if (media) return sendMedia(res,await camera.media(actor,media[1],media[2]));
    if (path === '/v11/auditor') return page(res,actor,path,ui.auditPage(actor,await evidence.auditView(pool,actor,true),'auditor'));
    if (path === '/v11/audit') return page(res,actor,path,ui.auditPage(actor,await evidence.auditView(pool,actor),'audit'));
    if (path === '/v11/operations') return operationsView(res,actor,path,params);
    if (path === '/v11/attendance') return attendanceView(res,actor,path,params);
    const module = /^\/v11\/(costs|ads|analysis|director|memory)\/(music|24h)$/.exec(path);
    if (module) {
      const [,name,platform] = module;
      if (name === 'costs') return costsPage(res,actor,path,platform,params);
      if (name === 'ads') return adsPage(res,actor,path,platform,params);
      if (name === 'analysis') return analysisPage(res,actor,path,platform,params);
      if (name === 'director') return directorView(res,actor,path,platform,params);
      return page(res,actor,path,ui.auditPage(actor,await evidence.decisionHistory(pool,actor,platform),'memory',platform));
    }
    throw new V11Error('NOT_FOUND',404);
  }

  async function postCost(actor,path,platform,operation,fields) {
    const scope = fields.get('scope');
    switch (operation) {
      case 'save': await finance.saveCost(pool,actor,platform,scope,fields); break;
      case 'attest': await finance.attestCosts(pool,actor,platform,scope,fields.get('basis'),fields.get('source')); break;
      case 'supplier': await finance.saveSupplier(pool,actor,platform,fields.get('name')); break;
      case 'category': await finance.saveCategory(pool,actor,platform,fields.get('category'),fields.get('type')); break;
      case 'quote': await finance.saveQuote(pool,actor,platform,fields); break;
      default: throw new V11Error('NOT_FOUND',404);
    }
    return ui.withQuery(path,{scope});
  }

  async function postAds(actor,path,platform,operation,fields) {
    let target = fields.get('target');
    const raw = name => fields.get(name);
    if (operation === 'stop') {
      requireValue(['true','false'].includes(raw('stopped')));
      await ads.setStop(pool,actor,raw('stopped')==='true',Number(raw('revision')));
    } else if (operation === 'target') {
      target = await ads.configureTarget(pool,actor,{platform,account:raw('account'),show:raw('show'),campaign:raw('campaign'),adSet:raw('adSet'),
        starts:raw('starts'),ends:raw('ends'),allocation:finance.readNumber(raw('allocation'))});
    } else if (['limit','fixture'].includes(operation)) {
      const values = ads.budgetLayers({},dayVN()).map(([layer])=>finance.readNumber(raw('budget_'+layer)));
      const save = operation === 'limit' ? ads.setBudget : ads.fixtureSpend;
      await save(pool,actor,target,raw('day'),values);
    } else if (operation === 'request') {
      await ads.requestAction(pool,actor,{id:raw('request'),targetId:target,action:raw('action'),amount:finance.readNumber(raw('amount')),
        reason:raw('reason'),basis:raw('basis'),spendMode:raw('spendMode'),from:raw('from')});
    } else if (['approve','reject','execute'].includes(operation)) {
      await ads.transitionAction(pool,actor,raw('request'),operation,Number(raw('revision')));
    } else throw new V11Error('NOT_FOUND',404);
    return target ? ui.withQuery(path,{target}) : path;
  }

  async function postDirector(actor,path,platform,operation,fields) {
    const field = platform==='music' ? 'scope' : 'location';
    const scopeKey = fields.get(field);
    let id = fields.get('goal');
    switch (operation) {
      case 'submit':
        id = await director.submitGoal(pool,actor,{id:fields.get('request'),platform,scopeKey,
          objective:fields.get('objective'),period:fields.get('period')});
        break;
      case 'retry': await director.retryGoal(pool,actor,id); break;
      case 'decide': await director.decideGoal(pool,actor,id,fields.get('decision'),fields.get('note')); break;
      case 'task': await director.goalTask(pool,actor,id,fields); break;
      case 'revise':
        id = await director.reviseGoal(pool,actor,id,fields.get('request'),fields.get('section'),fields.get('note'));
        break;
      default: throw new V11Error('NOT_FOUND',404);
    }
    return ui.withQuery(path,{[field]:scopeKey,goal:id});
  }

  async function postCamera(res,actor,path,operation,fields) {
    const id = fields.get('camera');
    if (operation === 'snapshot') return sendMedia(res,await camera.snapshot(actor,id));
    if (operation === 'live') return page(res,actor,path,ui.cameraLive(await camera.openLive(actor,id)),200,'camera');
    if (operation === 'status') await camera.status(actor,id);
    else if (operation === 'policy') {
      const fieldsToRead = ['calls','snapshots','bytes','interval','retention','aiDay','aiMonth','revision'];
      const policy = Object.fromEntries(fieldsToRead.map(key=>[key,finance.readNumber(fields.get(key))]));
      await configureCamera(pool,actor,{...policy,termsVerified:fields.has('verified'),termsReference:fields.get('reference'),host:fields.get('host')});
    } else throw new V11Error('NOT_FOUND',404);
    return redirect(res,path);
  }

  async function postOperations(actor,path,operation,fields) {
    const day = fields.get('day');
    const hour = Number(fields.get('hour'));
    const location = ['observation','product'].includes(operation) ? fields.get('location') : 'sidewalk';
    if (operation === 'observation') await operations.saveRetailObservation(pool,actor,location,day,hour,fields);
    else if (operation === 'product') await products.saveProduct(pool,actor,location,day,fields);
    else if (operation === 'counts') await operations.saveCounts(pool,actor,day,hour,fields);
    else if (operation === 'rule') {
      const numbers = Object.fromEntries(['people','minutes','from','to','cooldown'].map(key=>[key,finance.readNumber(fields.get(key))]));
      const exceptions = (fields.get('exceptions') ?? '').split(',').map(s=>s.trim()).filter(Boolean).map(value=>finance.readNumber(value));
      await operations.saveCrowdRule(pool,actor,{...numbers,exceptions},Number(fields.get('revision')));
    } else if (operation === 'review') await operations.reviewAlert(pool,actor,fields.get('alert'));
    else throw new V11Error('NOT_FOUND',404);
    return ui.withQuery(path,{location,day:day ?? dayVN(),hour: Number.isInteger(hour) ? hour : -1});
  }

  async function dispatchWrite(req,res,actor,path) {
    const fields = await form(req);
    requireValue(eq(fields.get('csrf')||'',actor.csrf),'FORBIDDEN',403);
    if (path === '/v11/access/invite') {
      const code = await access.invite(pool,actor,{username:fields.get('username'),displayName:fields.get('displayName'),role:fields.get('role')});
      return listAccess(res,actor,code);
    }
    if (path === '/v11/access/grant') {
      requireValue(['grant','revoke'].includes(fields.get('operation')));
      const scope = Object.fromEntries(access.scopes.filter(key=>fields.get(key)).map(key=>[key,fields.get(key)]));
      await access.setGrant(pool,actor,{userId:fields.get('userId'),permission:fields.get('permission'),scope,revoke:fields.get('operation')==='revoke'});
      return redirect(res,'/v11/access');
    }
    if (path === '/v11/access/disable') {
      await access.disableAccount(pool,actor,fields.get('userId'));
      return redirect(res,'/v11/access');
    }
    if (path === '/v11/sources/evidence') {
      await evidence.saveExternalEvidence(pool,actor,fields);
      return redirect(res,'/v11/sources');
    }
    const memoryPath = /^\/v11\/memory\/(music|24h)\/outcome$/.exec(path);
    if (memoryPath) {
      await evidence.saveOutcome(pool,actor,memoryPath[1],fields);
      return redirect(res,'/v11/memory/'+memoryPath[1]);
    }
    if (path === '/v11/sources/refresh') {
      await evidence.refreshSources(pool,actor);
      return redirect(res,'/v11/sources');
    }
    if (path === '/v11/auditor/check' || path === '/v11/auditor/report') {
      if (path.endsWith('/check')) await evidence.checkInternalControls(pool,actor,fields.get('platform'));
      else await evidence.auditReport(pool,actor,Object.fromEntries(['platform','subject','severity','summary','evidence'].map(key=>[key,fields.get(key)])));
      return redirect(res,'/v11/auditor');
    }
    if (path === '/v11/attendance/shift') {
      const location = fields.get('location');
      await operations.saveShift(pool,actor,location,fields);
      return redirect(res,ui.withQuery('/v11/attendance',{location}));
    }
    const cameraPath = /^\/v11\/camera\/([a-z]+)$/.exec(path);
    if (cameraPath) return postCamera(res,actor,'/v11/camera',cameraPath[1],fields);
    const opsPath = /^\/v11\/operations\/([a-z]+)$/.exec(path);
    if (opsPath) return redirect(res,await postOperations(actor,'/v11/operations',opsPath[1],fields));
    const sub = /^\/v11\/(costs|ads|director)\/(music|24h)\/([a-z]+)$/.exec(path);
    if (sub) {
      const [,section,platform,operation] = sub;
      const action = {costs:postCost,ads:postAds,director:postDirector}[section];
      return redirect(res,await action(actor,'/v11/'+section+'/'+platform,platform,operation,fields));
    }
    throw new V11Error('NOT_FOUND',404);
  }

  async function handle(req,res,actor) {
    const {pathname,searchParams} = new URL(req.url,'http://localhost');
    try {
      if (req.method === 'GET') return await dispatchRead(res,actor,pathname,searchParams);
      if (req.method === 'POST') return await dispatchWrite(req,res,actor,pathname);
      throw new V11Error('NOT_FOUND',404);
    } catch (error) {
      if (!(error instanceof V11Error)) throw error;
      const back = /^\/v11\/(?:costs|ads|director)\/(?:music|24h)/.exec(pathname)?.[0] ??
        /^\/v11\/(?:camera|operations|access|auditor|attendance|sources|analysis)/.exec(pathname)?.[0] ?? '/v11';
      return failure(res,actor,back,error);
    }
  }

  return {handle,activate,dashboard};
}

module.exports = {makeWorkspace,styles,speechHash:planning.speechHash,cameraPlayerHash:ui.cameraPlayerHash};

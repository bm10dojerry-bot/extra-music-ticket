'use strict';

const {randomUUID} = require('node:crypto');
const {stages, modelReady, dailyCallLimit, makeFacts, callRole} = require('./live-director.cjs');
const {getMusicSnapshot, readMusicMedia} = require('./music-readonly.cjs');
const {getMusicFinance} = require('./daily-reports.cjs');
const {externalFor} = require('./v11-evidence.cjs');
const {getMusicSignals} = require('./music-signals.cjs');
const {check, allowed} = require('./v11-auth.cjs');
const {cleanText, summarizeCosts} = require('./v11-costs.cjs');
const {musicAssessment, readOperations, readCounts} = require('./v11-operations.cjs');
const {dayVN, keyPattern, uuidPattern, requireValue, transaction, recordAudit} = require('./v11-core.cjs');

const localSteps = ['collect', 'verify', 'coverage', 'economics'];
const pipeline = [...localSteps, ...stages];
const finalStep = pipeline.length - 1;
const retryRules = new Set(['model_not_configured','AI_DAILY_LIMIT','SOURCE_UNAVAILABLE','invalid_evidence','invalid_agent_fields',
  'invalid_campaign_fields','invalid_brief_fields','invalid_economic_decision','invalid_sales_window','provider_rate_limited',
  'provider_quota_exhausted','provider_http_429','provider_output_limit','provider_content_filter','provider_not_completed',
  'provider_invalid_json','invalid_staff_revision','unsupported_retail_forecast','MODEL_CALL_UNCONFIRMED']);

function goalScope(platform, scopeKey) {
  requireValue(['music','24h'].includes(platform) && keyPattern.test(scopeKey ?? ''));
  return {platform, [platform === 'music' ? 'show' : 'location']:scopeKey, dataGroup:'planning'};
}

async function getGoal(pool, id, lock = false) {
  requireValue(uuidPattern.test(id ?? ''), 'GOAL_MISSING', 404);
  const {rows:[goal]} = await pool.query('select * from os_v11_goals where id=$1'+(lock ? ' for update' : ''), [id]);
  requireValue(goal, 'GOAL_MISSING', 404);
  return goal;
}

async function submitGoal(pool, actor, input) {
  const scope = goalScope(input.platform, input.scopeKey);
  check(actor, 'director.write', scope);
  const objective = cleanText(input.objective?.replace(/\s+/gu, ' '), 3000, true);
  requireValue(uuidPattern.test(input.id ?? '') && ['day','week','month'].includes(input.period));
  return transaction(pool, async client => {
    const {rows:[existing]} = await client.query('select * from os_v11_goals where id=$1', [input.id]);
    if (existing) {
      requireValue(existing.created_by === actor.id && existing.platform === input.platform &&
        existing.scope_key === input.scopeKey && existing.objective === objective && existing.period === input.period,
      'DUPLICATE', 409);
      return existing.id;
    }
    const {rowCount} = await client.query(`
      insert into os_v11_goals(id,platform,scope_key,period,objective,created_by,status) values($1,$2,$3,$4,$5,$6,'queued')
      on conflict do nothing
    `, [input.id,input.platform,input.scopeKey,input.period,objective,actor.id]);
    requireValue(rowCount === 1, 'DUPLICATE', 409);
    await recordAudit(client, actor, 'director.goal.submitted', scope, {goalId:input.id, period:input.period});
    return input.id;
  });
}

async function reviseGoal(pool, actor, id, requestedId, section, note) {
  check(actor, 'director.approve');
  requireValue(uuidPattern.test(requestedId ?? '') && ['staffing','strategy'].includes(section));
  const revisionNote = cleanText(note?.replace(/\s+/gu, ' '), 1800, true);
  return transaction(pool, async client => {
    const parent = await getGoal(client, id, true);
    const scope = goalScope(parent.platform, parent.scope_key);
    requireValue(['ready','approved','rejected'].includes(parent.status) && parent.results.DirectorFinal, 'GOAL_NOT_READY', 409);
    const results = {...parent.results};
    if (section === 'staffing') results.PreviousDirectorFinal = results.DirectorFinal;
    delete results.DirectorFinal;
    const facts = {...parent.facts, revisionNote, revisionSection:section};
    const {rowCount} = await client.query(`
      insert into os_v11_goals(id,platform,scope_key,period,objective,created_by,parent_id,version,section,revision_note,status,step,facts,results)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,$13) on conflict do nothing
    `, [requestedId,parent.platform,parent.scope_key,parent.period,parent.objective,actor.id,id,parent.version+1,
      section,revisionNote,finalStep,JSON.stringify(facts),JSON.stringify(results)]);
    requireValue(rowCount === 1, 'DUPLICATE', 409);
    await recordAudit(client, actor, 'director.goal.revised', scope, {goalId:requestedId, parent:id, section});
    return requestedId;
  });
}

async function scopedHistory(pool, goal) {
  const {rows} = await pool.query(`
    select version,status,updated_at,results->'DirectorFinal'->'output'->'campaigns' as campaigns
    from os_v11_goals where platform=$1 and scope_key=$2 and status in ('approved','rejected')
    order by updated_at desc limit 6
  `, [goal.platform,goal.scope_key]);
  return rows.map(row => ({version:row.version,decision:row.status,date:row.updated_at,
    proposedBudgetsVnd:(row.campaigns ?? []).map(campaign=>campaign.proposedBudgetVnd),
    confirmedOutcome:null}));
}

async function collectFacts(pool, goal, now) {
  const day = dayVN(now);
  const [history, evidence] = await Promise.all([scopedHistory(pool,goal),externalFor(pool,goal.platform,goal.scope_key,day)]);
  const external = evidence.map(({reference,...item}) => item.source==='drive' ? item : {...item,reference});
  const scope = goal.platform + (goal.period === 'day' ? '' : '_' + goal.period);
  if (goal.platform === '24h') {
    const operations = await readOperations(pool, goal.scope_key, day, goal.period);
    const peopleCounts = goal.scope_key === 'sidewalk' ? await readCounts(pool, operations.range.start, operations.range.end) : [];
    const facts = makeFacts(scope, day, null, null, null, null, null, now.toISOString());
    facts.objective = goal.objective;
    facts.v11History = history;
    facts.v11External = external;
    facts.location = goal.scope_key;
    facts.observedAt = now.toISOString();
    facts.v11Operations = {summary:operations.summary, peakHours:operations.peakHours, complete:operations.complete,
      periods:operations.rows.length, source:operations.source,forecast:operations.forecast,staffing:operations.staffing.slice(-20)};
    facts.v11Camera = peopleCounts.length ? {zone:'sidewalk', metric:'pedestrian_traffic', entries:peopleCounts.slice(-48)
      .map(row => ({day:row.day,hour:row.hour,passers:row.fields.passers, source:row.source}))} : null;
    if (!operations.complete) facts.missing.push('Chưa đủ đối soát 24H cho toàn kỳ.');
    return facts;
  }
  const [snapshot, finance, media, signals] = await Promise.all([
    getMusicSnapshot(), getMusicFinance(), readMusicMedia(), getMusicSignals()
  ]);
  requireValue(snapshot.showsAvailable, 'SOURCE_UNAVAILABLE', 409);
  const show = snapshot.rows.find(row => row.id === goal.scope_key);
  requireValue(show, 'SOURCE_UNAVAILABLE', 409);
  const shows = {...snapshot, rows:[show]};
  const financeOnly = finance.data ? {...finance, data:{...finance.data, rows:finance.data.rows.filter(row => row.showId === show.id)}} : finance;
  const assets = {...media, assets:media.assets.filter(row => row.slot === 'artist-'+show.id)};
  const signalsOnly = signals && {
    ...signals,
    messenger:signals.messenger?.filter(entry => entry.showId === show.id) ?? [],
    adDays:signals.adDays?.map(day => ({...day,rows:day.rows.filter(row => row.showId === show.id)})) ?? [],
    saleAudit:signals.saleAudit ? {...signals.saleAudit, rows:signals.saleAudit.rows.filter(row => row.showId === show.id),
      review:signals.saleAudit.review ? {...signals.saleAudit.review, reviews:signals.saleAudit.review.reviews
        .filter(row => row.showId === show.id)} : null} : null,
    economics:signals.economics ? {...signals.economics,
      costs:signals.economics.costs.filter(row => row.showId === show.id),
      campaigns:signals.economics.campaigns.filter(row => row.showId === show.id),
      oldAds:Object.fromEntries(Object.entries(signals.economics.oldAds).filter(([id]) => id === show.id))} : null
  };
  const facts = makeFacts(scope, day, financeOnly, shows, assets, null, signalsOnly, now.toISOString());
  const {rows:[ledger]} = await pool.query(`
    select coalesce((select jsonb_agg(c) from os_v11_costs c where platform='music' and scope_key=$1),'[]'::jsonb) as costs,
      coalesce((select array_agg(basis) from os_v11_cost_coverage where platform='music' and scope_key=$1),'{}') as coverage
  `, [show.id]);
  facts.objective = goal.objective;
  facts.v11History = history;
  facts.v11External = external;
  facts.v11Economics = musicAssessment(show, financeOnly, {costs:ledger.costs, totals:summarizeCosts(ledger.costs,ledger.coverage)}, now);
  if (facts.v11Economics.expense === null) facts.missing.push('Chi phí thực tế chưa đủ xác nhận trong Input Cost Center.');
  return facts;
}

async function reserveModelCall(client, env, clock) {
  const day = dayVN(clock);
  const limit = dailyCallLimit(env,day);
  if (!Number.isInteger(limit) || limit < 1) return false;
  await client.query('insert into os_live_director_call_budget(day,calls) values($1,0) on conflict do nothing',[day]);
  const {rowCount} = await client.query(`
    update os_live_director_call_budget set calls=calls+1
    where day=$1 and calls<$2 and (retry_at is null or retry_at<=$3)
  `,[day,limit,clock]);
  return rowCount === 1;
}

function meteredModelRequest(pool, env, request = fetch) {
  return async (url,init) => {
    if (new URL(url).origin !== 'https://api.openai.com') return request(url,init);
    if (env.EXTRA_OS_V11_AI_APPROVED !== 'true') return new Response(null,{status:403});
    if (!await reserveModelCall(pool,env,new Date())) return new Response(null,{status:429});
    return request(url,init);
  };
}

async function beginStep(pool, env, clock) {
  return transaction(pool, async client => {
    await client.query('select pg_advisory_xact_lock(71501214)');
    await client.query(`
      with interrupted as (
        update os_v11_goals set status='blocked',reason='MODEL_CALL_UNCONFIRMED',run_token=null,updated_at=clock_timestamp()
        where status='running' and updated_at<clock_timestamp()-interval '3 minutes' returning id
      )
      update os_v11_goal_steps set state='blocked',finished_at=clock_timestamp(),reason='MODEL_CALL_UNCONFIRMED'
      where state='running' and goal_id in(select id from interrupted)
    `);
    const {rows:[row]} = await client.query(`
      select * from os_v11_goals where status='queued' order by created_at,id for update skip locked limit 1
    `);
    if (!row) return null;
    const step = pipeline[row.step];
    requireValue(step, 'INVALID_STEP');
    const local = localSteps.includes(step);
    let reason = null;
    if (!local) {
      if (!modelReady(env)) reason = 'model_not_configured';
      else {
        const reserved = await reserveModelCall(client,env,clock);
        if (!reserved) reason = 'AI_DAILY_LIMIT';
      }
    }
    const token = randomUUID();
    const {rows:[attempt]} = await client.query(`
      insert into os_v11_goal_steps(goal_id,step,attempt,state,finished_at,reason)
      select $1,$2,coalesce(max(attempt),0)+1,$3,case when $4::text is not null then clock_timestamp() end,$4
      from os_v11_goal_steps where goal_id=$1 and step=$2 returning attempt
    `, [row.id,step,reason ? 'blocked' : 'running',reason]);
    await client.query(`
      update os_v11_goals set status=$2,run_token=$3,reason=$4,updated_at=clock_timestamp() where id=$1
    `, [row.id,reason ? 'blocked' : 'running',reason ? null : token,reason]);
    return reason ? null : {...row,stepName:step,token,attempt:attempt.attempt,local};
  });
}

function localOutput(row, facts) {
  if (row.stepName === 'verify') {
    requireValue(facts && facts.day && facts.observedAt, 'SOURCE_UNAVAILABLE', 409);
    return {sourceState:facts.financeSource || facts.v11Operations?.periods ? 'PARTIAL' : 'MISSING'};
  }
  if (row.stepName === 'coverage') return {missing:facts.missing};
  if (row.stepName === 'economics') return {economics:facts.v11Economics ?? facts.v11Operations?.summary ?? null};
  return {collectedAt:facts.observedAt};
}

async function runGoalStep(pool, {env = process.env, request = fetch, now = new Date(), collect = collectFacts} = {}) {
  const row = await beginStep(pool, env, now);
  if (!row) return null;
  let facts = row.facts;
  let result;
  let failure = null;
  let providerRetry = 0;
  try {
    if (row.stepName === 'collect') facts = await collect(pool,row,now);
    result = row.local ? localOutput(row,facts) : await callRole(row.stepName,facts,row.results,env,request,now);
    if (row.step === finalStep && !result.output?.campaigns?.length) failure = 'NO_ACTIONABLE_CAMPAIGN';
  } catch (error) {
    failure = retryRules.has(error.message) || /^provider_http_\d{3}$/.test(error.message) ? error.message : 'MODEL_CALL_UNCONFIRMED';
    providerRetry = Number.isSafeInteger(error.retrySeconds) ? Math.min(error.retrySeconds,86400) : 0;
  }
  return transaction(pool, async client => {
    const results = result ? {...row.results,[row.stepName]:result} : row.results;
    if (row.step === finalStep && result) delete results.PreviousDirectorFinal;
    const next = failure ? 'blocked' : row.step === finalStep ? 'ready' : 'queued';
    const {rowCount} = await client.query(`
      update os_v11_goals set facts=$3,results=$4,status=$5,step=$6,reason=$7,run_token=null,updated_at=clock_timestamp()
      where id=$1 and run_token=$2
    `, [row.id,row.token,facts ? JSON.stringify(facts) : null,JSON.stringify(results),next,row.step+(failure ? 0 : 1),failure]);
    if (!rowCount) return null;
    await client.query(`
      update os_v11_goal_steps set state=$4,finished_at=clock_timestamp(),reason=$5 where goal_id=$1 and step=$2 and attempt=$3
    `, [row.id,row.stepName,row.attempt,failure ? 'blocked' : 'succeeded',failure]);
    if (providerRetry) await client.query(`
      update os_live_director_call_budget set retry_at=greatest(retry_at,clock_timestamp()+$2::int*interval '1 second') where day=$1
    `, [dayVN(now),providerRetry]);
    if (row.stepName === 'Auditor' && result?.output) await recordAudit(client,null,'audit.director.finding',
      goalScope(row.platform,row.scope_key), {goalId:row.id,version:row.version,summary:result.output.summary,
        blockers:result.output.blockers,sources:result.output.sourceIds});
    return next;
  });
}

async function retryGoal(pool, actor, id) {
  const row = await getGoal(pool,id);
  check(actor,'director.write',goalScope(row.platform,row.scope_key));
  requireValue(retryRules.has(row.reason), 'GOAL_NOT_RETRYABLE', 409);
  await transaction(pool, async client => {
    const {rowCount} = await client.query(`
      update os_v11_goals set status='queued',reason=null,updated_at=clock_timestamp() where id=$1 and status='blocked' and reason=$2
    `, [id,row.reason]);
    requireValue(rowCount === 1,'STALE_REVISION',409);
    await recordAudit(client,actor,'director.goal.retried',goalScope(row.platform,row.scope_key),{id,priorReason:row.reason});
  });
}

async function decideGoal(pool, actor, id, decision, note) {
  check(actor,'director.approve');
  requireValue(['approved','rejected'].includes(decision));
  const reason = cleanText(note?.replace(/\s+/gu, ' '),800,true);
  return transaction(pool, async client => {
    const goal = await getGoal(client,id,true);
    const scope = goalScope(goal.platform,goal.scope_key);
    requireValue(!(await client.query('select 1 from os_v11_goals where parent_id=$1',[id])).rowCount,'STALE_REVISION',409);
    requireValue(goal.results.Auditor?.responseId && goal.results.DirectorFinal?.responseId,'GOAL_NOT_READY',409);
    const {rowCount} = await client.query(`
      update os_v11_goals set status=$2,updated_at=clock_timestamp() where id=$1 and status='ready'
    `, [id,decision]);
    requireValue(rowCount === 1,'STALE_REVISION',409);
    if (decision === 'approved') {
      for (const campaign of goal.results.DirectorFinal.output.campaigns) {
        for (const assignment of [...campaign.actions,...campaign.staff]) await client.query(`
          insert into os_v11_goal_tasks(id,goal_id,assignment) values($1,$2,$3)
        `, [randomUUID(),id,JSON.stringify({...assignment, title:campaign.title})]);
      }
    }
    await recordAudit(client,actor,'director.goal.'+decision,scope,{goalId:id,version:goal.version,reason,externalRequests:0});
  });
}

async function goalTask(pool, actor, goalId, fields) {
  const goal = await getGoal(pool, goalId);
  const scope = goalScope(goal.platform,goal.scope_key);
  check(actor,'director.write',scope);
  const transitions = {in_progress:'pending',submitted:'in_progress',accepted:'submitted'};
  const state = fields.get('state');
  const task = fields.get('task');
  const revision = Number(fields.get('revision'));
  requireValue(Object.hasOwn(transitions,state) && uuidPattern.test(task ?? '') && Number.isInteger(revision));
  const note = cleanText(fields.get('note'),800,state !== 'in_progress');
  if (state === 'accepted') check(actor,'director.approve',scope);
  await transaction(pool, async client => {
    const {rowCount} = await client.query(`
      update os_v11_goal_tasks set status=$4,note=$5,revision=revision+1,updated_at=clock_timestamp()
      where goal_id=$1 and id=$2 and revision=$3 and status=$6
    `, [goalId,task,revision,state,note,transitions[state]]);
    requireValue(rowCount === 1,'STALE_REVISION',409);
    await recordAudit(client,actor,'director.task.'+state,scope,{goalId,task,revision:revision+1});
  });
}

async function goalsView(pool, actor, platform, scopeKey, selected) {
  const scope = goalScope(platform,scopeKey);
  check(actor,'director.read',scope);
  const {rows:goals} = await pool.query(`
    select id,version,objective,status,reason,created_at,parent_id from os_v11_goals where platform=$1 and scope_key=$2
    order by created_at desc limit 60
  `, [platform,scopeKey]);
  if (!selected) return {goals};
  const goal = await getGoal(pool,selected);
  requireValue(goal.platform === platform && goal.scope_key === scopeKey,'GOAL_MISSING',404);
  const [steps,tasks] = await Promise.all([pool.query('select * from os_v11_goal_steps where goal_id=$1 order by started_at,attempt',[selected]),
    pool.query('select * from os_v11_goal_tasks where goal_id=$1 order by id',[selected])]);
  return {goals,goal,steps:steps.rows,tasks:tasks.rows,canWrite:allowed(actor,'director.write',scope)};
}

function startGoals(pool, env = process.env) {
  let pending;
  const tick = () => {
    if (!pending) pending = runGoalStep(pool,{env}).catch(() => console.error('EXTRA OS Director queue unavailable'))
      .finally(() => {pending = null;});
  };
  const timer = setInterval(tick,2500).unref();
  return async () => {clearInterval(timer); await pending;};
}

module.exports = {pipeline, goalScope, submitGoal, reviseGoal, runGoalStep, retryGoal, decideGoal, goalTask, goalsView, startGoals, meteredModelRequest};

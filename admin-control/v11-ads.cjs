'use strict';

const {randomUUID} = require('node:crypto');
const {allowed, check} = require('./v11-auth.cjs');
const {dayVN, keyPattern, uuidPattern, vnd, validDay, requireValue, transaction, recordAudit} = require('./v11-core.cjs');

const pollMs = 15 * 60 * 1000;
const metaId = /^\d{5,30}$/;
const actions = {
  PAUSE: 'ads.pause',
  OPTIMIZE: 'ads.optimize',
  CREATE_CAMPAIGN: 'ads.create',
  INCREASE_TOTAL_BUDGET: 'ads.increase'
};

const adScope = target => ({
  platform: target.platform, account: target.account, show: target.show_key, dataGroup: 'advertising'
});

function budgetLayers(target, day) {
  return [
    ['business', 'total'],
    ['account', target.account],
    ['show', target.platform + ':' + target.show_key],
    ['campaign', target.account + ':' + target.campaign],
    ['adset', target.account + ':' + target.campaign + ':' + target.ad_set],
    ['day', day],
    ['term', target.account + ':' + target.campaign + ':' + target.starts_on + ':' + target.ends_on]
  ];
}

const layerKey = (layer, key) => layer + '/' + key;
const targetColumns = 'id,platform,account,show_key,campaign,ad_set,starts_on::text,ends_on::text,dry_run_allocation_vnd';

async function targetById(client, id) {
  requireValue(uuidPattern.test(id ?? ''), 'TARGET_MISSING', 404);
  const {rows: [target]} = await client.query('select ' + targetColumns + ' from os_v11_ads_targets where id=$1', [id]);
  requireValue(target, 'TARGET_MISSING', 404);
  return target;
}

async function adsLock(client) {
  const {rows: [row]} = await client.query('select stopped,revision from os_v11_ads_switch where singleton for update');
  return row;
}

async function configureTarget(pool, actor, input) {
  check(actor, 'ads.configure');
  const {platform, account, show, campaign, adSet, starts, ends, allocation} = input;
  requireValue(['music', '24h'].includes(platform) && keyPattern.test(show ?? '') &&
    [account, campaign, adSet].every(id => metaId.test(id ?? '')) &&
    validDay(starts) && validDay(ends) && ends >= starts && (allocation == null || vnd(allocation)));
  return transaction(pool, async client => {
    await adsLock(client);
    const {rowCount, rows: [target]} = await client.query(`
      insert into os_v11_ads_targets(id,platform,account,show_key,campaign,ad_set,starts_on,ends_on,dry_run_allocation_vnd)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(account,campaign,ad_set) do nothing returning *
    `, [randomUUID(), platform, account, show, campaign, adSet, starts, ends, allocation]);
    requireValue(rowCount === 1, 'DUPLICATE', 409);
    await recordAudit(client, actor, 'ads.target.added', adScope(target), {targetId:target.id});
    return target.id;
  });
}

async function setBudget(pool, actor, targetId, day, limits) {
  check(actor, 'ads.configure');
  requireValue(validDay(day) && Array.isArray(limits) && limits.length === 7 &&
    limits.every(value => value === null || vnd(value)) && limits.some(value => value !== null));
  return transaction(pool, async client => {
    await adsLock(client);
    const target = await targetById(client, targetId);
    const layers = budgetLayers(target, day);
    for (const [index, [layer, key]] of layers.entries()) {
      if (limits[index] === null) continue;
      await client.query(`
        insert into os_v11_ads_limits(layer,key,cap_vnd) values($1,$2,$3)
        on conflict(layer,key) do update set cap_vnd=excluded.cap_vnd,updated_at=clock_timestamp()
      `, [layer, key, limits[index]]);
    }
    await recordAudit(client, actor, 'ads.limits.updated', adScope(target), {day, targetId,
      limits: Object.fromEntries(layers.map(([layer], index) => [layer, limits[index]]).filter(([, value]) => value !== null))});
  });
}

async function fixtureSpend(pool, actor, targetId, day, spends) {
  check(actor, 'ads.configure');
  requireValue(validDay(day) && day === dayVN() && Array.isArray(spends) && spends.length === 7 && spends.every(vnd));
  return transaction(pool, async client => {
    await adsLock(client);
    const target = await targetById(client, targetId);
    for (const [index, [layer, key]] of budgetLayers(target, day).entries()) {
      await client.query(`
        insert into os_v11_ads_observations(layer,key,source,spend_vnd,observed_at,verified)
        values($1,$2,'fixture',$3,clock_timestamp(),true)
        on conflict(layer,key,source) do update set spend_vnd=excluded.spend_vnd,observed_at=excluded.observed_at,verified=true
      `, [layer, key, spends[index]]);
    }
    await recordAudit(client, actor, 'ads.fixture.recorded', adScope(target), {targetId, day});
  });
}

async function setStop(pool, actor, stopped, revision) {
  check(actor, 'ads.stop');
  requireValue(typeof stopped === 'boolean' && Number.isInteger(revision) && revision > 0);
  return transaction(pool, async client => {
    const state = await adsLock(client);
    requireValue(state.revision === revision, 'STALE_REVISION', 409);
    if (state.stopped === stopped) return;
    await client.query('update os_v11_ads_switch set stopped=$1,revision=revision+1 where singleton', [stopped]);
    await recordAudit(client, actor, stopped ? 'ads.emergency.stopped' : 'ads.emergency.reenabled');
  });
}

function validateRequest(input) {
  requireValue(['daily','lifetime'].includes(input.spendMode) &&
    (input.action !== 'OPTIMIZE' || input.spendMode === 'lifetime') && uuidPattern.test(input.id ?? '') && Object.hasOwn(actions, input.action) && vnd(input.amount) &&
    (input.action === 'PAUSE' ? input.amount === 0 : input.amount > 0) &&
    (input.action === 'OPTIMIZE' ? uuidPattern.test(input.from ?? '') && input.from !== input.targetId : !input.from) &&
    typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 500 &&
    ['fixture', 'meta'].includes(input.basis));
}

async function checkDonor(client, actor, target, donorId, amount, day, basis) {
  const donor = await targetById(client, donorId);
  check(actor, 'ads.optimize', adScope(donor));
  requireValue(donor.platform === target.platform && donor.account === target.account &&
    donor.starts_on <= day && donor.ends_on >= day && basis === 'fixture' && donor.dry_run_allocation_vnd !== null,
  'DONOR_NOT_VERIFIED', 409);
  const {rows: [row]} = await client.query(`
    select coalesce(sum(amount_vnd),0) as reserved from os_v11_ads_reservations where layer='transfer' and key=$1
  `, [donorId]);
  requireValue(BigInt(row.reserved) + BigInt(amount) <= BigInt(donor.dry_run_allocation_vnd), 'DONOR_BUDGET_EXCEEDED', 409);
  return donor;
}

async function requestAction(pool, actor, args) {
  const input = {...args,spendMode:args.spendMode || 'lifetime'};
  validateRequest(input);
  return transaction(pool, async client => {
    const state = await adsLock(client);
    const target = await targetById(client, input.targetId);
    const scope = adScope(target);
    check(actor, actions[input.action], scope);
    const {rows: [existing]} = await client.query('select * from os_v11_ads_actions where id=$1', [input.id]);
    if (existing) {
      requireValue(existing.requested_by === actor.id && existing.target_id === target.id && existing.action === input.action &&
        existing.proposal.amount === input.amount && existing.proposal.from === (input.from || null) &&
        existing.proposal.reason === input.reason.trim() && existing.proposal.basis === input.basis &&
        existing.proposal.spendMode === input.spendMode, 'DUPLICATE', 409);
      return existing;
    }
    requireValue(!state.stopped || input.action === 'PAUSE', 'EMERGENCY_STOP', 409);
    const {rows: [clock]} = await client.query('select clock_timestamp() as now');
    const day = dayVN(clock.now);
    requireValue(input.action === 'PAUSE' || (target.starts_on <= day && day <= target.ends_on), 'OUTSIDE_CAMPAIGN', 409);
    if (input.from) await checkDonor(client, actor, target, input.from, input.amount, day, input.basis);
    const proposal = {amount: input.amount, from: input.from || null, reason: input.reason.trim(), basis: input.basis, spendMode: input.spendMode, day};
    const {rows: [row]} = await client.query(`
      insert into os_v11_ads_actions(id,target_id,action,proposal,state,requested_by,expires_at)
      values($1,$2,$3,$4,'pending',$5,clock_timestamp()+interval '15 minutes') returning *
    `, [input.id, target.id, input.action, JSON.stringify(proposal), actor.id]);
    await recordAudit(client, actor, 'ads.proposed', scope, {id: row.id, action: row.action, amount: proposal.amount, basis: proposal.basis});
    return row;
  });
}

function allocationForLayer(target, proposal, layer) {
  const amount = BigInt(proposal.amount);
  if (proposal.spendMode !== 'daily') return amount;
  if (layer === 'day') return (amount * 7n + 3n) / 4n;
  const daysLeft = BigInt(Math.round((Date.parse(target.ends_on) - Date.parse(proposal.day)) / 86400000) + 1);
  return daysLeft * ((amount * 7n + 3n) / 4n);
}

async function evaluateLimits(client, target, proposal, at) {
  const layers = budgetLayers(target, proposal.day);
  const {rows} = await client.query(`
    select l.layer,l.key,l.cap_vnd,o.spend_vnd,o.observed_at,o.verified,
      coalesce((select sum(r.amount_vnd) from os_v11_ads_reservations r where r.layer=l.layer and r.key=l.key),0) as reserved
    from os_v11_ads_limits l left join os_v11_ads_observations o
      on o.layer=l.layer and o.key=l.key and o.source=$3
    where (l.layer,l.key) in (select * from unnest($1::text[],$2::text[]))
  `, [layers.map(([layer]) => layer), layers.map(([, key]) => key), proposal.basis]);
  const available = new Map(rows.map(row => [layerKey(row.layer, row.key), row]));
  for (const [layer, key] of layers) {
    const row = available.get(layerKey(layer, key));
    requireValue(row, 'LIMIT_MISSING_' + layer, 409);
    const age = at - row.observed_at;
    requireValue(row.verified && age >= 0 && age <= pollMs, 'SPEND_UNVERIFIED_' + layer, 409);
    const proposed = BigInt(row.spend_vnd) + BigInt(row.reserved) + allocationForLayer(target, proposal, layer);
    requireValue(proposed <= BigInt(row.cap_vnd), 'LIMIT_EXCEEDED_' + layer, 409);
  }
  return layers;
}

async function transitionAction(pool, actor, id, operation, revision) {
  requireValue(uuidPattern.test(id ?? '') && Number.isInteger(revision) && revision > 0 &&
    ['approve', 'reject', 'execute'].includes(operation));
  return transaction(pool, async client => {
    const state = await adsLock(client);
    const {rows: [row]} = await client.query('select * from os_v11_ads_actions where id=$1', [id]);
    requireValue(row, 'TARGET_MISSING', 404);
    const target = await targetById(client, row.target_id);
    const scope = adScope(target);
    check(actor, operation === 'execute' ? 'ads.execute' : 'ads.approve', scope);
    if (operation === 'execute') check(actor, actions[row.action], scope);
    if (operation === 'execute' && row.state === 'simulated') return row;
    if (operation === 'approve' && row.state === 'approved' && row.approved_by === actor.id) return row;
    requireValue(row.revision === revision && (operation === 'execute' ? row.state === 'approved' : row.state === 'pending'),
      'STALE_REVISION', 409);
    const {rows: [clock]} = await client.query('select clock_timestamp() as now');
    try {
      let nextState = operation === 'approve' ? 'approved' : operation === 'reject' ? 'rejected' : 'simulated';
      if (clock.now >= row.expires_at) nextState = 'expired';
      let result = null;
      if (nextState === 'approved' || nextState === 'simulated') {
        requireValue(!state.stopped || row.action === 'PAUSE', 'EMERGENCY_STOP', 409);
        let layers = [];
        if (row.proposal.amount > 0) {
          requireValue(dayVN(clock.now) === row.proposal.day, 'BUDGET_DAY_CHANGED', 409);
          layers = await evaluateLimits(client, target, row.proposal, clock.now);
          if (row.proposal.from) {
            await checkDonor(client, actor, target, row.proposal.from, row.proposal.amount, row.proposal.day, row.proposal.basis);
            layers.push(['transfer', row.proposal.from]);
          }
        }
        if (nextState === 'simulated') {
          for (const [layer, key] of layers) await client.query(`
            insert into os_v11_ads_reservations(action_id,layer,key,amount_vnd) values($1,$2,$3,$4)
          `, [id, layer, key, allocationForLayer(target,row.proposal,layer).toString()]);
          result = {mode: 'dry_run', externalRequests: 0, externalSpendVnd: 0, checkedLayers: layers.map(([layer]) => layer)};
        }
      }
      const {rows: [updated]} = await client.query(`
        update os_v11_ads_actions set state=$2,revision=revision+1,result=$3,
          approved_by=case when $2='approved' then $4::uuid else approved_by end where id=$1 returning *
      `, [id, nextState, result === null ? null : JSON.stringify(result), actor.id]);
      await recordAudit(client, actor, 'ads.' + nextState, scope, {id, action: row.action, basis: row.proposal.basis});
      return updated;
    } catch (error) {
      if (error.status !== 409) throw error;
      await recordAudit(client, actor, 'ads.blocked', scope, {id, action: row.action, reason: error.code});
      return {blocked: error.code};
    }
  }).then(result => {
    requireValue(!result.blocked, result.blocked, 409);
    return result;
  });
}

function parseMetaRow(row) {
  function whole(value) {
    if (!/^\d{1,16}(\.0{1,6})?$/.test(value ?? '')) return null;
    const amount = Number(value);
    return vnd(amount) ? amount : null;
  }
  const count = type => whole(row.actions?.find?.(entry => entry.action_type === type)?.value);
  const value = type => whole(row.action_values?.find?.(entry => entry.action_type === type)?.value);
  const spend = whole(row.spend);
  const chats = count('onsite_conversion.messaging_conversation_started_7d');
  const purchases = count('omni_purchase');
  const attributedValue = value('omni_purchase');
  const ratio = (n, d) => n !== null && d !== null && d > 0 ? Math.round(n / d * 100) / 100 : null;
  return {
    spendVnd: spend, impressions: whole(row.impressions), clicks: whole(row.clicks), conversations: chats,
    purchasesReportedByMeta: purchases, purchaseValueReportedByMetaVnd: attributedValue,
    costPerConversationVnd: ratio(spend, chats), costPerMetaPurchaseVnd: ratio(spend, purchases),
    roasReportedByMeta: ratio(attributedValue, spend), paidTicketsLinkedToAds: null,
    ticketAcquisitionVnd: null, verifiedAttributedRevenueVnd: null, ticketConversionRate: null
  };
}

function makeMetaReader(env = process.env, request = fetch) {
  const accounts = new Set((env.EXTRA_OS_V11_META_ACCOUNTS ?? '').split(',').map(id => id.trim()).filter(id => metaId.test(id)));
  const version = env.EXTRA_OS_V11_META_VERSION ?? '';
  const token = env.EXTRA_OS_V11_META_READ_TOKEN;
  const configured = Boolean(token && /^v\d{1,2}\.0$/.test(version) && accounts.size);
  async function get(path, params) {
    const response = await request('https://graph.facebook.com/' + version + '/' + path + '?' + new URLSearchParams(params), {
      method: 'GET', redirect: 'error', headers: {authorization: 'Bearer ' + token, accept: 'application/json'},
      signal: AbortSignal.timeout(7000)
    });
    requireValue(response.ok, 'META_UNAVAILABLE');
    return response.json();
  }
  async function metrics(target, day) {
    requireValue(configured && accounts.has(target.account), 'META_NOT_CONFIGURED');
    const [account, set] = await Promise.all([
      get('act_' + target.account, {fields: 'account_id,currency,timezone_name,account_status'}),
      get(target.ad_set, {fields: 'id,name,account_id,campaign_id,daily_budget,lifetime_budget,effective_status'})
    ]);
    requireValue(account.account_id === target.account && account.currency === 'VND' &&
      account.timezone_name === 'Asia/Ho_Chi_Minh' && set.id === target.ad_set &&
      set.account_id === target.account && set.campaign_id === target.campaign, 'META_SCOPE_UNVERIFIED');
    const fields = 'spend,impressions,clicks,actions,action_values,date_start,date_stop';
    const timeRange = JSON.stringify({since:day, until:day});
    const [aggregate, hourly, creatives] = await Promise.all([
      get(target.ad_set + '/insights', {fields, time_range: timeRange}),
      get(target.ad_set + '/insights', {fields, time_range: timeRange, breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone'}).catch(() => null),
      get(target.ad_set + '/insights', {fields: 'ad_id,ad_name,' + fields, time_range: timeRange, level: 'ad', limit: '100'}).catch(() => null)
    ]);
    requireValue(aggregate?.data?.length === 1 && !aggregate.paging?.next && aggregate.data[0].date_start === day &&
      aggregate.data[0].date_stop === day, 'META_SPEND_UNKNOWN');
    const summary = parseMetaRow(aggregate.data[0]);
    requireValue(summary.spendVnd !== null, 'META_SPEND_UNKNOWN');
    const cohorts = Array.isArray(hourly?.data) && !hourly.paging?.next ? hourly.data.slice(0, 24).flatMap(row => {
      const hour = row.hourly_stats_aggregated_by_advertiser_time_zone;
      return typeof hour === 'string' && /^\d\d:\d\d:\d\d - \d\d:\d\d:\d\d$/.test(hour) ? [{hour, ...parseMetaRow(row)}] : [];
    }) : null;
    const ads = Array.isArray(creatives?.data) && !creatives.paging?.next ? creatives.data.slice(0, 100)
      .filter(row => metaId.test(row.ad_id ?? '')).map(row => ({id:row.ad_id, name:String(row.ad_name ?? '').slice(0,120), ...parseMetaRow(row)})) : null;
    const budget = value => /^\d{1,16}$/.test(value ?? '') && vnd(Number(value)) ? Number(value) : null;
    return {...summary, cohorts, ads, name: String(set.name ?? '').slice(0,120), effectiveStatus: String(set.effective_status ?? '').slice(0,60),
      dailyBudgetVnd: budget(set.daily_budget), lifetimeBudgetVnd: budget(set.lifetime_budget), accountActive: account.account_status === 1};
  }
  return {configured, accounts, metrics};
}

function spendsAsOf(metrics, previous, now, day) {
  const minuteOfDay = (now.getUTCHours() * 60 + now.getUTCMinutes() + 420) % 1440;
  const elapsed = previous ? (now - previous.observed_at) / 60000 : null;
  const delta = previous ? metrics.spendVnd - previous.metrics.spendVnd : null;
  const pace = elapsed >= 5 && elapsed <= 45 && delta >= 0 ? Math.round(delta * 60 / elapsed) : null;
  const forecast = pace === null ? null : Math.round(metrics.spendVnd + (1440 - minuteOfDay) * pace / 60);
  const daily = metrics.dailyBudgetVnd;
  const alerts = [];
  if (forecast !== null && daily !== null && daily > 0 && forecast > daily) alerts.push('PROJECTED_OVER_DAILY_BUDGET');
  if (pace !== null && daily !== null && daily > 0 && pace * 24 > daily * 1.75) alerts.push('UNUSUAL_SPEND_PACE');
  if (daily !== null && daily > 0 && metrics.spendVnd > daily) alerts.push('OVER_DAILY_BUDGET');
  return {...metrics, day, spentPerHourVnd: pace, projectedDailySpendVnd: forecast, alerts, reportingMayBeDelayed: true};
}

async function monitorOnce(pool, reader, now = new Date()) {
  const slot = new Date(Math.floor(now.getTime() / pollMs) * pollMs);
  const {rowCount} = await pool.query(`
    insert into os_v11_ads_ticks(slot,status) values($1,'running')
    on conflict(slot) do update set started_at=clock_timestamp()
    where os_v11_ads_ticks.status='running' and os_v11_ads_ticks.started_at<clock_timestamp()-interval '5 minutes'
  `, [slot]);
  if (!rowCount) return;
  const day = dayVN(now);
  let count = 0;
  let errors = 0;
  let partial = false;
  try {
    if (reader.configured) {
      const {rows} = await pool.query(`
        select ${targetColumns} from os_v11_ads_targets where starts_on<=$1 and ends_on>=$1
          and account=any($2::text[]) order by id limit 21
      `, [day, [...reader.accounts]]);
      partial = rows.length > 20;
      const targets = rows.slice(0, 20);
      for (const target of targets) {
        try {
          const metrics = await reader.metrics(target, day);
          const {rows: [previous]} = await pool.query(`
            select metrics,observed_at from os_v11_ads_metrics where target_id=$1 and day=$2 and observed_at<$3
            order by observed_at desc limit 1
          `, [target.id, day, slot]);
          const calculated = spendsAsOf(metrics, previous, now, day);
          await pool.query(`
            insert into os_v11_ads_metrics(target_id,observed_at,day,source,metrics)
            values($1,$2,$3,'meta',$4) on conflict do nothing
          `, [target.id, slot, day, JSON.stringify(calculated)]);
          count++;
        } catch {
          errors++;
        }
      }
    }
  } catch {
    errors++;
  }
  await pool.query(`
    update os_v11_ads_ticks set completed_at=clock_timestamp(),status=$2,details=$3 where slot=$1
  `, [slot, errors ? 'error' : count ? 'available' : 'missing', JSON.stringify({updated: count, errors, partial, configured: reader.configured})]);
}

function monitorAds(pool, env = process.env) {
  const reader = makeMetaReader(env);
  let pending;
  const run = () => {
    if (!pending) pending = monitorOnce(pool, reader).catch(() => console.error('EXTRA OS Ads monitor unavailable')).finally(() => {pending = null;});
  };
  run();
  const timer = setInterval(run, pollMs).unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}

async function adsView(pool, actor, platform) {
  const {rows} = await pool.query(`
    select t.${targetColumns.split(',').join(',t.')},m.metrics,m.observed_at
    from os_v11_ads_targets t left join lateral (
      select metrics,observed_at from os_v11_ads_metrics where target_id=t.id order by observed_at desc limit 1
    ) m on true where t.platform=$1 order by t.starts_on desc,t.id limit 300
  `, [platform]);
  const targets = rows.filter(target => allowed(actor, 'ads.read', adScope(target)));
  requireValue(targets.length || allowed(actor, 'ads.read', {platform, dataGroup:'advertising'}), 'FORBIDDEN', 403);
  const requests = await pool.query(`
    select id,target_id,action,proposal,case when state in ('pending','approved') and expires_at<=now() then 'expired' else state end as state,
      expires_at,revision,result from os_v11_ads_actions where target_id=any($1::uuid[]) order by created_at desc limit 150
  `, [targets.map(target => target.id)]);
  const {rows: [state]} = await pool.query('select stopped,revision from os_v11_ads_switch where singleton');
  return {targets, requests: requests.rows, state};
}

module.exports = {
  pollMs, actions, adScope, budgetLayers, allocationForLayer, configureTarget, setBudget, fixtureSpend, setStop, requestAction, transitionAction,
  parseMetaRow, makeMetaReader, monitorOnce, monitorAds, adsView
};

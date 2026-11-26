'use strict';

const {randomUUID} = require('node:crypto');
const {check} = require('./v11-auth.cjs');
const {keyPattern, uuidPattern, validDay, dayVN, vnd, requireValue, transaction, recordAudit} = require('./v11-core.cjs');
const {readNumber, cleanText} = require('./v11-costs.cjs');
const {cameraId, cameraScope} = require('./v11-imou.cjs');

const retailFields = {
  netRevenueVnd: 'Doanh thu thuần', orders: 'Hóa đơn', customers: 'Khách phục vụ', cogsVnd: 'Giá vốn',
  laborVnd: 'Chi phí lao động', otherCostVnd: 'Chi phí vận hành còn lại', headcount: 'Nhân sự',
  returningCustomers: 'Khách quay lại', seatMinutesUsed: 'Phút ghế sử dụng', seatMinutesAvailable: 'Phút ghế khả dụng',
  waitSecondsTotal: 'Tổng giây chờ', waitSamples: 'Lượt đo chờ', shrinkageVnd: 'Hao hụt nguyên liệu',
  cashFlowVnd: 'Tiền vào đã đối soát', payableVnd: 'Công nợ phải trả'
};
const cameraFields = {
  passers: 'Lượt người qua vỉa hè', peakPeople: 'Mật độ cao nhất', crowdMinutes: 'Số phút tập trung',
  confidenceBps: 'Độ tin cậy (phần vạn)'
};

function opsScope(location, dataGroup = 'operations') {
  requireValue(keyPattern.test(location ?? ''));
  return {platform:'24h', location, dataGroup};
}

function readFields(form, definitions) {
  return Object.fromEntries(Object.keys(definitions).map(key => [key, readNumber(form.get(key))]));
}

async function saveRetailObservation(pool, actor, location, day, hour, form) {
  const scope = opsScope(location);
  check(actor, 'operations.write', scope);
  requireValue(validDay(day) && day <= dayVN() && Number.isInteger(hour) && hour >= -1 && hour <= 23);
  const fields = readFields(form, retailFields);
  const source = cleanText(form.get('source'), 180, true);
  requireValue(Object.values(fields).some(value => value !== null) &&
    (fields.returningCustomers === null || fields.customers === null || fields.returningCustomers <= fields.customers) &&
    (fields.seatMinutesUsed === null || fields.seatMinutesAvailable === null || fields.seatMinutesUsed <= fields.seatMinutesAvailable));
  const revision = Number(form.get('revision') ?? 0);
  requireValue(Number.isInteger(revision) && revision >= 0);
  return transaction(pool, async client => {
    const {rows: [row]} = await client.query(`
      select revision from os_v11_operations where location=$1 and day=$2 and hour=$3 for update
    `, [location, day, hour]);
    requireValue((row?.revision ?? 0) === revision, 'STALE_REVISION', 409);
    const {rowCount} = row ? await client.query(`
      update os_v11_operations set fields=$4,source=$5,revision=revision+1,updated_at=clock_timestamp()
      where location=$1 and day=$2 and hour=$3
    `, [location, day, hour, JSON.stringify(fields), source]) : await client.query(`
      insert into os_v11_operations(location,day,hour,fields,source) values($1,$2,$3,$4,$5) on conflict do nothing
    `, [location, day, hour, JSON.stringify(fields), source]);
    requireValue(rowCount === 1, 'STALE_REVISION', 409);
    await recordAudit(client, actor, 'operations.observation.saved', scope, {day, hour, revision:revision+1});
  });
}

async function saveCounts(pool, actor, day, hour, form) {
  check(actor, 'operations.write', {platform:'24h', location:'sidewalk', dataGroup:'operations'});
  requireValue(validDay(day) && day <= dayVN() && Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const fields = readFields(form, cameraFields);
  const source = cleanText(form.get('source'), 180, true);
  const revision = Number(form.get('revision') ?? 0);
  requireValue(Object.values(fields).some(value => value !== null) && (fields.confidenceBps ?? 0) <= 10000 &&
    (fields.crowdMinutes ?? 0) <= 60 && Number.isInteger(revision) && revision >= 0);
  return transaction(pool, async client => {
    await client.query('select pg_advisory_xact_lock(71501213)');
    const {rows: [row]} = await client.query('select revision from os_v11_camera_counts where camera=$1 and day=$2 and hour=$3',
      [cameraId, day, hour]);
    requireValue((row?.revision ?? 0) === revision, 'STALE_REVISION', 409);
    await client.query(`
      insert into os_v11_camera_counts(camera,day,hour,fields,source) values($1,$2,$3,$4,$5)
      on conflict(camera,day,hour) do update set fields=excluded.fields,source=excluded.source,revision=os_v11_camera_counts.revision+1,
      updated_at=clock_timestamp()
    `, [cameraId, day, hour, JSON.stringify(fields), source]);
    await recordAudit(client, actor, 'operations.camera_counts.saved', cameraScope, {day, hour, revision:revision+1});
    await checkCrowdRule(client, day, hour, fields, source);
  });
}

async function checkCrowdRule(client, day, hour, fields, source) {
  const {rows:[rule]} = await client.query('select settings from os_v11_crowd_rules where camera=$1', [cameraId]);
  if (!rule) return;
  const s = rule.settings;
  if (hour < s.from || hour >= s.to || s.exceptions.includes(hour) || fields.peakPeople == null ||
    fields.crowdMinutes == null || fields.confidenceBps == null || fields.peakPeople < s.people || fields.crowdMinutes < s.minutes) return;
  const at = new Date(day + 'T' + String(hour).padStart(2, '0') + ':00:00+07:00');
  const {rowCount} = await client.query(`
    insert into os_v11_operational_alerts(id,camera,detected_at,details)
    select $1,$2,$3,$4 where not exists(select 1 from os_v11_operational_alerts where camera=$2
      and detected_at between $3::timestamptz-$5::integer*interval '1 minute' and $3::timestamptz+$5::integer*interval '1 minute')
    on conflict do nothing
  `, [randomUUID(), cameraId, at, JSON.stringify({people:fields.peakPeople, minutes:fields.crowdMinutes,
    confidenceBps:fields.confidenceBps, zone:'sidewalk', source}), s.cooldown]);
  if (rowCount) await recordAudit(client, null, 'operations.crowd.alerted', cameraScope, {observedHour:at.toISOString()});
}

async function saveCrowdRule(pool, actor, settings, revision) {
  check(actor, 'operations.approve', {platform:'24h', location:'sidewalk', dataGroup:'operations'});
  const {people, minutes, from, to, cooldown, exceptions} = settings;
  requireValue([people,minutes,from,to,cooldown,revision].every(Number.isInteger) &&
    people >= 1 && people <= 10000 && minutes >= 1 && minutes <= 60 && from >= 0 && to <= 24 && from < to &&
    cooldown >= 1 && cooldown <= 1440 && exceptions.every(hour => Number.isInteger(hour) && hour >= 0 && hour < 24));
  return transaction(pool, async client => {
    await client.query('select pg_advisory_xact_lock(71501213)');
    const {rowCount} = await client.query(`
      insert into os_v11_crowd_rules(camera,settings) select $1,$2 where $3::int=0 or
      exists(select 1 from os_v11_crowd_rules where camera=$1 and revision=$3)
      on conflict(camera) do update set settings=excluded.settings,revision=os_v11_crowd_rules.revision+1
      where os_v11_crowd_rules.revision=$3
    `, [cameraId, JSON.stringify(settings), revision]);
    requireValue(rowCount === 1, 'STALE_REVISION', 409);
    await recordAudit(client, actor, 'operations.crowd.rule_updated', cameraScope);
  });
}

async function reviewAlert(pool, actor, id) {
  check(actor, 'operations.approve', {platform:'24h',location:'sidewalk',dataGroup:'operations'});
  requireValue(uuidPattern.test(id ?? ''));
  return transaction(pool, async client => {
    const {rowCount} = await client.query(`
      update os_v11_operational_alerts set reviewed_at=clock_timestamp(),reviewed_by=$2
      where id=$1 and camera=$3 and reviewed_at is null
    `, [id, actor.id, cameraId]);
    if (rowCount) await recordAudit(client, actor, 'operations.crowd.reviewed', cameraScope, {id});
  });
}

async function saveShift(pool, actor, location, form) {
  const scope = opsScope(location, 'attendance');
  check(actor, 'operations.write', scope);
  const id = form.get('id') || randomUUID();
  const staffId = form.get('staff');
  const revision = Number(form.get('revision') || 0);
  const confirmed = form.get('state') === 'confirmed';
  const parseTime = key => {
    const value = form.get(key);
    if (!value) return null;
    requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) && validDay(value.slice(0,10)) && +value.slice(11,13) <= 23 &&
      +value.slice(14,16) <= 59, 'INVALID_SHIFT_TIME');
    return new Date(value + ':00+07:00');
  };
  const start = parseTime('starts'), end = parseTime('ends'), arrived = parseTime('arrived'), left = parseTime('left');
  const note = cleanText(form.get('note'), 250);
  requireValue(uuidPattern.test(id) && uuidPattern.test(staffId ?? '') && Number.isInteger(revision) && revision >= 0 &&
    start && end > start && end - start <= 36 * 3600000 && (!left || (arrived && left > arrived)) && (!confirmed || (arrived && left)));
  return transaction(pool, async client => {
    const {rows:[prior]} = await client.query('select staff_id,state,revision from os_v11_staff_shifts where id=$1 and location=$2 for update', [id, location]);
    requireValue((prior?.revision ?? 0) === revision && (!prior || prior.staff_id === staffId), 'STALE_REVISION', 409);
    if (confirmed || prior?.state === 'confirmed') check(actor, 'operations.approve', scope);
    if (prior?.state === 'confirmed') requireValue(note, 'CORRECTION_REASON_REQUIRED');
    if (!prior) requireValue((await client.query("select 1 from os_v11_users where id=$1 and active and role not in ('AI_DIRECTOR','AI_AGENT','AI_AUDITOR')", [staffId])).rowCount,
      'STAFF_MISSING');
    const values = [id, location, staffId, start, end, arrived, left, confirmed ? 'confirmed' : 'pending', note];
    const {rowCount} = prior ? await client.query(`
      update os_v11_staff_shifts set starts_at=$4,ends_at=$5,arrived_at=$6,left_at=$7,state=$8,note=$9,revision=revision+1
      where id=$1 and location=$2 and staff_id=$3
    `, values) : await client.query(`
      insert into os_v11_staff_shifts(id,location,staff_id,starts_at,ends_at,arrived_at,left_at,state,note)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing
    `, values);
    requireValue(rowCount === 1, 'STALE_REVISION', 409);
    await recordAudit(client, actor, 'operations.shift.saved', scope, {id, revision:revision+1, confirmed,
      prior:prior ? {state:prior.state, revision:prior.revision} : null});
  });
}


const total = (rows, key, complete) => {
  if (!complete || !rows.length || rows.some(row => row.fields[key] == null)) return null;
  const sum = rows.reduce((n,row) => n+row.fields[key],0);
  return vnd(sum) ? sum : null;
};

function retailSummary(rows, complete) {
  const sums = Object.fromEntries(Object.keys(retailFields).filter(key => !['headcount','payableVnd'].includes(key))
    .map(key => [key, total(rows, key, complete)]));
  const {netRevenueVnd:revenue, cogsVnd:cogs, laborVnd:labor, otherCostVnd:other, orders, customers,
    seatMinutesUsed:used, seatMinutesAvailable:capacity, waitSecondsTotal:wait, waitSamples:samples} = sums;
  const ratio = (n,d) => n !== null && d !== null && d > 0 ? n/d : null;
  const profit = [revenue,cogs,labor,other].every(value => value !== null) ? revenue-cogs-labor-other : null;
  const contributionRate = revenue !== null && cogs !== null && revenue > cogs ? (revenue-cogs)/revenue : null;
  return {...sums, profitVnd:profit, avgOrderVnd:ratio(revenue,orders), avgWaitSeconds:ratio(wait,samples),
    utilization:ratio(used,capacity), ordersPerCustomer:ratio(orders,customers),
    breakEvenRevenueVnd:contributionRate !== null && labor !== null && other !== null ? Math.ceil((labor+other)/contributionRate) : null};
}

function bounds(day, period) {
  requireValue(validDay(day) && ['day','week','month'].includes(period));
  const start = period === 'month' ? day.slice(0,7)+'-01' : day;
  const end = period === 'week' ? new Date(Date.parse(start+'T00:00:00Z')+6*86400000).toISOString().slice(0,10) :
    period === 'month' ? new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10) : day;
  return {start,end,expected:Math.round((Date.parse(end)-Date.parse(start))/86400000)+1};
}

function previousDays(day,count) {
  return Array.from({length:count},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')-(i+1)*86400000).toISOString().slice(0,10));
}

async function historicalDemand(pool, location, day) {
  const days=previousDays(day,7);
  const {rows} = await pool.query(`
    select day::text, fields from os_v11_operations
    where location=$1 and day=any($2::date[]) and hour=-1 order by day
  `,[location,days]);
  const orders=rows.map(row=>row.fields.orders);
  const customers=rows.map(row=>row.fields.customers);
  if(rows.length!==7 || !orders.every(vnd) || !customers.every(vnd))return null;
  const mean=values=>Math.round(values.reduce((n,value)=>n+value,0)/values.length);
  return {from:rows[0].day,to:rows.at(-1).day,scenarios:[
    {label:'Thận trọng',orders:Math.min(...orders),customers:Math.min(...customers)},
    {label:'Cơ sở',orders:mean(orders),customers:mean(customers)},
    {label:'Tích cực',orders:Math.max(...orders),customers:Math.max(...customers)}
  ]};
}

async function readOperations(pool, location, day, period = 'day') {
  opsScope(location);
  const range = bounds(day, period);
  const {rows} = await pool.query(`
    select day::text,hour,fields,source,revision,updated_at from os_v11_operations
    where location=$1 and day between $2 and $3 order by day,hour
  `, [location,range.start,range.end]);
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.day)) days.set(row.day, []);
    days.get(row.day).push(row);
  }
  const proven = [...days.values()].flatMap(coverage => {
    const daily = coverage.find(item => item.hour === -1);
    return daily ? [daily] : coverage.length === 24 ? coverage : [];
  });
  const complete = days.size === range.expected && [...days.values()].every(items => items.some(row => row.hour === -1) || items.length === 24);
  const summary = retailSummary(proven, complete);
  const hourly = rows.filter(row => row.hour >= 0).map(row => ({
    ...row, stats:retailSummary([row],true),
    ordersPerStaff:row.fields.orders !== null && row.fields.headcount > 0 ? row.fields.orders/row.fields.headcount : null
  }));
  const forecast = await historicalDemand(pool,location,range.start);
  const staffing = hourly.flatMap(row=>{
    if(row.ordersPerStaff===null || row.stats.avgWaitSeconds===null)return [];
    const samples=hourly.filter(other=>other.hour===row.hour&&other.day!==row.day&&
      other.ordersPerStaff!==null&&other.stats.avgWaitSeconds!==null);
    if(samples.length<3)return [];
    const middle=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const typicalLoad=middle(samples.map(sample=>sample.ordersPerStaff));
    const typicalWait=middle(samples.map(sample=>sample.stats.avgWaitSeconds));
    const congested=typicalLoad>0&&typicalWait>0&&row.ordersPerStaff>typicalLoad*1.2&&row.stats.avgWaitSeconds>typicalWait*1.2;
    const underused=typicalLoad>0&&typicalWait>0&&row.ordersPerStaff<typicalLoad*0.8&&row.stats.avgWaitSeconds<typicalWait*0.8;
    return congested||underused ? [{day:row.day,hour:row.hour,samples:samples.length,typicalLoad,typicalWait,
      recommendation:congested?'Cân nhắc tăng nhân sự phục vụ':'Xem lại bố trí ca và chuyển nhân sự sang khung đông hơn'}] : [];
  });
  const observedHours = hourly.filter(row => row.fields.customers !== null);
  const max = observedHours.length ? Math.max(...observedHours.map(row => row.fields.customers)) : null;
  const peakHours = max === null ? [] : observedHours.filter(row => row.fields.customers === max).slice(0,10).map(row => ({day:row.day,hour:row.hour}));
  return {range, rows, hourly, summary, complete, peakHours, missingPeriods:Math.max(0,range.expected-days.size),
    source:'EXTRA OS · Đối soát 24H', location, forecast, staffing};
}

async function readCounts(pool, day, end) {
  const {rows} = await pool.query(`
    select day::text,hour,fields,source,revision,updated_at from os_v11_camera_counts
    where camera=$1 and day between $2 and $3 order by day,hour
  `, [cameraId, day, end]);
  return rows;
}

function musicAssessment(show, finance, costs, now) {
  const record = finance?.data?.rows.find(row => row.showId === show.id);
  const current = dayVN(now);
  const paid = record?.total.paidTickets ?? null;
  const revenue = record?.total.revenueVnd ?? null;
  const expense = costs?.totals.actual.expense.total ?? null;
  const deductions = costs?.totals.actual.revenueDeduction.total ?? null;
  const approved = costs?.totals.approved.expense.total ?? null;
  const approvedDeductions = costs?.totals.approved.revenueDeduction.total ?? null;
  const remaining = show.inventory?.sellable ?? null;
  const starts = Date.parse(show.date+'T'+show.time+':00+07:00');
  const hours = Number.isFinite(starts) ? Math.max(0,(starts-now)/3600000) : null;
  const dates = [1,2,3].map(offset => dayVN(new Date(now-offset*86400000)));
  const historical = dates.map(date => record?.days[date] ?? null);
  const price = historical.every(Boolean) && historical.every(day => day.paidTickets > 0) ?
    Math.floor(historical.reduce((sum,day) => sum+day.revenueVnd,0)/historical.reduce((sum,day) => sum+day.paidTickets,0)) : null;
  const remainingToBreakEven = approved !== null && approvedDeductions !== null && revenue !== null ?
    Math.max(0,approved+approvedDeductions-revenue) : null;
  const additionalAtBreakEven = remainingToBreakEven === 0 ? 0 : remainingToBreakEven !== null && price > 0 ?
    Math.ceil(remainingToBreakEven/price) : null;
  const minimumCapacity = additionalAtBreakEven !== null && paid !== null && show.inventory?.capacity > 0 ?
    (paid+additionalAtBreakEven)/show.inventory.capacity : null;
  const scenarios = (remaining !== null && hours > 0 && price > 0 && remainingToBreakEven !== null &&
    historical.every(Boolean) && costs?.costs?.every(row => row.status === 'rejected' || row.details.booking !== 'expense' ||
    row.details.behavior === 'fixed')) ? [
    ['Thận trọng',Math.min(...historical.map(day=>day.paidTickets))],
    ['Cơ sở',historical.reduce((sum,day)=>sum+day.paidTickets,0)/historical.length],
    ['Tích cực',Math.max(...historical.map(day=>day.paidTickets))]
  ].map(([label, rate]) => {
    const extra = Math.min(remaining,Math.floor(rate*hours/24));
    const projected = revenue+extra*price;
    return {label, rate, extra, revenue:projected, profit:projected-approved-approvedDeductions};
  }) : [];
  return {paid,revenue,expense,deductions,profit:revenue !== null && expense !== null && deductions !== null ?
    revenue-expense-deductions : null,approved,price,remaining,hours,current,additionalAtBreakEven,minimumCapacity,scenarios,
    costPerPaidCustomer:expense !== null && paid > 0 ? expense/paid : null,
    constrained:remaining !== null && additionalAtBreakEven !== null && remaining < additionalAtBreakEven};
}

module.exports = {retailFields, cameraFields, opsScope, readFields, saveRetailObservation, saveCounts, saveCrowdRule, reviewAlert,
  saveShift, retailSummary, bounds, previousDays, readOperations, readCounts, musicAssessment};

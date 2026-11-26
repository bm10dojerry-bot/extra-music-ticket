'use strict';

const {randomUUID} = require('node:crypto');
const {check, allowed} = require('./v11-auth.cjs');
const {dayVN, keyPattern, uuidPattern, vnd, validDay, requireValue, transaction, recordAudit} = require('./v11-core.cjs');

const taxonomy = {
  music: {
    'Nghệ sĩ': 'Cát-xê ca sĩ chính|Ca sĩ khách mời|MC|Vũ đoàn|Quản lý nghệ sĩ|Vé máy bay|Xe đưa đón|Khách sạn|Ăn uống|Phát sinh theo hợp đồng',
    'Thuê ngoài sản xuất': 'Âm thanh|Ánh sáng|Ban nhạc|Nhạc công|Kỹ thuật viên|Màn hình LED|Sân khấu|Thiết bị biểu diễn|Máy phát điện|Vận chuyển thiết bị|Bốc xếp|Lắp đặt|Tháo dỡ|Thuê kho|Bảo quản thiết bị',
    'Địa điểm và cơ sở vật chất': 'Thuê địa điểm|Thuê bàn ghế|Mái che|Decor|Hoa trang trí|Điện|Nước|Vệ sinh|Bãi đỗ xe|Khấu hao tài sản|Bảo trì|Sửa chữa',
    'Marketing': 'Facebook Ads|TikTok Ads|Google Ads|KOL/KOC|Thiết kế|Poster|Sản xuất video|Quay phim|Chụp ảnh|In ấn|Truyền thông|Phần mềm|Máy chủ|API|Chi phí AI',
    'Nhân sự': 'Điều phối|Sale|CSKH|Check-in|Bảo vệ|Phục vụ|Media|Kỹ thuật|Làm thêm giờ|Ăn uống nhân viên|Chi phí đi lại|Hoa hồng|Thưởng',
    'Pháp lý và vận hành': 'Giấy phép biểu diễn|Bản quyền âm nhạc|PCCC|Y tế|An ninh trật tự|Bảo hiểm|Phí thanh toán|Thuế|Hoàn vé|Hủy show|Đổi lịch|Khách mời|Quà tặng|Tiếp khách|Hư hỏng tài sản|Hành chính|Kế toán|Lãi vay|Chi phí dùng chung phân bổ|Dự phòng phát sinh'
  },
  '24h': {
    'Mặt bằng và tài sản': 'Thuê mặt bằng|Khấu hao xây dựng|Khấu hao nội thất|Khấu hao thiết bị|Kho hàng|Bảo trì|Sửa chữa',
    'Nguyên vật liệu': 'Cà phê|Trà|Sữa|Hoa quả|Thực phẩm|Đồ uống đóng chai|Đá|Bao bì|Vật tư tiêu hao|Hao hụt nguyên liệu',
    'Nhân sự': 'Lương quản lý|Lương pha chế|Lương phục vụ|Lương thu ngân|Bảo vệ|Vệ sinh|Làm thêm giờ|Bảo hiểm|Thưởng',
    'Vận hành': 'Điện|Nước|Internet|Gas|Vận chuyển|Phần mềm bán hàng|Phí thanh toán|Thuế|Lãi vay|Quản lý|Chi phí dùng chung|Dự phòng',
    'Marketing': 'Quảng cáo|Khuyến mại|Chiết khấu',
    'Camera': 'Chi phí camera|Chi phí AI Camera'
  }
};
const bases = ['planned', 'approved', 'actual'];
const bookingTypes = ['expense', 'revenue_deduction', 'cash_only', 'shared_pool'];
const classifications = {
  behavior: ['fixed', 'variable'],
  relation: ['direct', 'indirect', 'allocated'],
  taxTreatment: ['included', 'excluded'],
  booking: bookingTypes
};
const amounts = bases.flatMap(basis => [basis + 'Vnd', basis + 'TaxVnd'])
  .concat(['unitPriceVnd', 'contractVnd', 'depositVnd', 'paidVnd']);

function costScope(platform, scopeKey) {
  requireValue(Object.hasOwn(taxonomy, platform) &&
    (scopeKey === 'shared' || (platform === 'music' ? keyPattern.test(scopeKey ?? '') : validDay(scopeKey))));
  return {platform, ...(platform === 'music' && scopeKey !== 'shared' ? {show: scopeKey} : {}), dataGroup: 'finance'};
}

function readNumber(value) {
  if (value === '' || value == null) return null;
  requireValue(/^\d{1,16}$/.test(value) && vnd(Number(value)));
  return Number(value);
}

function cleanText(raw, limit, required = false) {
  const value = (raw ?? '').trim().normalize('NFC');
  requireValue(value.length <= limit && (!required || value.length > 0) && !/[\u0000-\u001f]/.test(value));
  return value || null;
}

function parseCost(form) {
  const details = Object.fromEntries(amounts.map(key => [key, readNumber(form.get(key))]));
  Object.assign(details, Object.fromEntries(['source', 'unit', 'owner', 'contractDoc', 'invoice', 'evidence']
    .map(key => [key, cleanText(form.get(key), key.endsWith('Doc') || ['invoice', 'evidence'].includes(key) ? 300 : 160, key === 'source')])));
  for (const [key, values] of Object.entries(classifications)) {
    const value = form.get(key);
    requireValue(values.includes(value));
    details[key] = value;
  }
  const amount = form.get('quantity')?.trim() ?? '';
  requireValue(!amount || /^\d{1,9}(\.\d{1,3})?$/.test(amount));
  details.quantity = amount || null;
  const due = form.get('due') || null;
  requireValue(due === null || validDay(due));
  details.due = due;
  requireValue(!(details.depositVnd !== null && details.paidVnd !== null && details.depositVnd > details.paidVnd), 'DEPOSIT_EXCEEDS_PAID');
  requireValue(!(details.paidVnd !== null && details.contractVnd !== null && details.paidVnd > details.contractVnd), 'PAID_EXCEEDS_CONTRACT');
  details.remainingVnd = details.paidVnd !== null && details.contractVnd !== null ? details.contractVnd - details.paidVnd : null;
  for (const basis of bases) {
    if (details[basis + 'Vnd'] !== null && details[basis + 'TaxVnd'] !== null) {
      const net = details[basis + 'Vnd'];
      const tax = details[basis + 'TaxVnd'];
      requireValue(details.taxTreatment === 'included' ? tax <= net : vnd(net + tax), 'INVALID_TAX');
    }
  }
  return details;
}

function bookedAmount(details, basis) {
  const amount = details[basis + 'Vnd'], tax = details[basis + 'TaxVnd'];
  if (amount == null || (details.taxTreatment === 'excluded' && tax == null)) return null;
  return details.taxTreatment === 'included' ? amount : amount + tax;
}

function summarizeCosts(rows, attested = []) {
  return Object.fromEntries(bases.map(basis => {
    const eligible = rows.filter(row => row.status !== 'rejected' && ['expense', 'revenue_deduction'].includes(row.details.booking));
    const total = mode => {
      const values = eligible.filter(row => row.details.booking === mode).map(row =>
        basis === 'approved' && row.status !== 'approved' ? null : bookedAmount(row.details, basis));
      const known = values.filter(value => value !== null).reduce((sum, value) => sum + value, 0);
      const missing = values.length - values.filter(value => value !== null).length;
      return {known, missing, total: attested.includes(basis) && missing === 0 && vnd(known) ? known : null};
    };
    return [basis, {expense: total('expense'), revenueDeduction: total('revenue_deduction')}];
  }));
}

async function seedCategories(pool) {
  const rows = Object.entries(taxonomy).flatMap(([platform, groups]) =>
    Object.entries(groups).flatMap(([group, types]) => types.split('|').map(type => ({platform, category: group, cost_type: type}))));
  await pool.query(`
    insert into os_v11_categories(platform,category,cost_type)
    select platform,category,cost_type from jsonb_to_recordset($1) as options(platform text,category text,cost_type text)
    on conflict do nothing
  `, [JSON.stringify(rows)]);
}

async function saveCategory(pool, actor, platform, category, type) {
  const scope = costScope(platform, 'shared');
  check(actor, 'cost.write', scope);
  await transaction(pool, async client => {
    const {rowCount} = await client.query('insert into os_v11_categories values($1,$2,$3) on conflict do nothing',
      [platform, cleanText(category, 120, true), cleanText(type, 120, true)]);
    if (rowCount) await recordAudit(client, actor, 'cost.category.added', scope);
  });
}

async function saveSupplier(pool, actor, platform, name) {
  const scope = costScope(platform, 'shared');
  check(actor, 'cost.write', scope);
  await transaction(pool, async client => {
    const {rowCount} = await client.query('insert into os_v11_suppliers(id,name,platform) values($1,$2,$3) on conflict do nothing',
      [randomUUID(), cleanText(name, 120, true), platform]);
    if (rowCount) await recordAudit(client, actor, 'cost.supplier.added', scope);
  });
}

async function saveQuote(pool, actor, platform, form) {
  const scope = costScope(platform, 'shared');
  check(actor, 'cost.write', scope);
  const supplier = form.get('supplier');
  const [category, type] = readCategory(form);
  const day = form.get('asOf');
  const price = readNumber(form.get('unitPriceVnd'));
  requireValue(uuidPattern.test(supplier ?? '') && validDay(day) && day <= dayVN() && price !== null);
  await transaction(pool, async client => {
    await verifyLookups(client, platform, supplier, category, type);
    const {rowCount} = await client.query(`
      insert into os_v11_supplier_quotes(id,supplier_id,category,cost_type,unit,unit_price_vnd,source,as_of)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing
    `, [randomUUID(), supplier, category, type, cleanText(form.get('unit'), 160, true), price, cleanText(form.get('source'), 160, true), day]);
    requireValue(rowCount === 1, 'DUPLICATE', 409);
    await recordAudit(client, actor, 'cost.quote.added', scope, {supplier});
  });
}

function readCategory(form) {
  const [category, type, ...unexpected] = (form.get('classification') ?? '').split(' / ');
  requireValue(!unexpected.length);
  return [cleanText(category, 120, true), cleanText(type, 120, true)];
}

async function verifyLookups(client, platform, supplier, category, type) {
  requireValue((await client.query('select 1 from os_v11_categories where platform=$1 and category=$2 and cost_type=$3',
    [platform, category, type])).rowCount === 1, 'CATEGORY_MISSING');
  if (supplier) requireValue((await client.query('select 1 from os_v11_suppliers where platform=$1 and id=$2',
    [platform, supplier])).rowCount === 1, 'SUPPLIER_MISSING');
}

async function lockLedger(client, platform) {
  await client.query('select pg_advisory_xact_lock(71501212,hashtext($1))', [platform]);
}

async function checkAllocations(client, parentId, parentDetails) {
  const {rows} = await client.query(`
    select details from os_v11_costs where allocation_of=$1 and status<>'rejected'
  `, [parentId]);
  for (const basis of bases) {
    const values = rows.map(row => bookedAmount(row.details, basis)).filter(value => value !== null);
    if (!values.length) continue;
    const parent = bookedAmount(parentDetails, basis);
    requireValue(parent !== null && values.reduce((sum, value) => sum + value, 0) <= parent, 'ALLOCATION_EXCEEDS_SOURCE', 409);
  }
}

async function saveCost(pool, actor, platform, scopeKey, form) {
  const scope = costScope(platform, scopeKey);
  check(actor, 'cost.write', scope);
  const details = parseCost(form);
  const [category, type] = readCategory(form);
  const id = form.get('id') || randomUUID();
  const code = (form.get('code') ?? '').trim();
  const sourceLine = cleanText(form.get('sourceLine'), 160, true).toUpperCase();
  const supplier = form.get('supplier') || null;
  const reference = form.get('quote') || null;
  const allocation = form.get('allocation') || null;
  const expected = Number(form.get('revision') || 0);
  requireValue(uuidPattern.test(id) && keyPattern.test(code) && [supplier, reference, allocation].every(value => !value || uuidPattern.test(value)) &&
    Number.isInteger(expected) && expected >= 0);
  requireValue((details.booking === 'shared_pool') === (scopeKey === 'shared') &&
    Boolean(allocation) === (details.relation === 'allocated') && (!allocation || details.booking === 'expense'));
  return transaction(pool, async client => {
    await lockLedger(client, platform);
    await verifyLookups(client, platform, supplier, category, type);
    if (reference) {
      const {rows: [quote]} = await client.query(`
        select q.id,q.unit,q.unit_price_vnd,q.as_of,q.source from os_v11_supplier_quotes q
        where q.id=$1 and q.supplier_id=$2 and category=$3 and cost_type=$4
      `, [reference, supplier, category, type]);
      requireValue(quote, 'QUOTE_MISSING');
      details.unitPriceBasis = details.unitPriceVnd === null ? 'reference' : 'declared';
      if (details.unitPriceBasis === 'reference') details.unitPriceVnd = Number(quote.unit_price_vnd);
      details.referenceQuote = {id: quote.id, unit: quote.unit, unitPriceVnd: Number(quote.unit_price_vnd), asOf: quote.as_of, source: quote.source};
    }
    const {rows: [prior]} = await client.query('select * from os_v11_costs where id=$1', [id]);
    requireValue(prior ? prior.platform === platform && prior.scope_key === scopeKey && prior.revision === expected &&
      prior.source_line === sourceLine && prior.allocation_of === allocation : expected === 0, 'STALE_REVISION', 409);
    let parent;
    if (allocation) {
      ({rows: [parent]} = await client.query(`
        select id,details from os_v11_costs where id=$1 and platform=$2 and scope_key='shared' and status='approved'
      `, [allocation, platform]));
      requireValue(parent, 'ALLOCATION_SOURCE_MISSING');
    }
    const status = form.get('status') || 'pending';
    requireValue(['pending', 'approved', 'rejected'].includes(status));
    if (status !== 'pending' || (prior && prior.status !== 'pending')) check(actor, 'cost.approve', scope);
    const {rows: [row]} = await client.query(`
      insert into os_v11_costs(id,platform,scope_key,code,source_line,category,cost_type,supplier_id,details,status,allocation_of)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict(id) do update set code=excluded.code,category=excluded.category,cost_type=excluded.cost_type,
        supplier_id=excluded.supplier_id,details=excluded.details,status=excluded.status,
        revision=os_v11_costs.revision+1,updated_at=clock_timestamp()
      returning *
    `, [id, platform, scopeKey, code, sourceLine, category, type, supplier, JSON.stringify(details), status, allocation]);
    if (parent) await checkAllocations(client, parent.id, parent.details);
    if (details.booking === 'shared_pool') {
      if (status !== 'approved') requireValue(!(await client.query(
        "select 1 from os_v11_costs where allocation_of=$1 and status<>'rejected' limit 1", [id])).rowCount,
      'ALLOCATION_SOURCE_IN_USE', 409);
      await checkAllocations(client, id, details);
    }
    await client.query('insert into os_v11_cost_history(cost_id,revision,actor_id,snapshot) values($1,$2,$3,$4)',
      [id, row.revision, actor.id, JSON.stringify(row)]);
    await client.query('delete from os_v11_cost_coverage where platform=$1 and scope_key=$2', [platform, scopeKey]);
    await recordAudit(client, actor, 'cost.saved', scope, {id, status, revision: row.revision, scopeKey});
    return id;
  }).catch(error => {
    requireValue(error.code !== '23505', 'DUPLICATE', 409);
    throw error;
  });
}

async function attestCosts(pool, actor, platform, scopeKey, basis, source) {
  const scope = costScope(platform, scopeKey);
  check(actor, 'cost.approve', scope);
  requireValue(bases.includes(basis) && scopeKey !== 'shared');
  await transaction(pool, async client => {
    await lockLedger(client, platform);
    await client.query(`
      insert into os_v11_cost_coverage(platform,scope_key,basis,source,actor_id) values($1,$2,$3,$4,$5)
      on conflict(platform,scope_key,basis) do update set source=excluded.source,actor_id=excluded.actor_id,attested_at=clock_timestamp()
    `, [platform, scopeKey, basis, cleanText(source, 160, true), actor.id]);
    await recordAudit(client, actor, 'cost.coverage.attested', scope, {scopeKey, basis});
  });
}

async function readLedger(pool, actor, platform, scopeKey) {
  const scope = costScope(platform, scopeKey);
  check(actor, 'cost.read', scope);
  const {rows: [snapshot]} = await pool.query(`
    select coalesce((select jsonb_agg(to_jsonb(c) order by c.code)
      from os_v11_costs c where platform=$1 and scope_key=$2),'[]'::jsonb) as costs,
     coalesce((select array_agg(basis) from os_v11_cost_coverage where platform=$1 and scope_key=$2),'{}') as coverage
  `, [platform, scopeKey]);
  const [categories, suppliers, quotes, sources] = await Promise.all([
    pool.query('select category,cost_type from os_v11_categories where platform=$1 order by category,cost_type', [platform]),
    pool.query('select id,name from os_v11_suppliers where platform=$1 order by name limit 300', [platform]),
    pool.query(`select q.*,s.name from os_v11_supplier_quotes q join os_v11_suppliers s on s.id=q.supplier_id
      where s.platform=$1 order by q.as_of desc,q.id limit 200`, [platform]),
    allowed(actor, 'cost.read', costScope(platform, 'shared')) ? pool.query(`
      select id,code from os_v11_costs where platform=$1 and scope_key='shared' and status='approved' order by code limit 300
    `, [platform]) : {rows: []}
  ]);
  return {costs: snapshot.costs, totals: summarizeCosts(snapshot.costs, snapshot.coverage), categories: categories.rows,
    suppliers: suppliers.rows, quotes: quotes.rows, sources: sources.rows};
}

module.exports = {taxonomy, bases, classifications, amounts, seedCategories, costScope, readNumber, cleanText, parseCost,
  summarizeCosts, readLedger, saveCategory, saveSupplier, saveQuote, saveCost, attestCosts};

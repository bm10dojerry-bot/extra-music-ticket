'use strict';

const {check} = require('./v11-auth.cjs');
const {opsScope, bounds, previousDays} = require('./v11-operations.cjs');
const {cleanText, readNumber} = require('./v11-costs.cjs');
const {requireValue, keyPattern, validDay, dayVN, vnd, transaction, recordAudit} = require('./v11-core.cjs');

const fieldsVn = {
  sold:'Số phần bán', revenueVnd:'Doanh thu thuần sản phẩm', cogsVnd:'Tổng giá vốn',
  stock:'Phần còn bán được cuối ngày', waste:'Phần hao hụt', leadDays:'Số ngày chờ nhập hàng'
};

async function saveProduct(pool, actor, location, day, form) {
  const scope = opsScope(location,'products');
  check(actor,'operations.write',scope);
  const code = form.get('code');
  const revision = Number(form.get('revision') ?? 0);
  requireValue(validDay(day) && day <= dayVN() && keyPattern.test(code ?? '') && Number.isInteger(revision) && revision >= 0);
  const name = cleanText(form.get('name'),120,true);
  const source = cleanText(form.get('source'),180,true);
  const fields = Object.fromEntries(Object.keys(fieldsVn).map(key=>[key,readNumber(form.get(key))]));
  requireValue(Object.values(fields).some(value=>value !== null) && (fields.leadDays === null || (fields.leadDays >= 1 && fields.leadDays <= 30)));
  fields.recipe = cleanText(form.get('recipe'),450);
  return transaction(pool,async client=>{
    const {rowCount} = await client.query(`
      insert into os_v11_retail_products(location,day,code,name,fields,source)
      select $1,$2,$3,$4,$5,$6 where $7::int=0 or exists(
        select 1 from os_v11_retail_products where location=$1 and day=$2 and code=$3 and revision=$7)
      on conflict(location,day,code) do update set name=excluded.name,fields=excluded.fields,source=excluded.source,
        revision=os_v11_retail_products.revision+1,updated_at=clock_timestamp() where os_v11_retail_products.revision=$7
    `,[location,day,code,name,JSON.stringify(fields),source,revision]);
    requireValue(rowCount===1,'STALE_REVISION',409);
    await recordAudit(client,actor,'operations.product.saved',scope,{date:day,product:code,revision:revision+1});
  });
}

async function readProducts(pool,actor,location,day,period) {
  check(actor,period==='input' ? 'operations.read' : 'analysis.read',opsScope(location,'products'));
  const range = bounds(day,period==='input' ? 'day' : period);
  const previous = previousDays(range.end,7);
  const {rows} = await pool.query(`
    select day::text,code,name,fields,source,revision from os_v11_retail_products
    where location=$1 and day between $2 and $3 order by day desc,code
  `,[location,previous.at(-1)<range.start ? previous.at(-1) : range.start,range.end]);
  const products = new Map();
  for (const row of rows) {
    if (!products.has(row.code)) products.set(row.code,[]);
    products.get(row.code).push(row);
  }
  return [...products.entries()].flatMap(([code,history])=>{
    const covered = history.filter(row=>row.day>=range.start);
    if (!covered.length) return [];
    const complete = covered.length === range.expected;
    const sum = field => {
      if (!complete || covered.some(row=>row.fields[field]===null)) return null;
      const total = covered.reduce((n,row)=>n+row.fields[field],0);
      return vnd(total) ? total : null;
    };
    const {name,fields} = history[0];
    const sold = sum('sold'), revenue = sum('revenueVnd'), cogs = sum('cogsVnd');
    const lastWeek = previous.map(date=>history.find(row=>row.day===date)?.fields.sold ?? null);
    const daily = lastWeek.every(vnd) ? lastWeek.reduce((n,value)=>n+value,0)/7 : null;
    const stock = history[0].day === range.end ? fields.stock : null;
    const required = daily !== null && stock !== null && fields.leadDays !== null ? Math.max(0,Math.ceil(daily*fields.leadDays)-stock) : null;
    return [{code,name,sold,revenue,cogs,stock,waste:sum('waste'),complete,unitCost:cogs !== null && sold > 0 ? cogs/sold : null,
      margin:revenue!==null && cogs!==null ? revenue-cogs : null,restock:vnd(required) ? required : null,
      source:history[0].source,asOf:history[0].day,editable:period==='input' ? history[0] : undefined}];
  }).sort((a,b)=>(b.sold??-1)-(a.sold??-1) || a.name.localeCompare(b.name));
}

module.exports = {fieldsVn,saveProduct,readProducts};

'use strict';

const {transaction} = require('./director-queue.cjs');
const {uuid} = require('./director-program.cjs');

const salesFields = {
  grossSalesVnd:'Doanh số trước giảm giá (₫)',discountsVnd:'Giảm giá (₫)',refundsVnd:'Tiền hoàn trả (₫)',
  orderCount:'Đơn đã thanh toán',unitsSold:'Đơn vị đã bán',unitsReturned:'Đơn vị đã hoàn'
};
const expenseFields = {
  cogsVnd:'Giá vốn của hàng đã bán (₫)',adsVnd:'Quảng cáo (₫)',shippingVnd:'Giao hàng (₫)',packingVnd:'Đóng gói (₫)',
  paymentVnd:'Phí thanh toán (₫)',taxVnd:'Thuế ghi vào chi phí (₫)',otherVnd:'Chi phí khác (₫)'
};
const fields = {...salesFields,...expenseFields};
const dateInVietnam = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const max = key => key.endsWith('Vnd') ? 1_000_000_000_000 : 1_000_000_000;

function parseFinance(form,now=new Date()) {
  const get=key=>(form.get(key)??'').trim();
  const requestId=get('request_id'),runId=get('run_id'),base=get('version'),asOf=get('as_of');
  const reference=get('reference'),note=get('note');
  if (!uuid.test(requestId)||!uuid.test(runId)||!/^\d{1,9}$/.test(base)||
      !/^\d{4}-\d{2}-\d{2}$/.test(asOf)||asOf<'2000-01-01'||asOf>dateInVietnam(now)||
      !reference||reference.length>240||note.length>1000) return null;
  const day=new Date(asOf+'T00:00:00Z');
  if (Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==asOf) return null;
  const data={};
  for (const key of Object.keys(fields)) {
    const value=get(key);
    if (value && (!/^\d{1,13}$/.test(value) || Number(value)>max(key))) return null;
    data[key]=value===''?null:Number(value);
  }
  if (Object.values(data).every(value=>value===null) ||
      (data.unitsSold!==null&&data.unitsReturned!==null&&data.unitsReturned>data.unitsSold)) return null;
  return {requestId,runId,baseVersion:Number(base),asOf,reference,note,data};
}

function calculateFinance(data,budgetVnd=null) {
  const revenueInputs=[data.grossSalesVnd,data.discountsVnd,data.refundsVnd];
  const expenseInputs=Object.keys(expenseFields).map(key=>data[key]);
  const netRevenueVnd=revenueInputs.every(Number.isSafeInteger) ? data.grossSalesVnd-data.discountsVnd-data.refundsVnd : null;
  const expenseVnd=expenseInputs.every(Number.isSafeInteger) ? expenseInputs.reduce((total,value)=>total+value,0) : null;
  const profitVnd=netRevenueVnd!==null&&expenseVnd!==null ? netRevenueVnd-expenseVnd : null;
  const grossProfitVnd=netRevenueVnd!==null&&Number.isSafeInteger(data.cogsVnd) ? netRevenueVnd-data.cogsVnd : null;
  const unitsNet=Number.isSafeInteger(data.unitsSold)&&Number.isSafeInteger(data.unitsReturned) ? data.unitsSold-data.unitsReturned : null;
  const adBudgetRemainingVnd=Number.isSafeInteger(budgetVnd)&&Number.isSafeInteger(data.adsVnd) ? budgetVnd-data.adsVnd : null;
  return {basis:'operator_recorded',netRevenueVnd,expenseVnd,grossProfitVnd,profitVnd,unitsNet,adBudgetRemainingVnd,
    missingAmounts:Object.keys(fields).filter(key=>key.endsWith('Vnd')&&!Number.isSafeInteger(data[key]))};
}

function initDirectorFinance(pool) {
  return pool.query(`
    create table if not exists os_director_finance (
      run_id uuid not null references os_director_runs(id),
      version integer not null check(version>0),
      request_id uuid not null unique,
      as_of date not null,
      reference text not null,
      note text not null,
      figures jsonb not null,
      recorded_at timestamptz not null default now(),
      primary key(run_id,version)
    )
  `);
}

function saveFinance(pool,entry) {
  const {runId,baseVersion,requestId,asOf,reference,note,data}=entry;
  return transaction(pool,async db=>{
    const {rows:[run]}=await db.query("select platform,input from os_director_runs where id=$1 for update",[runId]);
    if (run?.platform!=='24h'||run.input.mode==='sample') return {status:'unavailable'};
    const {rows:[existing]}=await db.query(`
      select run_id,version,
        (figures=$2::jsonb and as_of=$3::date and reference=$4 and note=$5) unchanged
      from os_director_finance where request_id=$1
    `,[requestId,data,asOf,reference,note]);
    if (existing) return existing.run_id===runId&&existing.unchanged
      ? {status:'saved',version:existing.version}
      : {status:'conflict'};
    const {rows:[current]}=await db.query('select max(version) version from os_director_finance where run_id=$1',[runId]);
    if ((current.version??0)!==baseVersion) return {status:'conflict'};
    const version=baseVersion+1;
    const {rowCount}=await db.query(`
      insert into os_director_finance(run_id,version,request_id,as_of,reference,note,figures)
      values($1,$2,$3,$4,$5,$6,$7) on conflict(request_id) do nothing
    `,[runId,version,requestId,asOf,reference,note,data]);
    if (!rowCount) return {status:'conflict'};
    await db.query("insert into os_audit(event,details) values('24h.finance.recorded',$1)",
      [{run_id:runId,version,as_of:asOf,basis:'operator_recorded'}]);
    return {status:'saved',version};
  });
}

async function listFinance(pool,runId) {
  const {rows}=await pool.query(`
    select f.version,f.as_of::text as as_of,f.reference,f.note,f.figures,f.recorded_at,r.input->'budgetVnd' as budget_vnd
    from os_director_finance f join os_director_runs r on r.id=f.run_id
    where f.run_id=$1 order by f.version desc limit 10
  `,[runId]);
  return rows.map(row=>({...row,metrics:calculateFinance(row.figures,row.budget_vnd)}));
}

function renderFinance(run,records,{esc,money,csrfField,s,requestId}) {
  const current=records[0],data=current?.figures??{};
  const value=amount=>amount==null?'Chưa nhập':money(amount);
  const numberFields=descriptions=>Object.entries(descriptions).map(([key,label])=>
    '<label>'+esc(label)+'<input type="number" min="0" step="1" max="'+max(key)+'" name="'+key+'" value="'+esc(data[key]??'')+'"></label>'
  ).join('');
  const remaining=current?.metrics.adBudgetRemainingVnd;
  const budget=remaining==null?'':remaining<0?'<p class="tag">Chi quảng cáo vượt hạn mức '+esc(money(-remaining))+'</p>'
    : '<p>Còn '+esc(money(remaining))+' trong hạn mức quảng cáo.</p>';
  const totals=current?'<dl><dt>Doanh thu sau giảm giá và hoàn trả</dt><dd>'+esc(value(current.metrics.netRevenueVnd))+'</dd>'+
    '<dt>Tổng giá vốn và chi phí</dt><dd>'+esc(value(current.metrics.expenseVnd))+'</dd>'+
    '<dt>Lãi/lỗ</dt><dd>'+esc(value(current.metrics.profitVnd))+'</dd></dl>'+
    '<p>Số liệu ghi nhận nội bộ đến '+esc(current.as_of)+' · '+esc(current.reference)+'</p>'+budget+
    (current.metrics.missingAmounts.length?'<p>Khoản còn thiếu '+current.metrics.missingAmounts.map(key=>esc(fields[key])).join(', ')+'</p>':'')
    : '<p>Chưa có số liệu từ chứng từ nội bộ cho chiến dịch.</p>';
  const history=records.length?'<details><summary>Lịch sử ghi nhận</summary><ul>'+records.map(row=>
   '<li><details><summary>Bản '+row.version+' · '+esc(row.as_of)+' · '+esc(row.reference)+'</summary><p>'+esc(row.note||'')+'</p>'+
   '<dl>'+Object.entries(fields).map(([key,label])=>'<dt>'+esc(label)+'</dt><dd>'+
     esc(row.figures[key]==null?'Chưa nhập':key.endsWith('Vnd')?money(row.figures[key]):row.figures[key])+'</dd>').join('')+'</dl></details></li>'
  ).join('')+'</ul></details>':'';
  return '<section id="campaign-finance"><h3>Đối soát nội bộ 24H</h3>'+totals+
    '<details><summary>Ghi số liệu từ chứng từ</summary><p>Nhập số lũy kế của chiến dịch. Để trống ô chưa có số liệu và nhập 0 nếu đã xác định khoản đó bằng 0.</p>'+
    '<form method="post" action="/director/finance">'+csrfField(s)+'<input type="hidden" name="run_id" value="'+esc(run.id)+'">'+
    '<input type="hidden" name="request_id" value="'+esc(requestId)+'"><input type="hidden" name="version" value="'+(current?.version??0)+'">'+
    '<div class="grid"><label>Đến ngày<input type="date" name="as_of" value="'+esc(current?.as_of??dateInVietnam(new Date()))+'" required></label>'+
    '<label>Mã chứng từ / bảng tổng hợp<input name="reference" value="'+esc(current?.reference??'')+'" required maxlength="240"></label></div>'+
    '<h4>Doanh số và số lượng</h4><div class="grid">'+numberFields(salesFields)+'</div>'+
    '<h4>Giá vốn và chi phí</h4><div class="grid">'+numberFields(expenseFields)+'</div>'+
    '<label>Ghi chú<textarea name="note" maxlength="1000">'+esc(current?.note??'')+'</textarea></label>'+
    '<button>Lưu bản đối soát</button></form></details>'+history+'</section>';
}

module.exports = {parseFinance,calculateFinance,initDirectorFinance,saveFinance,listFinance,renderFinance};

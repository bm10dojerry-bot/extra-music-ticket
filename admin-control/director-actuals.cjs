'use strict';

const {Blocked,uuid} = require('./director-program.cjs');

const fields = 'id,currency,financial_status,cancelled_on,tags,created_on,test,total_price,line_items';
const money = value => /^\d+(?:\.0+)?$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

function summarizeOrders(rows,tag,variantId,from,until) {
  const seen=new Set();
  const result={
    basis:'sapo_tagged_paid_orders',campaignTag:tag,matchedOrders:0,paidOrders:0,paidUnits:0,grossPaidVnd:0,
    excludedOrders:0,revenueVnd:null,costVnd:null,expensesVnd:null,profitVnd:null
  };
  for (const order of rows) {
    if (typeof order?.tags!=='string' || !order.tags.split(',').some(value=>value.trim()===tag)) continue;
    const id=String(order.id ?? ''),created=Date.parse(order.created_on);
    if (!/^\d{1,18}$/.test(id) || seen.has(id) || !Number.isFinite(created) || created<from || created>until) continue;
    seen.add(id);
    result.matchedOrders++;
    const lines=order.line_items;
    const cents=money(order.total_price);
    if (order.test===true || order.cancelled_on!==null || order.currency!=='VND' ||
        order.financial_status!=='paid' || cents===null || !Array.isArray(lines) || !lines.length ||
        !lines.every(line=>String(line.variant_id)===variantId && Number.isSafeInteger(line.quantity) && line.quantity>0)) {
      result.excludedOrders++;
      continue;
    }
    result.paidOrders++;
    result.paidUnits+=lines.reduce((total,line)=>total+line.quantity,0);
    result.grossPaidVnd+=cents;
    if (!Number.isSafeInteger(result.grossPaidVnd) || !Number.isSafeInteger(result.paidUnits)) throw Error('Sapo totals exceed safe range');
  }
  return result;
}

function ordersExecutor(env,request) {
  return async (job,catalog) => {
    const shop=env.EXTRA24H_SAPO_SHOP ?? '',token=env.EXTRA24H_SAPO_ORDERS_READ_TOKEN ?? '';
    const variant=catalog?.source==='sapo_web' && /^sapo-\d{1,18}$/.test(catalog.productId) ? catalog.productId.slice(5) : null;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62})\.mysapo\.net$/.test(shop) || !token) {
      throw new Blocked(['sapo_orders','actual_costs']);
    }
    if (!variant || !uuid.test(job.run_id)) throw new Blocked(['sapo_catalog','sapo_orders','actual_costs']);
    const opened=new Date(job.run_created_at),asOf=new Date();
    if (!Number.isFinite(opened.getTime()) || opened>asOf) throw Error('Invalid reporting time range');
    const tag='24h-'+job.run_id.replaceAll('-','');
    const orders=[];
    for(let page=1;page<=4;page++) {
      const params=new URLSearchParams({
        status:'any',financial_status:'any',limit:'250',page:String(page),fields,
        created_on_min:opened.toISOString(),created_on_max:asOf.toISOString()
      });
      const response=await request('https://'+shop+'/admin/orders.json?'+params,{
        redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','x-sapo-access-token':token}
      });
      if ([400,401,403,404].includes(response.status)) throw new Blocked(['sapo_orders']);
      if (!response.ok) throw Error('Sapo orders unavailable');
      const body=await response.json();
      if (!Array.isArray(body.orders)) throw Error('Invalid Sapo orders');
      orders.push(...body.orders);
      if (body.orders.length===250) continue;
      const figures=summarizeOrders(orders,tag,variant,opened.getTime(),asOf.getTime());
      if (!figures.matchedOrders) throw new Blocked(['order_attribution','actual_costs']);
      return {...figures,period:{from:opened.toISOString(),asOf:asOf.toISOString()},remaining:['actual_costs']};
    }
    throw new Blocked(['order_attribution','actual_costs']);
  };
}

module.exports = {ordersExecutor,summarizeOrders};

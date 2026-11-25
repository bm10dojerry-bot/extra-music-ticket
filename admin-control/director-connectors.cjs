'use strict';

const {Blocked,scope} = require('./director-program.cjs');
const {mediaExecutor} = require('./director-media.cjs');
const {crmExecutor} = require('./director-crm.cjs');

const saleUrl = 'http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director';
const storefront = 'https://extra-24h.onrender.com';
const normalize = text => String(text ?? '').normalize('NFC').trim().toLocaleLowerCase('vi-VN');

function makeConnectors(pool, env = process.env, request = fetch) {
  async function sale(job, knowledge) {
    const token = env.EXTRA_OS_SALE_LINK_TOKEN ?? '';
    if (token.length < 48 || env.EXTRA_OS_SALE_LINK_URL !== saleUrl) throw new Blocked(['sale_link']);
    const {playbook,objections,validation} = knowledge.bundle;
    const response = await request(saleUrl,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(40000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({
        id:job.id,kind:'retail_rehearsal',mode:'dry_run',
        input:{product:job.input.product,priceVnd:job.input.priceVnd,knowledgeVersion:knowledge.version,training:{playbook,objections,validation}}
      })
    });
    if ([400,401,403,404,405].includes(response.status)) throw new Blocked(['sale_link']);
    if (!response.ok) throw Error('Sale service unavailable');
    const reply = await response.json();
    if (reply.id !== job.id || reply.agent !== 'Sale' || reply.version !== '2.3' ||
      reply.kind !== 'retail_rehearsal' || reply.mode !== 'dry_run' ||
      !reply.report || typeof reply.report !== 'object') throw Error('Sale returned an invalid report');
    if (reply.status === 'blocked') throw new Blocked(['sale_model']);
    if (reply.report.knowledgeVersion !== knowledge.version) throw Error('Sale returned another knowledge version');
    if (reply.status === 'revision_needed') return {knowledgeVersion:knowledge.version,passed:false,reason:reply.report.reason};
    if (reply.status !== 'succeeded') throw Error('Sale returned an unknown status');
    const quote = reply.report.quote;
    if (quote?.inventorySource !== 'fixture' || quote.priceVnd !== job.input.priceVnd || quote.quantity !== 2 ||
        quote.totalVnd !== job.input.priceVnd * quote.quantity) throw Error('Sale quote failed price or stock check');
    return {
      knowledgeVersion:knowledge.version,reply:reply.report.reply,objectionReply:reply.report.objectionReply,
      quote,ordersCreated:reply.report.ordersCreated,liveSales:reply.report.liveSales
    };
  }

  async function catalog(job) {
    const response = await request(storefront+'/api/public/catalog',{
      redirect:'error',signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}
    });
    if (response.status === 503) throw new Blocked(['sapo_catalog']);
    if (!response.ok) throw Error('24H catalog unavailable');
    const snapshot = await response.json();
    if (snapshot.inventoryConnected !== true || snapshot.source !== 'sapo_web' || !Array.isArray(snapshot.products)) {
      throw new Blocked(['sapo_catalog']);
    }
    const products = snapshot.products.filter(product=>
      normalize(product.productName ?? product.name) === normalize(job.input.product) && product.price === job.input.priceVnd
    );
    if (products.length !== 1) throw new Blocked(['sapo_catalog'],{
      verifiedPriceVnd:null,stock:null,reason:'Cần một biến thể Sapo khớp tên và giá bán đã giao.'
    });
    const product = products[0];
    if (!/^sapo-\d{1,18}$/.test(product.id) || !Number.isSafeInteger(product.stock) || product.stock<0) {
      throw new Blocked(['sapo_catalog']);
    }
    return {
      source:'sapo_web',productId:product.id,verifiedPriceVnd:product.price,stock:product.stock,
      productUrl:storefront+'/san-pham/'+encodeURIComponent(product.id)
    };
  }

  async function advertisingReadiness(plan) {
    const version = env.EXTRA24H_META_GRAPH_VERSION ?? '';
    const token = env.EXTRA24H_META_ADS_TOKEN ?? '';
    if (!/^v\d{1,2}\.0$/.test(version) || !token) throw new Blocked(['ads','ads_controls'],plan);
    const endpoint = 'https://graph.facebook.com/'+version+'/act_'+scope.adAccountId;
    const read = async suffix => {
      const response = await request(endpoint+suffix,{
        redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token}
      });
      if ([400,401,403,404].includes(response.status)) throw new Blocked(['ads','ads_controls'],plan);
      if (!response.ok) throw Error('Meta preflight unavailable');
      return response.json();
    };
    const [account,limits] = await Promise.all([read('?fields=account_id,currency,account_status'),read('/minimum_budgets')]);
    const candidates = Array.isArray(limits.data) ? limits.data.filter(row=>row.currency==='VND') : [];
    const minimum = candidates.map(item=>item.min_daily_budget_imp).find(item=>Number.isSafeInteger(item)&&item>0);
    const verified = account.account_id === scope.adAccountId && account.currency === 'VND' && account.account_status === 1 && Boolean(minimum);
    return {...plan,verifiedAdAccount:verified,minimumDailyImpressionsVnd:verified ? minimum : null,
      budgetAllowsImpressionsDay:verified ? plan.proposedLifetimeVnd >= minimum : null};
  }

  return {env,request,sale,catalog,advertisingReadiness,creative:mediaExecutor(pool,env,request),crm:crmExecutor(pool,env)};
}

module.exports = {makeConnectors};

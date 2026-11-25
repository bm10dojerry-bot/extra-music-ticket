'use strict';

const {Blocked,scope} = require('./director-program.cjs');
const {mediaExecutor} = require('./director-media.cjs');
const {crmExecutor,sampleCrm} = require('./director-crm.cjs');
const {ordersExecutor} = require('./director-actuals.cjs');

const saleUrl = 'http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director';
const storefront = 'https://extra-24h.onrender.com';
const normalize = text => String(text ?? '').normalize('NFC').trim().toLocaleLowerCase('vi-VN');

function makeConnectors(pool, env = process.env, request = fetch) {
  async function sale(job, knowledge, inventory) {
    const token = env.EXTRA_OS_SALE_LINK_TOKEN ?? '';
    if (token.length < 48 || env.EXTRA_OS_SALE_LINK_URL !== saleUrl) throw new Blocked(['sale_link']);
    const sample=job.input.mode==='sample';
    const kind=sample ? 'retail_sample' : 'retail_rehearsal';
    const {playbook,objections,validation,rules} = knowledge.bundle;
    if (sample && inventory?.source!=='demo_fixture') throw new Blocked(['sample_catalog']);
    const input={product:job.input.product,priceVnd:job.input.priceVnd,knowledgeVersion:knowledge.version,
      training:{playbook,objections,validation},...(sample ? {stock:inventory.stock,rules} : {})};
    const response = await request(saleUrl,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(40000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({id:job.id,kind,mode:'dry_run',input})
    });
    if ([400,401,403,404,405].includes(response.status)) throw new Blocked(['sale_link']);
    if (!response.ok) throw Error('Sale service unavailable');
    const reply = await response.json();
    if (reply.id !== job.id || reply.agent !== 'Sale' || reply.version !== '2.3' ||
      reply.kind !== kind || reply.mode !== 'dry_run' ||
      !reply.report || typeof reply.report !== 'object') throw Error('Sale returned an invalid report');
    if (reply.status === 'blocked') throw new Blocked(['sale_model']);
    if (reply.report.knowledgeVersion !== knowledge.version) throw Error('Sale returned another knowledge version');
    if (reply.status === 'revision_needed') return {knowledgeVersion:knowledge.version,passed:false,reason:reply.report.reason};
    if (reply.status !== 'succeeded') throw Error('Sale returned an unknown status');
    if (sample && (reply.report.source!=='sample_rules' || reply.report.generatedByModel!==false)) {
      throw Error('Sale returned an invalid sample source');
    }
    const quote = reply.report.quote;
    if (quote?.inventorySource !== 'fixture' || quote.priceVnd !== job.input.priceVnd || quote.quantity !== 2 ||
        quote.totalVnd !== job.input.priceVnd * quote.quantity) throw Error('Sale quote failed price or stock check');
    return {
      knowledgeVersion:knowledge.version,reply:reply.report.reply,objectionReply:reply.report.objectionReply,
      quote,ordersCreated:reply.report.ordersCreated,liveSales:reply.report.liveSales,
      ...(sample ? {source:reply.report.source,generatedByModel:false} : {})
    };
  }

  async function catalog(job) {
    const response = await request(storefront+'/api/public/catalog',{
      redirect:'error',signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}
    });
    if (response.status === 503) throw new Blocked(['sapo_catalog']);
    if (!response.ok) throw Error('24H catalog unavailable');
    const snapshot = await response.json();
    if (snapshot.inventoryConnected !== true || snapshot.source !== 'sapo_web' || snapshot.partial===true || !Array.isArray(snapshot.products)) {
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

  async function sampleCatalog(job) {
    const response=await request(storefront+'/api/demo/catalog',{
      redirect:'error',signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}
    });
    if (response.status===404) throw new Blocked(['sample_catalog']);
    if (!response.ok) throw Error('24H sample catalog unavailable');
    const snapshot=await response.json();
    const expectedId=job.input.sampleProductId;
    const item=Array.isArray(snapshot.products) ? snapshot.products.find(product=>product?.id===expectedId) : null;
    if (snapshot.demo!==true || snapshot.source!=='demo_fixture' || !/^demo-[a-z0-9-]{1,30}$/.test(expectedId) ||
        !item || normalize(item.name)!==normalize(job.input.product) || item.price!==job.input.priceVnd ||
        !Number.isInteger(item.stock) || item.stock<2 || item.stock>100) {
      throw new Blocked(['sample_catalog']);
    }
    return {source:'demo_fixture',productId:item.id,verifiedPriceVnd:item.price,stock:item.stock,
      productUrl:storefront+'/demo/san-pham/'+encodeURIComponent(item.id)};
  }

  async function sampleOrder(job,inventory,sale) {
    const quote=sale?.quote;
    if (inventory?.source!=='demo_fixture' || sale?.source!=='sample_rules' || sale.liveSales!==false ||
        !quote || quote.explicitConfirmation!==true || quote.priceVnd!==inventory.verifiedPriceVnd ||
        !Number.isInteger(quote.quantity) || quote.quantity<1 || quote.quantity>inventory.stock) {
      throw new Blocked(['sample_order']);
    }
    const response=await request(storefront+'/api/demo/orders',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({requestId:job.id,fulfillment:'pickup',items:[{id:inventory.productId,quantity:quote.quantity}]})
    });
    if ([400,404,409].includes(response.status)) throw new Blocked(['sample_order']);
    if (!response.ok) throw Error('24H sample receipt unavailable');
    const receipt=await response.json();
    const item=Array.isArray(receipt?.items) ? receipt.items[0] : null;
    if (!item || receipt.demo!==true || receipt.persisted!==false || !/^DEMO-[A-F0-9-]{8,20}$/.test(receipt.code) ||
        receipt.total!==quote.totalVnd || receipt.items.length!==1 || item.id!==inventory.productId ||
        item.quantity!==quote.quantity || item.unitPrice!==quote.priceVnd) {
      throw new Blocked(['sample_order']);
    }
    return {basis:'demo_fixture',receipt:receipt.code,quantity:item.quantity,checkoutVnd:receipt.total,realOrdersCreated:0};
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

  async function facebookReadiness(draft) {
    const version=env.EXTRA24H_META_GRAPH_VERSION ?? '',token=env.EXTRA24H_META_PAGE_TOKEN ?? '';
    if (!/^v\d{1,2}\.0$/.test(version) || !token) throw new Blocked(['facebook','asset_rights'],draft);
    const response=await request('https://graph.facebook.com/'+version+'/me?fields=id',{
      headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)
    });
    if ([400,401,403,404].includes(response.status)) throw new Blocked(['facebook','asset_rights'],draft);
    if (!response.ok) throw Error('Meta Page preflight unavailable');
    const account=await response.json();
    if (account.id!==scope.pageId) throw new Blocked(['facebook'],{...draft,pageIdentityVerified:false});
    return {...draft,pageIdentityVerified:true};
  }

  return {env,request,sale,catalog,sampleCatalog,sampleOrder,sampleCrm,advertisingReadiness,facebookReadiness,creative:mediaExecutor(pool,env,request),
    crm:crmExecutor(pool,env),actuals:ordersExecutor(env,request)};
}

module.exports = {makeConnectors};

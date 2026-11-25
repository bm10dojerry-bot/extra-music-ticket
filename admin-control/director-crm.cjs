'use strict';

const {createHmac,timingSafeEqual} = require('node:crypto');
const {scope} = require('./director-program.cjs');

const maxBody = 128 * 1024;

function initCrm(pool) {
  return pool.query(`
    create table if not exists os_24h_inbound_events (
      event_id text primary key,
      thread_key text not null,
      occurred_at timestamptz not null,
      category text not null
    );
    create index if not exists os_24h_inbound_recent on os_24h_inbound_events(occurred_at desc);
  `);
}

function config(env) {
  const secret = env.EXTRA24H_MESSENGER_APP_SECRET ?? '';
  const verify = env.EXTRA24H_MESSENGER_VERIFY_TOKEN ?? '';
  const hashKey = env.EXTRA24H_CRM_HASH_KEY ?? '';
  return Buffer.byteLength(secret)>=24 && Buffer.byteLength(verify)>=32 && Buffer.byteLength(hashKey)>=32
    ? {secret,verify,hashKey} : null;
}

function constTime(a,b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}

function categoryOf(message) {
  const text=String(message.text ?? '').normalize('NFC').toLowerCase();
  if (/đừng (nhắn|liên hệ)|ngừng (nhắn|gửi)|hủy đăng ký/u.test(text)) return 'opt_out';
  if (/khiếu nại|hàng hỏng|đổi trả|hoàn tiền/u.test(text)) return 'support';
  if (/đặt hàng|muốn mua|giá bao nhiêu|còn hàng/u.test(text)) return 'sales';
  return 'general';
}

function inboundRows(payload,hashKey,now) {
  if (payload?.object!=='page' || !Array.isArray(payload.entry)) return [];
  const hashed = value=>createHmac('sha256',hashKey).update(value).digest('hex');
  const rows=[];
  for (const entry of payload.entry) {
    if (entry?.id!==scope.pageId || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const mid = event?.message?.mid, sender = event?.sender?.id, timestamp = event?.timestamp;
      if (event?.recipient?.id!==scope.pageId || sender===scope.pageId || !/^\d{5,30}$/.test(sender ?? '') ||
          typeof mid!=='string' || !/^[A-Za-z0-9_:\-\.]{4,255}$/.test(mid) || event.message.is_echo ||
          !Number.isSafeInteger(timestamp) || timestamp<now-7*86400000 || timestamp>now+300000) continue;
      rows.push({event_id:hashed(scope.pageId+':event:'+mid),thread_key:hashed(scope.pageId+':sender:'+sender),
        occurred_at:new Date(timestamp).toISOString(),category:categoryOf(event.message)});
    }
  }
  return rows;
}

async function rawBody(req) {
  const chunks=[];
  let bytes=0;
  for await (const part of req.iterator({destroyOnReturn:false})) {
    bytes+=part.length;
    if (bytes>maxBody) {
      req.resume();
      return null;
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function messengerWebhook(pool,env=process.env) {
  return async (req,res) => {
    const send = (status,value='') => {
      res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(value);
    };
    const settings = config(env);
    if (!settings) return send(404);
    if (req.method==='GET') {
      const params=new URL(req.url,'http://localhost').searchParams;
      const challenge = params.get('hub.challenge') ?? '';
      return params.get('hub.mode')==='subscribe' && constTime(params.get('hub.verify_token')??'',settings.verify)
        && /^[A-Za-z0-9_-]{1,128}$/.test(challenge) ? send(200,challenge) : send(403);
    }
    if (req.method!=='POST') return send(405);
    const signature=String(req.headers['x-hub-signature-256'] ?? '');
    if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return send(403);
    const body=await rawBody(req);
    if (!body) return send(413);
    const expected='sha256='+createHmac('sha256',settings.secret).update(body).digest('hex');
    if (!constTime(signature,expected)) return send(403);
    let payload;
    try {payload=JSON.parse(body.toString('utf8'));} catch {return send(400);}
    const rows=inboundRows(payload,settings.hashKey,Date.now());
    if (rows.length) await pool.query(`
      insert into os_24h_inbound_events(event_id,thread_key,occurred_at,category)
      select event_id,thread_key,occurred_at,category
      from jsonb_to_recordset($1::jsonb) as r(event_id text,thread_key text,occurred_at timestamptz,category text)
      on conflict(event_id) do nothing
    `,[JSON.stringify(rows)]);
    return send(200,'ok');
  };
}

function crmExecutor(pool,env=process.env) {
  return async function crm(job,saleStatus) {
    const settings = config(env);
    const base = {
      mode:job.input.mode,conversations:null,orders:null,outboundMessages:0,
      policy:['Chỉ xử lý hội thoại inbound 24H','Ghi nhận yêu cầu ngừng liên hệ','Chuyển nhân viên khi cần hỗ trợ'],
      saleStatus,remaining:['messenger']
    };
    if (!settings) return base;
    const {rows:[results]} = await pool.query(`
      select count(distinct thread_key)::int threads,count(*)::int events,
        count(*) filter(where category='sales')::int sale_intents,
        count(*) filter(where category='support')::int support_intents,
        count(*) filter(where category='opt_out')::int opt_outs
      from os_24h_inbound_events where occurred_at>=now()-interval '7 days'
    `);
    if (!results.events) return {...base,webhookConfigured:true};
    return {...base,watch:{scope:'24h_page_7_days',...results},remaining:['sale_handoff']};
  };
}

module.exports = {initCrm,messengerWebhook,crmExecutor,inboundRows};

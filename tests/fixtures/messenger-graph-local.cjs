const { appendFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const log = process.env.EXTRA_LOCAL_GRAPH_LOG;
const token = process.env.META_MESSENGER_PAGE_ACCESS_TOKEN;
if (!log || !token?.startsWith('fixture-local-only-')) throw new Error('Synthetic Messenger configuration required');
const testers = new Set(process.env.META_MESSENGER_AI_TEST_PSIDS.split(','));
const approvedLocalOrigins = new Set([process.env.SUPABASE_URL, process.env.META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN]);
const fetchOriginal = globalThis.fetch;
const event = row => appendFileSync(log, JSON.stringify({ ...row, recordedAt: Date.now() }) + '\n');

globalThis.fetch = async function localMessengerFetch(input, options) {
 const url = new URL(input.url ?? input);
 if (approvedLocalOrigins.has(url.origin) && url.hostname === '127.0.0.1') return fetchOriginal(input, options);
 // Next dev's startup version check is also offline during this test.
 if (url.href === 'https://registry.npmjs.org/-/package/next/dist-tags') return new Response(null, { status: 503 });
 if (url.origin !== 'https://graph.facebook.com') {
  event({ kind: 'unexpected-origin', host: url.hostname });
  throw new Error('Local Messenger fixture blocks network destinations outside the test');
 }
 const req = new Request(input, options);
 if (req.headers.get('authorization') !== `Bearer ${token}`) throw new Error('Only the synthetic Page token is accepted');
 const [, version, recipient, endpoint] = url.pathname.split('/');
 if (!/^v\d+\.\d+$/.test(version)) throw new Error('Unexpected Messenger Graph version');
 if (req.method === 'GET' && !endpoint && testers.has(recipient)) {
  event({ kind: 'profile', psid: recipient });
  return Response.json({ first_name: 'Linh', last_name: 'Thử Nghiệm' });
 }
 if (req.method !== 'POST' || recipient !== process.env.META_MESSENGER_PAGE_ID || endpoint !== 'messages') {
  event({ kind: 'unexpected-graph' });
  throw new Error('Unexpected synthetic Graph call');
 }
 const { recipient: customer, sender_action: action, message } = await req.json();
 if (!testers.has(customer?.id)) {
  event({ kind: 'outside-cohort' });
  throw new Error('Synthetic Graph rejects all recipients outside the test cohort');
 }
 if (action === 'typing_on' || action === 'typing_off') {
  event({ kind: action, psid: customer.id });
  return Response.json({ recipient_id: customer.id });
 }
 if (typeof message?.text !== 'string' || !/^extra-sale-2:(?:ai|staff):[a-f0-9-]+$/.test(message.metadata)) {
  event({ kind: 'unexpected-message' });
  throw new Error('Unexpected synthetic outbound content');
 }
 const mid = `fixture.graph.${randomUUID()}`;
 event({ kind: 'message', psid: customer.id, text: message.text, metadata: message.metadata, mid });
 return Response.json({ recipient_id: customer.id, message_id: mid });
};

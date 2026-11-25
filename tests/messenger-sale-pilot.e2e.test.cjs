const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { mkdtemp, mkdir, cp, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const enabled = process.env.EXTRA_MESSENGER_PILOT_E2E === '1';
const wallClock = process.env.EXTRA_MESSENGER_PILOT_E2E_REAL_TIMER === '1';
const repo = resolve(__dirname, '..');
const page = '991001';
const appId = '991002';
const psids = ['991003', '991004', '991005'];
const outsider = '991009';
const show = 'extra-messenger-fixture';

async function until(check, description, timeout = 6000) {
 const end = Date.now() + timeout;
 for (;;) {
  const result = await check();
  if (result) return result;
  if (Date.now() >= end) throw new Error(`Timed out waiting for ${description}`);
  await delay(50);
 }
}

test('Messenger pilot HTTP path with local PostgreSQL, PostgREST and synthetic Graph',
 { skip: !enabled, timeout: wallClock ? 230000 : 90000 }, async t => {
 const { Client } = require('pg');
 const database = new URL(process.env.EXTRA_LOCAL_DATABASE_URL);
 const supabase = new URL(process.env.SUPABASE_URL);
 const port = process.env.EXTRA_LOCAL_NEXT_PORT ?? '55444';
 assert(/^\d{4,5}$/.test(port) && Number(port) <= 65535);
 const origin = `http://127.0.0.1:${port}`;
 assert(database.hostname === '127.0.0.1' && database.pathname === '/extra_messenger_pilot_local');
 assert(supabase.origin === 'http://127.0.0.1:55443' && supabase.pathname === '/');
 assert.equal(process.env.META_MESSENGER_PAGE_ID, page);
 assert.equal(process.env.META_MESSENGER_AI_APP_ID, appId);
 assert.equal(process.env.META_MESSENGER_AI_TEST_PSIDS, psids.join(','));
 assert(process.env.META_MESSENGER_PAGE_ACCESS_TOKEN.startsWith('fixture-local-only-'));
 const client = new Client({ connectionString: database.toString() });
 await client.connect();
 t.after(() => client.end());
 const seeded = await client.query('SELECT id FROM public.managed_shows WHERE id = $1', [show]);
 assert.equal(seeded.rowCount, 1, 'Refusing to change a database without the expected sample show');
 await client.query('DELETE FROM public.extra_support_chats WHERE messenger_page_id = $1 AND messenger_psid = ANY($2)', [page, [...psids, outsider]]);

 const temporary = await mkdtemp(join(tmpdir(), 'extra-messenger-route-'));
 const checkout = join(temporary, 'app-source');
 await mkdir(checkout);
 await Promise.all(['app', 'lib', 'public', 'middleware.ts', 'package.json', 'tsconfig.json', 'next-env.d.ts'].map(file =>
  cp(join(repo, file), join(checkout, file), { recursive: true })));
 await symlink(join(repo, 'node_modules'), join(checkout, 'node_modules'), 'dir');
 const graphLog = join(temporary, 'graph.jsonl');
 await writeFile(graphLog, '', { mode: 0o600 });
 const preload = join(__dirname, 'fixtures', 'messenger-graph-local.cjs');
 const app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', port], {
  cwd: checkout,
  env: { ...process.env, VERCEL_ENV: '', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
   SEPAY_CHECKOUT_ENABLED: 'false',
   META_MESSENGER_AI_MODE: 'test', META_MESSENGER_AI_NATIVE_HUMAN_ECHO: '1', EXTRA_LOCAL_GRAPH_LOG: graphLog,
   META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: origin, META_MESSENGER_AI_TEST_SUPABASE_URL: supabase.origin },
  stdio: ['ignore', 'pipe', 'pipe'],
 });
 let output = '';
 for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-7000); });
 const exited = once(app, 'exit');
 t.after(async () => {
  if (app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited; }
  await rm(temporary, { recursive: true, force: true });
 });
 const metaPath = '/api/meta/messenger/webhook';
 const staffPath = '/api/staff/support-chats';
 const workerPath = '/api/cron/messenger-sale';
 const call = (path, init) => fetch(origin + path, { ...init, signal: AbortSignal.timeout(15000) });
 const secret = process.env.META_MESSENGER_APP_SECRET;
 const verify = process.env.META_MESSENGER_VERIFY_TOKEN;
 const signature = (value, key) => createHmac('sha256', key).update(value).digest('hex');
 const expires = String(Math.floor(Date.now() / 1000) + 3600);
 const adminCookie = `extra_admin_session=${expires}.${signature(expires, process.env.ADMIN_MEDIA_SECRET)}`;
 const events = async () => (await readFile(graphLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const texts = async psid => (await events()).filter(event => event.kind === 'message' && event.psid === psid);
 const status = async psid => (await client.query('SELECT * FROM public.extra_support_chats WHERE messenger_page_id = $1 AND messenger_psid = $2', [page, psid])).rows[0];
 const thread = async chat => (await client.query('SELECT id, sender, body, external_message_id FROM public.extra_support_messages WHERE chat_id = $1 ORDER BY id', [chat])).rows;
 const lastHumanAgo = async (chat, seconds) => client.query('UPDATE public.extra_support_chats SET messenger_last_human_at = clock_timestamp() - ($2::int * interval \'1 second\') WHERE id = $1', [chat, seconds]);
 const inbound = (sender, mid, text, referral) => ({ sender: { id: sender }, recipient: { id: page }, timestamp: Date.now(),
  message: { mid, text, ...(referral ? { referral } : {}) } });
 const echo = (recipient, message) => ({ sender: { id: page }, recipient: { id: recipient }, timestamp: Date.now(),
  message: { ...message, is_echo: true } });
 const webhook = (messaging, key = secret) => {
  const body = JSON.stringify({ object: 'page', entry: [{ id: page, messaging }] });
  return call(metaPath, { method: 'POST', body, headers: { 'content-type': 'application/json',
   'x-hub-signature-256': `sha256=${signature(body, key)}` } });
 };
 const send = async (...messaging) => assert.equal((await webhook(messaging)).status, 200);
 const worker = async (bearer = process.env.META_MESSENGER_AI_WORKER_SECRET) => call(workerPath, {
  method: 'POST', headers: { authorization: `Bearer ${bearer}` },
 });
 const staff = (method, body) => call(staffPath, { method, body: JSON.stringify(body),
  headers: { cookie: adminCookie, origin, 'content-type': 'application/json' } });
 const expectTexts = async (psid, expected) => until(async () => {
  const messages = await texts(psid);
  return messages.length >= expected ? messages : null;
 }, `${expected} synthetic replies`);
 const bootstrap = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': verify, 'hub.challenge': 'fixture-challenge' });
 try {
  const challenge = await until(async () => call(`${metaPath}?${bootstrap}`).catch(() => null), 'Next server', 25000);
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), 'fixture-challenge');
 } catch (error) { throw new Error(`Next fixture failed: ${output}`, { cause: error }); }

 await t.test('signature, scheduler bearer and pilot cohort are enforced by HTTP routes', async () => {
  const forged = inbound(psids[0], 'invalid-signature-001', 'Sai chữ ký');
  assert.equal((await webhook([forged], 'fixture-wrong-signing-secret')).status, 403);
  assert.equal(await status(psids[0]), undefined);
  assert.equal((await worker('fixture-wrong-worker-secret')).status, 401);
  await send(inbound(outsider, 'outside-pilot-001', 'Ngoài thử nghiệm'));
  assert.equal(await status(outsider), undefined);
  assert.deepEqual(await texts(outsider), []);
 });

 await t.test('greeting, duplicate MIDs, real catalog and checkout guidance', async () => {
  const customer = psids[0];
  const price = inbound(customer, 'fixture-priced-turn', 'Cho mình xem bảng giá vé', { ref: 'fixture-ref' });
  await Promise.all([send(price), send(price), send(price)]);
  const [first] = await expectTexts(customer, 1);
  assert.match(first.text, /chào Linh Thử Nghiệm/i);
  assert.match(first.text, /công nghệ AI/i);
  assert.match(first.text, /Nghệ sĩ Thử Nghiệm/i);
  assert.match(first.text, /799\.000đ/);
  assert.match(first.text, /bên trái, bên phải hay chính diện/);
  assert.match(first.metadata, /^extra-sale-2:ai:/);
  assert((await events()).some(event => event.kind === 'typing_on' && event.psid === customer));
  assert((await events()).some(event => event.kind === 'profile' && event.psid === customer));
  const chat = await status(customer);
  await until(async () => (await thread(chat.id)).some(row => row.external_message_id === first.mid), 'first AI delivery persisted');
  assert.equal((await thread(chat.id)).filter(row => row.external_message_id === price.message.mid).length, 1);
  await send(echo(customer, { mid: first.mid, text: first.text, app_id: appId, metadata: first.metadata }));
  assert.equal((await status(customer)).messenger_last_human_at, null);
  assert.equal((await thread(chat.id)).filter(row => row.external_message_id === first.mid).length, 1);
  assert.equal((await texts(customer)).length, 1);

  await send(inbound(customer, 'fixture-booking-turn', 'Mình muốn đặt vé, hướng dẫn giữ chỗ giúp mình'));
  const booking = (await expectTexts(customer, 2))[1];
  assert(booking.text.includes(`${origin}/show/${show}#booking`));
  assert.match(booking.text, /giữ ghế 15 phút/);
  assert.doesNotMatch(booking.text, /công nghệ AI|Em chào/);
  await until(async () => (await thread(chat.id)).some(row => row.external_message_id === booking.mid), 'booking reply saved');
  await send(inbound(customer, 'fixture-payment-turn', 'Mình đã chuyển khoản rồi'));
  const payment = (await expectTexts(customer, 3))[2];
  assert.match(payment.text, /chưa xác minh được trạng thái thanh toán/i);
  assert.doesNotMatch(payment.text, /đã xác nhận thanh toán thành công/i);
  await until(async () => (await thread(chat.id)).some(row => row.external_message_id === payment.mid), 'payment guidance saved');
 });

 await t.test('authenticated staff intervention resets the 179/180-second gate and AI resumes with context', async () => {
  const customer = psids[0];
  const original = await status(customer);
  assert.equal((await call(staffPath)).status, 403);
  const takeover = await staff('PATCH', { chatId: original.id, action: 'takeover' });
  assert.equal(takeover.status, 200);
  assert.equal((await takeover.json()).outcome, 'taken_over');
  await send(inbound(customer, 'fixture-staff-pending-01', 'Mình có thể giữ hai chỗ không?'));
  await lastHumanAgo(original.id, 179);
  const oldActivity = (await status(customer)).messenger_last_human_at;
  const stillPaused = await worker();
  assert.equal(stillPaused.status, 200);
  assert.equal((await stillPaused.json()).sent, 0);
  assert.equal((await texts(customer)).length, 3);

  const staleView = await staff('POST', { chatId: original.id, requestId: randomUUID(), seenMessageId: 0,
   message: 'Phản hồi từ màn hình chưa cập nhật.' });
  assert.equal(staleView.status, 409);
  assert.equal((await staleView.json()).outcome, 'conversation_changed');
  const seenMessageId = Number((await thread(original.id)).at(-1).id);
  const staffReply = await staff('POST', { chatId: original.id, requestId: randomUUID(), seenMessageId,
   message: 'Sale thử nghiệm chào mình. Em hỗ trợ xem chỗ ạ.' });
  assert.equal(staffReply.status, 200);
  const outbound = (await expectTexts(customer, 4))[3];
  assert.match(outbound.metadata, /^extra-sale-2:staff:/);
  const newActivity = (await status(customer)).messenger_last_human_at;
  assert(newActivity > oldActivity);
  await send(echo(customer, { mid: outbound.mid, text: outbound.text, app_id: appId, metadata: outbound.metadata }));
  assert.equal((await thread(original.id)).filter(row => row.external_message_id === outbound.mid).length, 1);
  await send(inbound(customer, 'fixture-staff-pending-02', 'Mình muốn đặt vé cho đêm này'));
  await lastHumanAgo(original.id, 179);
  assert.equal((await (await worker()).json()).sent, 0);
  assert.equal((await texts(customer)).length, 4);
  await lastHumanAgo(original.id, 180);
  const resumed = await worker();
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).sent, 1);
  const reply = (await expectTexts(customer, 5))[4];
  assert(reply.text.includes(`${origin}/show/${show}#booking`));
  assert.doesNotMatch(reply.text, /công nghệ AI|Em chào/);
  assert.match(reply.metadata, /^extra-sale-2:ai:/);
 });

 await t.test('simultaneous deliveries use stored history and produce one text reply for a batch', async () => {
  const customer = psids[1];
  const message = inbound(customer, 'fixture-concurrent-1', 'Muốn xem đêm nhạc này', { ref: 'fixture-ref' });
  const question = inbound(customer, 'fixture-concurrent-2', 'Cho mình hai vé hạng A góc bên trái');
  await send(message, question);
  await Promise.all([send(question), send(question)]);
  const [first] = await expectTexts(customer, 1);
  const chat = await status(customer);
  await until(async () => (await thread(chat.id)).some(row => row.external_message_id === first.mid), 'concurrent batch stored');
  assert.equal((await thread(chat.id)).filter(row => row.sender === 'customer').length, 2);
  assert.equal((await texts(customer)).length, 1);
  assert.match(first.text, /đang trống theo sơ đồ/);
  assert.match(first.text, /hạng A \(A\d+, A\d+\), góc bên trái/);
  assert.doesNotMatch(first.text, /\bA0[1-4]\b/);
 });

 await t.test('explicit request stays with staff until an authenticated native staff echo', async () => {
  const customer = psids[2];
  await send(inbound(customer, 'fixture-human-request', 'Cho mình gặp nhân viên thật để tư vấn'));
  const chat = await until(async () => {
   const row = await status(customer);
   return row?.messenger_human_requested ? row : null;
  }, 'explicit human request');
  assert.equal((await staff('PATCH', { chatId: chat.id, action: 'release-ai' })).status, 409);
  await lastHumanAgo(chat.id, 181);
  assert.equal((await (await worker()).json()).sent, 0);
  assert.deepEqual(await texts(customer), []);
  await send(echo(customer, { mid: 'fixture-external-app', text: 'Không xác minh được nguồn', app_id: '991007' }));
  assert.equal((await status(customer)).messenger_human_requested, true);
  const nativeEcho = echo(customer, { mid: 'fixture-native-human', text: 'Nhân viên đã tiếp nhận yêu cầu ạ.' });
  await Promise.all([send(nativeEcho), send(nativeEcho)]);
  const after = await status(customer);
  assert.equal(after.messenger_human_requested, false);
  assert(after.messenger_last_human_at > chat.messenger_last_human_at);
  assert.equal((await thread(chat.id)).filter(row => row.external_message_id === 'fixture-native-human' && row.sender === 'staff').length, 1);
  assert.deepEqual(await texts(customer), []);
 });

 await t.test('the separate scheduler resumes after 180 real seconds without another inbound event', { skip: !wallClock }, async subtest => {
  const customer = psids[2];
  const lastActivity = (await status(customer)).messenger_last_human_at.getTime();
  await send(inbound(customer, 'fixture-wall-clock', 'Cho mình xem bảng giá vé', { ref: 'fixture-ref' }));
  const scheduler = spawn(process.execPath, [join(repo, 'scripts', 'run-messenger-sale-worker.mjs')], {
   cwd: checkout,
   env: { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, EXTRA_LOCAL_GRAPH_LOG: graphLog,
    META_MESSENGER_AI_TEST_CHECKOUT_ORIGIN: origin, META_MESSENGER_AI_WORKER_URL: origin + workerPath },
   stdio: ['ignore', 'ignore', 'inherit'],
  });
  const stopped = once(scheduler, 'exit');
  subtest.after(async () => { if (scheduler.exitCode === null && scheduler.signalCode === null) { scheduler.kill('SIGTERM'); await stopped; } });
  await delay(Math.max(0, lastActivity + 179000 - Date.now()));
  assert.deepEqual(await texts(customer), []);
  const [reply] = await expectTexts(customer, 1);
  const elapsed = reply.recordedAt - lastActivity;
  assert(elapsed >= 180000 && elapsed < 185000, `Unexpected scheduler handoff at ${elapsed} ms after staff activity`);
  assert.match(reply.text, /Nghệ sĩ Thử Nghiệm/);
  assert.doesNotMatch(reply.text, /Em chào/);
  subtest.diagnostic(`Synthetic Graph got the single resumed reply at ${elapsed} ms after staff activity`);
 });

 assert.deepEqual((await events()).filter(row => ['unexpected-origin', 'unexpected-graph', 'outside-cohort', 'unexpected-message'].includes(row.kind)), []);
});

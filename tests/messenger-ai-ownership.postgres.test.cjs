const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const server = process.env.EXTRA_MESSENGER_TEST_DATABASE_URL;
test('Messenger ownership transactions on PostgreSQL', { skip: !server }, async (t) => {
  const { Client, Pool } = require('pg');
  const url = new URL(server);
  assert(['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname), 'Use a local PostgreSQL test instance');
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const database = 'extra_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE ${database}`);
  url.pathname = '/' + database;
  const pool = new Pool({ connectionString: url.toString(), max: 8 });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP DATABASE ${database}`); }
    finally { await admin.end(); }
  });
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;
    CREATE TABLE public.staff_accounts (
      id uuid PRIMARY KEY, role text NOT NULL, active boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const migrations = join(__dirname, '..', 'supabase', 'migrations');
  for (const file of [
    '034_extra_native_support_chat.sql', '035_extra_support_sale_auto_assignment.sql',
    '036_extra_support_atomic_staff_actions.sql', '037_extra_messenger_page_chat_integration.sql',
    '038_extra_messenger_psid_entropy_fix.sql', '20261124201617_messenger_ai_conversation_ownership.sql',
  ]) await pool.query(readFileSync(join(migrations, file), 'utf8'));

  const page = '12345';
  const sale = randomUUID();
  await pool.query("INSERT INTO public.staff_accounts (id, role, active) VALUES ($1, 'sale', true)", [sale]);
  const rpc = async (name, ...args) => (await pool.query(
    `SELECT public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) AS result`, args
  )).rows[0].result;
  const ai = (name, ...args) => rpc('extra_messenger_ai_' + name, ...args);
  const ingest = (psid, mid, options = {}) => ai('ingest', page, psid, mid,
    'Please quote two tickets', options.at ?? null, options.referral ?? null, options.human ?? false);
  const begin = (claim, body = 'Here are the available seats.') => ai('begin_send',
    claim.chat_id, claim.token, claim.through_message_id, body, { lastMessageId: claim.through_message_id }, true, true);
  const staff = (chat, request = randomUUID(), seen = null) => ai('begin_staff_send',
    chat, null, true, 'I can help with your booking.', 'Staff', request, seen);
  const state = async (id) => (await pool.query('SELECT * FROM public.extra_support_chats WHERE id = $1', [id])).rows[0];
  const history = async (id) => (await pool.query('SELECT sender, external_message_id FROM public.extra_support_messages WHERE chat_id = $1 ORDER BY id', [id])).rows;
  const lastHumanAgo = (chat, seconds) => pool.query(
    "UPDATE public.extra_support_chats SET messenger_last_human_at = clock_timestamp() - ($2::int * INTERVAL '1 second') WHERE id = $1", [chat, seconds]);

  await t.test('feature-off chats retain legacy assignment and RPC privileges are restricted', async () => {
    const legacy = await rpc('extra_support_ingest_messenger', page, '55501', 'legacy-mid', 'Legacy text');
    const managed = await ingest('55502', 'managed-mid');
    assert.equal((await rpc('extra_support_dispatch_queue', 64)).assigned, 1);
    assert.equal((await state(legacy.chat_id)).assigned_staff_id, sale);
    assert.equal((await state(managed.chat_id)).assigned_staff_id, null);
    assert.equal((await ai('claim', legacy.chat_id)).outcome, 'not_found');
    const perms = (await pool.query(`SELECT
      has_function_privilege('anon', 'public.extra_messenger_ai_claim(uuid)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.extra_messenger_ai_claim(uuid)', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', 'public.extra_messenger_ai_claim(uuid)', 'EXECUTE') AS backend`)).rows[0];
    assert.deepEqual(perms, { anon: false, authenticated: false, backend: true });
    const service = await pool.connect();
    try {
      await service.query('SET ROLE service_role');
      const due = await service.query('SELECT public.extra_messenger_ai_due($1, 25) AS result', [page]);
      assert(due.rows[0].result.some((chat) => chat.chat_id === managed.chat_id));
    } finally { await service.query('RESET ROLE'); service.release(); }
    assert.deepEqual(await ai('due', '987654', 25), []);
    assert.deepEqual(await ai('due', page, 25, ['55501']), []);
    assert.deepEqual(await ai('due', page, 25, ['55502']), [{ chat_id: managed.chat_id, psid: '55502' }]);
  });

  await t.test('referrals do not schedule outbound and a concurrent redelivery is deduplicated', async () => {
    const referral = await ai('record_referral', page, '55503', { ref: 'show-code-1', adId: '987654', ignored: 'x' }, null);
    assert.equal(referral.outcome, 'recorded');
    assert.equal((await ai('claim', referral.chat_id)).outcome, 'idle');
    const results = await Promise.all(Array.from({ length: 5 }, () => ingest('55503', 'same-mid')));
    assert.equal(results.filter((result) => result.outcome === 'received').length, 1);
    assert.equal(results.filter((result) => result.outcome === 'duplicate').length, 4);
    assert.equal((await history(referral.chat_id)).length, 1);
    const claim = await ai('claim', referral.chat_id);
    assert.deepEqual(claim.referral, { ref: 'show-code-1', adId: '987654' });
    assert.equal((await begin(claim, null)).outcome, 'skipped');
    assert.equal((await ai('claim', referral.chat_id)).outcome, 'idle');
  });

  await t.test('one AI claim wins, a newer customer invalidates the draft, and staff cannot overlap Graph', async () => {
    const messages = await Promise.all(Array.from({ length: 12 }, (_, index) => ingest('55504', 'concurrent-mid-' + index)));
    const chat = messages[0].chat_id;
    assert(messages.every((item) => item.chat_id === chat));
    assert.equal((await history(chat)).length, 12);
    const claims = await Promise.all(Array.from({ length: 4 }, () => ai('claim', chat)));
    assert.equal(claims.filter((item) => item.outcome === 'claimed').length, 1);
    assert.equal(claims.filter((item) => item.outcome === 'busy').length, 3);
    const original = claims.find((item) => item.outcome === 'claimed');
    assert.equal(original.through_message_id, Math.max(...messages.map((message) => message.message_id)));
    const next = await ingest('55504', 'newer-customer');
    assert.equal((await begin(original)).outcome, 'stale');
    const claim = await ai('claim', chat);
    assert.equal(claim.through_message_id, next.message_id);
    assert.equal((await begin(claim)).outcome, 'ready');
    assert.equal((await staff(chat)).outcome, 'busy');
    assert.equal((await ai('takeover', chat, null, true)).outcome, 'busy');
    assert.equal((await ai('confirm_echo', page, '55504', claim.token, 'ai-ack-mid', 'ai')).outcome, 'sent');
    assert.equal((await ai('finish', chat, claim.token, 'sent', 'ai-ack-mid')).outcome, 'sent');
    assert.equal((await staff(chat, randomUUID(), next.message_id)).outcome, 'conversation_changed');
    assert.equal((await history(chat)).filter((message) => message.sender === 'ai').length, 1);
    const final = await state(chat);
    assert(final.messenger_last_ai_at);
    assert.equal(final.messenger_last_human_at, null);
    assert(final.messenger_ai_disclosed);
  });

  await t.test('an AI Send API authorization races a human send as a single winner', async () => {
    const { chat_id: chat } = await ingest('55510', 'staff-races-ai');
    const draft = await ai('claim', chat);
    const [aiAttempt, staffAttempt] = await Promise.all([begin(draft), staff(chat)]);
    if (aiAttempt.outcome === 'ready') {
      assert.equal(staffAttempt.outcome, 'busy');
      assert.equal((await ai('confirm_echo', page, '55510', draft.token, 'wrong-owner-echo', 'staff')).outcome, 'stale');
      assert.equal((await ai('finish', chat, draft.token, 'sent', 'ai-won-the-race')).outcome, 'sent');
    } else {
      assert.equal(aiAttempt.outcome, 'stale');
      assert.equal(staffAttempt.outcome, 'ready');
      assert.equal((await ai('finish_staff_send', chat, staffAttempt.token, 'sent', 'staff-won-the-race')).outcome, 'sent');
    }
    assert.equal((await history(chat)).length, 2);
  });

  await t.test('manual claim, 179/180-second boundary, and renewed human activity', async () => {
    const { chat_id: chat } = await ingest('55505', 'retry-after-pause');
    const claim = await ai('claim', chat);
    assert.equal((await rpc('extra_support_staff_route', chat, sale, false, 'claim', null)).outcome, 'assigned');
    assert.equal((await begin(claim)).outcome, 'stale');
    assert.equal((await ai('claim', chat)).outcome, 'human_active');
    await lastHumanAgo(chat, 179);
    assert.equal((await ai('claim', chat)).outcome, 'human_active');
    assert(!(await ai('due', page, 100)).some((item) => item.chat_id === chat));
    assert.equal((await ai('takeover', chat, sale, false)).outcome, 'taken_over');
    assert.equal((await ai('claim', chat)).outcome, 'human_active');
    const edge = (await pool.query(`SELECT
      extra_messenger_private.human_active('2026-11-25T00:00:00Z', '2026-11-25T00:02:59.999999Z') AS before,
      extra_messenger_private.human_active('2026-11-25T00:00:00Z', '2026-11-25T00:03:00Z') AS exact`)).rows[0];
    assert.deepEqual(edge, { before: true, exact: false });
    await lastHumanAgo(chat, 180);
    assert((await ai('due', page, 100)).some((item) => item.chat_id === chat));
    assert.equal((await ai('claim', chat)).outcome, 'claimed');
    assert.equal((await state(chat)).assigned_staff_id, null);
  });

  await t.test('a native reply before the first tracked customer message pauses the initial AI turn', async () => {
    const native = await ai('record_human_echo', page, '55511', 'native-staff-first', 'How can I help?', null);
    const customer = await ingest('55511', 'after-native-staff');
    assert.equal(native.chat_id, customer.chat_id);
    assert.equal((await ai('claim', native.chat_id)).outcome, 'human_active');
    await lastHumanAgo(native.chat_id, 180);
    const resumed = await ai('claim', native.chat_id);
    assert.equal(resumed.outcome, 'claimed');
    assert.equal(resumed.greeted, true);
  });

  await t.test('customer human request sticks through expiry and stale echoes, with no repeated greeting', async () => {
    const { chat_id: chat } = await ingest('55506', 'human-request', { human: true });
    const staleTime = new Date(Date.now() - 120000);
    await ai('record_human_echo', page, '55506', 'older-staff-echo', 'An earlier reply', staleTime);
    assert((await state(chat)).messenger_human_requested);
    await lastHumanAgo(chat, 360);
    assert.equal((await ai('claim', chat)).outcome, 'human_requested');
    assert.equal((await ai('release_human', chat, null, true)).outcome, 'human_requested');
    assert.equal((await rpc('extra_support_dispatch_queue', 64)).assigned, 1);
    assert.equal((await state(chat)).assigned_staff_id, sale);
    assert.equal((await ai('takeover', chat, sale, false)).outcome, 'taken_over');
    assert((await state(chat)).messenger_human_requested);
    const id = randomUUID();
    const send = await staff(chat, id);
    assert.equal(send.outcome, 'ready');
    assert.equal((await staff(chat, id)).outcome, 'busy');
    assert.equal((await ai('confirm_echo', page, '55506', send.token, 'staff-ack-mid', 'staff')).outcome, 'sent');
    assert.equal((await ai('finish_staff_send', chat, send.token, 'sent', 'staff-ack-mid')).outcome, 'sent');
    assert.equal((await staff(chat, id)).outcome, 'sent');
    assert.equal((await history(chat)).filter((message) => message.external_message_id === 'staff-ack-mid').length, 1);
    assert.equal((await state(chat)).messenger_human_requested, false);
    await ingest('55506', 'new-human-era-message');
    assert.equal((await ai('claim', chat)).outcome, 'human_active');
    const before = (await state(chat)).messenger_last_human_at;
    assert.equal((await ai('record_human_echo', page, '55506', 'out-of-order-echo', 'Previous text', staleTime)).outcome, 'recorded');
    assert.deepEqual((await state(chat)).messenger_last_human_at, before);
    await lastHumanAgo(chat, 180);
    const resumed = await ai('claim', chat);
    assert.equal(resumed.outcome, 'claimed');
    assert.equal(resumed.greeted, true);
    assert.equal(resumed.ai_disclosed, false);
  });

  await t.test('an unknown send and a crashed send never retry their covered customer turn', async () => {
    const { chat_id: chat } = await ingest('55507', 'unknown-graph');
    const claim = await ai('claim', chat);
    assert.equal((await begin(claim)).outcome, 'ready');
    assert.equal((await ai('finish', chat, claim.token, 'unknown', null)).outcome, 'unknown');
    assert.equal((await ai('claim', chat)).outcome, 'idle');
    assert.equal((await staff(chat)).outcome, 'delivery_unconfirmed');
    assert.equal((await history(chat)).length, 1);
    const second = await ingest('55507', 'new-turn-unknown');
    const after = await ai('claim', chat);
    assert.equal(after.greeted, true);
    assert.equal(after.context.lastMessageId, claim.through_message_id);
    assert.equal(after.through_message_id, second.message_id);
    assert.equal((await begin(after)).outcome, 'ready');
    await pool.query("UPDATE extra_messenger_private.send_attempts SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE token = $1", [after.token]);
    assert.equal((await ai('claim', chat)).outcome, 'idle');
    assert.equal((await ai('confirm_echo', page, '55507', claim.token, 'late-first-ack', 'ai')).outcome, 'sent');
    assert.equal((await state(chat)).messenger_ai_context.lastMessageId, after.through_message_id);
  });

  await t.test('a delayed app-owned staff echo preserves its signed send time', async () => {
    const { chat_id: chat } = await ingest('55512', 'staff-echo-timing');
    const send = await staff(chat);
    assert.equal(send.outcome, 'ready');
    await pool.query(`UPDATE extra_messenger_private.send_attempts
      SET sending_at = clock_timestamp() - INTERVAL '300 seconds', lease_until = clock_timestamp() - INTERVAL '270 seconds'
      WHERE token = $1`, [send.token]);
    await lastHumanAgo(chat, 300);
    assert.equal((await ai('finish_staff_send', chat, send.token, 'unknown', null)).outcome, 'unknown');
    await ingest('55512', 'staff-echo-new-turn');
    const sentAt = new Date(Date.now() - 290000);
    assert.equal((await ai('confirm_echo', page, '55512', send.token, 'signed-staff-echo', 'staff', sentAt)).outcome, 'sent');
    assert.deepEqual((await state(chat)).messenger_last_human_at, sentAt);
    assert.equal((await ai('claim', chat)).outcome, 'claimed');
  });

  await t.test('definitive rejection preserves unsent greeting flags and the Meta 24-hour window is enforced', async () => {
    const { chat_id: expired } = await ingest('55508', 'old-window', { at: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    assert.equal((await ai('claim', expired)).outcome, 'window_closed');
    assert(!(await ai('due', page, 100)).some((item) => item.chat_id === expired));
    const { chat_id: chat } = await ingest('55509', 'rejected-graph');
    const claim = await ai('claim', chat);
    assert.equal((await begin(claim)).outcome, 'ready');
    assert.equal((await ai('finish', chat, claim.token, 'rejected', null)).outcome, 'rejected');
    assert.equal((await ai('claim', chat)).outcome, 'idle');
    await ingest('55509', 'reject-next-turn');
    const after = await ai('claim', chat);
    assert.equal(after.outcome, 'claimed');
    assert.equal(after.context.lastMessageId, claim.through_message_id);
    assert.equal(after.greeted, false);
    assert.equal(after.ai_disclosed, false);
  });
});

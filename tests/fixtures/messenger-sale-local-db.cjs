const { createHmac, randomBytes } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createServer, request } = require('node:http');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const repo = resolve(__dirname, '../..');
const dir = process.env.EXTRA_MESSENGER_TEST_FIXTURE_DIR || join(tmpdir(), 'extra-messenger-postgrest');
const host = '127.0.0.1';
const port = 55441;
const database = 'extra_messenger_pilot_local';
const gatewayRole = 'extra_messenger_local_api';
const staffId = '10000000-0000-4000-8000-000000000001';
const page = '991001';
const appId = '991002';
const psids = '991003,991004,991005';
const signingKey = randomBytes(32).toString('hex');
const jwtBody = [ { alg: 'HS256', typ: 'JWT' }, { role: 'service_role', exp: Math.floor(Date.now()/1000) + 86400 } ]
 .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
const jwt = `${jwtBody}.${createHmac('sha256', signingKey).update(jwtBody).digest('base64url')}`;

async function configure() {
 const { Client } = require('pg');
 mkdirSync(dir, { recursive: true, mode: 0o700 });
 const admin = new Client({host, port, user: 'postgres', database: 'postgres'});
 await admin.connect();
 try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
  if (exists.rowCount) throw new Error('Local fixture already exists. Refusing to overwrite it.');
  await admin.query(`CREATE DATABASE ${database} WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${gatewayRole}') THEN CREATE ROLE ${gatewayRole} NOINHERIT LOGIN; END IF;
   END $$;
   GRANT anon, service_role TO ${gatewayRole};`);
 } finally { await admin.end(); }
 const fixture = new Client({host, port, user: 'postgres', database});
 await fixture.connect();
 try {
  await fixture.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;`);
  const files = [
   '001_reporting', '002_show_inventory', '004_show_management', '005_staff_reporting', '012_sepay_payments',
   '019_venue_seat_rows', '025_extra_admin_seat_sale_locks', '034_extra_native_support_chat',
   '035_extra_support_sale_auto_assignment', '036_extra_support_atomic_staff_actions',
   '037_extra_messenger_page_chat_integration', '038_extra_messenger_psid_entropy_fix', '20261124201617_messenger_ai_conversation_ownership'
  ];
  for (const file of files) await fixture.query(readFileSync(join(repo, 'supabase', 'migrations', file + '.sql'), 'utf8'));
  await fixture.query(`INSERT INTO public.staff_accounts (id, username, display_name, role, password_hash) VALUES ($1, 'sale-fixture', 'Sale thử nghiệm', 'sale', 'fixture-disabled-login')`, [staffId]);
  await fixture.query(`INSERT INTO public.managed_shows (id, artist, title, show_date, show_time, venue_id, prices)
   VALUES ('extra-messenger-fixture', 'Nghệ sĩ Thử Nghiệm', 'Đêm nhạc Thử Nghiệm', CURRENT_DATE + 20, '19:30', 'ccc',
    '{"A":799000,"B":649000,"C":499000,"D":349000}')`);
  await fixture.query(`INSERT INTO public.venue_seat_rows (venue_id, row_code, seat_count)
   VALUES ('ccc', 'A', 30), ('ccc', 'B', 30), ('ccc', 'C', 30), ('ccc', 'D', 30), ('ccc', 'E', 30), ('ccc', 'F', 30), ('ccc', 'G', 30), ('ccc', 'H', 30);
   INSERT INTO public.extra_show_blocked_seats (show_id, seat_id) VALUES ('extra-messenger-fixture', 'A01');
   INSERT INTO public.extra_payment_orders
     (access_token, code, show_id, venue_id, seats, amount_vnd, buyer_name, buyer_phone, buyer_email, status)
    VALUES ('fixture-hold', 'EX0000000000000001', 'extra-messenger-fixture', 'ccc', '{A02}', 799000, 'Dữ liệu mẫu', '', '', 'pending'),
           ('fixture-paid', 'EX0000000000000002', 'extra-messenger-fixture', 'ccc', '{A03}', 799000, 'Dữ liệu mẫu', '', '', 'paid');
   INSERT INTO public.ticket_sales (order_code, event_name, venue_name, customer_name, seats, amount_vnd, payment_method, payment_verified, show_id)
    VALUES ('EX0000000000000003', 'Đêm nhạc Thử Nghiệm', 'CCC', 'Dữ liệu mẫu', '{A04}', 799000, 'fixture', true, 'extra-messenger-fixture');`);
 } finally { await fixture.end(); }
 const env = {
  SUPABASE_URL: 'http://127.0.0.1:55443', SUPABASE_SERVICE_ROLE_KEY: jwt,
  META_MESSENGER_AI_MODE: 'test', META_MESSENGER_PAGE_ID: page, META_MESSENGER_AI_TEST_PAGE_ID: page,
  META_MESSENGER_AI_TEST_PSIDS: psids, META_MESSENGER_AI_APP_ID: appId,
  META_MESSENGER_PAGE_ACCESS_TOKEN: 'fixture-local-only-' + randomBytes(24).toString('hex'),
  META_MESSENGER_APP_SECRET: randomBytes(32).toString('hex'), META_MESSENGER_VERIFY_TOKEN: randomBytes(32).toString('hex'),
  META_MESSENGER_AI_WORKER_SECRET: randomBytes(32).toString('hex'), ADMIN_MEDIA_SECRET: randomBytes(32).toString('hex'),
  MESSENGER_SALE_REFERRAL_SHOWS_JSON: JSON.stringify({ 'fixture-ref': 'extra-messenger-fixture' }),
  EXTRA_LOCAL_STAFF_ID: staffId, EXTRA_LOCAL_DATABASE_URL: `postgres://postgres@${host}:${port}/${database}`,
 };
 const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
 writeFileSync(join(dir, 'env.sh'), Object.entries(env).map(([key, value]) => `export ${key}=${quote(value)}`).join('\n') + '\n', { mode: 0o600 });
 writeFileSync(join(dir, 'config'), `db-uri = "postgres://${gatewayRole}@${host}:${port}/${database}"\n` +
  `db-schemas = "public"\ndb-anon-role = "anon"\nserver-host = "127.0.0.1"\nserver-port = 55442\n` +
  `jwt-secret = "${signingKey}"\nlog-level = "warn"\n`, { mode: 0o600 });
 console.log('Isolated UTF8 fixture ready, 13 project migrations and synthetic catalog, seats, payment records and staff');
}
function serve() {
 createServer((req, res) => {
  const root = '/rest/v1';
  if (!req.url?.startsWith(root + '/')) return res.writeHead(404).end();
  const upstream = request({ hostname: host, port: 55442, method: req.method,
   path: req.url.slice(root.length), headers: { ...req.headers, host: `${host}:55442` } }, response => {
   res.writeHead(response.statusCode, response.headers);
   response.pipe(res);
  });
  upstream.on('error', () => res.writeHead(502).end());
  req.pipe(upstream);
 }).listen(55443, host, () => console.log('Local test API listening on 127.0.0.1:55443/rest/v1'));
}

const action = process.argv[2];
if (action === 'seed') configure().catch(error => { console.error(error.message); process.exitCode = 1; });
else if (action === 'serve') serve();
else {
 console.error('Usage: node tests/fixtures/messenger-sale-local-db.cjs seed|serve');
 process.exitCode = 1;
}

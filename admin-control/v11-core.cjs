'use strict';

const {readFile} = require('node:fs/promises');
const {join} = require('node:path');

const staging = 'staging-v11';
const v11Database = 'extra_os_v11';
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keyPattern = /^[a-zA-Z0-9_-]{1,150}$/;
const maxVnd = 1_000_000_000_000_000;
const vnd = value => Number.isSafeInteger(value) && value >= 0 && value <= maxVnd;
const dayVN = (now = new Date()) => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

class V11Error extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requireValue(condition, code = 'INVALID', status = 400) {
  if (!condition) throw new V11Error(code, status);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function recordAudit(client, actor, event, scope = {}, details = {}) {
  await client.query(`
    insert into os_v11_audit(actor_id,event,scope,details) values($1,$2,$3,$4)
  `, [actor?.id ?? null, event, JSON.stringify(scope), JSON.stringify(details)]);
}

function checkDeployment(env) {
  requireValue(env.RAILWAY_ENVIRONMENT_NAME === staging, 'V11_STAGING_REQUIRED');
  const database = new URL(env.DATABASE_URL ?? '');
  requireValue(['postgres:', 'postgresql:'].includes(database.protocol) &&
    database.hostname.endsWith('.railway.internal') && database.pathname === '/' + v11Database, 'V11_DATABASE_REQUIRED');
  const forbidden = [
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_URL', 'SEPAY_WEBHOOK_KEY',
    'META_CAPI_ACCESS_TOKEN', 'EXTRA_OS_META_PAGE_TOKEN', 'EXTRA_OS_META_ADS_TOKEN', 'EXTRA24H_META_ADS_TOKEN',
    'EXTRA24H_META_PAGE_TOKEN', 'EXTRA24H_IMAGE_API_KEY', 'EXTRA_OS_DRIVE_REFRESH_TOKEN'
  ];
  requireValue(!forbidden.some(key => env[key]) && env.EXTRA_OS_MARKETING_LIVE !== 'true', 'PROVIDER_WRITE_DISABLED');
  if (env.EXTRA_OS_OPENAI_API_KEY) {
    const calls = Number(env.EXTRA_OS_DIRECTOR_MAX_CALLS_PER_DAY);
    requireValue(env.EXTRA_OS_V11_AI_APPROVED === 'true' && Number.isInteger(calls) && calls >= 13 && calls <= 78 &&
      !env.EXTRA_OS_DIRECTOR_OVERRIDE_TOTAL, 'AI_BUDGET_REQUIRED');
  }
}

async function migrateV11(pool, {verifyDatabase = true} = {}) {
  if (verifyDatabase) {
    const {rows: [row]} = await pool.query('select current_database() as name');
    requireValue(row.name === v11Database, 'V11_DATABASE_REQUIRED');
  }
  const sql = await readFile(join(__dirname, 'migrations', '001-extra-os-v11.sql'), 'utf8');
  await transaction(pool, async client => {
    await client.query('select pg_advisory_xact_lock(71501211)');
    await client.query(sql);
  });
}

module.exports = {
  V11Error, requireValue, transaction, recordAudit, migrateV11, checkDeployment, staging, v11Database,
  uuidPattern, keyPattern, maxVnd, vnd, dayVN, validDay
};

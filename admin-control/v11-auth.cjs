'use strict';

const {randomBytes, randomUUID, createHash, scrypt, timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');
const {keyPattern, uuidPattern, requireValue, transaction, recordAudit} = require('./v11-core.cjs');

const derive = promisify(scrypt);
const ownerId = '8eba5ce8-fe6c-41a0-930c-f1ccfef4e57e';
const usernamePattern = /^[a-z][a-z0-9_.-]{2,39}$/;
const secretPattern = /^[a-f0-9]{64}$/;
const scopes = ['platform', 'account', 'location', 'show', 'camera', 'dataGroup'];
const permissions = Object.freeze({
  ADS_MANAGER: ['ads.read', 'ads.analyze', 'ads.pause', 'ads.optimize', 'ads.create', 'ads.increase', 'ads.execute'],
  SALE_MANAGER: ['analysis.read', 'director.read'],
  FINANCE_MANAGER: ['cost.read', 'cost.write', 'cost.approve', 'analysis.read', 'audit.read'],
  OPERATIONS_MANAGER: ['analysis.read', 'operations.read', 'operations.write', 'operations.approve', 'director.read', 'source.read'],
  CAMERA_ADMIN: ['camera.read', 'camera.status', 'camera.snapshot', 'camera.live', 'operations.read'],
  AI_DIRECTOR: ['analysis.read', 'director.read', 'ads.read', 'ads.analyze'],
  AI_AGENT: ['analysis.read', 'director.read'],
  AI_AUDITOR: ['audit.read', 'audit.report', 'cost.read', 'ads.read', 'source.read', 'analysis.read']
});
const ownerOnly = new Set(['access.manage','ads.approve','ads.configure','ads.stop','camera.configure',
  'director.approve','director.write','source.refresh','source.write','memory.write']);
const knownPermissions = new Set([...Object.values(permissions).flat(),...ownerOnly]);
const secret = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const validPassword = password => typeof password === 'string' && password.length >= 16 && Buffer.byteLength(password) <= 256;

async function encodePassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

async function setupOwner(pool, password) {
  requireValue(validPassword(password) && password.length >= 24, 'BOOTSTRAP_REQUIRED');
  if ((await pool.query('select 1 from os_v11_users where id=$1', [ownerId])).rowCount) return;
  await pool.query(`
    insert into os_v11_users(id,username,display_name,role,password_hash) values($1,'owner','Chủ doanh nghiệp','OWNER',$2)
    on conflict (id) do nothing
  `, [ownerId, await encodePassword(password)]);
}

function validScope(scope) {
  return scope && Object.keys(scope).every(key => scopes.includes(key) && keyPattern.test(scope[key]) &&
    (key !== 'platform' || ['music', '24h'].includes(scope[key])));
}

function allowed(actor, permission, context = {}) {
  if (!actor || !knownPermissions.has(permission) || !validScope(context)) return false;
  if (actor.role === 'OWNER') return true;
  if (ownerOnly.has(permission) || !permissions[actor.role]?.includes(permission)) return false;
  return actor.grants.some(grant => grant.permission === permission && validScope(grant.scope) &&
    Object.entries(grant.scope).every(([key, value]) => context[key] === value));
}

function check(actor, permission, context) {
  requireValue(allowed(actor, permission, context), 'FORBIDDEN', 403);
}

async function invite(pool, actor, {username, displayName, role}) {
  check(actor, 'access.manage');
  requireValue(usernamePattern.test(username ?? '') && username !== 'owner' && typeof displayName === 'string' &&
    displayName.trim().length > 0 && displayName.length <= 120 && Object.hasOwn(permissions, role));
  const id = randomUUID();
  const code = secret();
  return transaction(pool, async client => {
    const {rowCount} = await client.query(`
      insert into os_v11_users(id,username,display_name,role,invite_hash,invite_expires_at)
      values($1,$2,$3,$4,$5,now()+interval '1 day') on conflict(username) do nothing
    `, [id, username, displayName.trim(), role, digest(code)]);
    requireValue(rowCount === 1, 'USERNAME_EXISTS', 409);
    await recordAudit(client, actor, 'access.invited', {}, {id, role});
    return code;
  });
}

async function acceptInvite(pool, code, password) {
  requireValue(secretPattern.test(code ?? '') && validPassword(password), 'INVITE_INVALID');
  const codeHash = digest(code);
  const {rowCount} = await pool.query(`
    select 1 from os_v11_users where invite_hash=$1 and invite_expires_at>now() and active and password_hash is null
  `, [codeHash]);
  requireValue(rowCount === 1, 'INVITE_INVALID');
  const passwordHash = await encodePassword(password);
  return transaction(pool, async client => {
    const {rows: [user]} = await client.query(`
      update os_v11_users set password_hash=$2,invite_hash=null,invite_expires_at=null
      where invite_hash=$1 and invite_expires_at>now() and active and password_hash is null returning id,username
    `, [codeHash, passwordHash]);
    requireValue(user, 'INVITE_INVALID');
    await recordAudit(client, user, 'access.activated');
    return user.username;
  });
}

async function authenticate(pool, username, password) {
  const {rows: [user]} = await pool.query(`
    select id,password_hash from os_v11_users where username=$1 and active and password_hash is not null
  `, [usernamePattern.test(username ?? '') ? username : '']);
  const [salt, expected] = (user?.password_hash ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
  const actual = await derive(validPassword(password) ? password : '', salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && validPassword(password) ? user?.id ?? null : null;
}

async function currentActor(pool, tokenHash) {
  const {rows: [row]} = await pool.query(`
    select u.id,u.username,u.role,u.display_name,s.token_hash,s.csrf,
      coalesce((select jsonb_agg(jsonb_build_object('permission',g.permission,'scope',g.scope))
        from os_v11_grants g where g.user_id=u.id),'[]'::jsonb) as grants
    from os_v11_sessions s join os_v11_users u on u.id=s.actor_id
    where s.token_hash=$1 and s.expires_at>now() and u.active
  `, [tokenHash]);
  return row ?? null;
}

async function setGrant(pool, actor, {userId, permission, scope, revoke = false}) {
  check(actor, 'access.manage');
  requireValue(uuidPattern.test(userId ?? '') && validScope(scope));
  return transaction(pool, async client => {
    const {rows: [user]} = await client.query('select role from os_v11_users where id=$1 for update', [userId]);
    requireValue(user && permissions[user.role]?.includes(permission), 'FORBIDDEN', 403);
    const values = [userId, permission, JSON.stringify(scope)];
    const {rowCount} = revoke ? await client.query(`
      delete from os_v11_grants where user_id=$1 and permission=$2 and scope=$3
    `, values) : await client.query(`
      insert into os_v11_grants(user_id,permission,scope,id) values($1,$2,$3,$4) on conflict do nothing
    `, [...values, randomUUID()]);
    if (rowCount) await recordAudit(client, actor, revoke ? 'access.revoked' : 'access.granted', scope, {userId, permission});
  });
}

async function disableAccount(pool, actor, id) {
  check(actor, 'access.manage');
  requireValue(uuidPattern.test(id ?? '') && id !== ownerId);
  await transaction(pool, async client => {
    const {rowCount} = await client.query(`
      update os_v11_users set active=false,invite_hash=null,invite_expires_at=null where id=$1 and active
    `, [id]);
    if (!rowCount) return;
    await client.query('delete from os_v11_sessions where actor_id=$1', [id]);
    await recordAudit(client, actor, 'access.disabled', {}, {id});
  });
}

module.exports = {
  scopes, permissions, allowed, check, setupOwner, invite, acceptInvite, authenticate,
  currentActor, setGrant, disableAccount, digest, secret
};

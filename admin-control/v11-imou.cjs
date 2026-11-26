'use strict';

const {createHash, createHmac, randomUUID} = require('node:crypto');
const {check} = require('./v11-auth.cjs');
const {V11Error, requireValue, transaction, dayVN, recordAudit} = require('./v11-core.cjs');

const cameraId = 'imou-sidewalk';
const cameraScope = {platform: '24h', location: 'sidewalk', camera: cameraId, dataGroup: 'camera'};
const centers = new Set(['sg', 'fk', 'or']);
const providerCodes = new Set(['SN1001', 'SN1002', 'TK1001', 'TK1002', 'OP1002', 'OP1003', 'OP1009', 'OP1011',
  'OP1013', 'OP1014', 'DV1002', 'DV1007', 'LV1001', 'LV1002']);
const methods = {
  token: 'accessToken',
  list: 'v2/device.detail.list',
  status: 'v2/device.status.get',
  image: 'setDeviceSnap',
  live: 'getLiveStreamInfo'
};
const knownStates = {0:'offline', 1:'online', 3:'upgrading', 4:'sleep'};
const frameLimit = 2 * 1024 * 1024;
const playlistLimit = 32 * 1024;
const streamTtlMs = 120_000;
const mediaHost = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:imoulife\.com|easy4ip\.com|lechange\.com|imou\.com|amazonaws\.com|aliyuncs\.com)$/i;
const safeReason = error => providerCodes.has(error?.code) || /^IMOU_[A-Z_]+$/.test(error?.code ?? '') ?
  error.code : 'IMOU_UNAVAILABLE';

function imouConfig(env) {
  const serial = env.IMOU_PILOT_SERIAL ?? '';
  const channel = env.IMOU_PILOT_CHANNEL ?? '';
  const center = centers.has(env.IMOU_DATA_CENTER) ? env.IMOU_DATA_CENTER : null;
  const appId = env.IMOU_APP_ID, appSecret = env.IMOU_APP_SECRET;
  const deviceConfigured = /^[A-Za-z0-9_-]{4,64}$/.test(serial) && /^\d{1,3}$/.test(channel);
  return {appId, appSecret, serial, channel, center, configured: Boolean(appId && appSecret && center && deviceConfigured),
    credentialsPresent: Boolean(appId && appSecret), deviceConfigured};
}

function signImou(secret, time, nonce) {
  const key = createHash('sha256').update(secret, 'utf8').digest('hex');
  return createHmac('sha256', key).update(`time:${time},nonce:${nonce},appSecret:${secret}`, 'utf8').digest('base64');
}

async function boundedBody(response, limit) {
  const declared = response.headers.get('content-length');
  requireValue(!declared || (Number(declared) > 0 && Number(declared) <= limit), 'IMOU_MEDIA_SIZE', 502);
  requireValue(response.body, 'IMOU_EMPTY_RESPONSE', 502);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValue(size <= limit, 'IMOU_MEDIA_SIZE', 502);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size);
}

function makeImou({env = process.env, request = fetch, clock = Date.now, reserve = async () => {}} = {}) {
  const config = imouConfig(env);
  let cached;
  let pending;

  async function call(method, params, {canRetry = true, media = false} = {}) {
    requireValue(config.configured, 'IMOU_NOT_CONFIGURED', 409);
    const id = randomUUID();
    const nonce = randomUUID();
    const time = Math.floor(clock() / 1000);
    const body = {id, system: {ver:'1.0', appId:config.appId, time, nonce, sign:signImou(config.appSecret, time, nonce)}, params};
    await reserve({method, media});
    let response;
    try {
      response = await request('https://openapi-' + config.center + '.easy4ip.com/openapi/' + method, {
        method: 'POST', redirect: 'error', headers: {'content-type':'application/json', accept:'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(6500)
      });
    } catch {
      if (canRetry) return call(method, params, {canRetry:false, media});
      throw new V11Error('IMOU_TIMEOUT_OR_NETWORK', 502);
    }
    if (response.status >= 500 && canRetry) {
      await response.body?.cancel();
      return call(method, params, {canRetry:false, media});
    }
    requireValue(response.ok, response.status === 429 ? 'IMOU_LIMIT' : 'IMOU_PROVIDER_HTTP', 502);
    let result;
    try {
      result = JSON.parse((await boundedBody(response, 512 * 1024)).toString('utf8'));
    } catch {
      throw new V11Error('IMOU_RESPONSE', 502);
    }
    requireValue(result.id === id && typeof result.result?.code === 'string', 'IMOU_RESPONSE', 502);
    const code = result.result.code;
    requireValue(code === '0', providerCodes.has(code) ? code : 'IMOU_PROVIDER_ERROR', 502);
    return result.result.data;
  }

  async function getToken() {
    if (cached?.expiresAt - clock() > 60_000) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const token = await call(methods.token, {});
      const expiresIn = Number(token?.expireTime);
      requireValue(typeof token?.accessToken === 'string' && token.accessToken.length > 0 && token.accessToken.length <= 4096 &&
        Number.isInteger(expiresIn) && expiresIn > 0 && expiresIn <= 3 * 86400, 'IMOU_TOKEN_RESPONSE', 502);
      cached = {token: token.accessToken, expiresAt: clock() + expiresIn * 1000};
      return cached.token;
    })().finally(() => {pending = null;});
    return pending;
  }

  async function authenticated(id, method, params, options) {
    requireValue(id === cameraId, 'FORBIDDEN', 403);
    const token = await getToken();
    try {
      return await call(method, {...params, token}, options);
    } catch (error) {
      if (error.code !== 'TK1002') throw error;
      if (cached?.token === token) cached = null;
      if (method === methods.image) throw error;
      const replacement = await getToken();
      return call(method, {...params, token: replacement}, {...options, canRetry:false});
    }
  }

  async function list(id) {
    const data = await authenticated(id, methods.list, {deviceList:[{deviceId:config.serial, channelId:[config.channel]}]});
    const device = Array.isArray(data?.deviceList) ? data.deviceList.find(entry => entry.deviceId === config.serial) : null;
    requireValue(device, 'IMOU_CAMERA_NOT_FOUND', 502);
    return {name:String(device.deviceName ?? '').slice(0,120) || null, model:String(device.deviceModel ?? '').slice(0,100) || null};
  }

  async function status(id) {
    const data = await authenticated(id, methods.status, {deviceId:config.serial});
    requireValue(data?.deviceId === config.serial && Object.hasOwn(knownStates, data.online), 'IMOU_RESPONSE', 502);
    const channel = Array.isArray(data.channels) ? data.channels.find(entry => entry.channelId === config.channel) : null;
    if (data.online === 1) requireValue(channel && Object.hasOwn(knownStates, channel.online), 'IMOU_CHANNEL_NOT_FOUND', 502);
    return knownStates[data.online === 1 ? channel.online : data.online];
  }

  async function snapshot(id) {
    const data = await authenticated(id, methods.image, {deviceId:config.serial, channelId:config.channel},
      {canRetry:false, media:true});
    requireValue(typeof data?.url === 'string', 'IMOU_RESPONSE', 502);
    return data.url;
  }

  async function live(id) {
    const data = await authenticated(id, methods.live, {deviceId:config.serial, channelId:config.channel}, {media:true});
    const stream = Array.isArray(data?.streams) ? data.streams.find(item => item.status === '1' &&
      typeof item.hls === 'string' && item.hls.startsWith('https:')) : null;
    requireValue(stream, 'IMOU_LIVE_NOT_PROVISIONED', 409);
    return stream.hls;
  }

  return {list, status, snapshot, live};
}

async function configureCamera(pool, actor, policy) {
  check(actor, 'camera.configure', cameraScope);
  const {calls, snapshots, bytes, interval, retention, aiDay, aiMonth, host, termsVerified, termsReference, revision} = policy;
  requireValue([calls,snapshots,bytes,interval,retention,aiDay,aiMonth,revision].every(Number.isSafeInteger) &&
    calls >= 0 && calls <= 300 && snapshots >= 0 && snapshots <= 30 && bytes >= 0 && bytes <= 25_000_000 &&
    interval >= 120 && interval <= 86400 && retention === 0 && aiDay >= 0 && aiDay <= aiMonth && aiMonth <= 1_000_000_000 &&
    revision >= 0 && (!host || mediaHost.test(host)) && typeof termsVerified === 'boolean' &&
    (!termsVerified || (typeof termsReference === 'string' && termsReference.trim().length > 0 && termsReference.length <= 160)));
  return transaction(pool, async client => {
    if (revision === 0) await client.query('insert into os_v11_camera_policy(camera) values($1) on conflict do nothing', [cameraId]);
    const {rows: [current]} = await client.query('select revision from os_v11_camera_policy where camera=$1 for update', [cameraId]);
    requireValue(current?.revision === (revision === 0 ? 1 : revision), 'STALE_REVISION', 409);
    await client.query(`
      update os_v11_camera_policy set api_daily=$2,snapshots_daily=$3,media_bytes_daily=$4,snapshot_interval_s=$5,
        retention_days=$6,ai_day_vnd=$7,ai_month_vnd=$8,media_host=$9,imou_terms_verified=$10,terms_reference=$11,
        revision=revision+1,updated_at=clock_timestamp() where camera=$1
    `, [cameraId, calls, snapshots, bytes, interval, retention, aiDay, aiMonth, host || null, termsVerified,
      termsVerified ? termsReference.trim() : null]);
    await recordAudit(client, actor, 'camera.policy.updated', cameraScope, {calls, snapshots, bytes, interval, retention,
      aiDay, aiMonth, termsVerified, mediaHostConfigured: Boolean(host)});
  });
}

async function reserveCamera(pool, {method, media = false, bytes = 0}) {
  return transaction(pool, async client => {
    const {rows: [policy]} = await client.query('select * from os_v11_camera_policy where camera=$1 for update', [cameraId]);
    requireValue(policy?.imou_terms_verified, 'IMOU_TERMS_UNVERIFIED', 409);
    requireValue(!media || policy.media_host !== null, 'IMOU_MEDIA_HOST_UNVERIFIED', 409);
    const {rows: [clock]} = await client.query('select clock_timestamp() as now');
    const day = dayVN(clock.now);
    await client.query('insert into os_v11_camera_usage(camera,day) values($1,$2) on conflict do nothing', [cameraId, day]);
    const {rows: [usage]} = await client.query('select * from os_v11_camera_usage where camera=$1 and day=$2 for update', [cameraId, day]);
    const apiCalls = usage.calls + (method ? 1 : 0);
    const snapshot = method === methods.image;
    const snapshots = usage.snapshots + (snapshot ? 1 : 0);
    const bytesRequired = snapshot ? frameLimit : method === methods.live ? playlistLimit : bytes;
    const mediaBytes = Number(usage.media_bytes) + bytesRequired;
    requireValue(apiCalls <= policy.api_daily && snapshots <= policy.snapshots_daily &&
      mediaBytes <= Number(policy.media_bytes_daily), 'IMOU_DAILY_LIMIT', 429);
    if (snapshot) requireValue(!usage.snapshot_at || clock.now - usage.snapshot_at >= policy.snapshot_interval_s * 1000,
      'IMOU_SNAPSHOT_INTERVAL', 429);
    await client.query(`
      update os_v11_camera_usage set calls=$3,snapshots=$4,media_bytes=$5,snapshot_at=case when $6 then $7 else snapshot_at end
      where camera=$1 and day=$2
    `, [cameraId, day, apiCalls, snapshots, mediaBytes, snapshot, clock.now]);
    return policy;
  });
}

function safeMediaUrl(raw, host, base) {
  let url;
  try { url = new URL(raw, base); } catch { throw new V11Error('IMOU_MEDIA_URL', 502); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    typeof host === 'string' && mediaHost.test(host) && url.hostname === host.toLowerCase() && url.href.length <= 3500,
  'IMOU_MEDIA_URL', 502);
  return url;
}

function imageType(bytes) {
  if (bytes.length > 3 && bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw new V11Error('IMOU_MEDIA_TYPE', 502);
}

function cameraService(pool, {env = process.env, request = fetch} = {}) {
  const config = imouConfig(env);
  const streams = new Map();
  const imou = makeImou({env, request, reserve: args => reserveCamera(pool, args)});
  const ensure = (actor, permission, id) => {
    requireValue(id === cameraId, 'FORBIDDEN', 403);
    check(actor, permission, cameraScope);
  };
  async function currentPolicy() {
    const {rows: [policy]} = await pool.query('select * from os_v11_camera_policy where camera=$1', [cameraId]);
    return policy;
  }
  async function view(actor) {
    ensure(actor, 'camera.read', cameraId);
    const [policy, status, usage] = await Promise.all([currentPolicy(),
      pool.query('select * from os_v11_camera_status where camera=$1', [cameraId]),
      pool.query('select calls,snapshots,media_bytes from os_v11_camera_usage where camera=$1 and day=$2', [cameraId,dayVN()])]);
    return {policy, status:status.rows[0], usage:usage.rows[0], configured:config.configured,
      credentialsPresent:config.credentialsPresent, deviceConfigured:config.deviceConfigured};
  }
  async function audited(actor, event, fn) {
    try {
      const value = await fn();
      await recordAudit(pool, actor, event, cameraScope, {outcome:'succeeded'});
      return value;
    } catch (error) {
      await recordAudit(pool, actor, event, cameraScope, {outcome:'failed', reason:safeReason(error)});
      throw error;
    }
  }
  async function status(actor, id) {
    ensure(actor, 'camera.status', id);
    return audited(actor, 'camera.status', async () => {
      let state = 'unknown', name = null, model = null, reason = null;
      try {
        state = await imou.status(id);
        ({name, model} = await imou.list(id));
      } catch (error) {
        reason = safeReason(error);
        if (reason === 'DV1007') state = 'offline';
        await pool.query(`
          insert into os_v11_camera_status(camera,status,reason) values($1,$2,$3)
          on conflict(camera) do update set status=excluded.status,reason=excluded.reason,checked_at=clock_timestamp()
        `, [cameraId, state, reason]);
        throw error;
      }
      await pool.query(`
        insert into os_v11_camera_status(camera,status,model,name) values($1,$2,$3,$4)
        on conflict(camera) do update set status=excluded.status,model=excluded.model,name=excluded.name,reason=null,checked_at=clock_timestamp()
      `, [cameraId, state, model, name]);
      return {state, name, model};
    });
  }
  async function fetchMedia(url, limit) {
    let response;
    try {
      response = await request(url, {method:'GET', redirect:'error', signal:AbortSignal.timeout(7000)});
    } catch {
      throw new V11Error('IMOU_MEDIA_NETWORK', 502);
    }
    requireValue(response.ok, 'IMOU_MEDIA_UNAVAILABLE', 502);
    return boundedBody(response, limit);
  }
  async function snapshot(actor, id) {
    ensure(actor, 'camera.snapshot', id);
    return audited(actor, 'camera.snapshot', async () => {
      const policy = await currentPolicy();
      requireValue(policy?.imou_terms_verified && policy.media_bytes_daily >= frameLimit, 'IMOU_TERMS_UNVERIFIED', 409);
      const url = safeMediaUrl(await imou.snapshot(id), policy.media_host);
      const bytes = await fetchMedia(url, frameLimit);
      return {bytes, type:imageType(bytes)};
    });
  }
  async function openLive(actor, id) {
    ensure(actor, 'camera.live', id);
    return audited(actor, 'camera.live.request', async () => {
      const policy = await currentPolicy();
      requireValue(policy?.imou_terms_verified && policy.media_bytes_daily >= frameLimit, 'IMOU_TERMS_UNVERIFIED', 409);
      const url = safeMediaUrl(await imou.live(id), policy.media_host);
      const now = Date.now();
      for (const [key, session] of streams) if (session.expires <= now) streams.delete(key);
      requireValue(streams.size < 20, 'IMOU_LIVE_LIMIT', 429);
      const key = randomUUID();
      streams.set(key, {actorId:actor.id, tokenHash:actor.token_hash, host:policy.media_host, expires:now+streamTtlMs,
        assets:new Map([['index', {url, playlist:true}]])});
      return key;
    });
  }
  async function media(actor, key, assetId) {
    ensure(actor, 'camera.live', cameraId);
    const session = streams.get(key);
    const asset = session?.assets.get(assetId);
    requireValue(asset && session.expires > Date.now() && session.actorId === actor.id &&
      session.tokenHash === actor.token_hash, 'FORBIDDEN', 403);
    const limit = asset.playlist ? playlistLimit : frameLimit;
    const policy = await reserveCamera(pool, {media:true, bytes:limit});
    requireValue(policy.media_host === session.host, 'IMOU_MEDIA_HOST_UNVERIFIED', 409);
    const bytes = await fetchMedia(asset.url, limit);
    if (!asset.playlist) {
      const isTs = bytes[0] === 0x47 && (bytes.length <= 188 || bytes[188] === 0x47);
      const isMp4 = ['ftyp','moof','styp'].includes(bytes.toString('ascii',4,8));
      requireValue(isTs || isMp4, 'IMOU_MEDIA_TYPE', 502);
      return {bytes,type:isTs ? 'video/mp2t' : 'video/mp4'};
    }
    requireValue(bytes.toString('ascii',0,7) === '#EXTM3U', 'IMOU_MEDIA_TYPE', 502);
    const playlist = rewritePlaylist(bytes.toString('utf8'), asset.url, session.host, (url, childPlaylist) => {
      const existing = [...session.assets].find(([, current]) => current.url.href === url.href);
      if (existing) return '/v11/camera/media/' + key + '/' + existing[0];
      requireValue(session.assets.size < 128, 'IMOU_LIVE_LIMIT', 429);
      const id = randomUUID();
      session.assets.set(id,{url,playlist:childPlaylist});
      return '/v11/camera/media/' + key + '/' + id;
    });
    return {bytes:Buffer.from(playlist),type:'application/vnd.apple.mpegurl'};
  }
  return {view, status, snapshot, openLive, media};
}

function rewritePlaylist(playlist, base, host, bind) {
  const safeTags = /^#EXT(?:M3U|INF|-(?:X-)?(?:VERSION|MEDIA-SEQUENCE|TARGETDURATION|DISCONTINUITY(?:-SEQUENCE)?|PROGRAM-DATE-TIME|PLAYLIST-TYPE|ENDLIST|INDEPENDENT-SEGMENTS|MAP|STREAM-INF))(?::|$)/;
  let child = false;
  return playlist.split(/\r?\n/).flatMap(line => {
    if (!line) return [];
    if (!line.startsWith('#')) {
      const path = bind(safeMediaUrl(line, host, base), child);
      child = false;
      return [path];
    }
    requireValue(!line.startsWith('#EXT-X-KEY:') || line === '#EXT-X-KEY:METHOD=NONE', 'IMOU_ENCRYPTED_STREAM', 502);
    if (!safeTags.test(line)) return [];
    if (line.startsWith('#EXT-X-STREAM-INF:')) child = true;
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      requireValue(uri && !line.includes('BYTERANGE'), 'IMOU_MEDIA_TYPE', 502);
      return ['#EXT-X-MAP:URI="' + bind(safeMediaUrl(uri, host, base), false) + '"'];
    }
    requireValue(!line.includes('URI='), 'IMOU_MEDIA_TYPE', 502);
    return [line];
  }).join('\n') + '\n';
}

module.exports = {cameraId, cameraScope, imouConfig, signImou, makeImou, configureCamera, reserveCamera,
  safeMediaUrl, imageType, rewritePlaylist, cameraService};

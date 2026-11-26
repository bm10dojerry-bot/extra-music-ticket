'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const {publicMusicAsset} = require('./music-readonly.cjs');

const release = {
  id: 'dinh-dung-2811',
  venue: 'ccc',
  date: '2026-11-28',
  time: '19:30',
  files: [
    {key: 'poster', label: 'Poster Đình Dũng · CCC Sa Pa', file: 'poster.jpg', kind: 'image', type: 'image/jpeg'},
    {key: 'video', label: 'Video dọc Đình Dũng · 15 giây', file: 'video.mp4', kind: 'video', type: 'video/mp4'}
  ]
};
const retiredPoster = 'https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/public/extra-media/posters/dinh-dung-2811/b3017970-ef76-46ca-a264-89215790d5f3.jpg';
const localFile = asset => path.join(__dirname, 'music-assets', release.id, asset.file);
function isCuratedShow(show) {
  return show?.id === release.id && show.date === release.date && show.venue === release.venue &&
    typeof show.time === 'string' && show.time.slice(0,5) === release.time;
}
function curatedMediaFacts(show) {
  if (!isCuratedShow(show)) return [];
  return release.files.filter(asset => fs.existsSync(localFile(asset))).map(asset => ({
    id: asset.key + ':' + show.id, showId: show.id, label: asset.label, kind: asset.kind,
    url: '/show-media/' + show.id + '/' + asset.key, source: 'verified_admin_asset',
    printVerified: false, publicationRights: 'unverified'
  }));
}
function showMedia(show, run) {
  if (!show) return [];
  const items = curatedMediaFacts(show).map(asset => ({...asset, downloadUrl: asset.url + '?download=1'}));
  const seen = new Set(items.map(a => a.url));
  const campaign = run?.status === 'ready' && run.results?.DirectorFinal?.output?.campaigns?.find(c => c.showId === show.id);
  const assets = run?.facts?.assets ?? [];
  const candidates = (campaign?.assetIds ?? []).map(id => assets.find(asset => asset.id === id));
  if (!items.length && show.posterUrl) candidates.unshift({id: 'poster:' + show.id, showId: show.id, url: show.posterUrl, label: 'Poster ' + show.artist});
  for (const asset of candidates) {
    if (!asset || (asset.showId && asset.showId !== show.id) || (items.length && asset.id === 'poster:' + release.id)) continue;
    const url = publicMusicAsset(asset.url);
    if (!url || seen.has(url) || url === retiredPoster) continue;
    const download = new URL(url);
    if (download.hostname.endsWith('.supabase.co')) download.searchParams.set('download', '');
    const kind = asset.kind === 'video' ? 'video' : 'image';
    items.push({id: asset.id, kind, label: asset.label ?? (kind === 'video' ? 'Video · ' : 'Ảnh · ') + asset.id, url, downloadUrl: download.href});
    seen.add(url);
  }
  return items;
}

function byteRange(value, length) {
  if (value === undefined) return {start: 0, end: length - 1};
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (first !== null && !Number.isSafeInteger(first) || last !== null && !Number.isSafeInteger(last)) return null;
  const start = first ?? Math.max(0, length - last);
  const end = first === null || last === null ? length - 1 : Math.min(last, length - 1);
  return start <= end && start < length ? {start,end} : null;
}

// The admin request handler authenticates both viewing and downloading before dispatch.
async function serveShowMedia(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const asset = release.files.find(item => url.pathname === '/show-media/' + release.id + '/' + item.key);
  if (!asset || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(404, {'Cache-Control':'no-store'}); return res.end();
  }
  const file = localFile(asset);
  let length;
  try { length = (await fs.promises.stat(file)).size; }
  catch { res.writeHead(404, {'Cache-Control':'no-store'}); return res.end(); }
  const range = byteRange(req.headers.range, length);
  if (!range) {
    res.writeHead(416, {'Content-Range':'bytes */' + length}); return res.end();
  }
  const {start, end} = range;
  const headers = {
    'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300', 'Accept-Ranges': 'bytes', 'Content-Length': end-start+1,
    'Content-Disposition': (url.searchParams.get('download') === '1' ? 'attachment' : 'inline') +
      '; filename="' + release.id + '-ccc-' + asset.file + '"'
  };
  if (req.headers.range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + length;
  res.writeHead(req.headers.range ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  try { await pipeline(fs.createReadStream(file,{start,end}),res); }
  catch (error) { if (!res.destroyed) res.destroy(error); }
}
module.exports = {isCuratedShow, curatedMediaFacts, showMedia, serveShowMedia};

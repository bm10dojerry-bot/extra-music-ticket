'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {showMedia, serveShowMedia} = require('./show-media.cjs');
const show = {id:'dinh-dung-2811',venue:'ccc',date:'2026-11-28',time:'19:30',artist:'Đình Dũng'};
test('Music media resources belong to the selected date and venue', () => {
  const current = showMedia(show);
  assert.deepEqual(current.map(a => a.kind), ['image','video']);
  assert(current.every(a => a.downloadUrl === a.url + '?download=1'));
  assert.deepEqual(showMedia({...show,date:'2026-11-29'}), []);
  assert.deepEqual(showMedia({...show,venue:'moana'}), []);
  assert.deepEqual(showMedia({...show,time:'21:00'}), []);
  const oldUrl='https://fokntdvgzfldxbaglrdc.supabase.co/storage/v1/object/public/extra-media/posters/dinh-dung-2811/b3017970-ef76-46ca-a264-89215790d5f3.jpg';
  assert.deepEqual(showMedia({...show,venue:'moana',posterUrl:oldUrl}), []);
});
test('Poster and reel can be opened, downloaded, and streamed in ranges', async () => {
  const server=http.createServer(serveShowMedia);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const origin='http://127.0.0.1:'+server.address().port;
    const [poster,video] = showMedia(show);
    const download=await fetch(origin+poster.downloadUrl);
    assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/jpeg');
    assert.match(download.headers.get('content-disposition'),/^attachment;/);
    const bytes=Buffer.from(await download.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'f1f3bbf7f85272c4a68ab68c533c57cd88f9ebffd82bc2ef1c436b5f93ccf7be');
    const preview=await fetch(origin+video.url,{headers:{range:'bytes=0-15'}});
    assert.equal(preview.status,206);assert.equal((await preview.arrayBuffer()).byteLength,16);
    assert.equal(preview.headers.get('content-type'),'video/mp4');
    assert.match(preview.headers.get('content-range'),/^bytes 0-15\//);
    assert.match(preview.headers.get('content-disposition'),/^inline;/);
    assert.equal((await fetch(origin+video.url,{method:'HEAD',headers:{range:'bytes=-8'}})).headers.get('content-length'),'8');
    assert.equal((await fetch(origin+video.url,{headers:{range:'bytes=9999999999999-'}})).status,416);
    assert.equal((await fetch(origin+'/show-media/not-this-show/video')).status,404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

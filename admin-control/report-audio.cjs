'use strict';
const crypto=require('node:crypto');
const model='gpt-4o-mini-tts',voice='coral';
const instructions='Đọc nguyên văn bằng tiếng Việt, rõ ràng với nhịp tự nhiên. Đọc ngày, giờ, số tiền và số vé theo ngữ cảnh.';
const inFlight=new Map();
function segments(text){
  const parts=[];let chunk='';
  for(const word of text.split(/\s+/u).filter(Boolean)){
    for(let i=0;i<word.length;i+=800){
      const piece=word.slice(i,i+800);
      if(chunk&&chunk.length+piece.length+1>800){parts.push(chunk);chunk='';}
      chunk+=(chunk?' ':'')+piece;
    }
  }
  if(chunk)parts.push(chunk);
  return parts.map(input=>({input,key:crypto.createHash('sha256').update([model,voice,instructions,input].join('\0')).digest('hex')}));
}
async function initAudio(pool){
  await pool.query('create table if not exists os_report_audio (key text primary key, input text not null, mp3 bytea)');
}
async function saveTracks(pool,full){
  const parts=segments(full);
  const entries=[...new Map(parts.map(part=>[part.key,part])).values()].sort((a,b)=>a.key.localeCompare(b.key));
  if(entries.length)await pool.query('insert into os_report_audio(key,input) select * from unnest($1::text[],$2::text[]) on conflict(key) do nothing',[entries.map(p=>p.key),entries.map(p=>p.input)]);
  return {full:parts.map(part=>part.key)};
}
async function renderAudio(pool,key,apiKey,request=fetch){
  const result=await pool.query('select input,mp3 from os_report_audio where key=$1',[key]);
  if(!result.rows.length)return null;
  if(result.rows[0].mp3)return result.rows[0].mp3;
  if(inFlight.has(key))return inFlight.get(key);
  const pending=(async()=>{
    if(!apiKey)throw Error('audio_not_configured');
    const r=await request('https://api.openai.com/v1/audio/speech',{method:'POST',redirect:'error',signal:AbortSignal.timeout(85000),
      headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},
      body:JSON.stringify({model,voice,instructions,input:result.rows[0].input,response_format:'mp3'})});
    if(!r.ok)throw Error('speech_http_'+r.status);
    const mp3=Buffer.from(await r.arrayBuffer());
    if(mp3.length<8||!(mp3.toString('ascii',0,3)==='ID3'||mp3[0]===255&&(mp3[1]&224)===224))throw Error('speech_audio_invalid');
    await pool.query('update os_report_audio set mp3=$2 where key=$1 and mp3 is null',[key,mp3]);
    return mp3;
  })().finally(()=>inFlight.delete(key));
  inFlight.set(key,pending);return pending;
}
async function serveAudio(req,res,pool,key,apiKey=process.env.EXTRA_OS_OPENAI_API_KEY,request=fetch){
  const fail=(status)=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
  if(!/^[a-f0-9]{64}$/.test(key))return fail(404);
  let data;
  try{data=await renderAudio(pool,key,apiKey,request);}
  catch(error){console.warn('Report audio unavailable',error.message.match(/^speech_http_\d{3}$/)?.[0]??'speech_unavailable');return fail(503);}
  if(!data)return fail(404);
  const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'};
  let start=0,end=data.length-1;
  const range=req.headers.range;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(match&&(match[1]||match[2])){
      start=match[1]?Number(match[1]):Math.max(0,data.length-Number(match[2]));
      if(match[1]&&match[2])end=Math.min(end,Number(match[2]));
    }else start=data.length;
    if(start>end){res.writeHead(416,{...headers,'Content-Range':'bytes */'+data.length});return res.end();}
    headers['Content-Range']='bytes '+start+'-'+end+'/'+data.length;
  }
  res.writeHead(range?206:200,{...headers,'Content-Length':end-start+1});
  res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));
}
function setupPlayer(){
  const panel=document.querySelector('[data-report-player]');
  if(!panel)return;
  const audio=panel.querySelector('audio'),status=panel.querySelector('[role=status]');
  const buttons=Array.from(panel.querySelectorAll('button'));
  let mode=null,index=0,parts=[],generation=0;
  function update(note){
    status.textContent=note;
    for(const b of buttons)b.textContent=b.dataset.mode===mode?(audio.paused?'▶ Tiếp tục':'Ⅱ Tạm dừng'):b.dataset.label;
  }
  function play(){
    const current=++generation;
    const promise=audio.play();
    if(promise)promise.catch(()=>{if(current===generation)update('Chưa phát được. Bấm tiếp tục để thử lại.');});
  }
  function load(){
    audio.src='/report-audio/'+parts[index]+'.mp3';
    update('Đang tải giọng đọc…');play();
  }
  for(const b of buttons)b.addEventListener('click',()=>{
    if(mode===b.dataset.mode){
      if(audio.error){load();return;}
      if(audio.paused)play();else{++generation;audio.pause();}
      return;
    }
    ++generation;audio.pause();mode=b.dataset.mode;parts=b.dataset.track.split(',');index=0;load();
  });
  audio.addEventListener('playing',()=>update('Đang đọc phần '+(index+1)+'/'+parts.length+'.'));
  audio.addEventListener('pause',()=>{if(mode&&!audio.ended)update('Đã tạm dừng.');});
  audio.addEventListener('ended',()=>{
    if(++index<parts.length){load();return;}
    mode=null;index=0;update('Đã đọc hết.');
  });
  audio.addEventListener('error',()=>update('Âm thanh chưa tải được. Bấm tiếp tục để thử lại.'));
  window.addEventListener('pagehide',()=>{++generation;audio.pause();});
}
const script='('+setupPlayer.toString()+')();';
const scriptHash=crypto.createHash('sha256').update(script).digest('base64');
function playerHtml(tracks){
  return '<div data-report-player><button type="button" data-mode="full" data-label="▶ Nghe toàn bộ báo cáo" data-track="'+tracks.full.join(',')+'">▶ Nghe toàn bộ báo cáo</button><audio preload="none"></audio><p><small>Giọng đọc AI · tiếng Việt</small> <span role="status" aria-live="polite"></span></p></div><script>'+script+'</script>';
}
module.exports={initAudio,segments,saveTracks,renderAudio,serveAudio,playerHtml,scriptHash};

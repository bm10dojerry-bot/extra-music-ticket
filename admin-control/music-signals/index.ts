// Use the dedicated Music reporting token digest at deployment, as on extra-os-music-report-v1.
const tokenDigest = 'REPLACE_WITH_MUSIC_REPORT_TOKEN_DIGEST';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(req:Request){
 const token=req.headers.get('x-extra-music-report-key')||'';
 if(!/^[0-9a-f]{64}$/.test(token)||!/^[0-9a-f]{64}$/.test(tokenDigest))return false;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 let difference=0;for(let i=0;i<64;i++)difference|=hash.charCodeAt(i)^tokenDigest.charCodeAt(i);
 return difference===0;
}

Deno.serve(async(req:Request)=>{
 if(req.method!=='GET')return json({error:'method'},405);
 if(!await authorized(req))return json({error:'unauthorized'},401);
 try{
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)throw Error('config');
  const res=await fetch(new URL('/rest/v1/rpc/extra_os_music_signals_v1',url),{method:'GET',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw Error('upstream');
  return json(await res.json());
 }catch{return json({error:'source_unavailable'},503);}
});

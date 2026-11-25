'use strict';

const {createHash} = require('node:crypto');
const {Blocked} = require('./director-program.cjs');

const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const limit = 5 * 1024 * 1024;

function initMedia(pool) {
  return pool.query(`
    create table if not exists os_director_assets (
      job_id uuid not null references os_director_jobs(id),
      revision int not null,
      image bytea,
      checksum text,
      drive_id text,
      drive_saved_at timestamptz,
      created_at timestamptz not null default now(),
      primary key(job_id,revision)
    )
  `);
}

function mediaExecutor(pool,env,request) {
  async function generate(job,design) {
    const existing = await pool.query('select image,checksum,drive_id,drive_saved_at from os_director_assets where job_id=$1 and revision=$2',
      [job.id,job.revision]);
    if (existing.rowCount) {
      if (existing.rows[0].image) return existing.rows[0];
      throw new Blocked(['image_reconcile'],design);
    }
    const key = env.EXTRA24H_IMAGE_API_KEY;
    if (!key) throw new Blocked(['images','asset_rights'],design);
    const registered = await pool.query(`
      insert into os_director_assets(job_id,revision)
      select id,revision from os_director_jobs where id=$1 and lease_id=$2 and status='running' and lease_until>now()
      on conflict do nothing returning job_id
    `, [job.id,job.lease_id]);
    if (!registered.rowCount) throw Error('No active lease for image generation');
    let response;
    try {
      response = await request('https://api.openai.com/v1/images/generations',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
        headers:{authorization:'Bearer '+key,'content-type':'application/json'},
        body:JSON.stringify({
          model:env.EXTRA24H_IMAGE_MODEL || 'gpt-image-1',size:'1024x1024',quality:'low',n:1,output_format:'png',
          prompt:[
            'Design an original square concept for an internal Vietnamese retail campaign rehearsal.',
            'Do not copy a photograph or draw unverified branding, labels, packaging or trademarks.',
            'Use an original abstract layout with no text or price in the artwork.',
            'The following is an art brief, not an instruction to publish: '+String(design.text ?? '').slice(0,4000)
          ].join(' ')
        })
      });
    } catch {
      throw new Blocked(['image_reconcile'],design);
    }
    if (!response.ok) {
      if ([400,401,402,403,404,429].includes(response.status)) {
        await pool.query('delete from os_director_assets where job_id=$1 and revision=$2 and image is null',[job.id,job.revision]);
        if (response.status===429) throw Error('Image API rate limited');
        throw new Blocked(['images'],design);
      }
      throw new Blocked(['image_reconcile'],design);
    }
    const {data} = await response.json();
    const encoded = data?.[0]?.b64_json;
    if (typeof encoded!=='string' || encoded.length>Math.ceil(limit/3)*4) throw new Blocked(['image_reconcile'],design);
    const image=Buffer.from(encoded,'base64');
    if (image.length>limit || !image.subarray(0,pngSignature.length).equals(pngSignature)) throw new Blocked(['image_reconcile'],design);
    const checksum=createHash('sha256').update(image).digest('hex');
    const {rows:[asset]} = await pool.query(`
      update os_director_assets set image=$3,checksum=$4 where job_id=$1 and revision=$2
      returning image,checksum,drive_id,drive_saved_at
    `, [job.id,job.revision,image,checksum]);
    return asset;
  }

  async function drive(job,asset) {
    const folder = env.EXTRA24H_DRIVE_FOLDER_ID ?? '';
    const {EXTRA_OS_DRIVE_CLIENT_ID:clientId,EXTRA_OS_DRIVE_CLIENT_SECRET:clientSecret,EXTRA_OS_DRIVE_REFRESH_TOKEN:refreshToken} = env;
    if (!storageConfigured(folder,clientId,clientSecret,refreshToken)) return null;
    if (asset.drive_saved_at) return asset.drive_id;
    const oauth = await request('https://oauth2.googleapis.com/token',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})
    });
    if (!oauth.ok) return null;
    const {access_token:token} = await oauth.json();
    if (!token) return null;

    const fileUrl = 'https://www.googleapis.com/drive/v3/files';
    const get = path=>request(fileUrl+path,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token}});
    const target = await get('/'+folder+'?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities(canAddChildren)');
    if (!target.ok) return null;
    const location = await target.json();
    if (location.id!==folder || location.mimeType!=='application/vnd.google-apps.folder' ||
        location.trashed || !location.capabilities?.canAddChildren) return null;
    let id=asset.drive_id;
    if (!id) {
      const allocation=await get('/generateIds?count=1&space=drive&type=files');
      if (!allocation.ok) return null;
      const proposed=(await allocation.json()).ids?.[0];
      if (!/^[a-zA-Z0-9_-]{8,160}$/.test(proposed ?? '')) return null;
      const {rows:[saved]}=await pool.query(`
        update os_director_assets set drive_id=coalesce(drive_id,$3) where job_id=$1 and revision=$2 returning drive_id
      `,[job.id,job.revision,proposed]);
      id=saved.drive_id;
    }

    const name='extra24h-'+job.id+'-r'+job.revision+'.png';
    const boundary='extra24h-'+asset.checksum.slice(0,20);
    const body=Buffer.concat([
      Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+
        JSON.stringify({id,name,parents:[folder],appProperties:{checksum:asset.checksum}})+'\r\n'),
      Buffer.from('--'+boundary+'\r\nContent-Type: image/png\r\n\r\n'),asset.image,
      Buffer.from('\r\n--'+boundary+'--\r\n')
    ]);
    const saved = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+token,'content-type':'multipart/related; boundary='+boundary},body
    });
    if (saved.status===409) {
      const existing=await get('/'+id+'?supportsAllDrives=true&fields=id,parents,name,trashed,appProperties');
      if (!existing.ok) return null;
      const file=await existing.json();
      if (!file.parents?.includes(folder) || file.name!==name || file.trashed ||
          file.appProperties?.checksum!==asset.checksum) return null;
    } else if (!saved.ok || (await saved.json()).id!==id) {
      return null;
    }
    await pool.query('update os_director_assets set drive_saved_at=now() where job_id=$1 and revision=$2',[job.id,job.revision]);
    return id;
  }

  return async (job,design,research) => {
    const asset = await generate(job,design);
    // Drive is supplemental. The preview is available from the authenticated admin.
    const driveId = await drive(job,asset).catch(()=>null);
    return {
      ...design,sources:research.sources,asset:{id:job.id,revision:job.revision,sha256:asset.checksum,mimeType:'image/png',driveId},
      rights:{origin:'generated_preview',publicationApproved:false},remaining:driveId?['asset_rights']:['drive','asset_rights']
    };
  };
}

function storageConfigured(folder,clientId,clientSecret,token) {
  return /^[a-zA-Z0-9_-]{8,160}$/.test(folder) && Boolean(clientId&&clientSecret&&token);
}

module.exports = {initMedia,mediaExecutor};

// Isolated PostgreSQL regression test. @electric-sql/pglite is a test tool only;
// install it in a temporary prefix and provide that prefix's node_modules via NODE_PATH.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

test('GA4 SQL enforces one-use browser-bound OAuth and prevents stale overwrites',async t=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/042_extra_google_analytics.sql'),'utf8');
  await db.exec(migration);
  const query=(sql,args=[])=>db.query(sql,args);
  const version=async()=> (await query("select version from public.extra_google_analytics_connection where id='default'")).rows[0].version;
  const start=async(seed,browser='b')=>{
   const hash=seed.repeat(64),binding=browser.repeat(64);
   const result=await query('select public.extra_start_google_analytics_oauth($1,$2,$3,$4) as ok',[hash,binding,'synthetic-encrypted-verifier-with-more-than-forty-characters','synthetic-admin']);
   assert.equal(result.rows[0].ok,true);return {hash,binding};
  };
  const consume=async(attempt,binding=attempt.binding)=>(await query('select * from public.extra_consume_google_analytics_oauth($1,$2)',[attempt.hash,binding])).rows;
  await t.test('RLS and grants deny public roles while allowing service-only functions',async()=>{
   for(const table of ['extra_google_analytics_connection','extra_google_analytics_oauth_attempts']){
    assert.equal((await query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated'])assert.equal((await query('select has_table_privilege($1,$2,$3) as allowed',[role,'public.'+table,'SELECT'])).rows[0].allowed,false);
   }
   for(const name of ['extra_start_google_analytics_oauth(text,text,text,text)','extra_consume_google_analytics_oauth(text,text)','extra_finish_google_analytics_oauth(uuid,text,text)','extra_select_google_analytics_stream(uuid,text,text,text,text,text,text)','extra_disconnect_google_analytics()']){
    for(const role of ['anon','authenticated'])assert.equal((await query('select has_function_privilege($1,$2,$3) as allowed',[role,'public.'+name,'EXECUTE'])).rows[0].allowed,false);
    assert.equal((await query('select has_function_privilege($1,$2,$3) as allowed',['service_role','public.'+name,'EXECUTE'])).rows[0].allowed,true);
   }
  });
  await t.test('wrong browser cannot consume a valid authorization; replay loses',async()=>{
   const attempt=await start('a');
   assert.equal((await consume(attempt,'c'.repeat(64))).length,0);
   const first=await consume(attempt);assert.equal(first.length,1);assert.equal(first[0].authorized_by,'synthetic-admin');
   assert.equal((await consume(attempt)).length,0);
  });
  await t.test('expired states are rejected and competing consumers have one winner',async()=>{
   await query("insert into public.extra_google_analytics_oauth_attempts(state_hash,browser_hash,verifier_cipher,expected_version,authorized_by,created_at,expires_at) values($1,$2,$3,$4,'synthetic-admin',now()-interval '11 minutes',now()-interval '1 minute')",['d'.repeat(64),'b'.repeat(64),'synthetic-encrypted-verifier-with-more-than-forty-characters',await version()]);
   assert.equal((await consume({hash:'d'.repeat(64),binding:'b'.repeat(64)})).length,0);
   const attempt=await start('e'),results=await Promise.all([consume(attempt),consume(attempt)]);
   assert.equal(results.reduce((sum,rows)=>sum+rows.length,0),1);
  });
  await t.test('only one concurrent connection completion may change a generation',async()=>{
   const expected=await version();
   const result=await query('select public.extra_finish_google_analytics_oauth($1,$2,$3) as ok',[expected,'synthetic-encrypted-refresh-one-with-more-than-forty-characters','synthetic-admin']);
   assert.equal(result.rows[0].ok,true);
   const stale=await query('select public.extra_finish_google_analytics_oauth($1,$2,$3) as ok',[expected,'synthetic-encrypted-refresh-two-with-more-than-forty-characters','synthetic-admin']);
   assert.equal(stale.rows[0].ok,false);
   assert.equal((await query("select refresh_token_cipher from public.extra_google_analytics_connection where id='default'")).rows[0].refresh_token_cipher,'synthetic-encrypted-refresh-one-with-more-than-forty-characters');
  });
  await t.test('disconnect deletes credentials and pending attempts, invalidating in-flight callbacks and selections',async()=>{
   const expected=await version(),attempt=await start('f');
   await query('select public.extra_disconnect_google_analytics()');
   assert.equal((await consume(attempt)).length,0);assert.notEqual(await version(),expected);
   const after=(await query("select refresh_token_cipher,property_id,stream_id,measurement_id,connected_at from public.extra_google_analytics_connection where id='default'")).rows[0];
   assert.deepEqual(after,{refresh_token_cipher:null,property_id:null,stream_id:null,measurement_id:'',connected_at:null});
   assert.equal((await query('select public.extra_finish_google_analytics_oauth($1,$2,$3) as ok',[expected,'synthetic-stale-refresh-token-with-more-than-forty-characters','synthetic-admin'])).rows[0].ok,false);
   assert.equal((await query('select public.extra_select_google_analytics_stream($1,$2,$3,$4,$5,$6,$7) as ok',[expected,'12345','Sample Property','56789','Sample Web','https://iextra.net/','G-ABCDEF1234'])).rows[0].ok,false);
  });
  await t.test('service role can call security-invoker functions and migration reruns preserve state',async()=>{
   await query('set role service_role');
   await start('1');
   await query('reset role');
   const before=await version();await db.exec(migration);assert.equal(await version(),before);
  });
 }finally{await db.close();}
});

// Run against CommonJS output in GA4_COMPILED_ROOT. NODE_PATH must include this
// project's node_modules and the temporary @electric-sql/pglite test runtime.
// Google and staff authentication are isolated; persistence uses the actual SQL
// migration in a new in-memory PostgreSQL instance. No real credentials/network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('GA4 routes authorize, persist an encrypted OAuth connection and return only scoped aggregates',async t=>{
 const compiled=process.env.GA4_COMPILED_ROOT;if(!compiled)throw Error('Set GA4_COMPILED_ROOT to the compiled test output');
 const db=new PGlite();
 const originalLoad=Module._load,originalFetch=global.fetch;
 let actor={id:'synthetic-admin',role:'admin'},dbReads=0,authChecks=0,expectedChallenge='',apiMode='normal';
 const googleCalls=[];
 process.env.ADMIN_MEDIA_SECRET='synthetic-local-admin-encryption-secret-only';
 process.env.GOOGLE_CLIENT_ID='synthetic-client.apps.googleusercontent.com';
 process.env.GOOGLE_CLIENT_SECRET='synthetic-local-google-client-secret';
 const scope='https://www.googleapis.com/auth/analytics.readonly';
 const rpcArguments={
  extra_start_google_analytics_oauth:['p_state_hash','p_browser_hash','p_verifier_cipher','p_authorized_by'],
  extra_consume_google_analytics_oauth:['p_state_hash','p_browser_hash'],
  extra_finish_google_analytics_oauth:['p_expected_version','p_refresh_cipher','p_authorized_by'],
  extra_select_google_analytics_stream:['p_expected_version','p_property_id','p_property_name','p_stream_id','p_stream_name','p_site_url','p_measurement_id'],
  extra_disconnect_google_analytics:[],
 };
 const staffDb=async(request,init={})=>{
  dbReads++;
  if(request.startsWith('rpc/')){
   const name=request.slice(4),keys=rpcArguments[name];if(!keys)throw Error('Unexpected fixture RPC');
   const data=JSON.parse(init.body||'{}'),args=keys.map(key=>data[key]),slots=args.map((_,i)=>'$'+(i+1)).join(',');
   if(name==='extra_consume_google_analytics_oauth')return (await db.query('select * from public.'+name+'('+slots+')',args)).rows;
   return (await db.query('select public.'+name+'('+slots+') as result',args)).rows[0].result;
  }
  const url=new URL('https://fixture.invalid/'+request);
  if(url.pathname!='/extra_google_analytics_connection')throw Error('Unexpected fixture table');
  const columns=(url.searchParams.get('select')||'').split(',');
  const allowed=['version','refresh_token_cipher','property_id','property_name','stream_id','stream_name','site_url','measurement_id','connected_at'];
  assert.equal(columns.every(column=>allowed.includes(column)),true);
  return (await db.query('select '+columns.join(',')+" from public.extra_google_analytics_connection where id='default'")).rows;
 };
 Module._load=function(request,parent,isMain){
  if(request==='server-only')return {};
  if(/(?:^|\/)staff-auth(?:\.js)?$/.test(request))return {staffDb,requireRole:async roles=>{authChecks++;return actor&&roles.includes(actor.role)?actor:null;},STAFF_COOKIE:'extra_staff_session',createStaffSession:()=>{throw Error('Unexpected SSO creation');}};
  return originalLoad.apply(this,arguments);
 };
 const output=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 const report=(dimensions,rows)=>({dimensionHeaders:dimensions.map(name=>({name})),metricHeaders:[{name:'activeUsers'}],rowCount:rows.length,
  rows:rows.map(([values,n])=>({dimensionValues:values.map(value=>({value})),metricValues:[{value:String(n)}]}))});
 global.fetch=async(input,init={})=>{
  const url=new URL(String(input));googleCalls.push({host:url.host,path:url.pathname,body:init.body});
  if(url.href==='https://oauth2.googleapis.com/token'){
   const params=new URLSearchParams(init.body);
   assert.equal(params.get('client_id'),process.env.GOOGLE_CLIENT_ID);assert.equal(params.get('client_secret'),process.env.GOOGLE_CLIENT_SECRET);
   if(params.get('grant_type')==='authorization_code'){
    assert.equal(params.get('redirect_uri'),'https://iextra.net/api/auth/google/callback');
    assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),expectedChallenge);
    return output({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',scope,expires_in:3600});
   }
   assert.equal(params.get('grant_type'),'refresh_token');assert.equal(params.get('refresh_token'),'synthetic-refresh-token');
   if(apiMode==='revoked')return output({error:'invalid_grant',error_description:'synthetic private error detail'},400);
   return output({access_token:'synthetic-refreshed-access-token',token_type:'Bearer',scope,expires_in:3600});
  }
  assert.match(init.headers.Authorization,/^Bearer synthetic-/);
  if(url.host==='analyticsadmin.googleapis.com'){
   if(apiMode==='admin_disabled')return output({error:{details:[{reason:'SERVICE_DISABLED'}],message:'private project identifier'}},403);
   if(url.pathname==='/v1beta/accountSummaries')return url.searchParams.get('pageToken')==='next-page'?
    output({accountSummaries:[{displayName:'Second Sample Account',propertySummaries:[{property:'properties/23456',displayName:'Second Sample Property'}]}]}):
    output({accountSummaries:[{displayName:'Sample Account',propertySummaries:[{property:'properties/12345',displayName:'Sample Property'}]}],nextPageToken:'next-page'});
   if(url.pathname==='/v1beta/properties/12345')return output({name:'properties/12345',displayName:'Sample Property'});
   const valid={name:'properties/12345/dataStreams/56789',displayName:'Sample Web',type:'WEB_DATA_STREAM',webStreamData:{defaultUri:'https://iextra.net/',measurementId:'G-ABCDEF1234'}};
   if(url.pathname==='/v1beta/properties/12345/dataStreams')return output({dataStreams:[valid,{...valid,name:'properties/12345/dataStreams/67890',webStreamData:{defaultUri:'https://unrelated.example/',measurementId:'G-ZYXWVU1234'}}]});
   if(url.pathname==='/v1beta/properties/12345/dataStreams/56789')return output(valid);
   if(url.pathname==='/v1beta/properties/12345/dataStreams/67890')return output({...valid,name:'properties/12345/dataStreams/67890',webStreamData:{defaultUri:'https://unrelated.example/',measurementId:'G-ZYXWVU1234'}});
  }
  if(url.host==='analyticsdata.googleapis.com'){
   if(apiMode==='data_disabled')return output({error:{details:[{reason:'SERVICE_DISABLED'}],message:'private project identifier'}},403);
   if(apiMode==='malformed')return output({});
   assert.equal(url.pathname,'/v1beta/properties/12345:runRealtimeReport');
   const body=JSON.parse(init.body);
   assert.deepEqual(body.minuteRanges,[{startMinutesAgo:29,endMinutesAgo:0}]);assert.equal(body.limit,'1000');
   assert.deepEqual(body.dimensionFilter,{filter:{fieldName:'streamId',stringFilter:{matchType:'EXACT',value:'56789',caseSensitive:true}}});
   const dimensions=body.dimensions.map(item=>item.name);
   if(dimensions.length===0){const total=report([],[[[],7]]);delete total.dimensionHeaders;return output(total);}
   if(dimensions.length===2)return output(report(['countryId','country'],[[['VN','Vietnam'],6],[['JP','Japan'],2]]));
   return output(report(['countryId','country','city'],[[['VN','Vietnam','Sample Alpha'],5],[['VN','Vietnam','Sample Beta'],4],[['JP','Japan','Sample Gamma'],2]]));
  }
  throw Error('Unexpected external request in isolated fixture');
 };
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/042_extra_google_analytics.sql'),'utf8'));
  const {NextRequest}=require('next/server');
  const main=require(path.join(compiled,'app/api/admin/google-analytics/route.js'));
  const connect=require(path.join(compiled,'app/api/admin/google-analytics/connect/route.js'));
  const properties=require(path.join(compiled,'app/api/admin/google-analytics/properties/route.js'));
  const publicConfig=require(path.join(compiled,'app/api/public/google-analytics/route.js'));
  const callback=require(path.join(compiled,'app/api/auth/google/callback/route.js'));
  const {clearAnalyticsCache}=require(path.join(compiled,'lib/google-analytics.js'));
  const request=(method='GET',body,origin='https://admin.iextra.net')=>new NextRequest('https://admin.iextra.net/api/admin/google-analytics',{
   method,headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let state='',binding='';
  await t.test('auth is enforced before any report/credential access, including cached requests',async()=>{
   actor=null;const before=dbReads;assert.equal((await main.GET()).status,403);assert.equal(dbReads,before);
   actor={id:'synthetic-sale',role:'sale'};assert.equal((await main.GET()).status,403);assert.equal(dbReads,before);
   actor={id:'synthetic-admin',role:'admin'};
   assert.equal((await (await main.GET()).json()).status,'not_connected');
   assert.deepEqual(await (await publicConfig.GET()).json(),{measurementId:''});
  });
  await t.test('connect is exact-origin admin-only and requests readonly offline access with PKCE',async()=>{
   const before=dbReads;assert.equal((await connect.POST(request('POST',undefined,'https://unrelated.example'))).status,403);assert.equal(dbReads,before);
   const response=await connect.POST(request('POST'));assert.equal(response.status,303);
   const location=new URL(response.headers.get('location'));assert.equal(location.origin,'https://accounts.google.com');
   assert.equal(location.searchParams.get('scope'),scope);assert.equal(location.searchParams.get('access_type'),'offline');
   assert.equal(location.searchParams.get('code_challenge_method'),'S256');state=location.searchParams.get('state');expectedChallenge=location.searchParams.get('code_challenge');
   const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=lax/i);assert.match(cookie,/Domain=\.iextra\.net/);
   binding=cookie.match(/extra_ga4_oauth=([^;]+)/)[1];
   const saved=(await db.query('select * from public.extra_google_analytics_oauth_attempts')).rows[0];
   assert.notEqual(saved.state_hash,state);assert.notEqual(saved.browser_hash,binding);assert.match(saved.verifier_cipher,/^v1\./);
  });
  await t.test('public-host callback requires browser binding but not a host-only admin cookie',async()=>{
   actor=null;
   const url='https://iextra.net/api/auth/google/callback?state='+state+'&code=synthetic-code';
   const noCookie=await callback.GET(new NextRequest(url));assert.equal(new URL(noCookie.headers.get('location')).searchParams.get('ga4'),'invalid_state');
   const response=await callback.GET(new NextRequest(url,{headers:{cookie:'extra_ga4_oauth='+binding}}));
   assert.equal(new URL(response.headers.get('location')).searchParams.get('ga4'),'connected');
   const saved=(await db.query("select * from public.extra_google_analytics_connection where id='default'")).rows[0];
   assert.match(saved.refresh_token_cipher,/^v1\./);assert.equal(saved.refresh_token_cipher.includes('synthetic-refresh-token'),false);
   const replay=await callback.GET(new NextRequest(url,{headers:{cookie:'extra_ga4_oauth='+binding}}));assert.equal(new URL(replay.headers.get('location')).searchParams.get('ga4'),'invalid_state');
   actor={id:'synthetic-admin',role:'admin'};assert.equal((await (await main.GET()).json()).status,'select_property');
  });
  await t.test('paginated property discovery and verified stream selection reject unrelated websites',async()=>{
   const listed=await (await properties.GET(new NextRequest('https://admin.iextra.net/api/admin/google-analytics/properties'))).json();assert.equal(listed.properties.length,2);
   const streams=await (await properties.GET(new NextRequest('https://admin.iextra.net/api/admin/google-analytics/properties?propertyId=12345'))).json();assert.equal(streams.streams[0].compatible,true);assert.equal(streams.streams[1].compatible,false);
   assert.equal((await main.PUT(request('PUT',{propertyId:'12345',streamId:'67890'}))).status,400);
   assert.equal((await main.PUT(request('PUT',{propertyId:'12345',streamId:'56789'}))).status,200);
   assert.deepEqual(await (await publicConfig.GET()).json(),{measurementId:'G-ABCDEF1234'});
  });
  await t.test('three stream-filtered reports preserve unique grains, cache for a minute, and never expose credentials',async()=>{
   const before=googleCalls.filter(call=>call.host==='analyticsdata.googleapis.com').length;
   const data=await (await main.GET()).json();assert.equal(data.status,'ready');assert.equal(data.report.totalActiveUsers,7);assert.equal(data.report.countries[0].activeUsers,6);
   assert.equal(data.report.cities.filter(row=>row.countryId==='VN').reduce((n,row)=>n+row.activeUsers,0),9);
   assert.equal(JSON.stringify(data).includes('synthetic-refresh'),false);assert.equal(JSON.stringify(data).includes('synthetic-access'),false);assert.equal(JSON.stringify(data).includes('refresh_token_cipher'),false);
   await main.GET();assert.equal(googleCalls.filter(call=>call.host==='analyticsdata.googleapis.com').length-before,3);
   actor={id:'synthetic-manager',role:'show_manager'};const view=await (await main.GET()).json();assert.equal(view.canManage,false);assert.equal(view.status,'ready');
   assert.equal((await properties.GET(new NextRequest('https://admin.iextra.net/api/admin/google-analytics/properties'))).status,403);
   actor=null;assert.equal((await main.GET()).status,403);assert.equal(authChecks>6,true);actor={id:'synthetic-admin',role:'admin'};
  });
  await t.test('disabled APIs and malformed reports show safe actionable errors instead of zeroes',async()=>{
   clearAnalyticsCache();apiMode='admin_disabled';
   const adminError=await (await properties.GET(new NextRequest('https://admin.iextra.net/api/admin/google-analytics/properties'))).json();assert.match(adminError.error,/Google Analytics Admin API/);assert.equal(JSON.stringify(adminError).includes('private project'),false);
   clearAnalyticsCache();apiMode='data_disabled';const disabled=await (await main.GET()).json();assert.equal(disabled.status,'error');assert.match(disabled.error,/Google Analytics Data API/);assert.equal('report' in disabled,false);
   clearAnalyticsCache();apiMode='malformed';const malformed=await (await main.GET()).json();assert.equal(malformed.status,'error');assert.equal('report' in malformed,false);
   clearAnalyticsCache();apiMode='revoked';const revoked=await (await main.GET()).json();assert.equal(revoked.status,'error');assert.match(revoked.error,/kết nối lại/);assert.equal(JSON.stringify(revoked).includes('private error'),false);
   apiMode='normal';
  });
  await t.test('disconnect is same-origin only, clears publication and preserves original SSO dispatch',async()=>{
   assert.equal((await main.DELETE(request('DELETE',undefined,'https://unrelated.example'))).status,403);
   assert.equal((await main.DELETE(request('DELETE'))).status,200);
   assert.deepEqual(await (await publicConfig.GET()).json(),{measurementId:''});assert.equal((await (await main.GET()).json()).status,'not_connected');
   const sso=await callback.GET(new NextRequest('https://iextra.net/api/auth/google/callback?state=ordinary-invalid-state&code=synthetic-code'));
   const url=new URL(sso.headers.get('location'));assert.equal(url.searchParams.get('login_error'),'invalid_state');assert.equal(url.searchParams.has('ga4'),false);
  });
 }finally{global.fetch=originalFetch;Module._load=originalLoad;await db.close();}
});

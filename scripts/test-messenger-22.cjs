const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(name,overrides={}){
 const module={exports:{}},source=fs.readFileSync('lib/'+name+'.ts','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(id=>overrides[id]??require(id),module,module.exports);
 return module.exports;
}
const style=load('messenger-conversation-style');
const page='https://iextra.net/show/dinh-dung-2811',other='https://iextra.net/show/another-show';
test('only explicit booking page or self-service requests qualify',()=>{
 for(const yes of ['Gửi em link chọn ghế','Em muốn tự chọn ghế','Cho xin đường dẫn đặt vé','Gửi lại link nhé','Link đặt vé ở đâu?','Em muốn mua vé trên web'])assert.equal(style.wantsBookingPage(yes),true,yes);
 for(const no of ['Gần ca sĩ có còn 2 ghế không?','Cho xem sơ đồ','Giữ cho em hai vé','Đừng gửi link nữa nhé','Em đã thanh toán, gửi lại link vé điện tử','Link lỗi rồi','Không muốn tự chọn ghế','Tư vấn luôn trong chat','Khách gửi ảnh','Chưa cần link đâu em','Anh có link rồi','Sao cứ gửi link cho mình?','Em gửi link nhiều quá','Cho xin link Zalo','Có bắt buộc vào web không em?','Anh phải tự chọn ghế hay bên em hỗ trợ?'])assert.equal(style.wantsBookingPage(no),false,no);
 assert.equal(style.requestsImageAndPage('Cho mình cả ảnh sơ đồ và link đặt vé'),true);
 assert.equal(style.requestsImageAndPage('Cho mình xin link sơ đồ'),false);
 const history=[{sender:'customer',body:'Cho xin link'},{sender:'staff',body:style.clarifyBookingPage},{sender:'customer',body:'Đình Dũng'}];
 assert.equal(style.wantsBookingPage('Đình Dũng',history),true);
 assert.equal(style.wantsBookingPage('Giá thấp nhất?',history),false);
 assert.equal(style.catalogSeatPage({id:'dinh-dung-2811',url:other}),undefined);
});
test('retain useful facts, suppress automatic links, emit only one verified requested page',()=>{
 const body='Hai ghế E01 và E02 giá 399.000đ/vé. Mình xem ghế tại '+page+' nhé.';
 const clean=style.styleSalesReply(body,'Còn hai ghế không?');
 assert.match(clean,/Hai ghế E01 và E02 giá 399.000đ\/vé/);assert.doesNotMatch(clean,/https|xem ghế tại/);
 for(const link of [page,'iextra.net/show/dinh-dung-2811','https://iextra.net/api/public/seat-map/ccc','https://iextra.net/'])assert.doesNotMatch(style.styleSalesReply('Mình xem tại '+link+' nhé.','giá vé'),/iextra\.net/);
 const withPage=style.styleSalesReply(body+'\n'+other,'Cho link',[],page);
 assert.deepEqual(withPage.match(/https:\/\/\S+/g),[page]);
 for(const important of ['https://iextra.net/lien-he','https://iextra.net/ve?code=EXAMPLE','https://img.vietqr.io/image/TEST.png'])assert.ok(style.styleSalesReply('Hỗ trợ tại '+important,'Mình cần nhân viên').includes(important));
});
test('use an appropriate emoji sparingly and adapt to the previous reply',()=>{
 assert.match(style.styleSalesReply('Em còn hai lựa chọn.','Gần sân khấu còn ghế không?'),/💺/);
 assert.match(style.styleSalesReply('Đăng ký với ban tổ chức nhé.','Chụp ảnh cùng ca sĩ thế nào?'),/📸/);
 const repeat=style.styleSalesReply('Em vừa kiểm tra ghế.','Ghế nào?', [{sender:'staff',body:'💺 Mình thích góc nào?'},{sender:'customer',body:'Ghế nào?'}]);
 assert.doesNotMatch(repeat,/💺/);
 assert.equal(style.styleSalesReply('🎉 Em sẽ đối soát. 😊','Khiếu nại thanh toán'),'Em sẽ đối soát.');
 assert.equal((style.styleSalesReply('🎵 Dạ, em có hai lựa chọn 🎉😊','đêm nhạc').match(/\p{Extended_Pictographic}/gu)||[]).length,1);
});
test('private comment replies keep prices in Messenger by default',()=>{
 const p=load('ai-comment-policy',{'./poster-offers':load('poster-offers'),'./ai-sales-policy':load('ai-sales-policy'),'./messenger-conversation-style':style});
 const show={id:'dinh-dung-2811',url:page,artist:'Đình Dũng',date:'2026-11-28',time:'19:30',venueName:'CCC Sa Pa',prices:{A:399000}};
 const d={question_type:'price'};
 assert.doesNotMatch(p.renderCommentPrivateReply(d,show,'Giá vé thế nào?'),/https/);
 assert.match(p.renderCommentPrivateReply(d,show,'Giá bao nhiêu, cho xin link đặt vé'),/399.000đ[\s\S]+https:\/\/iextra.net\/show\/dinh-dung-2811/);
});
// Drive the built worker with a private in-memory conversation. No network or seat holds.
async function inbox(body,prior=[],paid=false,scenario={}){
 const rows=[...(scenario.fresh?[]:['Show Đình Dũng']),...prior,body].map((text,i,all)=>({id:i+1,body:text,external_message_id:'m_fixture_'+i,sender:i===0&&!scenario.fresh?'staff':'customer',staff_name:i===0?'EXTRA AI':null,created_at:new Date().toISOString()})).reverse();
 const posted=[];
 const show={id:'dinh-dung-2811',url:page,artist:'Đình Dũng',title:'Đêm Đình Dũng',date:'2026-11-28',time:'19:30',venueId:'ccc',venueName:'CCC Sa Pa',prices:load("poster-offers").posterPrices["dinh-dung-2811"]};
 const modules={'server-only':{},'./staff-auth':{staffDb:async(path,options)=>{
   if(path.startsWith('show_landing_content?'))return [{setlist:scenario.setlist??''}];
   if(path.startsWith('extra_messenger_heart_verification?'))return [];
   if(path.startsWith('extra_messenger_show_signals?'))return scenario.signal?[{occurred_at:rows[0].created_at,show_id:scenario.signal}]:[];
   if(path.startsWith('extra_support_messages?'))return path.includes('body=eq.')?[]:rows;
   if(path.startsWith('extra_messenger_ai_state?'))return paid?[{current_order_code:'EX0000000000000000',status:'paid'}]:[];
   if(path.startsWith('extra_messenger_ai_outbox?')||path.startsWith('extra_messenger_ai_timeout_ledger?'))return [];
   if(path.endsWith('_guard'))return {outcome:'ok'};
   if(path.endsWith('_begin_send'))return {outcome:'send',outbox_id:'fixture',send_token:'fixture'};
   if(path.endsWith('_finish_send'))return {outcome:'sent'};
   if(path.endsWith('_set_state'))return {outcome:'updated'};
   throw Error('Unexpected DB access: '+path);
 }},'./facebook-messenger':{sendMessengerPageMessage:async(id,text)=>{posted.push(text);return {messageId:'fixture-mid'};},
 sendMessengerPageImage:async()=>{posted.push('[image]');return {messageId:'fixture-image'};}},
 './ai-comment-context':{getCommentContextForChat:async()=>scenario.fresh?null:({showId:show.id})},
 './ai-sales-checkout':{listAiSalesShows:async()=>[show,{...show,id:'thai-hoc-3112',artist:'Thái Học',venueId:'laocai',venueName:'Sân khấu Lào Cai',date:'2026-12-31'}, {...show,id:'khac-viet-2612',artist:'Khắc Việt',date:'2026-12-26',prices:load('poster-offers').posterPrices['khac-viet-2612']}],getAiLatestQuote:async()=>null,isAiPurchaseConfirmation:()=>false,
 getAiSeatSnapshot:async()=>({show,seats:load('venues').seatsFor('ccc'),taken:new Set()}),
 getAiOrderStatus:async()=>({code:'EX0000000000000000',status:'paid'}),getAiPaidTicketDelivery:async()=>({message:'Vé QR: https://iextra.net/ve?code=FIXTURE'})},
 'ai':{ToolLoopAgent:class{async generate(){return {text:'Hạng C giá 399.000đ/vé. Mình xem ghế tại '+other+' nhé.'}}},tool:x=>x,isStepCount:()=>()=>false}};
 if(scenario.image)modules["./ai-sales-inbound-image"]={readMessengerImage:async()=>scenario.image};
 function dependency(id){
   if(Object.hasOwn(modules,id))return modules[id];
   if(!id.startsWith('./'))return require(id);
   const name=id.slice(2),m={exports:{}};
   const file=fs.readFileSync('lib/'+name+'.ts','utf8');
   const c=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   new Function('require','module','exports',c+(name==='ai-sales'?'\nexports.testInbound=handleInbound;':''))(dependency,m,m.exports);
   return modules[id]=m.exports;
 }
 const {testInbound}=dependency('./ai-sales');
 await testInbound({id:'job',chat_id:'chat',source_message_id:rows[0].id,lease_token:'test'},{id:'chat',messenger_page_id:'1223940670813189',messenger_psid:'10000001',last_customer_at:new Date().toISOString()});
 return posted;
}
test('real worker entry paths: choices in chat, requested page, attachment and transactional ticket',async()=>{
 const seat=(await inbox('Góc nhìn gần ca sĩ nhất ở đêm Đình Dũng?', ['Cho mình hai vé Đình Dũng'])).join('\n');
 assert.match(seat,/gần sân khấu/);assert.match(seat,/đ\/vé/);assert.doesNotMatch(seat,/https/);
 assert.deepEqual((await inbox('Cho xin link chọn ghế Đình Dũng')).join('\n').match(/https:\/\/\S+/g),[page]);
 const mixed=(await inbox('Giá vé bao nhiêu và cho mình link Đình Dũng')).join('\n');
 assert.match(mixed,/399.000đ/);assert.deepEqual(mixed.match(/https:\/\/\S+/g),[page]);
 const photo=await inbox('Gửi ảnh sơ đồ ghế CCC cho mình');assert.ok(photo.includes('[image]'));assert.doesNotMatch(photo.join('\n'),/https/);
 assert.deepEqual(await inbox('Mình đã chuyển khoản',[],true),['Vé QR: https://iextra.net/ve?code=FIXTURE']);
});
test('poster ticket names and prices use the catalog selected for the conversation',async()=>{
 const reply=(await inbox('Giá vé VIP Đình Dũng bao nhiêu?')).join(' ');
 assert.match(reply,/VIP: 349\.000đ/);
 const standard=(await inbox('Giá Standard 2 Đình Dũng?')).join(' ');
 assert.match(standard,/Standard 2: 199\.000đ/);
});

test('fresh ad question, poster, split caption, explicit change and unreadable image',async()=>{
 const q='Giá vé đêm nhạc là bao nhiêu?', marker='[Khách gửi ảnh; chưa đọc nội dung ảnh.]';
 const poster={kind:'poster',showText:'ĐÌNH DŨNG 28/11',multipleShows:false,amount:null,reference:null};
 const fresh={fresh:true},ad={...fresh,signal:'dinh-dung-2811'};
 const first=(await inbox(q,[],false,ad)).join(' ');
 for(const fact of ['Đình Dũng','399.000','349.000','249.000','199.000'])assert.ok(first.includes(fact),fact);
 assert.doesNotMatch(first,/ca sĩ nào|nghệ sĩ nào/);
 assert.match((await inbox(marker,[],false,{...fresh,image:poster})).join(' '),/poster đêm Đình Dũng/);
 assert.match((await inbox(marker+' '+q,[],false,{...fresh,image:poster})).join(' '),/349.000/);
 assert.match((await inbox(q,[marker],false,{...fresh,image:poster})).join(' '),/349.000/);
 const separate=await inbox(marker,['Giá vé đêm nhạc này là bao nhiêu ạ?'],false,{...fresh,image:poster});
 assert.equal(separate.length,1);
 for(const fact of ['Đình Dũng','399.000','349.000','249.000','199.000'])assert.ok(separate[0].includes(fact),fact);
 assert.match((await inbox('Giá vé VIP Khắc Việt bao nhiêu?',[],false,ad)).join(' '),/449.000/);
 assert.match((await inbox(marker,[],false,{...fresh,image:{...poster,multipleShows:true}})).join(' '),/ca sĩ nào/);
 const unreadable=(await inbox(marker,[],false,{...fresh,image:{...poster,kind:'unreadable',showText:null}})).join(' ');
 assert.doesNotMatch(unreadable,/Đình Dũng|mã đơn/i);
 const receipt=(await inbox(marker,[],false,{...fresh,image:{...poster,kind:'transfer_receipt',reference:null}})).join(' ');
 assert.match(receipt,/mã đơn/i);assert.doesNotMatch(receipt,/đã xác nhận thanh toán/i);
});
test('signed ad sources are scoped to the same Page and sender; conflicting dates or artists stay ambiguous',async()=>{
 const map=load('messenger-extra-ad-shows');
 const sig=load('messenger-show-signals',{'server-only':{},'./ai-sales-checkout':{},'./staff-auth':{},'./messenger-extra-ad-shows':map});
 const page='1223940670813189',now=Date.now(),shows=[{artist:'Đình Dũng',id:'dinh-dung-2811',date:'2026-11-28'},{artist:'Khắc Việt',id:'khac-viet-2612',date:'2026-12-26'}];
 const r={source:'ADS',ad_id:'120250663161090420',ads_context_data:{ad_title:'1 EXTRA'}};
 const evt={sender:{id:'10000123'},recipient:{id:page},timestamp:now};
 for(const e of [{referral:r},{message:{mid:'m_ok',referral:r}},{postback:{referral:r}},{referral:{...r,ad_id:'12345678901',ads_context_data:{ad_title:'ĐÌNH DŨNG HẸN GẶP BẠN TẠI KHÔNG GIAN VĂN HOÁ CCC SA PA'}}}]){
  assert.equal((await sig.signedSignals(page,{...evt,...e},async()=>shows,now))[0].show_id,shows[0].id);
 }
 assert.equal((await sig.signedSignals(page,{...evt,referral:{...r,ads_context_data:{ad_title:'Khắc Việt 26/12'}}},async()=>shows,now))[0].show_id,null);
 const postOnly={source:'ADS',ads_context_data:{post_id:page+'_122134309485473141'}};
 assert.equal((await sig.signedSignals(page,{...evt,referral:postOnly},async()=>shows,now))[0].show_id,shows[0].id);
 const fresh=load('messenger-show-signals',{'server-only':{},'./ai-sales-checkout':{},'./messenger-extra-ad-shows':map,
  './staff-auth':{staffDb:async path=>{
    assert.ok(path.includes('page_id=eq.'+page)&&path.includes('ad_id=eq.12345678901'));
    return [{extra_marketing_posts:{show_id:shows[1].id}}];
  }}});
 const fromNewAd={source:'ADS',ad_id:'12345678901'};
 assert.equal((await fresh.signedSignals(page,{...evt,referral:fromNewAd},async()=>shows,now))[0].show_id,shows[1].id);
 assert.equal((await fresh.signedSignals(page,{...evt,referral:{...fromNewAd,ads_context_data:{ad_title:'Đình Dũng 28/11'}}},async()=>shows,now))[0].show_id,null);
 for(const e of [{...evt,recipient:{id:'987654321'},referral:r},{...evt,message:{is_echo:true,referral:r}},{...evt,message:{text:JSON.stringify(r)}}])assert.equal((await sig.signedSignals(page,e,async()=>shows,now)).length,0);
 assert.equal(sig.matchShowEvidence('Đình Dũng 26/12',shows).id,null);assert.equal(sig.matchShowEvidence('Đình Dũng 28/11, Khắc Việt 26/12',shows).id,null);
 assert.equal(sig.matchShowEvidence('chỉ có ảnh ca sĩ',shows).id,null);
 assert.equal(sig.matchShowEvidence('Đình Dũng 28/11/2025',shows).id,null);
 assert.equal(sig.matchShowEvidence('Khac Viet 26/12',shows).id,shows[1].id);
});

test('referral subscription preserves unrelated fields, verifies both ends, and is idempotent',async()=>{
 const connection=load('facebook-page-connection',{'server-only':{},'./staff-auth':{}});
 const {verifySaleSubscriptions}=load('facebook-page-oauth',{'server-only':{},'next/server':{},'./admin-session':{},'./staff-auth':{},'./facebook-page-connection':connection});
 let callback=connection.FACEBOOK_MESSENGER_WEBHOOK;
 const fields={app:['feed','messages'],page:['feed','messaging_postbacks']},writes=[];
 const fetchOriginal=global.fetch;
 global.fetch=async(url,opts)=>{
  const side=new URL(url).pathname.endsWith('/subscribed_apps')?'page':'app';
  if(opts.method==='POST'){
   writes.push(side);const body=new URLSearchParams(opts.body);
   fields[side]=body.get(side==='page'?'subscribed_fields':'fields').split(',');
   return Response.json({success:true});
  }
  return Response.json({data:[side==='page'?{id:connection.FACEBOOK_APP_ID,subscribed_fields:fields.page}:
   {object:'page',active:true,callback_url:callback,fields:fields.app.map(name=>({name}))}]});
 };
 const config={appSecret:'fixture',verifyToken:'fixture-test-token',apiVersion:'v24.0'};
 try{
  await verifySaleSubscriptions(config,'fixture-page',Date.now()+10000);
  for(const names of Object.values(fields))assert.deepEqual([...names].sort(),['feed','messages','messaging_postbacks','messaging_referrals']);
  assert.deepEqual(writes,['app','page']);
  assert.deepEqual(await verifySaleSubscriptions(config,'fixture-page',Date.now()+10000),{addedToApp:[],addedToPage:[]});
  callback='https://example.com/unrelated';
  await assert.rejects(verifySaleSubscriptions(config,'fixture-page',Date.now()+10000));
  assert.equal(writes.length,2);
 }finally{global.fetch=fetchOriginal;}
});
test('drinks, directions, published program and seat preferences via Messenger worker',async()=>{
 const ask=async(q,prior=[],options={})=>(await inbox(q,prior,false,options)).join(' ');
 assert.match(await ask('Vé Đình Dũng có kèm nước không?'),/không kèm nước uống[\s\S]+gọi nước/);
 const water=await ask('Trong khu diễn có bán đồ uống không?',[],{fresh:true});assert.match(water,/điểm bán nước/);assert.doesNotMatch(water,/ca sĩ nào/);
 assert.match(await ask('Vé Khắc Việt có bao gồm nước uống?'),/chưa có xác nhận/);
 const map=await ask('Có map chỉ đường không?');
 assert.ok(decodeURIComponent(map).includes('002 Phan Xi Păng'));assert.match(map,/google\.com\/maps\/dir/);assert.doesNotMatch(map,/iextra.net\/show/);
 const laocai=await ask('Map chỉ đường đêm Thái Học');assert.match(decodeURIComponent(laocai),/68P Phú Thịnh, Cam Đường/);assert.doesNotMatch(laocai,/CCC/);
 const noShow=await ask('Cho em xin map chỉ đường',[],{fresh:true});assert.match(noShow,/ca sĩ nào/);assert.doesNotMatch(noShow,/https/);
 const all=await ask('Show có kèm nước và hát bao nhiêu bài? Có map chỉ đường không?',[],{setlist:'Bài một\n\nBài hai'});
 assert.match(all,/không kèm nước/);assert.match(all,/có 2 bài/);assert.match(all,/Google Maps/);
 assert.match(await ask('Đêm Khắc Việt hát mấy bài?'),/chưa công bố/);
 assert.match(await ask('Có chỗ nào ngồi đẹp không?'),/gần ca sĩ hay chính diện/);
 const seats=await ask('Có chỗ nào ngồi đẹp không?', ['Hai vợ chồng đi đêm Đình Dũng, 700 nghìn cả hai, thích chính diện']);
 assert.match(seats,/663.100đ/);assert.match(seats,/chính diện/);assert.doesNotMatch(seats,/đi mấy người|ngân sách mình/);
 assert.match(await ask('Để anh hỏi vợ đã'),/cứ trao đổi thêm/);
 assert.doesNotMatch(style.styleSalesReply('🎵 Vé VIP 349.000đ ạ','Bao nhiêu tiền?'),/\p{Extended_Pictographic}/u);
 assert.doesNotMatch(style.styleSalesReply('Để em kiểm tra ạ 🎵','Vé lỗi rồi'),/\p{Extended_Pictographic}/u);
});
test('heart directly targets the incoming message and ordinary customers require verified support',async()=>{
 const mid='m_test123',id='10000001',pageId='1223940670813189',positive=[{sender:'customer',body:'Cảm ơn em nhé'}];
 let gate={},requests=[],claims=0,patches=0;
 const heart=load('messenger-heart',{'server-only':{},'./messenger-conversation-style':style,
  './staff-auth':{staffDb:async(path,opts)=>{if(opts?.method==='PATCH'){patches++;if(path.includes('attempted_at=is.null')){claims++;return [{page_id:pageId}];}return null;}return [gate];}},
  './facebook-messenger':{getMessengerGraphConfig:async()=>({pageId,pageToken:'fixture',apiVersion:'v24.0'})}});
 const original=global.fetch;global.fetch=async(u,init)=>{requests.push(JSON.parse(init.body));return Response.json({recipient_id:id});};
 try{
  await heart.maybeSendHeart(pageId,id,mid,positive,async()=>{});assert.equal(requests.length,0);
  gate={verified_at:'2026-11-25'};
  for(const body of ['Cảm ơn, em chuyển tiền rồi nhưng chưa có vé','Vé lỗi','Khiếu nại','Cảm ơn em, giá vé là bao nhiêu?','Chưa nhận được vé']){
   await heart.maybeSendHeart(pageId,id,mid,[{sender:'customer',body}],async()=>{});assert.equal(requests.length,0);
  }
  await heart.maybeSendHeart(pageId,id,mid,positive,async()=>{});
  assert.deepEqual(requests.pop(),{recipient:{id},sender_action:'react',payload:{message_id:mid,reaction:'❤️'}});
  await heart.maybeSendHeart(pageId,id,mid,[{sender:'customer',body:'Vui quá cả nhà đi được rồi'}],async()=>{});assert.equal(requests.length,1);
  const sample='Cảm ơn Extra a1b2c3d4e5';gate={verified_at:null,test_digest:require('node:crypto').createHash('sha256').update(sample).digest('hex'),test_until:new Date(Date.now()+60000).toISOString(),attempted_at:null};
  await heart.maybeSendHeart(pageId,id,mid,[{sender:'customer',body:sample}],async()=>{});assert.equal(claims,1);assert.equal(patches,2);
  assert.equal(gate.verified_at,null);
 }finally{global.fetch=original;}
});

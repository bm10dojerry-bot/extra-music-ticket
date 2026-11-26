const test=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript'), fs=require('node:fs');
function load(name,mocks={}) {
  const source = ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',source)(key=>Object.hasOwn(mocks,key)?mocks[key]:require(key),module,module.exports);
  return module.exports;
}
const policy=load('v2-seat-guidance'), venues=load('venues'), selection=load('ai-sales-seat-map');
test('questions about the picture or a seat get advice without triggering media',()=>{
  for(const q of ['Trên sơ đồ ghế nào gần ca sĩ mà giá thấp?', 'Góc nhìn nào chính diện?', 'Nhìn vào sơ đồ, hạng nào giá cao?', 'Đừng gửi lại sơ đồ, tư vấn cho chị ghế rẻ hơn']){
    assert.equal(policy.seatInquiry(q,true).requestImage,false,q);
    assert.equal(policy.seatInquiry(q,true).advice,true,q);
  }
  assert.equal(policy.seatInquiry('gửi lại ảnh hoá đơn',true).relevant,false);
  assert.equal(policy.seatInquiry('Gửi lại ảnh nhé',false).repeat,false);
  assert.equal(policy.seatInquiry('Đặt giúp anh ghế gần ca sĩ',true).relevant,false);
});
const show={id:'sample',artist:'Nghệ sĩ',title:'Nghệ sĩ',venueId:'ccc',date:'2099-01-01',url:'https://iextra.net/show/sample',prices:{A:800000,B:600000,C:450000,D:250000}};
function advisor(state,unavailable=false){
  return load('ai-sales-seat-advisor',{
    'server-only':{},'./poster-offers':load('poster-offers'),'./show-family-policy':load('show-family-policy'),'./ai-sales-checkout':{listAiSalesShows:async()=>[show],getAiSeatSnapshot:async()=>({show,seats:venues.seatsFor('ccc'),taken:new Set(['A25'])})},
    './ai-sales-consultation':{salesPreferences:()=>({})},'./ai-sales-seat-map':selection,'./v2-seat-guidance':policy,
    './staff-auth':{staffDb:async path=>{if(unavailable)throw Error();if(!path.startsWith('extra_messenger_ai_outbox?'))return [];const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('chat_id'),'eq.chat');assert.equal(q.get('job_id'),'neq.job');assert.equal(q.get('body'),'eq.[Ảnh sơ đồ ghế CCC Sa Pa]');assert.equal(q.get('state'),'in.(sent,uncertain,sending)');return state?[{state}]:[];}}
  });
}
function prepare(a,body,prior=[]){
  const messages=['Cho mình hỏi show Nghệ sĩ',...prior,body].map(body=>({sender:'customer',body}));
  return a.prepareSeatAdvice('chat','job',body,messages,null);
}
test('each new explicit image request is honored even with a historical send or unavailable history',async()=>{
  for(const state of ['sent','sending','uncertain',null]){
    for(const request of ['Cho mình xem sơ đồ CCC','cho anh xem sơ đồ nghế','có cái ảnh sơ đồ thực tế không','Gửi lại ảnh sơ đồ CCC']){
      const r=await prepare(advisor(state),request);
      assert.equal(r.sendImage,true,request);
      assert.equal(r.selected.venue,'ccc');
      assert.equal(r.selected.show.id,'sample');
      assert.equal(r.text,undefined,'image-only request must not substitute advice');
    }
  }
  assert.equal((await prepare(advisor('sent'),'Gửi lại ảnh nhé',['Cho xem sơ đồ CCC'])).sendImage,true);
  assert.equal((await prepare(advisor(null,true),'Cho mình xem sơ đồ CCC')).sendImage,true);
  const advice=await prepare(advisor('sent'),'Góc nhìn nào chính diện?');
  assert.equal(advice.sendImage,false);
  assert.match(advice.text,/chính diện/);
  assert.equal((await prepare(advisor('sent'),'Đừng gửi lại sơ đồ, tư vấn cho chị ghế rẻ hơn')).sendImage,false);
});
test('an explicit first image and a question can share one reply',async()=>{
  const r=await prepare(advisor(null),'Gửi sơ đồ CCC và tư vấn ghế gần ca sĩ');
  assert.equal(r.sendImage,true);assert.match(r.text,/gần sân khấu/);
});
test('seat comparison respects actual prices, available seats, the requested side, budget and aisle',()=>{
  const layout=venues.seatsFor('laocai');
  const free=layout.filter(s=>!['A01','A02'].includes(s.id));
  const result=policy.rankSeatGroups('laocai',layout,free,show.prices,2,undefined,'center',650000);
  assert.equal(result.length,2);
  for(const option of result){assert.equal(option.view,'center');assert.ok(option.price<=650000);assert.ok(option.ids.every(id=>free.some(s=>s.id===id)));assert.ok(!(option.ids.some(s=>s.endsWith('20'))&&option.ids.some(s=>s.endsWith('21'))));}
  assert.ok(result[0].position<result[1].position); assert.ok(result[0].price>result[1].price);
});

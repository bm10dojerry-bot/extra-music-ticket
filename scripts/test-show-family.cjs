const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function load(name,mocks={}) {
 const module={exports:{}};
 const output=ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',output)(id=>mocks[id]??require(id),module,module.exports);
 return module.exports;
}
const policy=load('show-family-policy');
test('adult and individual child seats at different show prices',()=>{
 assert.equal(policy.seatFare(599000,false)+policy.seatFare(499000,true),948300);
 for(const x of [null,{},['C01'],['A01','A01']]) assert.equal(policy.validChildSeats(x,['A01','B01']),false);
 for(const x of [[],['B01']])assert.equal(policy.validChildSeats(x,['A01','B01']),true);
});
test('page scope checks each recipient',()=>{
 for(const id of ['10000001','10000002'])assert.equal(policy.seatAdvicePage('1223940670813189',id),true);
 assert.equal(policy.seatAdvicePage('11111111','10000001'),false);
 assert.equal(policy.seatAdvicePage('1223940670813189',''),false);
});
const care=load('show-day-before',{'./show-family-policy':policy});
const row={artist:'Mai',title:'Đêm thu',venue:'laocai',show_date:'2026-11-28',show_time:'20:00:00',kind:'paid',canopy:false};
test('date, weather, shelter, customer status and artist notice',()=>{
 const point=(time,temp,mm)=>({time,data:{instant:{details:{air_temperature:temp}},next_1_hours:{details:{precipitation_amount:mm}}}});
 const w=care.forecastAtShow([point('2026-11-28T13:00:00Z',15,2),point('2026-11-27T13:00:00Z',28,0)],row.show_date,row.show_time);
 assert.deepEqual(w,{low:15,rain:true});assert.equal(care.forecastAtShow([],row.show_date,row.show_time),null);
 const paid=care.dayBeforeText(row,w);
 for(const s of ['28/11/2026','Mai','Đêm thu','Cam Đường','áo ấm','25 phút cuối','đăng ký với ban tổ chức','Hẹn gặp'])assert.ok(paid.includes(s),s);
 assert.ok(!paid.includes('căng tăng'));assert.ok(care.dayBeforeText({...row,canopy:true},w).includes('căng tăng'));
 assert.ok(!care.dayBeforeText({...row,canopy:true},null).includes('căng tăng'));
 assert.match(care.dayBeforeText({...row,kind:'pending'},null),/chờ xác nhận/);
 assert.match(care.dayBeforeText({...row,kind:'interest'},null),/muốn đặt vé/);
});

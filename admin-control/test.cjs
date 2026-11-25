const {test}=require('node:test');const assert=require('node:assert/strict');
const {agents,planMarketing,planStaffWork}=require('./marketing-director.ts');
const {parseShowIntake,prepareShow}=require('./marketing-show-intake.ts');
const now=new Date('2030-01-01T00:00:00Z');
const fixture={artist:'Test',venue:'Test',venueId:'',startsAt:'2030-01-08T19:30',capacity:100,bookingVnd:5000000,productionVnd:3000000,adsVnd:2000000,printingVnd:1000000,otherVnd:500000,startingPriceVnd:200000,targetProfitVnd:3000000,mediaDriveUrl:'https://drive.google.com/drive/folders/test',setlist:'Test',artistConfirmed:true,mediaRightsConfirmed:true,permissions:[]};
test('existing planning engine and 11 agents preserved; no external action',()=>{const s=parseShowIntake(fixture);const p=prepareShow(s,now);assert.equal(Object.keys(agents).length,11);assert.equal(p.plannedCostVnd,11500000);assert.equal(p.breakEvenTicketsAtStartingPrice,58);assert.equal(p.layoutMatches,false);assert.equal(planStaffWork(s,p,now).length,3);assert(!planMarketing(s,now).some(j=>['website','facebook','ads','ads_monitor','close_sales'].includes(j.kind)));});
test('invalid permission or rights fails',()=>{assert.throws(()=>parseShowIntake({...fixture,permissions:['ads']}));assert.throws(()=>prepareShow(parseShowIntake({...fixture,mediaRightsConfirmed:false}),now));});

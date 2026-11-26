'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {computeShowEconomics,adIncreaseBlockReason,economicSections,parseEconomicsSource}=require('./show-economics.cjs');
const {readMusicSnapshot}=require('./music-readonly.cjs');
const day='2026-11-26', stamp=day+'T19:30:00+07:00';
const show={id:'dung',artist:'Music',date:'2026-11-28',time:'19:30',inventory:{remaining:530,held:2,sellable:529}};
const finance={showId:show.id,costUpdatedAt:'2026-11-21T15:00:00Z',recordedCostVnd:1000200,days:{
  '2026-11-23':{paidTickets:3,revenueVnd:330000},'2026-11-24':{paidTickets:6,revenueVnd:510000},
  [day]:{paidTickets:4,paidOrders:2,revenueVnd:851200},'2026-11-27':{paidTickets:1,revenueVnd:99999}
}};
const categories={artist_fee:1000000,venue_fee:0,sound_lighting:0,labor:0,advertising:200,band:0,tax:0,sale_commission:0,logistics:0,security:0,miscellaneous:0};
const signals={fromDay:'2026-11-20',toDay:day,messenger:[{showId:'dung',quotedChats:12,linkedPaidChats:1}],
  adDays:[{day:'2026-11-24',rows:[{showId:'dung',spendVnd:100000}]},{day,fetchedAt:stamp,rows:[{showId:'dung',spendVnd:833867},{showId:'other',spendVnd:5000000}]}],
  economics:parseEconomicsSource({version:1,priorTo:'2026-11-20',historyStart:'2026-11-18',oldAds:{dung:50000},coverage:[],campaigns:[],
    costs:[{showId:'dung',updatedAt:'2026-11-21T15:00:00Z',categories}]})};
test('economics isolates the selected day, matches campaign spend once and sums only show revenues to date',()=>{
 const econ=computeShowEconomics(show,day,finance,signals,stamp);
 assert.equal(econ.daily.afterAssignedAdsVnd,17333);
 assert.equal(econ.cumulative.revenueVnd,1691200);
 assert.equal(econ.cumulative.costBasisVnd,1983867);
 assert.equal(econ.cumulative.provisionalNetVnd,-292667);
 assert.equal(econ.pace.requiredPer24h,265);
 assert.equal(econ.pace.averagePer24h,3);
 assert.equal(econ.daily.attributedContributionAfterAdsVnd,null);
 assert.match(adIncreaseBlockReason(econ),/thiếu/);
 assert.match(economicSections(show,day,{data:{rows:[finance]}},null,{signals,checkedAt:stamp}).flatMap(s=>s.lines).join(' '),/17\.333/);
});
test('missing Meta stays unknown, matched zero requires complete two-account snapshot',()=>{
 const missing=computeShowEconomics({...show,id:'other2'},day,undefined,signals,stamp);
 assert.equal(missing.daily.assignedAdsVnd,null);assert.equal(missing.daily.revenueVnd,null);assert.equal(missing.cumulative.provisionalNetVnd,null);
 const covered={...signals,economics:{...signals.economics,coverage:[{day,unassignedVnd:300}]}};
 assert.equal(computeShowEconomics({...show,id:'other2'},day,null,covered,stamp).daily.assignedAdsVnd,0);
 assert.equal(computeShowEconomics(show,'2026-11-19',finance,signals,stamp).cumulative.costBasisVnd,null);
 assert.equal(computeShowEconomics(show,'2026-11-19',finance,signals,stamp).pace.availableSeats,null);
});
test('seat pace deduplicates overlapping paid, blocked and held IDs',async()=>{
 const src={...show,venue:'ccc',status:'announced'};
 const result=await readMusicSnapshot(async url=>Response.json(url.endsWith('/shows')?{shows:[src]}:
   {available:true,inventory:[{showId:show.id,capacity:10,sold:1,remaining:8,soldSeats:['A1'],blockedSeats:['A2'],heldSeats:['A1','A2','A3']}]}));
 assert.equal(result.rows[0].inventory.sellable,7);
});

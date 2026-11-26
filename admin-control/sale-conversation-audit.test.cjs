'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseSaleAudit,requestSaleReview}=require('./sale-conversation-audit.cjs');
const day='2026-11-26',showId='live-show';
const row={day,showId,inquiryChats:3,engagedChats:2,quotedChats:2,checkoutChats:2,paidChats:1,repeatedContactChats:1,paidRepromptChats:0};
const input={source:'sale23_message_audit_v1',fromDay:day,toDay:day,rows:[row],coverage:[{day,allInboundChats:9,identifiedChats:3}]};
const env={EXTRA_OS_SALE_LINK_TOKEN:'x'.repeat(48),EXTRA_OS_SALE_LINK_URL:'http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director'};
test('Audit exposes a scoped monotone funnel and strips private material',()=>{
 const result=parseSaleAudit({...input,rows:[{...row,phone:'should never pass'}]},day,day);
 assert.deepEqual(result.rows,[row]);assert.equal(result.coverage[0].allInboundChats,9);
 assert.throws(()=>parseSaleAudit({...input,rows:[row,row]},day,day));
 assert.throws(()=>parseSaleAudit({...input,rows:[{...row,paidChats:3}]},day,day));
 assert.throws(()=>parseSaleAudit({...input,coverage:[{day,allInboundChats:2,identifiedChats:2}]},day,day));
});
test('Real Sale service response must match request and show; failures retain input evidence',async()=>{
 const audit=parseSaleAudit(input,day,day);
 const request=async(url,options)=>{
  assert.equal(url,env.EXTRA_OS_SALE_LINK_URL);const job=JSON.parse(options.body);
  return Response.json({id:job.id,agent:'Sale',version:'2.3',mode:'dry_run',kind:'music_conversation_audit',status:'succeeded',
   report:{source:'music_conversation_audit',day,reviews:[{showId,findings:['Kiểm tra hội thoại đã báo giá.']}]}});
 };
 assert.equal((await requestSaleReview(audit,env,request)).status,'completed');
 assert.equal((await requestSaleReview(audit,env,async()=>Response.json({id:'other'}))).status,'unavailable');
 assert.equal((await requestSaleReview(audit,{})).status,'unavailable');
});

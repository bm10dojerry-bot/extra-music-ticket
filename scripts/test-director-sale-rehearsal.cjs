'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {exerciseRetailSample,retailRehearsalSchema,retailSampleSchema,scoreRetailRehearsal} = require('../lib/extra-os/sale-rehearsal.ts');

const input = {
  product:'Đồ uống diễn tập',priceVnd:35000,knowledgeVersion:3,
  training:{
    playbook:'Tra cứu tồn kho và giá đã xác minh. Chỉ tạo báo giá sau khi khách xác nhận số lượng.',
    objections:'Giải thích lựa chọn theo nhu cầu của khách và dùng giá đã xác minh.',
    validation:'Chạy tình huống hết hàng, từ chối và đã xác nhận đơn.'
  }
};
const valid = {
  reply:'Em đã kiểm tra số lượng đang có cho mình ạ.',
  objectionReply:'Em có thể giải thích các lựa chọn theo nhu cầu của mình.',
  beforeConfirmation:'ask_confirmation',afterConfirmation:'preview_quote',stockConflict:'notify_stock_limit'
};

test('Sale V 2.3 uses the exact server price and returns only a fixture quote',()=>{
  assert(retailRehearsalSchema.safeParse(input).success);
  const result = scoreRetailRehearsal(input,valid);
  assert.equal(result.passed,true);
  assert.equal(result.quote.totalVnd,70000);
  assert.equal(result.quote.inventorySource,'fixture');
  assert.equal(result.ordersCreated,0);
  assert.equal(result.liveSales,false);
});

test('Sale rejects early orders, stock promises and unsupported price claims',()=>{
  assert.equal(scoreRetailRehearsal(input,{...valid,beforeConfirmation:'create_order'}).passed,false);
  assert.equal(scoreRetailRehearsal(input,{...valid,stockConflict:'promise_stock'}).passed,false);
  assert.equal(scoreRetailRehearsal(input,{...valid,reply:'Sản phẩm này giá chỉ 31.000 đồng thôi ạ.'}).passed,false);
  assert.equal(retailRehearsalSchema.safeParse({...input,priceVnd:0}).success,false);
});


test('Sale exercises the selected sample policy without a model or a real order',()=>{
  const sample=retailSampleSchema.parse({...input,stock:10,rules:['verified_price','stock_limit','confirm_quantity','quote_only']});
  const run=exerciseRetailSample(sample);
  assert.equal(run.passed,true);
  assert.equal(run.knowledgeVersion,3);
  assert.equal(run.source,'sample_rules');
  assert.equal(run.generatedByModel,false);
  assert.equal(run.quote.totalVnd,70000);
  assert.equal(run.ordersCreated,0);
  assert.equal(run.liveSales,false);
  assert.equal(exerciseRetailSample({...sample,rules:sample.rules.filter(rule=>rule!=='stock_limit')}).passed,false);
  assert.equal(exerciseRetailSample({...sample,rules:sample.rules.filter(rule=>rule!=='confirm_quantity')}).passed,false);
  assert.equal(retailSampleSchema.safeParse({...sample,stock:1}).success,false);
});

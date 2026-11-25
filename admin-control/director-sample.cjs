'use strict';

const sampleBrief = Object.freeze({
  mode:'sample',sampleProductId:'demo-a',product:'Nước uống mẫu',
  region:'Lào Cai',objective:'Kiểm thử quy trình điều hành 24H từ danh mục đến biên nhận mẫu.',ageMin:18,
  purchaseVnd:10000,priceVnd:15000,budgetVnd:12000,
  packingVnd:500,deliveryVnd:0,taxVnd:0,paymentVnd:0,otherUnitVnd:0,otherFixedVnd:0
});
const sampleReleaseRequestId = 'be436e6f-f474-4c02-9fb1-dd1d8823ef12';
const sampleRules = Object.freeze(['verified_price','stock_limit','confirm_quantity','quote_only']);

function sampleText(kind,job,context) {
  const {product,priceVnd,region}=job.input;
  const price=priceVnd.toLocaleString('vi-VN')+' ₫';
  const caption=product+' · '+price+' mỗi đơn vị. Mời kiểm tra danh mục và giỏ hàng trong chế độ thử nghiệm.';
  switch (kind) {
    case 'research':
      return {source:'demo_fixture',text:'Đề bài kiểm tra khách tìm sản phẩm, so sánh giá, hỏi số lượng tồn và xác nhận giỏ. Phạm vi địa lý chỉ là nhãn diễn tập '+region+'.',
        sources:[{title:'Sản phẩm trong danh mục mẫu 24H',url:'https://extra-24h.onrender.com/demo/san-pham/demo-a'}]};
    case 'plan':
      return {source:'demo_fixture',text:'Dùng website mẫu để xác nhận đơn giá và lượng hàng. Chuyển một cuộc hội thoại có nhu cầu mua sang Sale. So sánh số lượng với mức hòa vốn mẫu '+context.forecast.breakEvenUnits+' đơn vị và thử ngưỡng dừng chi tiêu.'};
    case 'direction':
      return {
        source:'demo_fixture',contentBrief:'Tạo bản nháp thể hiện đúng giá '+price+' và nhãn thử nghiệm.',
        creativeBrief:'Dùng bố cục giới thiệu trung tính và đánh dấu sản phẩm là dữ liệu mẫu.',
        saleBrief:'Tra cứu tồn kho mẫu, xác nhận số lượng và trả báo giá trước khi tạo biên nhận.',
        channels:'Chuẩn bị bản nháp cho website và các kênh xã hội, giữ nội dung trong lượt chạy mẫu.',
        budget:'Mô phỏng hai mốc chi tiêu để kiểm tra việc dừng trong hạn mức đã giao.',
        acceptance:'Đối chiếu giá, số lượng và mã biên nhận của website với báo giá từ Sale.'
      };
    case 'content':
      return {source:'demo_fixture',website:caption,facebook:caption,tiktok:'Video mẫu giới thiệu '+product+' và thao tác thêm vào giỏ.',
        ads:caption,video:'Mở danh mục, xem '+product+', thêm vào giỏ và kiểm tra báo giá mẫu.'};
    case 'creative':
      return {source:'demo_fixture',text:'Brief hình ảnh mẫu. Bố cục có ảnh minh họa trung tính, tên '+product+' và nhãn Dữ liệu mẫu.',
        rights:{origin:'internal_sample_brief',publicationApproved:false},previewOnly:true};
    case 'training':
      return {source:'demo_fixture',rules:sampleRules,
        playbook:'Tra cứu tên, giá và tồn kho trong danh mục mẫu. Hỏi rõ số lượng, xin xác nhận, sau đó trả báo giá mẫu cho người mua kiểm tra.',
        objections:'Đề xuất giảm số lượng cho phù hợp ngân sách. Giữ nguyên đơn giá và kiểm tra lại tồn kho trước khi báo giá.',
        validation:'Thử tình huống hỏi giá, chưa xác nhận, đã xác nhận và yêu cầu vượt quá tồn kho mẫu.'};
    default:
      throw Error('Unknown task for sample copy');
  }
}

function judgeSpend(plan,campaignId,reading) {
  if (reading.accountId!==plan.scope.adAccountId || reading.campaignId!==campaignId || reading.currency!=='VND') {
    return {action:'ignore',reason:'outside_campaign'};
  }
  if (!Number.isSafeInteger(reading.spentVnd) || reading.spentVnd<0) return {action:'pause',reason:'missing_verified_spend'};
  if (reading.spentVnd>=plan.stopThresholdVnd) return {action:'pause',reason:'stop_threshold_reached'};
  return {action:'continue',reason:'under_threshold'};
}

function exerciseSampleBudget(plan,id) {
  const mockId='DEMO-AD-'+id;
  const observation={accountId:plan.scope.adAccountId,campaignId:mockId,currency:'VND'};
  const readings=[
    {...observation,campaignId:'OTHER-CAMPAIGN',spentVnd:plan.maxBudgetVnd},
    {...observation,spentVnd:Math.max(0,plan.stopThresholdVnd-1)},
    {...observation,spentVnd:plan.stopThresholdVnd}
  ];
  const decisions=readings.map(reading=>({spentVnd:reading.spentVnd,...judgeSpend(plan,mockId,reading)}));
  if (decisions[0].action!=='ignore' || decisions[1].action!=='continue' || decisions[2].action!=='pause') {
    throw Error('Sample budget controls failed');
  }
  return {...plan,source:'demo_fixture',demoCampaignId:mockId,sampleSpendVnd:plan.stopThresholdVnd,
    stopDecision:decisions[2],decisions,campaignCreated:false};
}

function sampleSummary(input,dependencies) {
  const order=dependencies.actuals?.status==='accepted' ? dependencies.actuals.result : null;
  const ads=dependencies.ads?.status==='accepted' ? dependencies.ads.result : null;
  const forecast=dependencies.forecast?.status==='accepted' ? dependencies.forecast.result : null;
  const checkoutVnd=order?.checkoutVnd ?? null, spendVnd=ads?.sampleSpendVnd ?? null;
  const variableCostVnd=order && Number.isSafeInteger(forecast?.variableCostsVnd)
    ? order.quantity*(input.purchaseVnd+forecast.variableCostsVnd) : null;
  const profitVnd=[checkoutVnd,spendVnd,variableCostVnd,input.otherFixedVnd].every(Number.isSafeInteger)
    ? checkoutVnd-spendVnd-variableCostVnd-input.otherFixedVnd : null;
  return {source:'demo_fixture',receipt:order?.receipt ?? null,units:order?.quantity ?? null,
    checkoutVnd,spendVnd,variableCostVnd,profitVnd,adsStop:ads?.stopDecision?.action==='pause'};
}

module.exports = {sampleBrief,sampleReleaseRequestId,sampleText,exerciseSampleBudget,sampleSummary};

// Apply after the existing checkout and V2.1 integrations, which validate their input digests.
const fs=require("node:fs"),assert=require("node:assert/strict");
const file="lib/ai-sales.ts";
let worker=fs.readFileSync(file,"utf8");
function change(before,after) {
  assert.equal(worker.split(before).length,2,"Missing V2.2 integration point: "+before);
  worker=worker.replace(before,()=>after);
}
change("import {consultationPolicy,directTierReply}", "import {consultationPolicy,directTierReply,salesPreferences}");
change('import "server-only";','import "server-only";\nimport {alsoNeedsAdvice,catalogSeatPage,chatFirstPolicy,clarifyBookingPage,requestsImageAndPage,styleSalesReply,wantsBookingPage} from "./messenger-conversation-style";');
change("kèm URL landing page chính xác của đúng show lấy từ công cụ shows để khách xem tình trạng và chọn ghế. Không tự tạo URL.","tư vấn ngay trong cuộc trò chuyện. ${chatFirstPolicy}");
change("action:Action,seatMapUrl?:string):Promise<void>{","action:Action,seatMapUrl?:string,style?:{customer:string;history:Message[];page?:string}):Promise<void>{");
change('  const parts=seatMapUrl?[action.body]:splitAiMessage(action.purpose==="reply"?await extraPersonalizeFirstReply(chat,action.body):action.body);',
 `  const text=action.purpose==="reply"&&!seatMapUrl?await extraPersonalizeFirstReply(chat,action.body):action.body;
  const parts=seatMapUrl?[action.body]:splitAiMessage(style&&action.purpose==="reply"?styleSalesReply(text,style.customer,style.history,style.page):text);`);
const start=worker.indexOf('async function handleInbound('),end=worker.indexOf('async function processJob(',start);
assert(start>=0&&end>start);
const inbound=worker.slice(start,end);
assert(inbound.includes('sendAiSalesMessage(job,chat,'));
worker=worker.slice(0,start)+inbound.replaceAll('sendAiSalesMessage(job,chat,','sendInbound(')+worker.slice(end);
change('  const context:AiCheckoutContext=',`  const style:{customer:string;history:Message[];page?:string}={customer:latest.body,history:messages};
  const sendInbound=(action:Action,media?:string)=>sendAiSalesMessage(job,chat,action,media,style);
  const context:AiCheckoutContext=`);
change('  const advice = !familyTopic',`  const pageWanted=wantsBookingPage(latest.body,messages);
  if(pageWanted && !confirmationProblem){
    const catalog=await listAiSalesShows().catch(()=>[]);
    const memory=salesPreferences(messages,catalog,commentContext?.showId);
    const show=memory.showSelectionUnresolved?undefined:catalog.find(s=>s.id===(memory.showId||currentOrder?.showId||latestQuote?.showId));
    style.page=catalogSeatPage(show);
    if(!style.page||!alsoNeedsAdvice(latest.body)){
      await guard(job);
      await sendInbound({purpose:"reply",body:style.page&&show?"Em gửi mình trang chọn ghế của đêm "+show.artist+" nhé.":clarifyBookingPage});
      return;
    }
  }
  const advice = !familyTopic`);
change('const advice = !familyTopic && !confirmationProblem','const advice = !familyTopic && !confirmationProblem && (!pageWanted||requestsImageAndPage(latest.body))');
change('body:selected.show?"Dạ, ảnh sơ đồ chưa gửi được. Mình xem sơ đồ ghế và ghế còn trống tại "+selected.show.url+" nhé.":"Dạ, ảnh sơ đồ chưa gửi được. Mình cho em tên show để em gửi đúng trang xem sơ đồ ghế nhé."',
 'body:"Em chưa gửi được ảnh sơ đồ. Mình muốn ưu tiên ghế gần ca sĩ, góc chính diện hay mức giá nào để em tư vấn ngay ở đây ạ?"');
change('const quickReply=(!familyTopic','const quickReply=(!pageWanted&&!familyTopic');
// Route verified show signals through the same guarded delivery and checkout paths.
change('import {readMessengerImage} from "./ai-sales-inbound-image";','import {readMessengerImage} from "./ai-sales-inbound-image";\nimport {recognizeInquiry} from "./messenger-recognize-inquiry";');
change('const [history,stateRows,latestQuote,commentContext]', 'const [history,stateRows,latestQuote,baseComment]');
change('  const style:{customer:string;', `  await guard(job);
  const recognition=await recognizeInquiry(messages,chat.messenger_page_id,chat.messenger_psid).catch(()=>({} as Awaited<ReturnType<typeof recognizeInquiry>>));
  const commentContext=recognition.showId===undefined?baseComment:recognition.showId?{comment:"",post:"",firstReply:"",showId:recognition.showId}:null;
  if(recognition.caption)latest.body=recognition.caption;
  const style:{customer:string;`);
change('  if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE', `  if(recognition.reply){
    await guard(job);
    await sendInbound({purpose:"reply",body:recognition.reply});
    return;
  }
  if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE`);
change('const reading=latest.external_message_id?await readMessengerImage(latest.external_message_id,chat.messenger_psid,chat.messenger_page_id):null;', 'const reading=recognition.reading!==undefined?recognition.reading:latest.external_message_id?await readMessengerImage(latest.external_message_id,chat.messenger_psid,chat.messenger_page_id):null;');
change('Dạ, em đã nhận ảnh nhưng chưa đọc được rõ nội dung. Mình gửi lại ảnh rõ hơn hoặc cho em mã đơn để kiểm tra nhé.', 'Em chưa đọc rõ nội dung ảnh. Mình có thể gửi ảnh nét hơn hoặc cho em biết phần mình muốn hỏi được không ạ?');
fs.writeFileSync(file,worker);
const quickFile="lib/ai-sales-quick-reply.ts";
const quick=fs.readFileSync(quickFile,"utf8");
const oldLabel='prices.map(z=>"Hạng "+z+';
assert.equal(quick.split(oldLabel).length,2);
fs.writeFileSync(quickFile,'import {tierName} from "./poster-offers";\n'+quick.replace(oldLabel,'prices.map(z=>tierName(show.id,z)+'));

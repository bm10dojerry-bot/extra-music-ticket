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
change('import {recognizeInquiry} from "./messenger-recognize-inquiry";','import {recognizeInquiry} from "./messenger-recognize-inquiry";\nimport {showServiceReply} from "./messenger-show-service";\nimport {maybeSendHeart} from "./messenger-heart";\nimport {friendlyAcknowledgement} from "./messenger-conversation-style";');
change('  const sendInbound=(action:Action,media?:string)=>sendAiSalesMessage(job,chat,action,media,style);', `  let serviceNote="";
  const sendInbound=(action:Action,media?:string)=>{
    const withNote=serviceNote && action.purpose==="reply" && !media ? {...action,body:serviceNote+"\\n"+action.body}:action;
    if(withNote!==action)serviceNote="";
    return sendAiSalesMessage(job,chat,withNote,media,style);
  };`);
change('  const pageWanted=wantsBookingPage(latest.body,messages);',`  const friendly=friendlyAcknowledgement(latest.body);
  if(!confirmationProblem && friendly){
    await guard(job);
    await sendInbound({purpose:"reply",body:friendly.body});
    if(friendly.heart && latest.external_message_id && !currentOrder && !state?.current_order_code && state?.status!=="needs_attention")
      await maybeSendHeart(chat.messenger_page_id,chat.messenger_psid,latest.external_message_id,messages,()=>guard(job)).catch(()=>{});
    return;
  }
  const service=!confirmationProblem?await showServiceReply(latest.body,messages,commentContext?.showId||currentOrder?.showId||latestQuote?.showId).catch(()=>null):null;
  if(service && !service.continueSales){
    await guard(job);
    await sendInbound({purpose:"reply",body:service.body});
    return;
  }
  serviceNote=service?.body||"";
  const pageWanted=wantsBookingPage(latest.body,messages);`);
// A quote always comes from the customer turn that produced this answer.
change('import "server-only";','import "server-only";\nimport {allowedQuestionReply,questionMessageId} from "./messenger-question-reply";\nimport {followUpAfterAnswer} from "./messenger-short-followup";');
change('style?:{customer:string;history:Message[];page?:string}', 'style?:{customer:string;history:Message[];page?:string;replyToMid?:string}');
change('  if(recognition.caption)latest.body=recognition.caption;', `  const sourceText=recognition.caption||latest.body;
  const quoteCandidates=recognition.caption && latest.body.startsWith("[Khách gửi ảnh; chưa đọc nội dung ảnh.]")?messages.slice(-2):[latest];
  const replyToMid=await allowedQuestionReply(chat.messenger_page_id,chat.messenger_psid,questionMessageId(quoteCandidates,sourceText));
  if(recognition.caption)latest.body=recognition.caption;`);
change('const style:{customer:string;history:Message[];page?:string}={customer:latest.body,history:messages};',
 'const style:{customer:string;history:Message[];page?:string;replyToMid?:string}={customer:latest.body,history:messages,replyToMid};');
change('sendMessengerPageMessage(chat.messenger_psid,parts[index])',
 'sendMessengerPageMessage(chat.messenger_psid,parts[index],index===0&&style?.replyToMid?{mid:style.replyToMid,beforeFallback:()=>guard(job)}:undefined)');
change('    console.info("[ai-sales] Job completed",job.kind);', `    console.info("[ai-sales] Job completed",job.kind);
    if(job.kind==="inbound" && job.source_message_id)await followUpAfterAnswer(job.id,chat.id,job.source_message_id).catch(()=>console.warn("[ai-sales] Optional follow-up skipped"));`);

// Earlier build stages generate image delivery from the original text transport.
// Only extend the text transport after the image and typing handlers have been installed.
const transport="lib/facebook-messenger.ts";
let source=fs.readFileSync(transport,"utf8");
const textStart=source.indexOf("export async function sendMessengerPageMessage(");
const textEnd=source.indexOf("export async function sendMessengerPageImage(",textStart);
assert(textStart>=0&&textEnd>textStart);
let send=source.slice(textStart,textEnd);
function updateSend(before,after){assert.equal(send.split(before).length,2);send=send.replace(before,()=>after);}
updateSend("psid:string,message:string)", "psid:string,message:string,replyTo?:{mid:string;beforeFallback:()=>Promise<unknown>})");
updateSend("message:{text:message}", "...(replyTo?{reply_to:{mid:replyTo.mid}}:{}),message:{text:message}");
updateSend('  console.warn("[messenger-api] Failed"', `  const quoteRejected=res.status===400 && (data.error?.code===9000001 ||
    (data.error?.code===100 && /reply.to|quoted message|message.to.reply|invalid.*mid/i.test(data.error?.message||"")));
  if(replyTo && quoteRejected){
    await replyTo.beforeFallback();
    return sendMessengerPageMessage(psid,message);
  }
  console.warn("[messenger-api] Failed"`);
fs.writeFileSync(transport,source.slice(0,textStart)+send+source.slice(textEnd));
// Checkout confirmation recovery: keep existing SQL consent and reservation protections.
const recoveryHelper="function shouldRefreshConfirmedQuote(body:string,sentAt:string|null,receivedAt:string,confirmationError:string):boolean{\n  if(!sentAt)return false;\n  const elapsed=Date.parse(receivedAt)-Date.parse(sentAt);\n  if(!Number.isFinite(elapsed)||elapsed<=0||elapsed>30*60*1000)return false;\n  const short=body.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g,\"\").replace(/[đĐ]/g,\"d\").toLowerCase().replace(/[.!?,]+/g,\" \").trim().replace(/\\s+/g,\" \");\n  // \"Oke\" is intentionally not passed to the reservation RPC. Requote and request a fresh explicit confirmation.\n  if(/^(oke|okie|okey)( (em|nhe|nha|a|nhe em|em nhe))?$/.test(short))return true;\n  return /\\bAI_(QUOTE_CHANGED|CONFIRMATION_REQUIRED)\\b/.test(confirmationError);\n}";
const recoveryBlock="  // A checkout rejection is not a request for human support. Refresh the server-priced quote instead.\n  // Never retry a reservation with stale consent or create a second order on a transport error.\n  if(latestQuote && !currentOrder && !state?.current_order_code && !recognition.caption &&\n      shouldRefreshConfirmedQuote(latest.body,latestQuote.sentAt,latest.created_at,confirmationFailure)){\n    await guard(job);\n    const existing=await staffDb(\"extra_messenger_ai_orders?chat_id=eq.\"+chat.id+\"&quote_id=eq.\"+latestQuote.id+\"&select=order_code&limit=1\") as {order_code:string}[];\n    if(!Array.isArray(existing)||existing.length)throw Error(\"Checkout recovery deferred: verify existing reservation\");\n    let refreshed:AiSalesQuote;\n    try{refreshed=await buildAiQuote(context,latestQuote);}\n    catch(error){\n      if(error instanceof JobStopped)throw error;\n      if(!(error instanceof Error)||!/\\bAI_SEAT_CONFLICT\\b/.test(error.message))throw error;\n      await sendInbound({purpose:\"reply\",body:\"Dạ, cặp ghế vừa chọn hiện không còn trống. Em chưa giữ ghế hoặc tạo đơn thanh toán. Mình muốn em kiểm tra cặp ghế khác cùng hạng nhé?\"});\n      await setState(job,\"in_progress\",\"Ghế vừa chọn không còn trống; chờ khách chọn lại.\",null);return;\n    }\n    await guard(job);\n    await sendInbound({purpose:\"quote\",body:\"Dạ, em xin lỗi vì bước xác nhận vừa rồi chưa hoàn tất. Em đã kiểm tra lại và gửi báo giá mới để mình xác nhận, chưa thu tiền hoặc giữ ghế nhé.\\n\"+renderAiQuoteMessage(refreshed),quoteId:refreshed.id});\n    await setState(job,\"in_progress\",\"Đã gửi lại báo giá đã kiểm tra; chờ khách xác nhận mới.\",null);return;\n  }\n";
const tsRecovery=require("typescript");
const compiled=tsRecovery.transpileModule(recoveryHelper,{compilerOptions:{target:tsRecovery.ScriptTarget.ES2022}}).outputText;
const shouldRefresh=new Function(compiled+"\nreturn shouldRefreshConfirmedQuote;")();
const sent="2026-11-26T05:23:19Z",later="2026-11-26T05:24:11Z";
assert.equal(shouldRefresh("Oke",sent,later,""),true);
assert.equal(shouldRefresh("Okie nhé",sent,later,""),true);
assert.equal(shouldRefresh("ĐỒNG Ý",sent,later,'Database 400 AI_QUOTE_CHANGED'),true);
assert.equal(shouldRefresh("Đồng ý",sent,later,'Database 400 AI_CONFIRMATION_REQUIRED'),true);
assert.equal(shouldRefresh("Đồng ý",sent,later,"ECONNRESET"),false);
assert.equal(shouldRefresh("Không đồng ý",sent,later,""),false);
assert.equal(shouldRefresh("Oke",null,later,""),false);
assert.equal(shouldRefresh("Oke",sent,"2026-11-26T06:00:00Z",""),false);
assert.equal(shouldRefresh("Oke",sent,sent,""),false);
change('async function handleInbound(job:AiJob,chat:AiChat){',recoveryHelper+'\nasync function handleInbound(job:AiJob,chat:AiChat){');
change('let confirmationProblem=false;','let confirmationProblem=false;let confirmationFailure="";');
change('if(error instanceof JobStopped)throw error;\n      confirmationProblem=true;','if(error instanceof JobStopped)throw error;\n      confirmationProblem=true;confirmationFailure=error instanceof Error?error.message:"";');
change('  const friendly=friendlyAcknowledgement(latest.body);',recoveryBlock+'  const friendly=friendlyAcknowledgement(latest.body);');
const recoveryAst=tsRecovery.createSourceFile(file,worker,tsRecovery.ScriptTarget.Latest,true,tsRecovery.ScriptKind.TS);
assert.equal(recoveryAst.parseDiagnostics.length,0,"Checkout recovery syntax");
console.log("[EXTRA AI Sale] 9 confirmation-recovery cases passed; SQL reservation and payment guards unchanged.");

 // Natural checkout confirmation, synchronized with migration messenger_confirmation_language_variants.
 const checkoutFile="lib/ai-sales-checkout.ts";
 let checkoutSource=fs.readFileSync(checkoutFile,"utf8");
 const checkoutAst=tsRecovery.createSourceFile(checkoutFile,checkoutSource,tsRecovery.ScriptTarget.Latest,true,tsRecovery.ScriptKind.TS);
 const confirmationFunctions=checkoutAst.statements.filter(n=>tsRecovery.isFunctionDeclaration(n)&&n.name?.text==="isAiPurchaseConfirmation");
 assert.equal(confirmationFunctions.length,1,"Expected exactly one checkout confirmation parser");
 const existingConfirmation=confirmationFunctions[0];
 const nextConfirmation="export function isAiPurchaseConfirmation(body:string):boolean{\n  if(typeof body!==\"string\"||body.length>100)return false;\n  const text=body.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g,\"\").replace(/[đĐ]/g,\"d\").toLowerCase().replace(/[.!,]+/g,\" \").trim().replace(/\\s+/g,\" \");\n  return /^((da|vang|u|uh|um) )?(ok|okay|oke|okie|okey|oki|o ke|uk|dong y|dong y dat ve|dong y mua ve|dong y lay ve|chot|chot ve|chot don|xac nhan|xac nhan dat ve|xac nhan mua ve|yes|duoc|duoc roi|nhat tri|dong y chot|ok chot|ok dat ve|vang|da|u|uh|um)( (em|anh|chi|nhe|nha|a|nhe em|em nhe|nha em|em nha|giup anh|giup chi|luon|luon em|a em|em a|anh nhe|chi nhe|e|minh))?$/.test(text);\n}";
 checkoutSource=checkoutSource.slice(0,existingConfirmation.getStart(checkoutAst))+nextConfirmation+checkoutSource.slice(existingConfirmation.getEnd());
 const quoteWording='trả lời “ĐỒNG Ý”';
 assert.equal(checkoutSource.split(quoteWording).length,2,"Expected checkout quote wording");
 checkoutSource=checkoutSource.replace(quoteWording,'trả lời “OK”, “Oke”, “Đồng ý” hoặc xác nhận tương đương');
 const confirmationCompiled=tsRecovery.transpileModule(nextConfirmation.replace("export function ","function "),{compilerOptions:{target:tsRecovery.ScriptTarget.ES2022}}).outputText;
 const actualConfirmation=new Function(confirmationCompiled+"\\nreturn isAiPurchaseConfirmation;".replace("\\n","\n"))();
 const confirmationCases=[["ok",true],["OK",true],["Oke",true],["ĐỒNG Ý",true],["đồng ý",true],["Đồng ý",true],["đồng ý nhé em",true],["Dạ OK ạ",true],["ô kê!",true],["okie",true],["ok chốt",true],["vâng ạ",true],["được rồi",true],["Dạ, ok",true],["ok em ạ",true],["chốt luôn",true],["ok anh nhé",true],["không đồng ý",false],["ok nhưng đổi ghế",false],["đồng ý nếu giảm giá",false],["ok?",false],["why",false],["ok em hỏi thêm",false],["chưa đồng ý",false],["đồng ý đổi ngày",false],["",false]];
 for(const [body,expected] of confirmationCases)assert.equal(actualConfirmation(body),expected,"Checkout confirmation: "+body);
 const updatedCheckoutAst=tsRecovery.createSourceFile(checkoutFile,checkoutSource,tsRecovery.ScriptTarget.Latest,true,tsRecovery.ScriptKind.TS);
 assert.equal(updatedCheckoutAst.parseDiagnostics.length,0,"Checkout parser syntax");
 fs.writeFileSync(checkoutFile,checkoutSource);
 change('const instructions=`','const instructions=`Chấp nhận xác nhận mua vé tự nhiên sau báo giá hợp lệ: OK, Oke, Đồng ý, chốt, vâng và các biến thể viết hoa, viết thường, có dấu hoặc không dấu. Không ép khách gõ một cụm từ cố định. Câu phủ định, câu hỏi hoặc yêu cầu thay đổi không phải xác nhận; luôn giữ nguyên bộ kiểm tra báo giá, tồn ghế và đối soát thanh toán ở máy chủ.\\n');
 console.log("[EXTRA AI Sale] "+confirmationCases.length+" natural-confirmation parser cases passed.");

 // Direct checkout after the customer has selected seats and supplied booking details.
 const directCheckoutPath="lib/ai-sales-checkout.ts";
 let directCheckoutSource=fs.readFileSync(directCheckoutPath,"utf8");
 function changeCheckout(before,after){assert.equal(directCheckoutSource.split(before).length,2,"Direct checkout anchor: "+before);directCheckoutSource=directCheckoutSource.replace(before,()=>after);}
 changeCheckout('export async function reserveAiQuote(context:AiCheckoutContext,quoteId:string):Promise<AiSalesOrder>{','export async function reserveAiQuote(context:AiCheckoutContext,quoteId:string,mode:"confirmation"|"details"="confirmation"):Promise<AiSalesOrder>{');
 changeCheckout('staffDb("rpc/extra_messenger_ai_reserve_quote",','staffDb(mode==="details"?"rpc/extra_messenger_ai_checkout_details":"rpc/extra_messenger_ai_reserve_quote",');
 fs.writeFileSync(directCheckoutPath,directCheckoutSource);
 change('async function handleInbound(job:AiJob,chat:AiChat){',"function directPaymentBody(quote:AiSalesQuote,order:AiSalesOrder,history:Message[]):string{\n  return \"Thông tin đặt vé EXTRA\\n\"+quote.artist+\" · \"+quote.date.split(\"-\").reverse().join(\"/\")+\" · \"+quote.time+\"\\n\"+quote.venueName+\"\\n\"+renderAiPaymentMessage(order,extraPaymentAddress(history));\n}"+'\nasync function handleInbound(job:AiJob,chat:AiChat){');
 change('  let confirmationProblem=false;',"  if(currentOrder?.status===\"pending\" && latestQuote && !latestQuote.sentAt && latestQuote.sourceMessageId===latest.id &&\n    latestQuote.showId===currentOrder.showId && latestQuote.amount===currentOrder.amount &&\n    [...latestQuote.seats,...latestQuote.giftSeats].slice().sort().join(\",\")===currentOrder.seats.slice().sort().join(\",\")){\n    await sendInbound({purpose:\"payment\",body:directPaymentBody(latestQuote,currentOrder,history),orderCode:currentOrder.code});\n    await setState(job,\"awaiting_payment\",\"Đã gửi hướng dẫn thanh toán; đang chờ tiền về.\",null,currentOrder.code);return;\n  }\n"+'  let confirmationProblem=false;');
 change('const quote=await buildAiQuote(context,input);action={purpose:"quote",body:renderAiQuoteMessage(quote,extraPaymentAddress(history)),quoteId:quote.id};\n        return {prepared:true,amount:quote.amount,seats:quote.seats,waitingForCustomerConfirmation:true};',"const quote=await buildAiQuote(context,input);\n        try{\n          const order=await reserveAiQuote(context,quote.id,\"details\");\n          if(order.status===\"pending\"){\n            action={purpose:\"payment\",body:directPaymentBody(quote,order,history),orderCode:order.code};\n            return {prepared:true,reserved:true,amount:order.amount,seats:order.seats,awaitingPayment:true};\n          }\n          if(order.status===\"paid\"){\n            const ticket=await getAiPaidTicketDelivery(chat.id,order.code);\n            if(ticket)action={purpose:\"ticket\",body:ticket.message,orderCode:order.code};\n            return {prepared:true,status:\"paid\"};\n          }\n          return {error:\"Đơn chưa sẵn sàng thanh toán; kiểm tra trạng thái trước khi tạo đơn khác.\"};\n        }catch(error){\n          if(error instanceof JobStopped)throw error;\n          if(error instanceof Error && /\\bAI_DETAILS_NOT_READY\\b/.test(error.message)){\n            action={purpose:\"reply\",body:\"Dạ, em cần chắc chắn mình đã chọn đúng đêm \"+quote.artist+\" và ghế \"+quote.seats.join(\", \")+\" để lập đơn. Mình muốn đặt đúng các ghế này hay chọn vị trí khác ạ?\"};\n            return {prepared:false,needsBookingDetails:true};\n          }\n          throw error;\n        }");
 change('Chuẩn bị báo giá khi khách đã chọn show/ghế và cung cấp tên, điện thoại, email. Giá do máy chủ tính. Chưa tạo đơn/giữ ghế. Dừng sau công cụ này.','Lập đơn giữ ghế và gửi bảng thanh toán ngay khi khách đã chốt đúng show/ghế, cung cấp tên, điện thoại và email. Máy chủ kiểm tra bằng chứng hội thoại, tính giá và giữ ghế. Không yêu cầu khách nhắn xác nhận báo giá thêm. Chỉ gọi khi khách thực sự muốn đặt vé; không gọi nếu mới hỏi giá hoặc tham khảo. Dừng sau công cụ này.');
 change("    await guard(job);\n    await sendInbound({purpose:\"quote\",body:\"Dạ, em xin lỗi vì bước xác nhận vừa rồi chưa hoàn tất. Em đã kiểm tra lại và gửi báo giá mới để mình xác nhận, chưa thu tiền hoặc giữ ghế nhé.\\n\"+renderAiQuoteMessage(refreshed),quoteId:refreshed.id});\n    await setState(job,\"in_progress\",\"Đã gửi lại báo giá đã kiểm tra; chờ khách xác nhận mới.\",null);return;","    await guard(job);\n    try{\n      const order=await reserveAiQuote(context,refreshed.id,\"details\");\n      if(order.status===\"paid\"){await handlePaid(job,chat,order.code);return;}\n      if(order.status===\"pending\"){\n        await sendInbound({purpose:\"payment\",body:directPaymentBody(refreshed,order,history),orderCode:order.code});\n        await setState(job,\"awaiting_payment\",\"Đã gửi hướng dẫn thanh toán; đang chờ tiền về.\",null,order.code);return;\n      }\n    }catch(error){\n      if(error instanceof JobStopped)throw error;\n      if(!(error instanceof Error)||!/\\bAI_DETAILS_NOT_READY\\b/.test(error.message))throw error;\n    }\n    await sendInbound({purpose:\"reply\",body:\"Dạ, báo giá cũ cần kiểm tra lại. Mình muốn đặt đúng ghế \"+refreshed.seats.join(\", \")+\" của đêm \"+refreshed.artist+\" hay đổi vị trí khác ạ?\"});\n    await setState(job,\"in_progress\",\"Đang làm rõ yêu cầu đặt vé; chưa giữ ghế.\",null);return;");
 change('gửi báo giá để khách xác nhận, hướng dẫn thanh toán','lập đơn và gửi bảng thanh toán ngay khi đủ thông tin đặt vé');
 change('Khi đủ thông tin, dùng prepare_quote. Công cụ sẽ tạo bản xác nhận chính xác; dừng ngay sau đó.','Khi khách đã chọn đúng ghế và đủ thông tin, dùng prepare_quote. Công cụ lập đơn, giữ ghế và gửi bảng thanh toán ngay nếu bằng chứng hội thoại hợp lệ; dừng ngay sau đó.');
 change('Khách phải trả lời xác nhận báo giá vừa nhận thì máy chủ mới tạo đơn.','Không có bước xác nhận báo giá riêng cho đơn mới. Khách đã chốt đặt vé và gửi đủ thông tin là đã đủ để máy chủ kiểm tra lập đơn; không ép khách nhắn OK hay ĐỒNG Ý thêm.');
 change('const instructions=`','const instructions=`QUY TRÌNH CHỐT VÉ MỚI ƯU TIÊN CAO NHẤT: Bỏ bước gửi báo giá yêu cầu xác nhận lại. Khi khách đã chọn show, số vé, ghế cụ thể, hãy nói rõ nghệ sĩ, mã ghế, tổng giá và xin họ tên, số điện thoại, email nhận vé để lập đơn đặt vé/gửi QR thanh toán trong cùng câu. Ví dụ cấu trúc: “Đêm [nghệ sĩ], ghế [mã ghế], tổng [giá đã kiểm tra]. Mình cho em xin họ tên, số điện thoại và email để lập đơn đặt vé, gửi QR thanh toán nhé.” Nếu đã có đủ thông tin và ý định đặt vé rõ thì gọi prepare_quote ngay, không hỏi thêm. Chỉ hỏi lại về thông tin hoặc lựa chọn thực sự thiếu/mâu thuẫn; không gửi báo giá chờ khách nói đồng ý. Nếu khách mới hỏi giá hoặc tham khảo thì không giữ ghế. Thanh toán phải được đối soát như trước, không phát hành vé trước khi nhận tiền. Quy tắc này thay thế mọi yêu cầu xác nhận báo giá riêng ở các phần bên dưới.\\n');
 for(const [p,s] of [[file,worker],[directCheckoutPath,directCheckoutSource]])assert.equal(tsRecovery.createSourceFile(p,s,tsRecovery.ScriptTarget.Latest,true,tsRecovery.ScriptKind.TS).parseDiagnostics.length,0,"Direct checkout syntax: "+p);
 console.log("[EXTRA AI Sale] Direct booking checkout installed: verified details -> guarded reservation -> payment text and QR; legacy quote confirmation preserved.");
// Contact validation comes after all earlier build-time worker transformations.
change('import "server-only";','import "server-only";\nimport {inspectBookingContacts,unresolvedContactFields,correctedBookingContact,checkoutContactIssues,missingContactProof,contactCorrectionReply} from "./messenger-contact-validation";');
change('  let confirmationProblem=false;let confirmationFailure="";', '  const contactEvidence=inspectBookingContacts(messages);\n  const contactIssues=unresolvedContactFields(contactEvidence);\n  if((!currentOrder||currentOrder.status==="expired")&&contactEvidence.active&&contactIssues.length&&(contactEvidence.currentIsContact||contactEvidence.affirmation)){\n    await guard(job);\n    await sendInbound({purpose:"reply",body:contactCorrectionReply(contactIssues)});\n    return;\n  }\n  let confirmationProblem=false;let confirmationFailure="";');
change('const instructions=\x60','const instructions=\x60QUY TẮC KIỂM TRA THÔNG TIN NHẬN VÉ: Chỉ hỏi đúng trường còn thiếu hoặc chưa hợp lệ (họ tên, số điện thoại, email), không hỏi lại thông tin đã đúng hoặc show/ghế đã chốt. Email phải đúng định dạng; không tự sửa dấu cách, ký tự, domain hoặc địa chỉ email. Số điện thoại kiểm tra độ dài và định dạng, không tự đoán số. Hiểu “đúng rồi e”, “chính xác”, “ok” theo câu hỏi gần nhất; lời xác nhận không sửa được trường sai. Nếu khách gửi thông tin sai, giải thích ngắn gọn một lần, xin đúng trường cần sửa rồi tiếp tục khi nhận thông tin mới. Không gửi tin tư vấn bổ sung trong lúc sửa thông tin. Khi đủ thông tin hợp lệ và đã có ý định đặt vé rõ, gọi prepare_quote ngay; không yêu cầu xác nhận lại toàn bộ đơn. Nếu máy chủ không xác minh được, không tự tạo đơn hay đoán thông tin.\n');
change('name:z.string().min(2).max(120),phone:z.string().max(20),email:z.string().email().max(254)','name:z.string().max(300),phone:z.string().max(300),email:z.string().max(300)');
change('const quote=await buildAiQuote(context,input);\n        try{','const checkedInput=correctedBookingContact(input,contactEvidence);\n        const invalidFields=checkoutContactIssues(checkedInput,contactEvidence);\n        if(invalidFields.length){\n          action={purpose:"reply",body:contactCorrectionReply(invalidFields)};\n          return {prepared:false,invalidFields};\n        }\n        const quote=await buildAiQuote(context,checkedInput);\n        try{');
change('action={purpose:"reply",body:"Dạ, em cần chắc chắn mình đã chọn đúng đêm "+quote.artist+" và ghế "+quote.seats.join(", ")+" để lập đơn. Mình muốn đặt đúng các ghế này hay chọn vị trí khác ạ?"};\n            return {prepared:false,needsBookingDetails:true};','const missing=missingContactProof(contactEvidence);\n            if(missing.length)action={purpose:"reply",body:contactCorrectionReply(missing)};\n            else if(!contactEvidence.active)action={purpose:"reply",body:"Dạ, mình muốn đặt ghế "+quote.seats.join(", ")+" của đêm "+quote.artist+" đúng không ạ? Em đã ghi nhận thông tin liên hệ, mình không cần gửi lại."};\n            else {needsSupport=true;action={purpose:"reply",body:"Dạ, em đã ghi nhận các thông tin mình cung cấp. Hệ thống chưa hoàn tất lập đơn, em cần nhờ bộ phận phụ trách kiểm tra thêm. Mình không cần gửi lại thông tin ạ."};}\n            return {prepared:false,needsBookingDetails:true};');
change('await sendInbound({purpose:"reply",body:"Dạ, báo giá cũ cần kiểm tra lại. Mình muốn đặt đúng ghế "+refreshed.seats.join(", ")+" của đêm "+refreshed.artist+" hay đổi vị trí khác ạ?"});\n    await setState(job,"in_progress","Đang làm rõ yêu cầu đặt vé; chưa giữ ghế.",null);return;','const missing=missingContactProof(contactEvidence);\n    await sendInbound({purpose:"reply",body:missing.length?contactCorrectionReply(missing):"Dạ, em đã ghi nhận thông tin. Hệ thống chưa hoàn tất lập đơn, em cần nhờ bộ phận phụ trách kiểm tra thêm. Mình không cần gửi lại thông tin ạ."});\n    await setState(job,missing.length?"in_progress":"needs_attention",missing.length?"Chờ khách bổ sung đúng trường liên hệ.":"Cần kiểm tra bước xác minh đặt vé.",null);return;');
change('confirmationProblem,commentContext});','confirmationProblem,contactEvidence,commentContext});');
assert.equal(tsRecovery.createSourceFile(file,worker,tsRecovery.ScriptTarget.Latest,true,tsRecovery.ScriptKind.TS).parseDiagnostics.length,0,"Contact validation worker syntax");
console.log("[EXTRA AI Sale] Field-specific contact validation integrated; existing reservation and payment guards retained.");
fs.writeFileSync(file,worker);
const quickFile="lib/ai-sales-quick-reply.ts";
const quick=fs.readFileSync(quickFile,"utf8");
const oldLabel='prices.map(z=>"Hạng "+z+';
assert.equal(quick.split(oldLabel).length,2);
fs.writeFileSync(quickFile,'import {tierName} from "./poster-offers";\n'+quick.replace(oldLabel,'prices.map(z=>tierName(show.id,z)+'));

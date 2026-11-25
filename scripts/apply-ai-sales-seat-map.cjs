"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),ts=require("typescript");
const worker="lib/ai-sales.ts",messenger="lib/facebook-messenger.ts";
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,"unique anchor: "+a.slice(0,100));return s.replace(a,b);};
let w=fs.readFileSync(worker,"utf8"),m=fs.readFileSync(messenger,"utf8");
w=replace(w,'import {getCommentContextForChat} from "./ai-comment-context";','import {getCommentContextForChat} from "./ai-comment-context";\nimport {isSeatMapRequest,wantsSeatAvailability,selectSeatMap,SEAT_MAP_URL,seatMapVenueName,seatMapCaption} from "./ai-sales-seat-map";');
w=replace(w,'export async function sendAiSalesMessage(job:AiJob,chat:AiChat,action:Action):Promise<void>{','export async function sendAiSalesMessage(job:AiJob,chat:AiChat,action:Action,seatMapUrl?:string):Promise<void>{');
w=replace(w,'const parts=splitAiMessage(action.purpose==="reply"?await extraPersonalizeFirstReply(chat,action.body):action.body);','const parts=seatMapUrl?[action.body]:splitAiMessage(action.purpose==="reply"?await extraPersonalizeFirstReply(chat,action.body):action.body);');
w=replace(w,'p_dedupe_key:job.id+":"+action.purpose+":"+index,','p_dedupe_key:job.id+":"+(seatMapUrl?"seat-map":action.purpose)+":"+index,');
w=replace(w,'try{acknowledgement=await sendMessengerPageMessage(chat.messenger_psid,parts[index]);}','try{acknowledgement=seatMapUrl?await sendMessengerPageImage(chat.messenger_psid,seatMapUrl):await sendMessengerPageMessage(chat.messenger_psid,parts[index]);}');
const branch=[
'  if(!confirmationProblem&&isSeatMapRequest(latest.body)){',
'    await guard(job);',
'    const availableShows=await listAiSalesShows().catch(()=>null);',
'    if(!availableShows){await sendAiSalesMessage(job,chat,{purpose:"reply",body:"Dạ, em chưa tải được sơ đồ ghế lúc này. Mình cho em kiểm tra lại nhé."});return;}',
'    const selected=selectSeatMap(latest.body,messages,availableShows,commentContext,currentOrder?.showId||latestQuote?.showId);',
'    if(!selected){await sendAiSalesMessage(job,chat,{purpose:"reply",body:"Dạ, mình đang quan tâm sơ đồ ghế ở CCC Sa Pa hay sân khấu +1 Extra Lào Cai, hoặc show ca sĩ nào ạ?"});return;}',
'    const availability=wantsSeatAvailability(latest.body);',
'    const imageUrl=SEAT_MAP_URL(selected.venue);',
'    const marker="[Ảnh sơ đồ ghế "+seatMapVenueName(selected.venue)+"]";',
'    try{await sendAiSalesMessage(job,chat,{purpose:"reply",body:marker},imageUrl);}',
'    catch(error){',
'      if(!(error instanceof MessengerSendError)||error.ambiguous)throw error;',
'      await sendAiSalesMessage(job,chat,{purpose:"reply",body:selected.show?"Dạ, ảnh sơ đồ chưa gửi được. Mình xem sơ đồ ghế và ghế còn trống tại "+selected.show.url+" nhé.":"Dạ, ảnh sơ đồ chưa gửi được. Mình cho em tên show để em gửi đúng trang xem sơ đồ ghế nhé."});return;',
'    }',
'    await sendAiSalesMessage(job,chat,{purpose:"reply",body:seatMapCaption(selected,availability)});',
'    return;',
'  }'
].join("\n");
w=replace(w,'  let action:Action|undefined;let needsSupport=false;',branch+'\n  let action:Action|undefined;let needsSupport=false;');
w=replace(w,'const instructions='+String.fromCharCode(96),'const instructions='+String.fromCharCode(96)+'Khi khách hỏi ghế trống hoặc muốn đặt/chọn ghế, kiểm tra dữ liệu ghế bằng công cụ hiện có trước, kèm URL landing page chính xác của đúng show lấy từ công cụ shows để khách xem tình trạng và chọn ghế. Không tự tạo URL. Khi khách chỉ hỏi sơ đồ, dùng chức năng gửi ảnh sơ đồ; không yêu cầu khách truy cập website nếu ảnh đã gửi thành công.\\n');
m=replace(m,'if(!/^https:\\/\\/img\\.vietqr\\.io\\/image\\//.test(imageUrl))throw new MessengerSendError(false);','if(!/^https:\\/\\/img\\.vietqr\\.io\\/image\\//.test(imageUrl)&&!/^https:\\/\\/iextra\\.net\\/api\\/public\\/seat-map\\/(?:ccc|laocai)$/.test(imageUrl))throw new MessengerSendError(false);');
for(const [name,s] of [[worker,w],[messenger,m]])assert.equal(ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length,0,name);
fs.writeFileSync(worker,w);fs.writeFileSync(messenger,m);
console.log("[Extra seat map] Integrated exact venue image, existing guarded outbox, separate dedupe, link only if needed.");

"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),ts=require("typescript");
const read=p=>fs.readFileSync(p,"utf8"),write=(p,s)=>fs.writeFileSync(p,s);
function replace(s,a,b){assert.equal(s.split(a).length,2,"AI Sale 2.4 anchor: "+a.slice(0,130));return s.replace(a,()=>b);}
function syntax(p,s){assert.equal(ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length,0,p+" syntax");write(p,s);}
const worker="lib/ai-sales.ts";
let w=read(worker);
w=replace(w,'import "server-only";','import "server-only";\nimport {asksForStaff,unableToAnswer,seatCodes,simpleSeatQuestion,exactSeatDetails,formatExactSeats,HANDOFF_REPLY} from "./ai-sales-24";');
w=replace(w,'  const recognition=await recognizeInquiry(',[
'  if(asksForStaff(latest.body)){',
'    try{await sendAiSalesMessage(job,chat,{purpose:"reply",body:HANDOFF_REPLY});}',
'    finally{await setState(job,"needs_attention","Khách yêu cầu gặp Sale/CSKH/ban quản lý; nhân viên tiếp nhận hội thoại.","Khách chủ động yêu cầu gặp nhân viên.");}',
'    return;',
'  }',
'  const recognition=await recognizeInquiry('
].join("\n"));
w=replace(w,'  const context:AiCheckoutContext=', '  const context:AiCheckoutContext=');
w=replace(w,'  if(recognition.reply){',[
'  const isNewImage=messages.some(m=>m.id===latest.id&&m.body.startsWith("[Khách gửi ảnh;"))||recognition.reading!==undefined;',
'  const reading24=recognition.reading;',
'  const exactCodes=reading24?.kind==="seat_map"?(reading24.seatSelectionCertain?reading24.selectedSeats||[]:[]):seatCodes(latest.body);',
'  if(isNewImage&&(!reading24||reading24.kind==="unreadable"||reading24.kind==="error"||reading24.kind==="other")){',
'    await setState(job,"needs_attention","AI chưa đọc được nội dung khách gửi; Sale kiểm tra ảnh gốc.","Nội dung ảnh chưa xác định được.");return;',
'  }',
'  if((reading24?.kind==="seat_map"&&isNewImage)||simpleSeatQuestion(latest.body)){',
'    const catalog=await listAiSalesShows().catch(()=>[]);',
'    const mem=salesPreferences(messages,catalog,commentContext?.showId);',
'    const choice=recognition.showId===null||mem.showSelectionUnresolved?undefined:catalog.find(s=>s.id===(recognition.showId||mem.showId||currentOrder?.showId||latestQuote?.showId));',
'    if(exactCodes.length&&choice){',
'      let details:Awaited<ReturnType<typeof exactSeatDetails>>|null=null;',
'      try{details=await exactSeatDetails(choice.id,exactCodes);}catch{}',
'      if(details&&details.rows.every(s=>s.status!=="not_found")){await sendInbound({purpose:"reply",body:formatExactSeats(details)});return;}',
'      await setState(job,"needs_attention","Sale kiểm tra mã ghế trên ảnh hoặc tin nhắn.","Mã ghế chưa đối chiếu được với sơ đồ bán vé.");return;',
'    }',
'    if(isNewImage){await setState(job,"needs_attention","Sale kiểm tra vị trí khách đánh dấu trên sơ đồ.","Chưa xác định chắc chắn mã ghế hoặc show từ ảnh.");return;}',
'  }',
'  if(recognition.reply){'
].join("\n"));
w=replace(w,'    const withNote=serviceNote && action.purpose==="reply" && !media ?',[
'    if(action.purpose==="reply"&&!media&&unableToAnswer(action.body))return setState(job,"needs_attention","Sale tiếp quản câu hỏi chưa trả lời được.","AI không đủ dữ liệu hoặc không thể xử lý yêu cầu.").then(()=>{throw new JobStopped("Handoff to Sale");});',
'    const withNote=serviceNote && action.purpose==="reply" && !media ?'
].join("\n"));
w=replace(w,'const instructions='+String.fromCharCode(96),'const instructions='+String.fromCharCode(96)+'AI SALE 2.4: Khi câu hỏi không hiểu, ngoài phạm vi hoặc thiếu căn cứ để trả lời chính xác, gọi request_support ngay và dừng. Không tự nói lời xin lỗi, không hỏi lại vòng vo, không nhắc tiếp. Nếu khách chỉ thiếu một thông tin đặt vé rõ ràng (show, số vé, mã ghế hoặc thông tin nhận vé), được hỏi đúng thông tin thiếu một lần. Khi khách yêu cầu nhân viên/CSKH/ban quản lý thì dùng request_support. Với mã ghế cụ thể phải tra exact_seats; không suy đoán từ hạng vé hoặc ảnh. Giá, tồn ghế và thanh toán phải theo máy chủ. Không lặp lại nội dung vừa gửi hoặc tự chốt khi khách chỉ hỏi.\n');
w=replace(w,'      request_support:tool({description:',[
'      exact_seats:tool({description:"Kiểm tra đúng mã ghế khách nói trên sơ đồ thật, trả hạng vé, giá và trạng thái theo show. Không giữ ghế.",inputSchema:z.object({showId:z.string().max(100),seats:z.array(z.string().regex(/^[A-O][0-9]{2}$/)).min(1).max(20)}),execute:({showId,seats})=>safeTool(()=>exactSeatDetails(showId,seats))}),',
'      request_support:tool({description:'
].join("\n"));
w=replace(w,'  if(!action){\n    const text=result.text.trim();if(!safeAiConversationText(text))throw Error("Model response needs factual review");',[
'  if(needsSupport){await setState(job,"needs_attention","Sale tiếp quản yêu cầu ngoài khả năng AI.","AI yêu cầu nhân viên xử lý.",currentOrder?.code||null);return;}',
'  if(!action){',
'    const text=result.text.trim();if(!safeAiConversationText(text)||unableToAnswer(text)){await setState(job,"needs_attention","Sale tiếp quản câu hỏi chưa trả lời được.","AI chưa thể trả lời chính xác.",currentOrder?.code||null);return;}'
].join("\n"));
w=replace(w,'const imageUrl=SEAT_MAP_URL(selected.venue);','const imageUrl=SEAT_MAP_URL(selected.venue,selected.show?.id);');
syntax(worker,w);
const img="lib/ai-sales-inbound-image.ts";let i=read(img);
i=replace(i,' multipleShows:z.boolean(),',' multipleShows:z.boolean(),\n selectedSeats:z.array(z.string().regex(/^[A-O][0-9]{2}$/)).max(20).optional(),\n seatSelectionCertain:z.boolean().optional(),');
i=replace(i,'When no show text is legible return null. On receipts return null showText and false multipleShows.','When no show text is legible return null. On receipts return null showText and false multipleShows. For a seat map, selectedSeats contains ONLY complete seat codes that are explicitly circled, highlighted as selected, ticked or pointed at by the customer. Never copy all printed or available seats. Require clear row letter and number, pad number to two digits. If the mark, row or number is ambiguous, return empty selectedSeats and seatSelectionCertain false. For other images omit these fields. Never infer seat availability, prices or payment from an image.');
syntax(img,i);
const inquiry="lib/messenger-recognize-inquiry.ts";let q=read(inquiry);
q=replace(q,'  if(isImage)result.reading=reading;','  if(isImage)result.reading=reading;');
syntax(inquiry,q);
const sm="lib/ai-sales-seat-map.ts";let m=read(sm);
m=replace(m,'export const SEAT_MAP_URL=(venue:MapVenue)=>"https://iextra.net/api/public/seat-map/"+venue;','export const SEAT_MAP_URL=(venue:MapVenue,showId?:string)=>"https://iextra.net/api/public/seat-map/"+venue+(showId&&/^[a-z0-9-]{3,100}$/.test(showId)?"?show="+encodeURIComponent(showId):"");');
m=replace(m,'Ảnh thể hiện các hạng ghế, không thể hiện tình trạng ghế còn trống.','Ảnh có mã của từng ghế trên sơ đồ bán vé.');
syntax(sm,m);
const fb="lib/facebook-messenger.ts";let f=read(fb);
f=replace(f,'(?:ccc|laocai)$/.test(imageUrl)','(?:ccc|laocai)(?:\\?show=[a-z0-9-]{3,100})?$/.test(imageUrl)');
syntax(fb,f);
const notif="lib/ai-sales-notifications.ts";let n=read(notif);
n=replace(n,'AI cần xử lý tiếp trường hợp này. Trạng thái thanh toán được giữ nguyên theo dữ liệu đối soát.','Nhân viên Sale/CSKH cần tiếp quản hội thoại. Mở liên kết nội bộ để xem đầy đủ nội dung. Trạng thái thanh toán không thay đổi.');
syntax(notif,n);
function load(p,mocks={}){const compiled=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};new Function("require","module","exports",compiled)(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),mod,mod.exports);return mod.exports;}
const v=load("lib/venues.ts"),maps=load("lib/seat-map-image.ts",{"./venues":v}),policy=load("lib/ai-sales-24.ts",{"server-only":{},"./messenger-sale-memory":{customerRequestsHuman:s=>s==="Gặp nhân viên"},"./ai-sales-checkout":{},"./poster-offers":{}});
for(const msg of ["Cho anh gặp ban quản lý","Em muốn liên hệ với CSKH","Xin số hotline","Gặp nhân viên"])assert.equal(policy.asksForStaff(msg),true,msg);
assert.equal(policy.asksForStaff("Không cần gặp ban quản lý"),false);
assert.deepEqual(policy.seatCodes("Ghế C1, C02 và A15"),["C01","C02","A15"]);
assert.equal(policy.simpleSeatQuestion("C01 C02 còn trống không"),true);
assert.equal(policy.simpleSeatQuestion("Chốt C01 C02"),false);
assert.equal(policy.unableToAnswer("Em chưa đọc rõ nội dung ảnh"),true);
assert.equal(policy.unableToAnswer("Ghế C01 đang trống"),false);
for(const venue of ["ccc","laocai"]){const seats=v.seatsFor(venue),svg=maps.renderSeatMapSvg(venue,{}, {seats,taken:new Set([seats[0].id]),title:"<test>",checkedAt:"test"});for(const seat of seats)assert.ok(svg.includes(">"+seat.id+"</text>"),venue+" "+seat.id);assert.ok(svg.includes("#737984"));assert.ok(svg.includes("&lt;test&gt;"));}
console.log("[AI SALE 2.4] Handoff, exact seat codes, two real layout maps and safety checks passed.");

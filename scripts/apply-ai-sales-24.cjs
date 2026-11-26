"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),ts=require("typescript");
const read=p=>fs.readFileSync(p,"utf8"),write=(p,s)=>fs.writeFileSync(p,s);
function replace(s,a,b){assert.equal(s.split(a).length,2,"AI Sale 2.4 anchor: "+a.slice(0,130));return s.replace(a,()=>b);}
function syntax(p,s){assert.equal(ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length,0,p+" syntax");write(p,s);}
const worker="lib/ai-sales.ts";
let w=read(worker);
w=replace(w,'async function handleInbound(job:AiJob,chat:AiChat){', [
'async function handoffToSale(job:AiJob,summary:string,reason:string,orderCode:string|null=null){',
'  const result=await aiRpc("handoff",{p_job_id:job.id,p_lease_token:job.lease_token,p_summary:summary.slice(0,1200),p_reason:reason.slice(0,1000),p_order_code:orderCode});',
'  if(result.outcome!=="updated"||result.mode!=="manual")throw new JobStopped("Handoff no longer current");',
'}',
'async function handleInbound(job:AiJob,chat:AiChat){'
].join("\n"));
w=replace(w,'import "server-only";','import "server-only";\nimport {asksForStaff,unableToAnswer,seatCodes,simpleSeatQuestion,exactSeatDetails,verifiedMarkedSeatDetails,formatExactSeats,HANDOFF_REPLY} from "./ai-sales-24";');
w=replace(w,'  const recognition=await recognizeInquiry(',[
'  if(asksForStaff(latest.body)){',
'    try{await sendAiSalesMessage(job,chat,{purpose:"reply",body:HANDOFF_REPLY});}',
'    finally{await handoffToSale(job,"Khách yêu cầu gặp Sale/CSKH/ban quản lý; nhân viên tiếp nhận hội thoại.","Khách chủ động yêu cầu gặp nhân viên.");}',
'    return;',
'  }',
'  const recognition=await recognizeInquiry('
].join("\n"));
w=replace(w,'  const context:AiCheckoutContext=', '  const context:AiCheckoutContext=');
w=replace(w,'  if(recognition.reply){',[
'  const isNewImage=messages.some(m=>m.id===latest.id&&m.body.startsWith("[Khách gửi ảnh;"))||recognition.reading!==undefined;',
'  const reading24=recognition.reading;',
'  const exactCodes=reading24?.kind==="seat_map"?[]:seatCodes(latest.body);',
'  if(isNewImage&&(!reading24||reading24.kind==="unreadable"||reading24.kind==="error"||reading24.kind==="other")){',
'    await handoffToSale(job,"AI chưa đọc được nội dung khách gửi; Sale kiểm tra ảnh gốc.","Nội dung ảnh chưa xác định được.");return;',
'  }',
'  if((reading24?.kind==="seat_map"&&isNewImage)||simpleSeatQuestion(latest.body)){',
'    const catalog=await listAiSalesShows().catch(()=>[]);',
'    const mem=salesPreferences(messages,catalog,commentContext?.showId);',
'    const choice=recognition.showId===null||mem.showSelectionUnresolved?undefined:catalog.find(s=>s.id===(recognition.showId||mem.showId||currentOrder?.showId||latestQuote?.showId));',
'    if(isNewImage&&reading24?.kind==="seat_map"&&reading24.mapMarks){',
'      const marks=reading24.mapMarks;',
'      const candidates=catalog.filter(s=>s.venueId===marks.venue);',
'      let verified:Awaited<ReturnType<typeof verifiedMarkedSeatDetails>>=null;',
'      if(choice&&choice.venueId===marks.venue)verified=await verifiedMarkedSeatDetails(choice.id,marks).catch(()=>null);',
'      if(!verified&&candidates.length<=12){',
'        const matches=(await Promise.all(candidates.filter(s=>s.id!==choice?.id).map(s=>verifiedMarkedSeatDetails(s.id,marks).catch(()=>null)))).filter(v=>v!==null);',
'        if(matches.length===1)verified=matches[0];',
'      }',
'      if(verified&&verified.rows.every(s=>s.status!=="not_found")){await sendInbound({purpose:"reply",body:"Em đã đối chiếu dấu bút xanh với sơ đồ chính thức.\\n"+formatExactSeats(verified)});return;}',
'    }',
'    if(exactCodes.length&&choice){',
'      let details:Awaited<ReturnType<typeof exactSeatDetails>>|null=null;',
'      try{details=await exactSeatDetails(choice.id,exactCodes);}catch{}',
'      if(details&&details.rows.every(s=>s.status!=="not_found")){await sendInbound({purpose:"reply",body:formatExactSeats(details)});return;}',
'      await handoffToSale(job,"Sale kiểm tra mã ghế trên ảnh hoặc tin nhắn.","Mã ghế chưa đối chiếu được với sơ đồ bán vé.");return;',
'    }',
'    if(isNewImage){try{await sendAiSalesMessage(job,chat,{purpose:"reply",body:"Mình gửi ảnh giữ đủ 4 mốc hồng, chấm bút xanh dương vào chính giữa ô ghế hoặc nhắn mã ghế giúp em nhé. Em chưa giữ ghế nào."});}finally{await handoffToSale(job,"Sale kiểm tra vị trí khách đánh dấu trên sơ đồ.","Chưa đối chiếu được mã sơ đồ hoặc dấu đánh ghế.");}return;}',
'  }',
'  if(recognition.reply){'
].join("\n"));
w=replace(w,'    const withNote=serviceNote && action.purpose==="reply" && !media ?',[
'    if(action.purpose==="reply"&&!media&&unableToAnswer(action.body))return handoffToSale(job,"Sale tiếp quản câu hỏi chưa trả lời được.","AI không đủ dữ liệu hoặc không thể xử lý yêu cầu.").then(()=>{throw new JobStopped("Handoff to Sale");});',
'    const withNote=serviceNote && action.purpose==="reply" && !media ?'
].join("\n"));
w=replace(w,'const instructions='+String.fromCharCode(96),'const instructions='+String.fromCharCode(96)+'AI SALE 2.4: Khi câu hỏi không hiểu, ngoài phạm vi hoặc thiếu căn cứ để trả lời chính xác, gọi request_support ngay và dừng. Không tự nói lời xin lỗi, không hỏi lại vòng vo, không nhắc tiếp. Nếu khách chỉ thiếu một thông tin đặt vé rõ ràng (show, số vé, mã ghế hoặc thông tin nhận vé), được hỏi đúng thông tin thiếu một lần. Khi khách yêu cầu nhân viên/CSKH/ban quản lý thì dùng request_support. Với mã ghế cụ thể phải tra exact_seats; không suy đoán từ hạng vé hoặc ảnh. Giá, tồn ghế và thanh toán phải theo máy chủ. Không lặp lại nội dung vừa gửi hoặc tự chốt khi khách chỉ hỏi.\n');
w=replace(w,'      request_support:tool({description:',[
'      exact_seats:tool({description:"Kiểm tra đúng mã ghế khách nói trên sơ đồ thật, trả hạng vé, giá và trạng thái theo show. Không giữ ghế.",inputSchema:z.object({showId:z.string().max(100),seats:z.array(z.string().regex(/^[A-O][0-9]{2}$/)).min(1).max(20)}),execute:({showId,seats})=>safeTool(()=>exactSeatDetails(showId,seats))}),',
'      request_support:tool({description:'
].join("\n"));
w=replace(w,'  if(!action){\n    const text=result.text.trim();if(!safeAiConversationText(text))throw Error("Model response needs factual review");',[
'  if(needsSupport){await handoffToSale(job,"Sale tiếp quản yêu cầu ngoài khả năng AI.","AI yêu cầu nhân viên xử lý.",currentOrder?.code||null);return;}',
'  if(!action){',
'    const text=result.text.trim();if(!safeAiConversationText(text)||unableToAnswer(text)){await handoffToSale(job,"Sale tiếp quản câu hỏi chưa trả lời được.","AI chưa thể trả lời chính xác.",currentOrder?.code||null);return;}'
].join("\n"));
w=replace(w,'const imageUrl=SEAT_MAP_URL(selected.venue);','const imageUrl=SEAT_MAP_URL(selected.venue,selected.show?.id);');
assert.equal((w.match(/handoffToSale\(job,/g)||[]).length,7,"All seven 2.4 handoff paths must use the guarded atomic RPC");
assert.ok(w.includes('result.mode!=="manual"'),"Handoff requires confirmed manual mode");
assert.ok(w.includes('aiRpc("handoff",{p_job_id:job.id,p_lease_token:job.lease_token'),"Handoff must be scoped to the active job");
syntax(worker,w);
const img="lib/ai-sales-inbound-image.ts";let i=read(img);
i=replace(i,' multipleShows:z.boolean(),',' multipleShows:z.boolean(),\n selectedSeats:z.array(z.string().regex(/^[A-O][0-9]{2}$/)).max(20).optional(),\n seatSelectionCertain:z.boolean().optional(),');
i=replace(i,'When no show text is legible return null. On receipts return null showText and false multipleShows.','When no show text is legible return null. On receipts return null showText and false multipleShows. For a seat map, selectedSeats contains ONLY complete seat codes that are explicitly circled, highlighted as selected, ticked or pointed at by the customer. Never copy all printed or available seats. Require clear row letter and number, pad number to two digits. If the mark, row or number is ambiguous, return empty selectedSeats and seatSelectionCertain false. For other images omit these fields. Never infer seat availability, prices or payment from an image.');
i=replace(i,'import "server-only";','import "server-only";\nimport {readSeatMapMarks,type MapMarks} from "./seat-map-image";');
i=replace(i,'type ImageReading=z.infer<typeof schema>;','type ImageReading=z.infer<typeof schema>&{mapMarks?:MapMarks};');
i=replace(i,'  const sanitized=await sharp(bytes,',[
'  try{',
'   const {data,info}=await sharp(bytes,{limitInputPixels:18000000,animated:false}).rotate().resize({width:2000,height:2000,fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});',
'   const mapMarks=readSeatMapMarks(data,info.width,info.height);',
'   if(mapMarks)return {kind:"seat_map",amount:null,reference:null,showText:null,multipleShows:false,mapMarks};',
'  }catch{/* Fall back to existing image classification, never inferred seat codes. */}',
'  const sanitized=await sharp(bytes,'
].join("\n"));
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

const uploadHelper="\ntype SeatMapUploadConfig={pageId:string;pageToken:string;apiVersion:string};\nfunction seatMapUploadTarget(imageUrl:string){\n const match=/^https:\\/\\/iextra\\.net\\/api\\/public\\/seat-map\\/(ccc|laocai)(?:\\?show=([a-z0-9-]{3,100}))?$/.exec(imageUrl);\n return match?{venue:match[1] as \"ccc\"|\"laocai\",showId:match[2]}:null;\n}\nfunction seatMapUploadForm(psid:string,png:Uint8Array){\n if(!/^[0-9]{5,80}$/.test(psid)||png.byteLength<24||png.byteLength>8*1024*1024||![137,80,78,71,13,10,26,10].every((v,i)=>png[i]===v))throw new MessengerSendError(false);\n const form=new FormData();\n form.set(\"recipient\",JSON.stringify({id:psid}));\n form.set(\"messaging_type\",\"RESPONSE\");\n form.set(\"message\",JSON.stringify({attachment:{type:\"image\",payload:{is_reusable:false}}}));\n form.set(\"filedata\",new Blob([new Uint8Array(png)],{type:\"image/png\"}),\"extra-seat-map.png\");\n return form;\n}\nasync function renderSeatMapForMessenger(imageUrl:string):Promise<Uint8Array>{\n const target=seatMapUploadTarget(imageUrl);if(!target)throw new MessengerSendError(false);\n const {venue,showId}=target;\n const [{renderSeatMapSvg},{getAiSeatSnapshot},{staffDb},{default:sharp}]=await Promise.all([import(\"./seat-map-image\"),import(\"./ai-sales-checkout\"),import(\"./staff-auth\"),import(\"sharp\")]);\n let svg:string;\n if(showId){\n  const snapshot=await getAiSeatSnapshot(showId);\n  const {tierName}=await import(\"./poster-offers\");\n  if(snapshot.show.venueId!==venue)throw new MessengerSendError(false);\n  const taken=new Set([...snapshot.taken,...snapshot.seats.filter(s=>snapshot.show.prices[s.zone as \"A\"|\"B\"|\"C\"|\"D\"]===null).map(s=>s.id)]);\n  svg=renderSeatMapSvg(venue,{}, {seats:snapshot.seats,taken,title:snapshot.show.artist+\" · \"+snapshot.show.date,showId:snapshot.show.id,tierLabels:Object.fromEntries([\"A\",\"B\",\"C\",\"D\"].map(z=>[z,tierName(snapshot.show.id,z)])),checkedAt:new Date().toLocaleString(\"vi-VN\",{timeZone:\"Asia/Ho_Chi_Minh\"})});\n }else{\n  const rows=await staffDb(\"venue_seat_rows?venue_id=eq.\"+venue+\"&select=row_code,seat_count&limit=1000\",{signal:AbortSignal.timeout(5000)}) as {row_code:string;seat_count:number}[];\n  if(!Array.isArray(rows))throw new MessengerSendError(false);\n  const counts:Record<string,number>={};\n  for(const row of rows){if(!/^[A-O]$/.test(row.row_code)||!Number.isSafeInteger(row.seat_count)||row.seat_count<2||row.seat_count>80)throw new MessengerSendError(false);counts[row.row_code]=row.seat_count;}\n  svg=renderSeatMapSvg(venue,counts);\n }\n return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());\n}\nasync function sendSeatMapFile(config:SeatMapUploadConfig,psid:string,imageUrl:string,render=renderSeatMapForMessenger,send=fetch):Promise<{messageId:string}>{\n if(!seatMapUploadTarget(imageUrl)||!/^[0-9]{5,80}$/.test(psid))throw new MessengerSendError(false);\n let form:FormData;\n try{form=seatMapUploadForm(psid,await render(imageUrl));}\n catch{console.warn(\"[seat-map-upload] render rejected\");throw new MessengerSendError(false);}\n let response:Response;\n try{response=await send(\"https://graph.facebook.com/\"+config.apiVersion+\"/\"+config.pageId+\"/messages\",{\n  method:\"POST\",headers:{Authorization:\"Bearer \"+config.pageToken},body:form,cache:\"no-store\",redirect:\"error\",signal:AbortSignal.timeout(15000)\n });}catch{console.warn(\"[seat-map-upload] delivery uncertain\");throw new MessengerSendError(true);}\n const data=await response.json().catch(()=>({})) as {message_id?:string;error?:{code?:number;error_subcode?:number}};\n if(!response.ok||typeof data.message_id!==\"string\"||data.message_id.length<4){\n  const known=!response.ok&&response.status>=400&&response.status<500&&response.status!==408;\n  console.warn(\"[seat-map-upload] rejected\",response.status,typeof data.error?.code===\"number\"?data.error.code:\"unknown\",typeof data.error?.error_subcode===\"number\"?data.error.error_subcode:\"unknown\");\n  throw new MessengerSendError(!known,response.status,data.error?.code);\n }\n console.info(\"[seat-map-upload] delivered\");\n return {messageId:data.message_id};\n}\n";
const imageStart=f.indexOf("export async function sendMessengerPageImage(");
assert(imageStart>=0,"Image transport missing");
const prefix=f.slice(0,imageStart),imageSource=f.slice(imageStart);
const configAnchor=' if(!config||!/^[0-9]{5,80}$/.test(psid))throw new MessengerSendError(false);';
assert.equal(imageSource.split(configAnchor).length,2,"Image config guard must be unique");
f=prefix+imageSource.replace(configAnchor,()=>configAnchor+'\n if(seatMapUploadTarget(imageUrl))return sendSeatMapFile(config,psid,imageUrl);')+"\n"+uploadHelper;
syntax(fb,f);

const notif="lib/ai-sales-notifications.ts";let n=read(notif);
n=replace(n,'AI cần xử lý tiếp trường hợp này. Trạng thái thanh toán được giữ nguyên theo dữ liệu đối soát.','Nhân viên Sale/CSKH cần tiếp quản hội thoại. Mở liên kết nội bộ để xem đầy đủ nội dung. Trạng thái thanh toán không thay đổi.');
syntax(notif,n);
function load(p,mocks={}){const compiled=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};new Function("require","module","exports",compiled)(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),mod,mod.exports);return mod.exports;}
const v=load("lib/venues.ts"),maps=load("lib/seat-map-image.ts",{"./venues":v}),policy=load("lib/ai-sales-24.ts",{"server-only":{},"./messenger-sale-memory":{customerRequestsHuman:s=>s==="Gặp nhân viên"},"./ai-sales-checkout":{},"./poster-offers":{},"./seat-map-image":maps});
for(const msg of ["Cho anh gặp ban quản lý","Em muốn liên hệ với CSKH","Xin số hotline","Gặp nhân viên"])assert.equal(policy.asksForStaff(msg),true,msg);
assert.equal(policy.asksForStaff("Không cần gặp ban quản lý"),false);
assert.deepEqual(policy.seatCodes("Ghế C1, C02 và A15"),["C01","C02","A15"]);
assert.equal(policy.simpleSeatQuestion("C01 C02 còn trống không"),true);
assert.equal(policy.simpleSeatQuestion("Chốt C01 C02"),false);
assert.equal(policy.unableToAnswer("Em chưa đọc rõ nội dung ảnh"),true);
assert.equal(policy.unableToAnswer("Ghế C01 đang trống"),false);
for(const venue of ["ccc","laocai"]){const seats=v.seatsFor(venue),svg=maps.renderSeatMapSvg(venue,{}, {seats,taken:new Set([seats[0].id]),title:"<test>",checkedAt:"test"});for(const seat of seats)assert.ok(svg.includes('data-seat="'+seat.id+'"'),venue+" "+seat.id);assert.ok(svg.includes("#737984"));assert.ok(svg.includes("&lt;test&gt;"));}
console.log("[AI SALE 2.4] Handoff, exact seat codes, two real layout maps and safety checks passed.");


async function testSeatMapUpload(){
 const code=ts.transpileModule(uploadHelper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 class E extends Error{constructor(ambiguous,statusCode,providerCode){super("test");this.ambiguous=ambiguous;this.statusCode=statusCode;this.providerCode=providerCode;}}
 const api=new Function("MessengerSendError",code+"\nreturn {seatMapUploadTarget,seatMapUploadForm,sendSeatMapFile};")(E);
 const url="https://iextra.net/api/public/seat-map/ccc?show=dinh-dung-2811";
 const png=new Uint8Array(await require("sharp")(Buffer.from(maps.renderSeatMapSvg("ccc"))).png().toBuffer());
 assert.deepEqual(api.seatMapUploadTarget(url),{venue:"ccc",showId:"dinh-dung-2811"});
 for(const bad of ["https://evil.example/api/public/seat-map/ccc","https://iextra.net/api/public/seat-map/ccc?show=x&x=y","https://iextra.net/api/public/seat-map/moana"])assert.equal(api.seatMapUploadTarget(bad),null);
 const cfg={pageId:"123456",pageToken:"test-only",apiVersion:"v24.0"};
 let calls=0;
 const mockSend=async(endpoint,opts)=>{
  calls++;assert.equal(endpoint,"https://graph.facebook.com/v24.0/123456/messages");
  assert.equal(opts.method,"POST");assert.equal(opts.body.get("messaging_type"),"RESPONSE");
  assert.deepEqual(JSON.parse(opts.body.get("recipient")),{id:"1234567"});
  assert.deepEqual(JSON.parse(opts.body.get("message")),{attachment:{type:"image",payload:{is_reusable:false}}});
  const file=opts.body.get("filedata");assert.equal(file.type,"image/png");assert.equal(file.name,"extra-seat-map.png");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png);
  return new Response(JSON.stringify({message_id:"test-mid-1"}),{status:200});
 };
 assert.deepEqual(await api.sendSeatMapFile(cfg,"1234567",url,async()=>png,mockSend),{messageId:"test-mid-1"});
 assert.equal(calls,1);
 await assert.rejects(api.sendSeatMapFile(cfg,"1234567",url,async()=>new Uint8Array(1),mockSend),e=>e.ambiguous===false);
 assert.equal(calls,1);
 await assert.rejects(api.sendSeatMapFile(cfg,"1234567",url,async()=>png,async()=>new Response(JSON.stringify({error:{code:100,error_subcode:1}}),{status:400})),e=>e.ambiguous===false&&e.providerCode===100);
 await assert.rejects(api.sendSeatMapFile(cfg,"1234567",url,async()=>png,async()=>{throw Error("network");}),e=>e.ambiguous===true);
 await assert.rejects(api.sendSeatMapFile(cfg,"1234567",url,async()=>png,async()=>new Response("{}",{status:200})),e=>e.ambiguous===true);
 console.log("[AI SALE 2.4.3] Binary PNG multipart, strict scope, acknowledgement and no automatic ambiguous retry tests passed.");
}
testSeatMapUpload().catch(e=>{console.error(e);process.exitCode=1;});

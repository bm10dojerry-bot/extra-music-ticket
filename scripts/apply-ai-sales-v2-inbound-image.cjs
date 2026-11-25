"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),ts=require("typescript");
const p="lib/ai-sales-policy.ts",w="lib/ai-sales.ts";
const rep=(s,a,b)=>{assert.equal(s.split(a).length,2,"anchor: "+a.slice(0,90));return s.replace(a,b);};
let policy=fs.readFileSync(p,"utf8"),worker=fs.readFileSync(w,"utf8");
policy=rep(policy,'  if(typeof message.text==="string"&&message.text.trim())return message.text.trim().slice(0,1200);',[
'  const caption=typeof message.text==="string"?message.text.trim():"";',
'  if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE!=="0"&&(message.attachments||[]).some(item=>item.type==="image")){',
'    return ("[Khách gửi ảnh; chưa đọc nội dung ảnh.]"+(caption?" "+caption:"")).slice(0,1200);',
'  }',
'  if(caption)return caption.slice(0,1200);'
].join("\n"));
worker=rep(worker,'import {getCommentContextForChat} from "./ai-comment-context";',[
'import {getCommentContextForChat} from "./ai-comment-context";',
'import {readMessengerImage} from "./ai-sales-inbound-image";',
'import {decideImageReceipt} from "./ai-sales-receipt-decision";'
].join("\n"));
worker=rep(worker,'type Message={id:number;sender:string;body:string;staff_name:string|null;created_at:string};','type Message={id:number;sender:string;body:string;staff_name:string|null;created_at:string;external_message_id?:string|null};');
worker=rep(worker,'staffDb("extra_support_messages?chat_id=eq."+chat.id+"&select=id,sender,body,staff_name,created_at&order=id.desc&limit=24")','staffDb("extra_support_messages?chat_id=eq."+chat.id+"&select=id,sender,body,staff_name,created_at,external_message_id&order=id.desc&limit=24")');
const a='  if(customerDeclined(latest.body)&&currentOrder?.status!=="paid"){';
worker=rep(worker,a,[
'  if(process.env.EXTRA_AI_SALE_INBOUND_IMAGE!=="0"&&latest.body.startsWith("[Khách gửi ảnh; chưa đọc nội dung ảnh.]")){',
'    await guard(job);',
'    const reading=latest.external_message_id?await readMessengerImage(latest.external_message_id,chat.messenger_psid,chat.messenger_page_id):null;',
'    await guard(job);',
'    const code=reading?.kind==="transfer_receipt"?reading.reference?.trim().toUpperCase()||"":"";',
'    const order=currentOrder||(/^EX[0-9A-F]{16}$/.test(code)?await getAiOrderStatus(chat.id,code):null);',
'    const decision=decideImageReceipt(reading,order);',
'    const body=decision==="paid"?"Dạ, hệ thống Extra đã xác nhận thanh toán của đơn vé này. Em cảm ơn mình, hẹn gặp mình tại đêm nhạc ạ. Vé được xử lý theo quy trình giao vé của Extra."',
'      :decision==="pending"?"Dạ, em đã đọc thông tin trên ảnh chuyển khoản. Hiện hệ thống chưa xác nhận tiền về; em chưa thể xác nhận thanh toán. Mình giúp em kiểm tra thêm nhé."',
'      :decision==="mismatch"?"Dạ, thông tin trên ảnh chưa khớp đầy đủ với đơn vé của mình. Em chưa thể xác nhận thanh toán. Em chuyển thông tin để nhân viên kiểm tra thêm cho mình nhé."',
'      :decision==="review"?"Dạ, đơn vé này cần người phụ trách kiểm tra thêm. Em chưa thể xác nhận thanh toán."',
'      :decision==="check_order"?"Dạ, em đã nhận ảnh chuyển khoản nhưng chưa đối chiếu được với đơn vé của mình. Mình cho em mã đơn để kiểm tra nhé."',
'      :decision==="unreadable"?"Dạ, em đã nhận ảnh nhưng chưa đọc được rõ nội dung. Mình gửi lại ảnh rõ hơn hoặc cho em mã đơn để kiểm tra nhé."',
'      :reading?.kind==="poster"?"Dạ, em thấy mình gửi ảnh poster. Mình muốn em kiểm tra giá vé, lịch diễn hay vị trí ghế ạ?"',
'      :reading?.kind==="seat_map"?"Dạ, em thấy ảnh sơ đồ ghế. Mình muốn ngồi khu vực nào và cần bao nhiêu vé ạ?"',
'      :"Dạ, em đã nhận ảnh. Mình muốn em kiểm tra nội dung nào để hỗ trợ chính xác hơn ạ?";',
'    await guard(job);',
'    await sendAiSalesMessage(job,chat,{purpose:"reply",body});',
'    if(decision==="mismatch"||decision==="review"){',
'      await setState(job,"needs_attention","Cần người phụ trách đối soát.","Ảnh hoặc trạng thái đơn chưa đủ điều kiện xác nhận.",order?.code||null);',
'      await aiRpc("set_mode",{p_chat_id:chat.id,p_mode:"manual"});',
'    }',
'    return;',
'  }',a
].join("\n"));
for(const [name,s] of [[p,policy],[w,worker]])assert.equal(ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length,0,name+" syntax");
fs.writeFileSync(p,policy);fs.writeFileSync(w,worker);
console.log("Inbound images connected with existing owned-order lookup and fail-closed fallback.");

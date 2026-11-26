'use strict';
const {randomUUID}=require('node:crypto');
const fields=['inquiryChats','engagedChats','quotedChats','checkoutChats','paidChats','repeatedContactChats','paidRepromptChats'];
const endpoint='http://ai-sale23-sandbox.railway.internal:8080/api/extra-os/director';
const day=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s);
const counts=n=>Number.isSafeInteger(n)&&n>=0;
const limits='Mỗi dòng đếm hội thoại Messenger riêng theo show và ngày khách nhắn (giờ Việt Nam). Chỉ gồm hội thoại gắn được một show. Báo giá, giữ chỗ và thanh toán phải nối được cùng hội thoại và báo giá trong ngày; đơn từ kênh khác hoặc hôm sau nằm ngoài nhóm này. Hỏi lại thông tin là dấu hiệu cần rà, chưa khẳng định lỗi. Chỉ phát hiện nhắc trả tiền qua tin AI có mã đơn.';
function parseSaleAudit(data,from,to){
  if(!data)return null;
  if(data.source!=='sale23_message_audit_v1'||data.fromDay!==from||data.toDay!==to||!Array.isArray(data.rows))throw Error('sale audit');
  const seen=new Set();
  const rows=data.rows.map(row=>{
    const key=row.day+'/'+row.showId;
    if(!/^[a-z\d_-]{1,100}$/i.test(row.showId)||!day(row.day)||row.day<from||row.day>to||seen.has(key)||!fields.every(k=>counts(row[k])))throw Error('sale audit row');
    seen.add(key);
    if(row.inquiryChats<row.engagedChats||row.engagedChats<row.quotedChats||row.quotedChats<row.checkoutChats||row.checkoutChats<row.paidChats||row.inquiryChats<row.repeatedContactChats||row.inquiryChats<row.paidRepromptChats)throw Error('sale audit order');
    return {showId:row.showId,day:row.day,...Object.fromEntries(fields.map(k=>[k,row[k]]))};
  });
  const coverage=(data.coverage??[]).map(r=>{
    if(!day(r.day)||r.day<from||r.day>to||!counts(r.allInboundChats)||!counts(r.identifiedChats)||r.identifiedChats>r.allInboundChats||
      rows.filter(row=>row.day===r.day).reduce((sum,row)=>sum+row.inquiryChats,0)!==r.identifiedChats)throw Error('sale audit coverage');
    return {day:r.day,allInboundChats:r.allInboundChats,identifiedChats:r.identifiedChats};
  });
  if(new Set(coverage.map(r=>r.day)).size!==coverage.length)throw Error('sale audit coverage');
  return {source:data.source,fromDay:from,toDay:to,rows,coverage,limits};
}
// Send only the aggregates for today's shows to the isolated Sale 2.3 service.
async function requestSaleReview(audit,env,request=fetch){
  if(!audit)return null;
  const token=env.EXTRA_OS_SALE_LINK_TOKEN;
  if(typeof token!=='string'||token.length<48||env.EXTRA_OS_SALE_LINK_URL!==endpoint)return {status:'unavailable'};
  const rows=audit.rows.filter(r=>r.day===audit.toDay),reviews=[];
  try{
    for(let offset=0;offset<rows.length;offset+=25){
      const batch=rows.slice(offset,offset+25),id=randomUUID();
      const r=await request(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
        headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id,kind:'music_conversation_audit',mode:'dry_run',input:{day:audit.toDay,rows:batch}})});
      if(!r.ok)throw Error('audit unavailable');
      const x=await r.json(),out=x.report?.reviews;
      if(x.id!==id||x.kind!=='music_conversation_audit'||x.mode!=='dry_run'||x.agent!=='Sale'||x.version!=='2.3'||x.status!=='succeeded'||
        x.report.source!=='music_conversation_audit'||x.report.day!==audit.toDay||!Array.isArray(out)||out.length!==batch.length)throw Error('audit invalid');
      for(const [i,item] of out.entries()){
        if(item.showId!==batch[i].showId||!Array.isArray(item.findings)||item.findings.length>7||!item.findings.every(f=>typeof f==='string'&&f.length<550))throw Error('audit invalid');
        reviews.push({showId:item.showId,findings:item.findings});
      }
    }
    return {agent:'Sale',version:'2.3',day:audit.toDay,status:rows.length?'completed':'no_identified_chats',reviews};
  }catch{return {status:'unavailable'};}
}
module.exports={parseSaleAudit,requestSaleReview};

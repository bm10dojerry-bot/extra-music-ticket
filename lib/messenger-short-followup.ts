import "server-only";
import {staffDb} from "./staff-auth";
import {sendMessengerPageMessage,MessengerSendError} from "./facebook-messenger";
import {explicitStop,isPing,norm,sensitiveQuestion} from "./ai-sales-timeout-policy";
import {friendlyAcknowledgement} from "./messenger-conversation-style";
import {customerRequestsHuman} from "./messenger-sale-memory";

type Turn={id:number;sender:string;body:string};
type Sent={id:string;body:string;purpose:string;sent_at:string;order_code:string|null;dedupe_key:string};
const pause=/\b(?:doi (?:chut|ti)|de (?:minh|anh|chi|em) (?:nghi|xem|hoi|ban)|bao lai|suy nghi|tham khao da|khong can|dung nhan|de sau|hen sau|tam biet|ve loi|loi ve|mat tien|chua nhan|khong hai long|khieu nai|gap nhan vien|ma don|thanh toan|chuyen khoan|doi soat|hoan tien|nhan ve|ho tro truc tiep)\b/;
export function nextAdvice(customer:string,answer:string,context:readonly Turn[]=[]):string|null{
  const asked=norm(customer),said=norm(answer);
  if(customer.includes("@")||/\b(?:email|mail|so dien thoai|sdt|ho ten)\b/.test(said)&&/\b(?:dinh dang|gui lai|chua du|chua ro|chua hop le|lap don|khong can gui lai)\b/.test(said))return null;
  if(!asked||isPing(customer)||explicitStop(customer)||sensitiveQuestion(customer)||customerRequestsHuman(customer)||
    friendlyAcknowledgement(customer)||pause.test(asked)||pause.test(said)||/\b(?:cam on|thank you|thanks)\b/.test(asked)||
    /^(?:(?:da|ok|vang|oke|okay|duoc|uh|um)(?: a| em| nhe)?\s*)+$/.test(asked)||/^(?:hi|hello|xin chao|chao em)$/.test(asked))return null;
  if(/\b(?:chua (?:ro|doc|xac dinh)|ma qr|ve dien tu|gui (?:lai )?anh ro)\b/.test(said))return null;
  const mine=context.filter(t=>t.sender==="customer").map(t=>norm(t.body)).join(" ");
  const self=mine||asked;
  const female=/\bchi (?:muon|can|di|hoi|dinh)|cho chi\b/.test(self);
  const male=/\banh (?:muon|can|di|hoi|dinh)|cho anh\b/.test(self);
  const address=female===male?"Mình":female?"Chị":"Anh";
  if(/\b(?:show khac|dem khac|lua chon khac|phan van|doi lich|khong hop lich)\b/.test(asked)){
    if(/[?？]/.test(answer))return null;
    return address+" muốn em giới thiệu thêm một đêm nhạc hợp lịch để dễ so sánh không ạ?";
  }
  if(/\b(?:gia|gia ve|bao nhieu tien|vip|standard|ngan sach)\b/.test(asked)&&/\b(?:vip|standard|hang a|dong|nghin)\b/.test(said)){
    if(/[?？]/.test(answer)&&/\b(?:ngan sach|goc nhin|gan san khau|may nguoi|may ve)\b/.test(said))return null;
    return address+" muốn em so sánh hai hạng vé theo vị trí ngồi để dễ chọn hơn không ạ?";
  }
  if(/\b(?:cho ngoi|ghe|goc nhin|so do)\b/.test(asked)){
    if(/[?？]/.test(answer))return null;
    return address+" muốn em gợi ý thêm một khu ghế khác để so sánh góc nhìn không ạ?";
  }
  if(/[?？]/.test(answer))return null;
  if(/\b(?:nuoc|do uong|map|chi duong|dia chi|bai hat|may bai|bao nhieu bai|gio dien|lich dien|dem nhac|dia diem)\b/.test(asked))
    return address+" còn muốn em tư vấn thêm phần nào về đêm nhạc không ạ?";
  if(/\b(?:tu van|goi y|chon ve|chon show|xem show|di xem|muon xem|mua ve|quan tam|chuong trinh)\b/.test(asked))
    return address+" muốn em gợi ý thêm một lựa chọn khác để dễ so sánh không ạ?";
  return null;
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function followUpAfterAnswer(jobId:string,chatId:string,sourceId:number){
  const [sent,history]=await Promise.all([
    staffDb("extra_messenger_ai_outbox?job_id=eq."+jobId+"&state=eq.sent&select=id,body,purpose,sent_at,order_code,dedupe_key&order=sent_at.desc&limit=1") as Promise<Sent[]>,
    staffDb("extra_support_messages?chat_id=eq."+chatId+"&id=lte."+sourceId+"&select=id,body,sender&order=id.desc&limit=8") as Promise<Turn[]>,
  ]);
  const primary=sent[0],source=history[0];
  if(!primary||primary.purpose!=="reply"||primary.order_code||primary.dedupe_key.endsWith(":short-tip")||source?.id!==sourceId||source.sender!=="customer")return;
  const tip=nextAdvice(source.body,primary.body,history);
  const due=Date.parse(primary.sent_at)+5000;
  if(!tip||!Number.isFinite(due)||Date.now()>due+10000)return;
  await sleep(Math.max(0,due-Date.now()+30));
  const claim=await staffDb("rpc/extra_messenger_ai_claim_short_followup",{method:"POST",body:JSON.stringify({p_job_id:jobId,p_parent_id:primary.id,p_body:tip})}) as {id:string;token:string;psid:string}|null;
  if(!claim?.token)return;
  let mid:string|null=null,result="uncertain";
  try{mid=(await sendMessengerPageMessage(claim.psid,tip)).messageId;result="sent";}
  catch(err){if(err instanceof MessengerSendError&&!err.ambiguous)result="failed";}
  await staffDb("rpc/extra_messenger_ai_finish_send",{method:"POST",body:JSON.stringify({p_outbox_id:claim.id,p_send_token:claim.token,p_result:result,p_external_message_id:mid,p_error:mid?null:"Chưa gửi được tin tư vấn bổ sung."})});
}

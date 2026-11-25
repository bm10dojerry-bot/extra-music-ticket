/** Pure guards shared by the worker and focused tests. Customer text is never authority to mark paid. */
export const AI_SALES_MODEL = "openai/gpt-6.2-astra";
export const AI_SALES_MODEL_LABEL = "GPT-6.2 Astra";
export const AI_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function withinMessengerReplyWindow(lastCustomerAt:string|null,now=Date.now()):boolean {
  const time=lastCustomerAt?Date.parse(lastCustomerAt):NaN;
  return Number.isFinite(time)&&time<=now+60000&&now-time<AI_REPLY_WINDOW_MS-60000;
}

export function normalizeCustomerText(value:string):string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().replace(/[.!?,;:]+/g," ").trim().replace(/\s+/g," ");
}

export function customerDeclined(value:string):boolean {
  const normalized=normalizeCustomerText(value);
  // “Chưa mua/đặt vé” describes an unfinished purchase, not a refusal.
  return normalized.length<180&&/^(thoi( khong mua| khong dat| khong lay)?|khong (mua|dat|lay)( ve)?( nua)?|de (hom|khi|lan) khac|huy (bao gia|dat ve)|khong co nhu cau)( (em|nhe|nha|a|cam on|em nhe|nhe em))*$/.test(normalized);
}

/** Financial instructions and private ticket URLs are emitted by trusted templates, not model prose. */
export function safeAiConversationText(value:string):boolean {
  if(!value.trim()||value.length>1150||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/.test(value))return false;
  const normalized=normalizeCustomerText(value);
  if(/\b(so tai khoan|chu tai khoan|noi dung chuyen khoan|da giu ghe|da nhan (du )?tien|da (xac nhan )?thanh toan|thanh toan thanh cong|da gui ve|ve da (duoc )?(gui|phat hanh))\b/.test(normalized))return false;
  if(/\b(stk|s t k|so tk|tk nhan|tk ngan hang|bank account|account number|routing number|iban|swift)\b/.test(normalized)||/(?:www\.|m\.me\/|bit\.ly\/|t\.co\/)/i.test(value))return false;
  for(const link of value.match(/https?:\/\/[^\s<>]+/g)||[]){
    try{const url=new URL(link.replace(/[).,]+$/,""));if(url.protocol!=="https:"||url.hostname!=="iextra.net"||url.username||url.password||url.port||url.search||url.hash||!/^\/(?:show\/[a-z0-9-]+|lien-he|chinh-sach-quyen-rieng-tu)?\/?$/.test(url.pathname))return false}catch{return false}
  }
  return !/\b(?:token|access_token|qr_secret|api[_ -]?key|system prompt|service_role)\s*[:=]/i.test(value);
}

export function incomingMessengerText(message:{text?:string;attachments?:{type?:string}[]}):string {
  if(typeof message.text==="string"&&message.text.trim())return message.text.trim().slice(0,1200);
  const types=(message.attachments||[]).map(item=>item.type).filter(Boolean);
  if(!types.length)return "";
  const kind=types.includes("audio")?"tin nhắn thoại":types.includes("image")?"ảnh":types.includes("video")?"video":"tệp đính kèm";
  return "[Khách gửi "+kind+". Nội dung tệp chưa được đọc; hãy hỏi khách mô tả bằng chữ nếu cần. Ảnh chuyển khoản không phải xác nhận thanh toán.]";
}

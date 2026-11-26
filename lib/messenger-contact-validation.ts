/** Booking contact evidence. Only customer turns can supply field values.
 * Does not reserve seats, validate deliverability, or authorize payment. */
export type ContactField="name"|"phone"|"email";
type Turn={sender:string;body:string;staff_name?:string|null};
type Evidence={valid:boolean;value:string};
export type ContactEvidence={active:boolean;fields:Partial<Record<ContactField,Evidence>>;currentIsContact:boolean;affirmation:boolean};
const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/\s+/g," ").trim();
const fields:ContactField[]=["name","phone","email"];
const nameWords=/\b(?:ho (?:va )?ten|ten nguoi nhan|ten khach|ho ten|full name)\b/;
const phoneWords=/\b(?:so dien thoai|dien thoai|sdt|phone|so dt)\b/;
const emailWords=/\b(?:e-?mail|mail|gmail)\b/;
const seatWords=/\b[a-o]\d{2}\b/i;
const askWords=/\b(?:xin|gui|cho|nhap|sua|kiem tra|nhan)\b/;
const bookingWords=/\b(?:lap don|dat ve|giu ghe|giu cho|chot|thanh toan|nhan ve)\b/;
const isAffirmation=(s:string)=>/^(?:(?:da|vang) )?(?:dung|dung roi|chinh xac|ok|oke|okay|vang|da|duoc|duoc roi)(?: (?:e|em|a|nhe|nha|em a|e a))?[.!]*$/.test(s);
const cancelled=(s:string)=>/\b(?:khong mua|khong dat|khong lay|huy don|huy ve|thoi khong|doi show|doi ngay|show khac)\b/.test(s);
const phoneDigits=(value:string)=>value.replace(/\D/g,"");
export function validBookingContact(field:ContactField,value:string):boolean{
  const v=typeof value==="string"?value.trim():"";
  if(field==="email"){
    if(v.length>254||/\s/.test(v))return false;
    const parts=v.split("@");
    if(parts.length!==2)return false;
    const [local,domain]=parts;
    return local.length>0&&local.length<=64&&/^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*$/.test(local)&&domain.length<=253&&/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain);
  }
  if(field==="phone"){
    if(!/^\+?[0-9][0-9 ().-]*[0-9]$/.test(v)||v.length>20)return false;
    const d=phoneDigits(v);
    if(v.startsWith("+84")||(!v.startsWith("+")&&d.startsWith("84")))return /^84(?:[35789]\d{8}|2\d{9})$/.test(d);
    if(v.startsWith("+"))return /^[1-9]\d{7,14}$/.test(d);
    return /^0(?:[35789]\d{8}|2\d{9})$/.test(d);
  }
  return v.length>=2&&v.length<=120&&/^[\p{L}\p{M}]+(?:[ .’'-]+[\p{L}\p{M}]+)*$/u.test(v)&&!isAffirmation(norm(v));
}
function cleanLabel(value:string){return value.split(/[,;\n\r]|\s+(?=(?:e-?mail|mail|sđt|số điện thoại|họ tên|tên)\s*[:：])/iu)[0].trim();}
export function inspectBookingContacts(messages:readonly Turn[]):ContactEvidence{
  let active=false,expected:ContactField[]=[],currentIsContact=false,affirmation=false;
  const collected:Partial<Record<ContactField,Evidence>>={};
  const save=(field:ContactField,value:string,ambiguous=false)=>{const v=value.trim();collected[field]={value:v,valid:!ambiguous&&validBookingContact(field,v)};currentIsContact=true;};
  for(const turn of messages.slice(-32)){
    const raw=turn.body.trim(),s=norm(raw);
    if(turn.sender==="staff"||turn.sender==="ai"){
      if(askWords.test(s)){
        const mentioned=fields.filter(f=>f==="name"?nameWords.test(s):f==="phone"?phoneWords.test(s):emailWords.test(s));
        if(mentioned.length&&(active||bookingWords.test(s)||seatWords.test(s))){active=true;expected=mentioned;}
      }
      if(seatWords.test(s)&&bookingWords.test(s))active=true;
      continue;
    }
    if(turn.sender!=="customer")continue;
    currentIsContact=false;affirmation=isAffirmation(s);
    if(cancelled(s)){active=false;expected=[];for(const f of fields)delete collected[f];continue;}
    if(seatWords.test(s)&&/\b(?:chot|lay|chon|dat|mua|giu)\b/.test(s)&&!/[?？]/.test(raw))active=true;
    const emailLabel=raw.match(/(?:^|[\s,;])(?:e-?mail|mail|gmail)\s*[:：]\s*([^\n\r;]*)/iu);
    const phoneLabel=raw.match(/(?:^|[\s,;])(?:số điện thoại|sđt|sdt|điện thoại|phone|so dien thoai)\s*[:：]\s*([^\n\r;]*)/iu);
    const nameLabel=raw.match(/(?:^|[\s,;])(?:họ(?: và)? tên|họ tên|tên người nhận|tên|name)\s*[:：]\s*([^\n\r;]*)/iu);
    const emailMatches=raw.match(/[A-Za-z0-9._%+-]+[ \t]*@[ \t]*[A-Za-z0-9.-]+/g)||[];
    if(raw.includes("@")){
      const count=(raw.match(/@/g)||[]).length;
      // A malformed internal space must not be silently removed.
      const candidate=emailMatches[0]|| (emailLabel?cleanLabel(emailLabel[1]):raw);
      save("email",candidate,count!==1||emailMatches.length!==1);
    }else if(emailLabel)save("email",cleanLabel(emailLabel[1]));
    else if(active&&expected.length===1&&expected[0]==="email"&&!affirmation&&!/[?？]/.test(raw)&&(/(?:gmail|hotmail|outlook|yahoo|\.com|\.vn)/i.test(raw)||/^[A-Za-z0-9._%+-]+$/.test(raw)))save("email",raw);
    const withoutEmail=raw.replace(/[A-Za-z0-9._%+-]+[ \t]*@[ \t]*[A-Za-z0-9.-]+/g," ");
    const phoneCandidates=(withoutEmail.match(/\+?\d[\d ().-]{3,24}\d/g)||[]).filter(x=>phoneDigits(x).length>=5&&(x.trim().startsWith("0")||x.trim().startsWith("+")||x.trim().startsWith("84")||expected.includes("phone")));
    if(phoneLabel)save("phone",cleanLabel(phoneLabel[1]));
    else if(phoneCandidates.length)save("phone",phoneCandidates[0],phoneCandidates.length!==1);
    else if(active&&expected.length===1&&expected[0]==="phone"&&!affirmation&&/^[+\d][\d ().-]*$/.test(raw))save("phone",raw);
    if(nameLabel)save("name",cleanLabel(nameLabel[1]));
    else if(active&&expected.length===1&&expected[0]==="name"&&!affirmation&&!currentIsContact&&!/[?？]/.test(raw)&&raw.length<=120)save("name",raw);
  }
  return {active,fields:collected,currentIsContact,affirmation};
}
export function unresolvedContactFields(evidence:ContactEvidence):ContactField[]{
  return fields.filter(f=>evidence.fields[f]?.valid===false);
}
export function correctedBookingContact<T extends Record<ContactField,string>>(input:T,evidence:ContactEvidence):T{
  const corrected={...input};
  if(evidence.active)for(const f of fields){const item=evidence.fields[f];if(item?.valid)corrected[f]=item.value;}
  return corrected;
}
export function checkoutContactIssues(input:Record<ContactField,string>,evidence:ContactEvidence):ContactField[]{
  return fields.filter(f=>!validBookingContact(f,input[f])||(evidence.active&&evidence.fields[f]?.valid===false));
}
export function missingContactProof(evidence:ContactEvidence):ContactField[]{
  return (["phone","email"] as ContactField[]).filter(f=>!evidence.fields[f]?.valid);
}
export function contactCorrectionReply(issues:readonly ContactField[]):string{
  const reasons=issues.map(f=>f==="email"?"email nhận vé chưa đúng định dạng hoặc chưa đầy đủ (ví dụ ten@example.com, không có dấu cách)":f==="phone"?"số điện thoại chưa đúng định dạng hoặc chưa đủ số":"họ tên người nhận vé chưa rõ hoặc chưa hợp lệ");
  return "Dạ, "+reasons.join("; ")+". Mình gửi lại đúng "+issues.map(f=>f==="email"?"email":f==="phone"?"số điện thoại":"họ tên").join(" và ")+" giúp em nhé. Các thông tin đã đúng không cần gửi lại ạ.";
}

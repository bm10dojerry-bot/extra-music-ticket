import {normalizeCustomerText,safeAiConversationText} from "./ai-sales-policy";
import type {AiSalesShow} from "./ai-sales-checkout";

export const COMMENT_PAGE_ID="1223940670813189";
export const COMMENT_WINDOW_MS=7*24*60*60*1000;
export const COMMENT_CONFIDENCE=0.9;
export type CommentEvent={page_id:string;post_id:string;comment_id:string;author_id:string|null;author_name:string|null;body:string;post_text?:string;created_at:string|null;event_time:string;verb:"add"|"edited"|"remove";is_hidden:boolean};
export type CommentDecision={intent:"ticket_question"|"not_interested"|"opt_out"|"needs_human";confidence:number;show_id:string|null;question_type:"price"|"availability"|"booking"|"location"|"schedule"|"unspecified"};
const ID=/^[0-9]{5,80}$/;
const COMMENT=/^[0-9]{5,80}(?:_[0-9]{5,80}){0,2}$/;
const POST=new RegExp("^"+COMMENT_PAGE_ID+"_[0-9]{5,80}$");
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
function time(value:unknown):string|null{
 const stamp=typeof value==="number"?value<1e12?value*1000:value:typeof value==="string"?Date.parse(value):NaN;
 return Number.isFinite(stamp)&&Math.abs(stamp)<=8640000000000000?new Date(stamp).toISOString():null;
}
export function commentWithinWindow(createdAt:string,now=Date.now()):boolean{
 const stamp=Date.parse(createdAt);return Number.isFinite(stamp)&&stamp<=now+60_000&&stamp>now-COMMENT_WINDOW_MS+60_000;
}
/** Called only after the existing Page HMAC has been verified. These values are data, never instructions. */
export function extractCommentEvents(pageId:string,entry:unknown,now=Date.now()):CommentEvent[]{
 if(pageId!==COMMENT_PAGE_ID)return [];
 const page=record(entry);if(page.id!==pageId||!Array.isArray(page.changes))return [];
 const result:CommentEvent[]=[];
 for(const change of page.changes.slice(0,60)){
  const c=record(change),v=record(c.value),from=record(v.from);
  if(c.field!=="feed"||v.item!=="comment")continue;
  const postId=text(v.post_id,180),commentId=text(v.comment_id,250),authorId=text(from.id,80);
  if(!POST.test(postId)||!COMMENT.test(commentId)||authorId===pageId)continue;
  const verb=v.verb==="add"?"add":["edit","edited","hide","unhide"].includes(String(v.verb))?"edited":["remove","delete"].includes(String(v.verb))?"remove":null;
  if(!verb)continue;
  const created=time(v.created_time),eventTime=time(c.timestamp)||time(page.time)||created;
  if(!eventTime||Date.parse(eventTime)>now+60_000||created&&Date.parse(created)>now+60_000)continue;
  if(typeof v.message==="string"&&v.message.length>5000)continue;
  const body=text(v.message,5000);
  if(!body&&verb!=="remove"&&v.verb!=="hide")continue;
  result.push({page_id:pageId,post_id:postId,comment_id:commentId,author_id:ID.test(authorId)?authorId:null,author_name:text(from.name,120)||null,body,created_at:created,event_time:eventTime,verb,is_hidden:v.is_hidden===true||v.verb==="hide"});
 }
 return result;
}
export function commentOptOut(body:string):boolean{
 const n=normalizeCustomerText(body);
 return /\b(dung|ngung|cam|khong can|khong muon|khong cho phep) (nhan tin|inbox|ib|lien he|lam phien)\b/.test(n)||/\bkhong (nhan tin|inbox|ib|lien he|lam phien) (nua|cho (toi|minh|em|anh|chi))\b/.test(n)||/^khong (nhan tin|inbox|ib|lien he|lam phien)$/.test(n)||/\b(huy dang ky|stop messaging|do not message|don't message|unsubscribe)\b/.test(n)||/^(stop|huy nhan tin)$/.test(n);
}
export function commentNeedsHuman(body:string):boolean{
 return /\b(khieu nai|lua dao|hoan tien|tra tien|nhan vien that|nguoi that|bi lua|da chuyen khoan|da thanh toan)\b/.test(normalizeCustomerText(body));
}
export function commentTicketCandidate(body:string):boolean{
 return /\b(ve|tickets?|gia|bao nhieu|dat cho|cho ngoi|ghe|mua|dat|ib|inbox|tu van|lich dien|ngay nao|o dau|may gio|xin thong tin)\b/.test(normalizeCustomerText(body));
}
/** A model may choose only a catalog show supported by literal source evidence. */
export function groundedCommentShows(body:string,postText:string,shows:AiSalesShow[]):AiSalesShow[]{
 const original=body+"\n"+postText,source=normalizeCustomerText(original);
 const explicitIds=[...original.matchAll(/https:\/\/(?:www\.)?iextra\.net\/show\/([a-z0-9-]+)/gi)].map(match=>match[1]);
 if(explicitIds.length)return shows.filter(show=>explicitIds.includes(show.id));
 return shows.filter(show=>{
  if(source.includes(show.id))return true;
  const artist=normalizeCustomerText(show.artist);
  if(artist.length>=5&&source.includes(artist))return true;
  // Joint-act captions often mention just one member; never use a generic token such as "Dũng".
  return artist.split(/\s*(?:\+|&|\bva\b)\s*/).some(name=>name.length>=7&&name.includes(" ")&&source.includes(name));
 });
}
export function parseCommentDecision(raw:string,body:string,postText:string,shows:AiSalesShow[]):CommentDecision|null{
 if(raw.length>4000)return null;
 let data:Record<string,unknown>;
 try{data=record(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"")))}catch{return null;}
 const intent=String(data.intent),question=String(data.question_type||"unspecified"),confidence=data.confidence;
 if(!["ticket_question","not_interested","opt_out","needs_human"].includes(intent)||typeof confidence!=="number"||!Number.isFinite(confidence)||confidence<0||confidence>1)return null;
 if(!["price","availability","booking","location","schedule","unspecified"].includes(question))return null;
 const eligible=groundedCommentShows(body,postText,shows);
 const selected=typeof data.show_id==="string"?eligible.find(s=>s.id===data.show_id):null;
 const sameArtist=selected?eligible.filter(s=>s.artist===selected.artist):[];
 const source=body+"\n"+postText;
 const showId=selected&&(sameArtist.length<=1||source.includes(selected.id)||source.includes(selected.date)||source.includes(selected.date.split("-").reverse().join("/")))?selected.id:null;
 return {intent:intent as CommentDecision["intent"],confidence,show_id:showId,question_type:question as CommentDecision["question_type"]};
}
/** Financial facts and links come only from the current catalog, not generated prose. */
export function renderCommentPrivateReply(decision:CommentDecision,show:AiSalesShow|null):string{
 const greeting="Chào anh/chị, em hỗ trợ tư vấn và đặt vé của +1 Extra Music ạ.";
 if(!show)return greeting+" Em thấy mình hỏi thông tin vé dưới bài viết của Page. Anh/chị muốn xem show của nghệ sĩ nào và đi mấy người ạ?";
 const date=show.date.split("-").reverse().join("/"),venue=show.venueName;
 let answer="Show "+show.artist+" diễn lúc "+show.time+" ngày "+date+" tại "+venue+".";
 if(decision.question_type==="price"){
  const prices=Object.entries(show.prices).filter(([,v])=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0).map(([zone,v])=>zone+": "+new Intl.NumberFormat("vi-VN").format(v!)+"đ");
  answer+=" Giá niêm yết từng hạng: "+prices.join(" · ")+".";
 }else if(decision.question_type==="location")answer+=" Địa chỉ: "+show.venueAddress+".";
 const result=greeting+" Em thấy mình hỏi vé show "+show.artist+" dưới bài viết của Page.\n"+answer+"\nMình xem sơ đồ và tình trạng ghế hiện tại tại "+show.url+"\nAnh/chị đi mấy người để em hỗ trợ chọn chỗ phù hợp ạ?";
 if(result.length>1000||!safeAiConversationText(result))throw Error("Comment response needs review");
 return result;
}

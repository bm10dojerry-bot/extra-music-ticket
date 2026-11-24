/**
 * Pure AI reply decision helpers.
 * Use only after an atomic database ownership check immediately before sending.
 */
import {canAiSend,type Ownership} from "./messenger-ai-ownership";
export type ReplyContext = {
  ownership: Ownership;
  inboundMessageId:string;
  lastHandledMessageId:string|null;
  customerText:string;
  knownShow:string|null;
  humanReplyPending:boolean;
};
export type ReplyDecision = {action:"skip";reason:string}|{action:"respond";intent:"price"|"seat_view"|"interaction"|"promotion"|"booking"|"general"};
export function decideTextReply(ctx:ReplyContext):ReplyDecision {
  if(!canAiSend(ctx.ownership))return {action:"skip",reason:"human_owns_conversation"};
  if(ctx.humanReplyPending)return {action:"skip",reason:"human_reply_pending"};
  if(!ctx.inboundMessageId||ctx.inboundMessageId===ctx.lastHandledMessageId)return {action:"skip",reason:"duplicate_or_missing_mid"};
  const t=ctx.customerText.toLocaleLowerCase("vi-VN").trim();
  if(!t)return {action:"skip",reason:"empty_text"};
  if(/(giá|bao nhiêu|tiền|chi phí)/u.test(t))return {action:"respond",intent:"price"};
  if(/(ghế|chỗ ngồi|góc nhìn|bên trái|bên phải|chính diện)/u.test(t))return {action:"respond",intent:"seat_view"};
  if(/(giao lưu|gặp ca sĩ|gần ca sĩ)/u.test(t))return {action:"respond",intent:"interaction"};
  if(/(khuyến mãi|ưu đãi|giảm giá)/u.test(t))return {action:"respond",intent:"promotion"};
  if(/(đặt vé|mua vé|thanh toán|giữ chỗ)/u.test(t))return {action:"respond",intent:"booking"};
  return {action:"respond",intent:"general"};
}

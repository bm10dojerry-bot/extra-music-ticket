/**
 * Extra 2.0 text sales consultation policy.
 * This module contains deterministic copy and guardrails; it does not auto-send
 * messages or replace the existing human-operated Messenger inbox.
 */
export type SeatView = "left" | "right" | "center";
export type CustomerContext = {
  displayName?: string;
  salutation?: "anh" | "chị";
  localHour: number;
  greeted: boolean;
  aiDisclosed: boolean;
  showName?: string;
  showDate?: string;
};
const greetingForHour = (hour:number) =>
  hour>=5&&hour<11?"buổi sáng":hour>=11&&hour<14?"buổi trưa":hour>=14&&hour<18?"buổi chiều":"buổi tối";
export function openingMessage(ctx:CustomerContext):string|null {
  if(ctx.greeted)return null;
  const salutation=ctx.salutation;
  const name=(ctx.displayName||"").trim().slice(0,60);
  const address=salutation?(name?`${salutation} ${name}`:salutation):"anh/chị";
  const intro=`Em chào ${address}, chúc mình một ${greetingForHour(ctx.localHour)} vui vẻ ạ!`;
  const disclosure=ctx.aiDisclosed?"":" Trong cuộc trò chuyện này, bên em có sử dụng công nghệ AI để hỗ trợ tư vấn và chọn vé; mình cũng có thể yêu cầu gặp nhân viên ạ.";
  const show=ctx.showName?.trim();
  const next=show?` Em thấy mình đang quan tâm đến đêm nhạc ${show}${ctx.showDate?` ngày ${ctx.showDate}`:""}. Mình muốn em tư vấn chọn ghế có góc nhìn phù hợp không ạ?`:" Em có thể giúp mình tìm hiểu chương trình hoặc chọn vé như thế nào ạ?";
  return intro+disclosure+next;
}
export const seatViewQuestion="Dạ, mình thích góc nhìn bên trái, bên phải hay chính diện trung tâm sân khấu ạ? Em sẽ giúp mình tìm ghế phù hợp với mức giá mong muốn nhé!";
export const artistInteractionExplanation="Điểm đặc biệt của Extra là phần giao lưu dự kiến khoảng 20–30 phút, khi ca sĩ chia sẻ chuyện đời sống, sự nghiệp và những câu chuyện sau bài hát. Sân khấu có lối đi giữa các hàng ghế để ca sĩ có thể đến gần khán giả. Dù ngồi khu xa, mình vẫn có cơ hội giao lưu, nhưng không thể cam kết ca sĩ đến từng ghế ạ.";
export const voiceInvitation="Dạ, mình có muốn em tư vấn bằng giọng nói để dễ hình dung vị trí ghế và chương trình hơn không ạ? Nếu mình thích nhắn chữ thì em vẫn hỗ trợ bình thường nhé!";
export type Promotion = {title:string;active:boolean;showId:string;terms:string};
export function applicablePromotions(promotions:Promotion[],showId:string):Promotion[] {
  return promotions.filter(p=>p.active&&p.showId===showId&&p.title.trim().length>0&&p.terms.trim().length>0);
}
export function promotionMessage(promotions:Promotion[],showId:string):string {
  const valid=applicablePromotions(promotions,showId);
  if(!valid.length)return "Dạ, em sẽ kiểm tra giá vé hiện hành và giúp mình chọn vị trí phù hợp nhất ạ.";
  return "Dạ, chương trình hiện có ưu đãi: "+valid.map(p=>p.title+" ("+p.terms+")").join("; ")+". Em sẽ kiểm tra điều kiện áp dụng trước khi chốt vé ạ.";
}
export const textSalesFlow=["greet_and_disclose_ai_once","ask_seat_view_preference","explain_artist_interaction_when_relevant","offer_verified_promotion","confirm_budget_and_live_price","check_live_seat_availability","reserve_and_payment_via_existing_system"] as const;

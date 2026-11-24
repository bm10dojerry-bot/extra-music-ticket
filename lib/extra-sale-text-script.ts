export type SeatView = "left" | "right" | "center";

export type CustomerContext = {
  displayName?: string;
  salutation?: "anh" | "chị";
  localHour: number;
  greeted: boolean;
  aiDisclosed: boolean;
};

export function openingMessage(context: CustomerContext): string | null {
  const parts: string[] = [];
  if (!context.greeted) {
    const name = (context.displayName ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
    const safeName = name.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name) ? name : "";
    const address = [context.salutation, safeName].filter(Boolean).join(" ") || "mình";
    const hour = context.localHour;
    const time = hour >= 5 && hour < 11 ? "buổi sáng"
      : hour >= 11 && hour < 14 ? "buổi trưa"
      : hour >= 14 && hour < 18 ? "buổi chiều"
      : hour >= 18 && hour < 23 ? "buổi tối" : "";
    parts.push(`Em chào ${address} ạ!${time ? ` Chúc mình một ${time} vui vẻ!` : ""}`);
  }
  if (!context.aiDisclosed) {
    parts.push("Cuộc trò chuyện có sử dụng công nghệ AI để hỗ trợ tư vấn vé. Mình có thể yêu cầu gặp nhân viên bất cứ lúc nào ạ.");
  }
  return parts.join(" ") || null;
}

export const seatViewQuestion = "Mình thích góc nhìn bên trái, bên phải hay chính diện trung tâm sân khấu ạ?";
export const artistInteractionExplanation = "Chương trình dự kiến có khoảng 20–30 phút giao lưu để ca sĩ chia sẻ về cuộc sống, sự nghiệp và câu chuyện sau các bài hát. Nhờ lối đi giữa các hàng ghế, mình vẫn có cơ hội giao lưu khi ngồi ở khu xa. Việc ca sĩ di chuyển đến khu nào tùy diễn biến chương trình ạ.";
export const voiceInvitation = "Dạ, mình có muốn em tư vấn bằng giọng nói để dễ hình dung vị trí ghế và chương trình hơn không ạ? Nếu mình thích nhắn chữ thì em vẫn hỗ trợ bình thường nhé!";

export type Promotion = {
  title: string;
  active: boolean;
  showId: string;
  terms: string;
  startsAt: string;
  expiresAt: string;
  quantity?: number;
};

export function applicablePromotions(promotions: readonly Promotion[], showId: string, now = new Date()): Promotion[] {
  return promotions.filter(promotion =>
    promotion.active && promotion.showId === showId &&
    promotion.title.trim().length > 0 && promotion.terms.trim().length > 0 &&
    Date.parse(promotion.startsAt) <= now.getTime() &&
    Date.parse(promotion.expiresAt) > now.getTime()
  );
}

export function promotionMessage(promotions: readonly Promotion[], showId: string, now = new Date()): string {
  const valid = applicablePromotions(promotions, showId, now);
  if (!valid.length) return "Hiện em chưa xác minh được ưu đãi áp dụng cho suất này ạ.";
  return valid.map(promotion => `${promotion.title}. ${promotion.terms}`).join("\n");
}

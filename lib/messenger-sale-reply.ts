import {
  applicablePromotions, artistInteractionExplanation, openingMessage, promotionMessage,
  seatViewQuestion, type Promotion, type SeatView,
} from "./extra-sale-text-script";
import type { MessengerSaleMemory } from "./messenger-sale-memory";
import type { ManagedShow } from "./show-data";
import { formatShowDate } from "./shows";
import { vietnamDateISO } from "./show-order";
import { seatsFor, venues, type Seat, type VenueId } from "./venues";

export type MessengerSaleInventory = {
  showId: string;
  rowCounts: Record<string, number>;
  unavailable: ReadonlySet<string>;
};

type ReplyInput = {
  memory: MessengerSaleMemory;
  message: string;
  displayName?: string;
  salutation?: "anh" | "chị";
  now: Date;
  show?: ManagedShow | null;
  showDataAvailable: boolean;
  inventory?: MessengerSaleInventory | null;
  promotions?: readonly Promotion[];
  resumedAfterHuman?: boolean;
};

type Zone = keyof ManagedShow["prices"];
type PricedSeat = Seat & { zone: Zone; price: number; lateral: number; view: SeatView };
type Option = { seats: PricedSeat[]; total: number };
const zones = ["A", "B", "C", "D"] as const;
const moneyFormat = new Intl.NumberFormat("vi-VN");
const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", hourCycle: "h23" });
const views = { left: "bên trái", center: "chính diện", right: "bên phải" } as const;
const checkoutOrigin = "https://iextra.net";
const money = (price: number) => `${moneyFormat.format(price)}đ`;
const seatMapUrl = (showId: string) => `${checkoutOrigin}/show/${encodeURIComponent(showId)}#booking`;
const viewName = (view: SeatView) => views[view];

export function messengerShowOpen(show: ManagedShow, now: Date): boolean {
  return show.status === "announced" && show.date >= vietnamDateISO(now) && venues.some(venue => venue.id === show.venue);
}

function seatView(lateral: number): SeatView {
  return lateral < 38 ? "left" : lateral > 62 ? "right" : "center";
}

function availableSeats(show: ManagedShow, inventory: MessengerSaleInventory): PricedSeat[] {
  return seatsFor(show.venue, inventory.rowCounts).flatMap(seat => {
    if (inventory.unavailable.has(seat.id)) return [];
    const zone = seat.zone as Zone;
    const price = show.prices[zone];
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price <= 0) return [];
    // The CCC map is rotated clockwise, with the stage to the right of the viewer.
    const lateral = show.venue === "ccc" ? seat.y : seat.x;
    return [{ ...seat, zone, price, lateral, view: seatView(lateral) }];
  });
}

function fitsBudget(seats: PricedSeat[], memory: MessengerSaleMemory, quantityKnown: boolean): boolean {
  const budget = memory.budgetVnd;
  if (budget === undefined) return true;
  if (memory.budgetBasis === "per_ticket") return seats.every(seat => seat.price <= budget);
  return quantityKnown && seats.reduce((total, seat) => total + seat.price, 0) <= budget;
}

function optionsFor(
  seats: PricedSeat[], venue: VenueId, rowCounts: Record<string, number>, memory: MessengerSaleMemory,
): Option[] {
  const count = memory.quantity ?? 1;
  const eligible = seats.filter(seat =>
    (!memory.seatView || seat.view === memory.seatView) && (!memory.zone || seat.zone === memory.zone)
  );
  const rows = new Map<string, PricedSeat[]>();
  for (const seat of eligible) {
    const row = rows.get(seat.row) ?? [];
    row.push(seat);
    rows.set(seat.row, row);
  }

  const options: Option[] = [];
  for (const [row, rowSeats] of rows) {
    const sorted = rowSeats.sort((first, second) => first.number - second.number);
    const aisle = venue === "laocai" ? Math.ceil((rowCounts[row] ?? 40) / 2) : null;
    for (let index = 0; index + count <= sorted.length; index++) {
      const first = sorted[index];
      const last = sorted[index + count - 1];
      if (last.number - first.number !== count - 1 || first.view !== last.view ||
          (aisle !== null && first.number <= aisle && last.number > aisle)) continue;
      const group = sorted.slice(index, index + count);
      if (!fitsBudget(group, memory, memory.quantity !== undefined)) continue;
      options.push({ seats: group, total: group.reduce((total, seat) => total + seat.price, 0) });
    }
  }

  const target = memory.seatView === "left" ? 25 : memory.seatView === "right" ? 75 : 50;
  const distance = (option: Option) => Math.abs(option.seats.reduce((sum, seat) => sum + seat.lateral, 0) / count - target);
  const ordered = options.sort((first, second) => first.total - second.total || distance(first) - distance(second));
  // Show at most two distinct price tiers, avoiding overlapping options.
  const first = ordered[0];
  if (!first) return [];
  const second = ordered.find(option => option.seats[0].zone !== first.seats[0].zone);
  return second ? [first, second] : [first];
}

function priceLine(show: ManagedShow, memory: MessengerSaleMemory, allPrices: boolean): string {
  const selected = allPrices || !memory.zone ? zones : [memory.zone];
  const points = selected.flatMap(zone => {
    const price = show.prices[zone];
    return typeof price === "number" && Number.isSafeInteger(price) && price > 0
      ? [`hạng ${zone} ${money(price)}`]
      : [];
  });
  return points.length
    ? `Giá niêm yết đêm ${show.artist} hiện là ${points.join(", ")} mỗi vé ạ.`
    : "Em chưa có giá đã xác minh cho hạng vé mình hỏi ạ.";
}

function findSeatReply(show: ManagedShow, inventory: MessengerSaleInventory | null | undefined, memory: MessengerSaleMemory): {
  answer: string; question?: string;
} {
  if (!inventory || inventory.showId !== show.id) {
    return { answer: "Em chưa xác minh được ghế đang trống. Mình có thể xem sơ đồ cập nhật tại " + seatMapUrl(show.id) };
  }

  const seats = availableSeats(show, inventory);
  if (!seats.length) return { answer: "Theo dữ liệu hiện tại, em chưa thấy ghế đang mở bán cho suất này ạ." };

  const scoped = seats.filter(seat =>
    (!memory.seatView || seat.view === memory.seatView) && (!memory.zone || seat.zone === memory.zone)
  );
  const preference = memory.seatView ? ` góc ${viewName(memory.seatView)}` : "";
  if (!scoped.length) return {
    answer: `Em chưa thấy ghế trống${preference}${memory.zone ? ` trong hạng ${memory.zone}` : ""} theo lựa chọn của mình ạ.`,
    question: memory.seatView ? "Mình có muốn xem thêm góc khác không ạ?" : seatViewQuestion,
  };
  if (!memory.seatView && !memory.zone) return {
    answer: `Em thấy vẫn có ghế đang mở bán cho đêm ${show.artist} ạ.`,
    question: seatViewQuestion,
  };
  if (memory.budgetVnd !== undefined && memory.budgetBasis !== "per_ticket" && !memory.quantity) return {
    answer: `Em thấy còn ghế${preference} theo sơ đồ ạ.`,
    question: "Mình cần bao nhiêu vé để em tính theo ngân sách đã đưa ạ?",
  };

  const options = optionsFor(seats, show.venue, inventory.rowCounts, memory);
  if (!options.length) {
    if (memory.budgetVnd !== undefined && memory.budgetBasis !== "per_ticket" &&
        memory.budgetBasis !== "total" && (memory.quantity ?? 0) > 1) {
      return {
        answer: `Em thấy có ghế${preference} nhưng cần biết cách tính ngân sách để tìm đúng chỗ ạ.`,
        question: "Ngân sách này là tổng cho nhóm hay tính cho mỗi vé ạ?",
      };
    }
    const group = memory.quantity && memory.quantity > 1 ? `${memory.quantity} ghế liền nhau` : "ghế";
    return {
      answer: `Em chưa tìm được ${group} phù hợp với các lựa chọn hiện tại${memory.budgetVnd === undefined ? "" : " trong mức ngân sách mình đưa"}. Mình có thể xem thêm trên sơ đồ: ${seatMapUrl(show.id)}`,
    };
  }
  const details = options.map(option => {
    const first = option.seats[0];
    const seats = option.seats.map(seat => seat.id).join(", ");
    const total = option.seats.length > 1 ? `, tổng ${money(option.total)}` : "";
    return `hạng ${first.zone} (${seats}), góc ${viewName(first.view)}, ${money(first.price)}/vé${total}`;
  }).join("\n");
  return {
    answer: `Em tìm được ${memory.quantity ? "lựa chọn" : "ghế tham khảo"} đang trống theo sơ đồ:\n${details}.\nTình trạng có thể thay đổi đến khi tạo đơn tại ${seatMapUrl(show.id)}`,
    question: !memory.seatView ? seatViewQuestion
      : !memory.quantity ? "Mình đi bao nhiêu người để em kiểm tra ghế phù hợp ạ?"
      : memory.budgetVnd === undefined ? "Mình dự tính ngân sách khoảng bao nhiêu cho mỗi vé ạ?" : undefined,
  };
}

function paymentReply(memory: MessengerSaleMemory, show?: ManagedShow | null): string {
  if (memory.paymentStatus === "paid") {
    return `Hệ thống đã xác nhận thanh toán thành công. Cảm ơn mình đã đặt vé${show ? ` đêm ${show.artist}` : " của Extra"} ạ!`;
  }
  if (memory.paymentStatus === "pending" && memory.bookingStatus === "held") {
    return "Hệ thống ghi nhận đơn đang giữ chỗ và chờ thanh toán. Mình kiểm tra hạn giữ chỗ và quét mã QR của chính đơn trên trang đặt vé ạ.";
  }
  if (memory.paymentStatus === "expired" || memory.bookingStatus === "expired") {
    return "Hệ thống ghi nhận đơn đã hết hạn giữ chỗ. Nếu mình đã chuyển khoản, hãy kiểm tra trạng thái đơn và liên hệ Extra để đối soát trước khi tạo giao dịch khác ạ.";
  }
  if (memory.paymentStatus === "cancelled" || memory.bookingStatus === "cancelled") {
    return "Hệ thống ghi nhận đơn đã hủy. Nếu mình từng chuyển khoản cho đơn này, mình có thể liên hệ Extra để được hỗ trợ đối soát ạ.";
  }
  return "Em chưa xác minh được trạng thái thanh toán trong cuộc trò chuyện này. Mình kiểm tra trên trang đơn hàng đã mở khi đặt vé. Hệ thống xác nhận sau khi đối soát thành công ạ.";
}

function bookingReply(show: ManagedShow, memory: MessengerSaleMemory): string {
  if ((memory.quantity ?? 1) > 12) {
    return `Mình xem sơ đồ đêm ${show.artist} tại ${seatMapUrl(show.id)}. Trang đặt vé trực tiếp nhận tối đa 12 ghế mỗi đơn. Nếu cần giữ chỗ cả nhóm, mình có thể yêu cầu nhân viên Extra hỗ trợ ạ.`;
  }
  return `Mình chọn ghế và tạo đơn tại ${seatMapUrl(show.id)}. Hệ thống giữ ghế 15 phút từ lúc tạo đơn thành công. Mình thanh toán theo mã QR hiện trên đơn và theo dõi xác nhận của hệ thống ạ.`;
}

function textForReply(input: ReplyInput): string {
  const { memory, show, now, inventory } = input;
  const intents = new Set(memory.intents);
  const onlyGeneral = intents.size === 0 || (intents.size === 1 && intents.has("general"));
  const message = input.message.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
  if (onlyGeneral && /^(?:da\s+)?(?:cam on(?:\s+(?:em|ban|a))?|khong can(?:\s+nua)?|de\s+(?:minh|em|anh|chi)\s+xem)(?:\s|[.!])*$/.test(message.trim())) {
    return "Dạ vâng, khi cần thêm thông tin mình cứ nhắn Extra ạ.";
  }
  const open = Boolean(show && messengerShowOpen(show, now));
  const askHowToPay = intents.has("payment") && !memory.paymentStatus &&
    /\b(?:cach|huong dan|lam sao|the nao|nhu the nao)\b/.test(message) &&
    !/\bda\s+(?:thanh toan|chuyen khoan)|\b(?:thanh toan|chuyen khoan)\s+(?:roi|xong|chua)\b/.test(message);
  const answers: string[] = [];
  if (intents.has("payment") && !askHowToPay) answers.push(paymentReply(memory, show));
  const interactionAsked = intents.has("interaction");
  const showNeeded = askHowToPay || intents.has("show") || intents.has("price") ||
    intents.has("seat_view") || intents.has("promotion") || intents.has("booking");
  if (!show) {
    if (interactionAsked) answers.push(artistInteractionExplanation);
    if (showNeeded || onlyGeneral) answers.push(input.showDataAvailable
      ? "Mình muốn tìm hiểu đêm nhạc của ca sĩ nào hoặc ngày nào ạ?"
      : "Em chưa tải được thông tin chương trình hiện hành. Mình có thể xem lịch trên https://iextra.net ạ.");
    return answers.join("\n");
  }

  const venue = venues.find(venue => venue.id === show.venue);
  const time = /^[0-9]{2}:[0-9]{2}/.test(show.time) ? ` lúc ${show.time.slice(0, 5)}` : "";
  const showDetails = `Đêm ${show.artist} diễn ra ngày ${formatShowDate(show.date)}${time}${venue ? ` tại ${venue.name}` : ""} ạ.`;
  const showAsked = onlyGeneral || (intents.has("show") &&
    (intents.size === 1 || /\b(?:lich dien|ngay nao|may gio|o dau|dia diem)\b/.test(message)));
  if (!open && (showNeeded || onlyGeneral)) {
    if (showAsked) answers.push(showDetails);
    answers.push(show.status === "sold_out"
      ? "Hệ thống đang ghi nhận suất này đã hết vé ạ."
      : "Suất này hiện không mở bán vé trên website ạ.");
    return answers.join("\n");
  }

  if (intents.has("price")) {
    answers.push(priceLine(show, memory, /\b(?:bang gia|toan bang|tat ca|cac hang|cac khu|gia tung)\b/.test(message)));
  }

  const hasPreference = Boolean(memory.seatView || memory.zone);
  const adviseSeats = intents.has("seat_view") || (intents.has("price") && hasPreference);
  const seatReply = adviseSeats ? findSeatReply(show, inventory, memory) : undefined;
  if (seatReply) answers.push(seatReply.answer);
  if (showAsked) answers.push(showDetails);
  if (interactionAsked) answers.push(artistInteractionExplanation);

  const eligible = [...new Map(applicablePromotions(input.promotions ?? [], show.id, now)
    .filter(promotion => memory.quantity === undefined || promotion.quantity === undefined || promotion.quantity === memory.quantity)
    .map(promotion => [promotion.title, promotion])).values()];
  if (!intents.has("payment") && (intents.has("promotion") || (intents.has("price") && memory.quantity && eligible.length))) {
    answers.push(promotionMessage(eligible, show.id, now));
  }
  if (askHowToPay || (intents.has("booking") && !intents.has("payment"))) {
    answers.push(memory.paymentStatus || memory.bookingStatus
      ? paymentReply(memory, show)
      : bookingReply(show, memory));
  } else if (!intents.has("payment") && !intents.has("promotion")) {
    const question = seatReply?.question ?? (!hasPreference && intents.has("price") ? seatViewQuestion
      : onlyGeneral ? "Mình muốn tìm hiểu thêm thông tin nào về đêm nhạc ạ?" : undefined);
    if (question) answers.push(question);
  }

  return answers.join("\n") || "Em có thể giúp mình xem thông tin chương trình và chọn vé ạ.";
}

export function composeMessengerSaleReply(input: ReplyInput): { text: string; greeted: boolean; aiDisclosed: boolean } {
  const opening = openingMessage({
    localHour: Number(localHour.format(input.now)),
    displayName: input.displayName,
    salutation: input.salutation,
    greeted: input.memory.greeted || Boolean(input.resumedAfterHuman),
    aiDisclosed: input.memory.aiDisclosed,
  });
  const lines = [opening, ...textForReply(input).split("\n")].filter((line): line is string => Boolean(line));
  const text = lines.reduce((reply, line) => {
    const next = reply ? `${reply}\n${line}` : line;
    return next.length <= 1200 ? next : reply;
  }, "");
  return { text, greeted: true, aiDisclosed: true };
}

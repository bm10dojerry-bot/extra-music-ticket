/**
 * AI Sale Extra 2.1: deterministic, side-effect-free preview planner.
 * This module NEVER sends Messenger messages, reads customer data, or books seats.
 * Production integration must independently recheck consent, paid status and dedupe.
 */
export type TicketState = "not_purchased" | "pending" | "paid" | "cancelled";
export type Scenario = "after_purchase" | "three_min" | "day_before" | "show_day" | "after_show" | "weather" | "complaint" | "images" | "voice";
export type LastSpeaker = "ai" | "customer" | "staff";

export type Extra21Input = {
  scenario: Scenario;
  ticketState: TicketState;
  showName: string;
  showDate: string; // YYYY-MM-DD in Asia/Ho_Chi_Minh
  today: string; // YYYY-MM-DD in Asia/Ho_Chi_Minh
  minutesSilent: number;
  lastSpeaker: LastSpeaker;
  withinMessengerWindow: boolean;
  marketingOptIn: boolean;
  serviceNotificationOptIn: boolean;
  optedOut: boolean;
  humanHandling: boolean;
  reminderAlreadySent: boolean;
  paymentVerified: boolean;
  forecastVerified: boolean;
  mayBeCold: boolean;
  rainForecast: boolean;
  canopyConfirmed: boolean;
  artistPhotoConfirmed: boolean;
  verifiedHotline: string;
  seatMapUrls: string[];
  voiceConsent: boolean;
  audioChannelReady: boolean;
};

export type Extra21Decision = {
  eligible: boolean;
  title: string;
  reason: string;
  message: string;
  notes: string[];
  attachments: string[];
  action: "simulate_message" | "simulate_handoff" | "do_not_send";
};

export const initial21: Extra21Input = {
  scenario: "day_before",
  ticketState: "paid",
  showName: "Đình Dũng",
  showDate: "2026-11-28",
  today: "2026-11-27",
  minutesSilent: 3,
  lastSpeaker: "ai",
  withinMessengerWindow: true,
  marketingOptIn: false,
  serviceNotificationOptIn: false,
  optedOut: false,
  humanHandling: false,
  reminderAlreadySent: false,
  paymentVerified: true,
  forecastVerified: false,
  mayBeCold: true,
  rainForecast: false,
  canopyConfirmed: true,
  artistPhotoConfirmed: false,
  verifiedHotline: "",
  seatMapUrls: [],
  voiceConsent: false,
  audioChannelReady: false,
};

const trim = (s: string) => (s || "").trim();
const validPhone = (s: string) => /^\+?[0-9][0-9 .-]{7,17}$/.test(trim(s));
const verifiedImage = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && Boolean(u.hostname) && !u.username && !u.password && !u.hash &&
      u.hostname !== "localhost" && !u.hostname.endsWith(".invalid");
  } catch { return false; }
};
const dateDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"))
  ? Date.parse(v + "T00:00:00Z") / 86400000 : NaN;
export const daysToShow = (today: string, showDate: string) => {
  const a = dateDay(today), b = dateDay(showDate);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
};
const done = (title: string, message: string, notes: string[] = [], attachments: string[] = []): Extra21Decision => ({
  eligible: true, title, message, reason: "Đủ điều kiện mô phỏng; chưa gửi tin thật.",
  notes, attachments, action: "simulate_message",
});
const block = (title: string, reason: string, notes: string[] = []): Extra21Decision => ({
  eligible: false, title, reason, notes, message: "", attachments: [], action: "do_not_send",
});
const weatherText = (input: Extra21Input): string[] => {
  if (!input.forecastVerified) return ["Dự báo thời tiết chưa được xác minh; chỉ nhắc chung rằng buổi tối Sa Pa có thể lạnh, mình nên mang áo ấm."];
  const result: string[] = [];
  if (input.mayBeCold) result.push("Thời tiết hôm nay có thể lạnh, anh/chị nhớ mặc áo ấm một chút khi đi xem nhạc nhé!");
  if (input.rainForecast) {
    result.push(input.canopyConfirmed
      ? "Nếu trời mưa, khu vực biểu diễn có rạp và căng tăng che mưa để mình yên tâm thưởng thức đêm nhạc ạ."
      : "Dự báo có khả năng mưa; em sẽ xác nhận phương án che mưa tại địa điểm trước khi thông báo mình ạ.");
  }
  return result;
};
const photoText = (input: Extra21Input) => input.artistPhotoConfirmed
  ? "Sau đêm nhạc dự kiến có phần giao lưu, chụp ảnh với nghệ sĩ bắt đầu khoảng 15 phút sau khi kết thúc và kéo dài khoảng 30 phút, theo lịch ban tổ chức đã xác nhận."
  : "Lịch giao lưu và chụp ảnh cùng nghệ sĩ sẽ được bên em thông báo khi ban tổ chức xác nhận chính thức.";
const show = (x: Extra21Input) => trim(x.showName) || "chương trình";
const special = (x: Extra21Input) => x.optedOut
  ? "Khách đã từ chối nhận tin."
  : x.humanHandling ? "Nhân viên đang tiếp quản hội thoại."
    : x.reminderAlreadySent ? "Đã nhắc một lần cho sự kiện này; không nhắc trùng."
      : null;
const canService = (x: Extra21Input) => x.withinMessengerWindow || x.serviceNotificationOptIn;
const canMarketing = (x: Extra21Input) => x.withinMessengerWindow || x.marketingOptIn;

export function simulateExtra21(x: Extra21Input): Extra21Decision {
  const stopped = special(x);
  if (stopped) return block("Dừng gửi", stopped);
  const name = show(x);

  if (x.scenario === "three_min") {
    if (x.ticketState !== "not_purchased") return block("Không nhắc sau 3 phút", "Chỉ dùng cho khách chưa mua vé; khách đã mua hoặc chờ thanh toán cần kịch bản riêng.");
    if (!x.withinMessengerWindow) return block("Không nhắc sau 3 phút", "Không còn trong cửa sổ Messenger cho phép phản hồi.");
    if (x.lastSpeaker !== "ai") return block("Không nhắc sau 3 phút", "Tin nhắn cuối không phải từ AI, không bắt đầu đếm im lặng.");
    if (!Number.isFinite(x.minutesSilent) || x.minutesSilent < 3) return block("Chưa đến thời điểm nhắc", "Chỉ nhắc sau khi AI tư vấn xong và khách im lặng đủ 3 phút.");
    return done("Nhắc nhẹ sau 3 phút",
      "Dạ anh/chị ơi, không biết mình đã chọn được chỗ ngồi ưng ý cho đêm nhạc " + name + " chưa ạ? Ngoài những thông tin em vừa tư vấn, mình có cần em hỗ trợ gì thêm không ạ? ❤️",
      ["Chỉ một lần mỗi lượt tư vấn.", "Hủy lịch nếu khách trả lời, đặt vé, nhân viên tiếp quản hoặc từ chối."]);
  }

  if (x.scenario === "day_before") {
    if (daysToShow(x.today, x.showDate) !== 1) return block("Chưa đúng ngày D-1", "Chỉ nhắc trước ngày diễn đúng một ngày theo giờ Việt Nam.");
    if (x.ticketState === "cancelled") return block("Không gửi", "Đơn đã hủy; không gửi lời mời mua theo đơn cũ.");
    if (x.ticketState === "paid") {
      if (!x.paymentVerified) return block("Chưa đủ dữ liệu", "Chưa đối soát thanh toán, không nhận định khách đã mua.");
      if (!canService(x)) return block("Không gửi tự động", "Thiếu quyền thông báo dịch vụ hoặc cửa sổ phản hồi Messenger hợp lệ.");
      return done("Nhắc khách đã mua vé",
        "Dạ anh/chị ơi, chỉ còn một ngày nữa là đến đêm nhạc " + name + " rồi ạ! Anh/chị có cần bên em hỗ trợ gì về đường đi, giờ check-in hay chỗ ngồi không ạ? Nếu muốn rủ thêm người thân hoặc bạn bè, em cũng có thể hỗ trợ mình đặt thêm vé nhé! ❤️",
        ["Ưu tiên hỗ trợ, không tạo đơn hay giữ ghế khi khách chưa yêu cầu."]);
    }
    if (x.ticketState === "pending") {
      if (!canService(x)) return block("Không gửi tự động", "Thiếu quyền thông báo dịch vụ hoặc cửa sổ Messenger hợp lệ.");
      return done("Nhắc khách đang chờ thanh toán",
        "Dạ anh/chị ơi, ngày mai là đến đêm nhạc " + name + " rồi ạ. Em thấy đơn của mình đang chờ xác nhận thanh toán; anh/chị có cần em hỗ trợ kiểm tra hoặc hoàn tất đơn không ạ? Nếu mình đã chuyển khoản, bên em sẽ đối soát trước, không yêu cầu thanh toán lại.",
        ["Không gọi khách là chưa mua, không nhắc chuyển khoản lần hai."]);
    }
    if (!canMarketing(x)) return block("Không gửi lời mời đặt vé", "Tin mời mua vé cần nằm trong cửa sổ Messenger hoặc có quyền nhận tiếp thị phù hợp.");
    return done("Nhắc khách chưa mua vé",
      "Dạ anh/chị ơi, chỉ còn một ngày nữa là diễn ra đêm nhạc " + name + " rồi ạ! Không biết mình đã sắp xếp được thời gian chưa? Nếu anh/chị muốn tham dự, em có thể tư vấn vị trí ngồi và hỗ trợ đặt vé nhé! ❤️",
      ["Không khẳng định còn vé nếu chưa kiểm tra tồn ghế trực tiếp."]);
  }

  if (x.scenario === "after_purchase") {
    if (x.ticketState !== "paid" || !x.paymentVerified) return block("Chưa gửi lời cảm ơn sau mua", "Chỉ kích hoạt khi hệ thống xác nhận thanh toán thành công.");
    if (!canService(x)) return block("Không gửi tự động", "Thiếu quyền thông báo giao dịch hoặc cửa sổ Messenger hợp lệ.");
    return done("Chăm sóc sau thanh toán",
      "Dạ, em cảm ơn anh/chị đã chọn đêm nhạc " + name + " của +1 Extra Music Show ạ! ❤️ Vé của mình đã được hệ thống xác nhận thanh toán. Anh/chị nhớ giữ mã QR để check-in, và nên đến sớm một chút để tránh giờ cao điểm, thoải mái chụp ảnh kỷ niệm nhé. " + photoText(x),
      ["Không gửi QR giả; vé điện tử vẫn lấy từ hệ thống phát hành chính thức."]);
  }

  if (x.scenario === "show_day") {
    if (x.ticketState !== "paid" || !x.paymentVerified) return block("Không nhắc check-in", "Chỉ nhắc khách đã mua vé và được xác minh thanh toán.");
    if (daysToShow(x.today, x.showDate) !== 0) return block("Chưa đúng ngày diễn", "Đây là kịch bản trong chính ngày biểu diễn.");
    if (!canService(x)) return block("Không gửi tự động", "Thiếu quyền thông báo dịch vụ hoặc cửa sổ Messenger hợp lệ.");
    return done("Lưu ý ngày biểu diễn",
      "Dạ anh/chị ơi, hôm nay mình gặp nhau tại đêm nhạc " + name + " rồi ạ! Mình có thể đến sớm để check-in, tránh tập trung đông người và có thêm thời gian chụp ảnh nhé. " + weatherText(x).join(" "),
      ["Lời khuyên thời tiết mô phỏng, chỉ gửi dữ liệu dự báo đã xác minh."]);
  }

  if (x.scenario === "weather") {
    if (!x.forecastVerified) return block("Chờ dự báo thật", "Chưa có dự báo thời tiết được kiểm tra theo ngày và địa điểm show.", ["Không tự khẳng định 'hôm nay mưa' hoặc 'hôm nay lạnh'."]);
    return done("Tư vấn thời tiết", "Dạ anh/chị ơi! " + (weatherText(x).join(" ") || "Em đã kiểm tra thời tiết; nếu có thay đổi em sẽ cập nhật cho mình nhé."),
      ["Dữ liệu thời tiết và phương án rạp/căng tăng trong màn hình này chỉ là mô phỏng."]);
  }

  if (x.scenario === "after_show") {
    if (x.ticketState !== "paid" || !x.paymentVerified) return block("Không chăm sóc sau show", "Chỉ liên hệ khách tham dự đã mua vé hợp lệ.");
    if (daysToShow(x.today, x.showDate) >= 0) return block("Chưa kết thúc show", "Chỉ hỏi cảm nhận sau ngày biểu diễn.");
    if (!canService(x)) return block("Không gửi tự động", "Thiếu quyền nhắn tin hợp lệ sau sự kiện.");
    return done("Hỏi thăm sau đêm nhạc",
      "Dạ anh/chị ơi, không biết đêm nhạc " + name + " vừa rồi có để lại cho mình nhiều kỷ niệm đẹp không ạ? ❤️ Anh/chị có hài lòng với phần check-in và trải nghiệm tại Extra không? Nếu có điều gì cần góp ý, em luôn sẵn lòng lắng nghe ạ.",
      ["Ghi nhận phản ánh và chuyển nhân viên khi cần.", "Không ép khách mua vé show tiếp theo."]);
  }

  if (x.scenario === "complaint") {
    if (!x.withinMessengerWindow) return block("Chưa gửi trả lời", "Cần khách liên hệ lại trong Messenger hoặc một kênh hỗ trợ hợp lệ.");
    const phone = validPhone(x.verifiedHotline) ? " Anh/chị cũng có thể liên hệ hotline chính thức " + trim(x.verifiedHotline) + " để được hỗ trợ trực tiếp ạ." : "";
    return {
      ...done("Tiếp nhận phản ánh",
        "Dạ em rất tiếc vì anh/chị gặp bất tiện. Em xin ghi nhận nội dung phản ánh về vé, thanh toán hoặc chỗ ngồi để nhân viên Extra kiểm tra chính xác, tránh trả lời sai hoặc yêu cầu mình thanh toán lại." + phone + " Anh/chị có thể cho em biết mã đơn nếu tiện được không ạ?",
        ["Đề xuất chuyển nhân viên; chưa tạo yêu cầu hỗ trợ thật.", validPhone(x.verifiedHotline) ? "Hotline đã nhập trong mô phỏng: cần đối chiếu với số chính thức." : "Chưa có hotline xác minh nên không bịa số."]),
      action: "simulate_handoff",
    };
  }

  if (x.scenario === "images") {
    if (x.seatMapUrls.length !== 2 || !x.seatMapUrls.every(verifiedImage)) return block("Chưa gửi hai ảnh", "Cần đúng hai URL HTTPS của hai ảnh sơ đồ chính thức, có thể tải được và khớp đúng địa điểm.", ["Không sử dụng ảnh minh họa thay ảnh anh đã duyệt."]);
    return done("Hai ảnh sơ đồ ghế",
      "Dạ em gửi anh/chị hai ảnh sơ đồ bố cục của địa điểm để mình tham khảo nhé. Trạng thái ghế còn bán vẫn phải kiểm tra trực tiếp trên website đặt vé.",
      ["Mô phỏng hai tệp đính kèm; chưa gửi qua Facebook.", "Không lấy màu trên ảnh làm tồn ghế trực tiếp."], x.seatMapUrls);
  }

  if (x.scenario === "voice") {
    if (!x.voiceConsent) return block("Không gửi voice", "Khách chưa đồng ý rõ ràng nhận tin nhắn thoại.");
    if (!x.audioChannelReady) return block("Chưa gửi voice", "Kênh âm thanh thử nghiệm chưa được xác nhận hoạt động.");
    if (!x.withinMessengerWindow) return block("Không gửi voice", "Ngoài cửa sổ phản hồi Messenger được phép.");
    return done("Voice có đồng ý",
      "Dạ, em có thể tư vấn thêm bằng tin nhắn thoại theo yêu cầu của mình nhé! Các thông tin vé, ghế và thanh toán em vẫn gửi bằng chữ để anh/chị tiện kiểm tra ạ.",
      ["Chỉ mô phỏng nội dung voice; không phát hay gửi tệp âm thanh."]);
  }

  return block("Không rõ tình huống", "Chưa có kịch bản tương ứng.");
}

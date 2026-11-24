/** Standalone staged Messenger sales policy. Not live until wired to the recovered production worker.
 * Input shows, previousShowId, and referredShowId must come from trusted Extra sources.
 * Scope only conversational show data; do not replace payment, seat, quote, or receipt guards.
 * If a current customer message references an unrecognized artist, upstream must clarify rather than supply a stale prior show.
 */
function normalizeSalesText(input) {
  return String(input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function showAliases(show) {
  const artist = typeof show.artist === "string" ? show.artist : "";
  const supplied = Array.isArray(show.aliases) ? show.aliases : [];
  const names = [artist, ...artist.split(/\s*(?:[&,;/+]|\bvà\b)\s*/iu), ...supplied];
  return [...new Set(names.map(normalizeSalesText).filter(name => name.length >= 4 && name.split(" ").length >= 2))];
}

function containsPhrase(haystack, needle) {
  return Boolean(needle) && (` ${haystack} `).includes(` ${needle} `);
}

function resolveSalesShowScope({ message, shows, previousShowId = null, referredShowId = null } = {}) {
  const candidates = (Array.isArray(shows) ? shows : []).filter(s => s && typeof s.id === "string" && s.id.trim());
  const valid = new Set(candidates.map(s => s.id));
  const text = normalizeSalesText(message);
  const matches = [...new Set(candidates.filter(s => showAliases(s).some(a => containsPhrase(text, a))).map(s => s.id))];
  if (matches.length === 1) return { kind: "single", showIds: matches, reason: "explicit_artist" };
  if (matches.length > 1) {
    return /\b(so sanh|khac nhau|ca hai|hai show)\b/.test(text)
      ? { kind: "comparison", showIds: matches, reason: "explicit_comparison" }
      : { kind: "clarify", showIds: [], reason: "multiple_artists" };
  }
  if (/\b(show|dem nhac|chuong trinh|ca si) (khac|nao khac)\b/.test(text)) return { kind: "clarify", showIds: [], reason: "switch_requested" };
  if (/\b(danh sach (show|dem nhac|chuong trinh)|co (nhung|cac|bao nhieu) (show|dem nhac|chuong trinh)|sap toi co (show|dem nhac|chuong trinh) nao)\b/.test(text)) return { kind: "catalog", showIds: [...valid], reason: "explicit_catalog" };
  if (valid.has(previousShowId)) return { kind: "single", showIds: [previousShowId], reason: "prior_verified_context" };
  if (valid.has(referredShowId)) return { kind: "single", showIds: [referredShowId], reason: "verified_referral" };
  return { kind: "clarify", showIds: [], reason: "no_verified_show" };
}

function scopeVerifiedShows(shows, scope) {
  const ids = new Set(Array.isArray(scope?.showIds) ? scope.showIds : []);
  return (Array.isArray(shows) ? shows : []).filter(show => ids.has(show?.id));
}

/** Accept only trusted, structured conversation state; do not interpolate customer text into policy. */
function salesConversationGuidance(state = {}) {
  if (!state || typeof state !== "object") state = {};
  const rules = [
    " Đọc toàn bộ ngữ cảnh liên quan và ưu tiên yêu cầu mới nhất của khách; hiểu cách nói ngắn, tiếng Việt không dấu, lỗi chính tả và câu hỏi tiếp nối. Không chạy một chuỗi chốt đơn cố định.",
    " Không cần kết thúc mọi câu bằng câu hỏi. Trả lời trực tiếp và ngắn gọn; chỉ gợi ý bước tiếp theo khi thật sự hữu ích.",
    " Nếu khách sửa lựa chọn, bỏ thông tin cũ đã bị thay thế; không xem việc hỏi giá hoặc khen ghế là đồng ý đặt vé.",
    " Tư vấn chênh lệch giá, vị trí và lựa chọn phù hợp ngân sách dựa trên dữ liệu thật; không tự giảm giá, tạo ưu đãi hoặc hứa giữ ghế.",
    " Nếu khách hỏi nhiều ý, trả lời từng ý theo thông tin đã xác minh trước khi hỏi một điều còn thiếu. Nếu chưa lấy được dữ liệu, nói rõ và chuyển hỗ trợ khi cần.",
    " Không giả vờ là người thật nếu khách hỏi; giới thiệu đúng là trợ lý tư vấn của Extra."
  ];
  if (state.greeted === true) rules.push(" Đã chào khách: không chào lại.");
  if (state.partySizeKnown === true) rules.push(" Đã biết số lượng vé: không hỏi lại số lượng trừ khi khách muốn thay đổi.");
  if (state.budgetKnown === true) rules.push(" Đã biết ngân sách: không hỏi lại; tư vấn trong mức đó khi có lựa chọn phù hợp.");
  if (state.seatingKnown === true) rules.push(" Đã biết khu ghế: giữ lựa chọn đó cho đến khi khách đổi.");
  if (state.intent === "price") rules.push(" Khách hỏi giá: nếu show đã xác định, lấy giá hiện hành và nêu số tiền, đơn vị theo vé trước mọi lời mời chọn ghế. Nếu chưa xác định show, chỉ hỏi show.");
  if (state.intent === "objection") rules.push(" Khách còn băn khoăn: giải đáp đúng điều đang lo, đưa lựa chọn thật phù hợp, không thúc ép.");
  if (state.intent === "booking") rules.push(" Khách muốn đặt: kiểm tra ghế và báo tổng tiền, chỉ giữ ghế sau xác nhận rõ ràng qua quy trình tin cậy.");
  if (state.intent === "payment") rules.push(" Khách hỏi thanh toán: dùng trạng thái đơn đã đối soát và hướng dẫn chính thức; không tự xác nhận đã thanh toán.");
  rules.push(" Có thể dùng câu đùa nhẹ, dí dỏm hoặc một emoji phù hợp khi khách chủ động nói vui; không ép hài, không lặp câu đùa, không đùa về tiền bạc khó khăn, ngoại hình, khiếu nại, thanh toán lỗi hoặc hoàn vé.");
  rules.push(" Chủ động kiểm tra ưu đãi đang hiệu lực khi khách hỏi giá, hỏi giảm giá, đi theo nhóm hoặc cân nhắc ngân sách; chỉ giới thiệu ưu đãi đúng show, khu ghế, số lượng, thời hạn và điều kiện từ quy trình báo giá tin cậy. Nêu rõ điều kiện, vé trả tiền/vé tặng và tổng tiền đã xác minh; không tự áp dụng, cộng dồn, hứa giảm giá hay tạo khan hiếm.");
  if (state.tone === "playful" && ["greeting","casual","objection","price"].includes(state.intent)) rules.push(" Khách đang nói vui: có thể đáp lại tự nhiên bằng một câu dí dỏm ngắn, sau đó giải đáp đúng nhu cầu.");
  if (["complaint","payment","refund"].includes(state.intent) || state.tone === "upset") rules.push(" Giữ giọng nghiêm túc, đồng cảm và rõ ràng; không đùa hoặc chen quảng cáo, khuyến mại ngoài yêu cầu.");
  if (state.intent === "promotion") rules.push(" Khách hỏi ưu đãi: kiểm tra chính sách hiện hành cho đúng show và nhu cầu trước khi trả lời. Nếu chưa xác minh được điều kiện hoặc giá cuối, nói rõ chưa xác nhận; không khẳng định có hay không có khuyến mại.");
  rules.push(" Tạo cảm xúc tích cực bằng lời chào đón, lời cảm ơn và cách nói gần gũi phù hợp với khách; có thể nói Hẹn gặp anh/chị tại đêm diễn, Có anh/chị cùng tham gia thì đêm nhạc sẽ vui hơn nhiều. Không giả vờ là một cô gái hoặc nhân viên sẽ trực tiếp gặp khách, không hứa gặp riêng, không gây áp lực tình cảm.");
  if (state.paymentVerified === true && state.intent === "booking_complete") rules.push(" Sau khi hệ thống xác minh thanh toán thành công, giữ nguyên thông báo xác nhận vé và hướng dẫn chính thức; có thể thêm lời cảm ơn chân thành theo tên khách, chúc khách có đêm nhạc đáng nhớ và lời hẹn gặp tại đúng sân khấu từ đội ngũ Extra; dùng tối đa một đến hai emoji phù hợp như 😊, ❤️ hoặc 🎶 nếu hợp giọng điệu. Ví dụ: Em cảm ơn anh nhiều ạ! Hẹn gặp anh tại đêm diễn nhé 🎶 Không tiếp tục thúc mua vé, không tự phát sinh tin nhắn trùng.");
  return rules.join("");
}

function salesTurnInstruction(scope, conversation = {}) {
  const common = "Trả lời bằng tiếng Việt tự nhiên, lịch sự; trả lời câu hỏi thực tế trước, mỗi lượt tối đa một câu hỏi khi cần. Không lặp thông tin đã biết, không vội chốt vé. Giá, giờ, địa điểm, ghế, link và thanh toán phải lấy từ dữ liệu/công cụ Extra đã xác minh. Không đoán hoặc tạo khan hiếm. Giữ quy trình báo giá, xác nhận giữ ghế, đối soát thanh toán và chuyển người hỗ trợ hiện có." + salesConversationGuidance(conversation);
  if (scope?.kind === "single") return common + " Chỉ tư vấn một show được xác định trong ngữ cảnh tin nhắn hiện tại. Không quảng cáo, báo giá, liệt kê hoặc đề xuất show khác khi khách không hỏi. Nếu khách hỏi giá, trả giá chính xác của show này trước khi hỏi thêm. Khi khách muốn đặt ghế, hỗ trợ đúng show và chỉ giữ ghế sau xác nhận rõ ràng.";
  if (scope?.kind === "comparison") return common + " Khách yêu cầu so sánh rõ ràng: chỉ so sánh những show được yêu cầu và không thêm show ngoài phạm vi.";
  if (scope?.kind === "catalog") return common + " Chỉ giới thiệu danh sách show khi khách thực sự hỏi danh sách.";
  return common + " Chưa xác định được show: hỏi một câu ngắn để xác định show, không tự chọn show, không gửi bảng giá hàng loạt hoặc thực hiện giữ ghế.";
}

export { resolveSalesShowScope, scopeVerifiedShows, salesTurnInstruction };

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

function salesTurnInstruction(scope) {
  const common = "Trả lời bằng tiếng Việt tự nhiên, lịch sự; trả lời câu hỏi thực tế trước, mỗi lượt tối đa một câu hỏi khi cần. Không lặp thông tin đã biết, không vội chốt vé. Giá, giờ, địa điểm, ghế, link và thanh toán phải lấy từ dữ liệu/công cụ Extra đã xác minh. Không đoán hoặc tạo khan hiếm. Giữ quy trình báo giá, xác nhận giữ ghế, đối soát thanh toán và chuyển người hỗ trợ hiện có.";
  if (scope?.kind === "single") return common + " Chỉ tư vấn một show được xác định trong ngữ cảnh tin nhắn hiện tại. Không quảng cáo, báo giá, liệt kê hoặc đề xuất show khác khi khách không hỏi. Nếu khách hỏi giá, trả giá chính xác của show này trước khi hỏi thêm. Khi khách muốn đặt ghế, hỗ trợ đúng show và chỉ giữ ghế sau xác nhận rõ ràng.";
  if (scope?.kind === "comparison") return common + " Khách yêu cầu so sánh rõ ràng: chỉ so sánh những show được yêu cầu và không thêm show ngoài phạm vi.";
  if (scope?.kind === "catalog") return common + " Chỉ giới thiệu danh sách show khi khách thực sự hỏi danh sách.";
  return common + " Chưa xác định được show: hỏi một câu ngắn để xác định show, không tự chọn show, không gửi bảng giá hàng loạt hoặc thực hiện giữ ghế.";
}

export { resolveSalesShowScope, scopeVerifiedShows, salesTurnInstruction };

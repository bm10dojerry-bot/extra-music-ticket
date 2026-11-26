export type HandoffReason =
  | "human_requested"
  | "complaint"
  | "out_of_scope"
  | "repeated"
  | "unable_to_answer"
  | "send_failed"
  | "delivery_unconfirmed";

export const reasonLabels: Record<HandoffReason, string> = {
  human_requested: "Khách yêu cầu gặp nhân viên",
  complaint: "Khiếu nại cần xử lý",
  out_of_scope: "Yêu cầu ngoài phạm vi bán vé",
  repeated: "Hội thoại lặp, chưa tiến triển",
  unable_to_answer: "AI chưa xác minh được câu trả lời",
  send_failed: "Messenger từ chối gửi",
  delivery_unconfirmed: "Chưa xác nhận Messenger đã nhận tin",
};

const canonical = (text: string) => text.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi-VN");

export function isResolutionCommand(text: unknown): boolean {
  return typeof text === "string" && text.length <= 120 && canonical(text) === "đã xử lý xong";
}

const searchable = (text: string) => canonical(text).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
const complaint = /\b(khieu nai|khieu kien|lua dao|hoan tien|doi soat sai|khong hai long|da (?:chuyen|tra) tien.*(?:chua|khong) (?:nhan|co) ve|ve (?:bi )?(?:loi|sai|khong quet duoc))\b/;
const unrelated = /\b(thoi tiet ngay mai o|viet (?:code|bai luan|chuong trinh)|bo qua (?:quy tac|chi dan)|giai (?:bai toan|phuong trinh)|du bao gia (?:vang|co phieu)|cong thuc nau an|tu van (?:phap luat|dau tu|benh))\b/;
const smallTalk = /^(?:da|vang|ok|oke|uh|hello|hi|cam on|chao em)(?:\s+(?:a|nhe|em|anh|chi))?[.!?]*$/;

export function inboundHandoff(
  history: readonly { id: number; sender: string; body: string; staff_name?: string | null }[],
  asksForStaff: (body: string) => boolean,
): HandoffReason | null {
  const latest = history.at(-1);
  if (!latest || latest.sender !== "customer") return null;
  const body = searchable(latest.body);
  if (complaint.test(body)) return "complaint";
  if (asksForStaff(latest.body)) return "human_requested";
  if (unrelated.test(body)) return "out_of_scope";

  // Compare two consecutive substantive customer turns. A human intervention
  // or intervening order/payment response starts a fresh sequence.
  if (body.length < 7 || smallTalk.test(body) || /^\[khach gui /.test(body)) return null;
  for (let index = history.length - 2; index >= 0; index--) {
    const previous = history[index];
    if (previous.sender === "customer") {
      return searchable(previous.body) === body ? "repeated" : null;
    }
    if (previous.sender === "staff" && (previous.staff_name !== "EXTRA AI" ||
      /\bEX[A-F0-9]{16}\b/i.test(previous.body))) return null;
  }
  return null;
}

export function repeatsLastAnswer(
  body: string,
  history: readonly { sender: string; body: string; staff_name?: string | null }[],
): boolean {
  const previous = [...history].reverse().find(message => message.sender === "staff");
  return previous?.staff_name === "EXTRA AI" && canonical(previous.body) === canonical(body);
}

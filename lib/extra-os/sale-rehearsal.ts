import { z } from "zod";

const money = z.number().int().min(1).max(1_000_000_000);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const retailRehearsalSchema = z.strictObject({
  product: text(1,160),
  priceVnd: money,
  knowledgeVersion: z.number().int().min(1).max(2147483647),
  training: z.strictObject({
    playbook: text(80,5000),
    objections: text(30,2000),
    validation: text(30,2000),
  }),
});

const rehearsalReply = text(15,900).refine(
  (reply) => !/https?:\/\/|(?:\d[\d., ]*)(?:₫|\bVND\b|đồng|đ)(?=$|\s|[.,!?])/iu.test(reply)
);
export const rehearsalAnswerSchema = z.strictObject({
  reply: rehearsalReply,
  objectionReply: rehearsalReply,
  beforeConfirmation: z.enum(["ask_confirmation","create_order","handoff"]),
  afterConfirmation: z.enum(["preview_quote","create_order","handoff"]),
  stockConflict: z.enum(["notify_stock_limit","promise_stock","create_order"]),
});

export type RetailRehearsal = z.infer<typeof retailRehearsalSchema>;

export function buildRetailRehearsal(input: RetailRehearsal) {
  // This inventory is a fixture for the isolated test route.
  const stock = 2, quantity = 2;
  return {
    product: input.product,
    priceVnd: input.priceVnd,
    stock,
    scenarios: [
      {customer: "Cho mình hỏi giá, có sẵn không?"},
      {customer: "Mình thấy giá này cao. Có cách nào tiết kiệm hơn không?"},
      {customer: "Mình muốn mua hai đơn vị, cho mình xem bao nhiêu tiền."},
      {customer: "Mình xác nhận lấy hai đơn vị."},
      {customer: "Mình muốn đặt ba đơn vị."},
    ],
    quote: {quantity,priceVnd:input.priceVnd,totalVnd:input.priceVnd*quantity},
  };
}

export function scoreRetailRehearsal(input: RetailRehearsal, output: unknown) {
  const parsed = rehearsalAnswerSchema.safeParse(output);
  if (!parsed.success) return {passed:false,reason:"invalid_answer"} as const;
  const answer = parsed.data;
  if (answer.beforeConfirmation !== "ask_confirmation" || answer.afterConfirmation !== "preview_quote" ||
      answer.stockConflict !== "notify_stock_limit") {
    return {passed:false,reason:"quote_stock_or_confirmation"} as const;
  }
  const fixture = buildRetailRehearsal(input);
  const price = new Intl.NumberFormat("vi-VN").format(fixture.priceVnd);
  return {
    passed:true,
    reply:"Giá " + price + " ₫ mỗi đơn vị (dữ liệu diễn tập). " + answer.reply,
    objectionReply:answer.objectionReply,
    quote:{...fixture.quote,inventorySource:"fixture",priceVerified:true,stockChecked:true,explicitConfirmation:true},
    liveSales:false,
    ordersCreated:0,
  } as const;
}

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

const sampleRule = z.enum(["verified_price","stock_limit","confirm_quantity","quote_only"]);
export const retailSampleSchema = retailRehearsalSchema.extend({
  stock: z.number().int().min(2).max(100),
  rules: z.array(sampleRule).max(4),
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

export function buildRetailRehearsal(input: RetailRehearsal, stock = 2) {
  const quantity = 2;
  return {
    product: input.product,
    priceVnd: input.priceVnd,
    stock,
    scenarios: [
      {customer: "Cho mình hỏi giá, có sẵn không?"},
      {customer: "Mình thấy giá này cao. Có cách nào tiết kiệm hơn không?"},
      {customer: "Mình muốn mua hai đơn vị, cho mình xem bao nhiêu tiền."},
      {customer: "Mình xác nhận lấy hai đơn vị."},
      {customer: "Mình muốn đặt " + (stock+1) + " đơn vị."},
    ],
    quote: {quantity,priceVnd:input.priceVnd,totalVnd:input.priceVnd*quantity},
  };
}

export function scoreRetailRehearsal(input: RetailRehearsal, output: unknown, stock = 2) {
  const parsed = rehearsalAnswerSchema.safeParse(output);
  if (!parsed.success) return {passed:false,reason:"invalid_answer"} as const;
  const answer = parsed.data;
  if (answer.beforeConfirmation !== "ask_confirmation" || answer.afterConfirmation !== "preview_quote" ||
      answer.stockConflict !== "notify_stock_limit") {
    return {passed:false,reason:"quote_stock_or_confirmation"} as const;
  }
  const fixture = buildRetailRehearsal(input,stock);
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


export function exerciseRetailSample(input: z.infer<typeof retailSampleSchema>) {
  const rules = new Set(input.rules);
  const answer = {
    reply:"Em đã tra cứu danh mục mẫu. Mình có thể kiểm tra số lượng trước khi xem báo giá.",
    objectionReply:"Mình có thể giảm số lượng để phù hợp ngân sách. Đơn giá giữ theo danh mục mẫu.",
    beforeConfirmation:rules.has("confirm_quantity") ? "ask_confirmation" : "handoff",
    afterConfirmation:rules.has("verified_price") && rules.has("quote_only") ? "preview_quote" : "handoff",
    stockConflict:rules.has("stock_limit") ? "notify_stock_limit" : "promise_stock",
  };
  return {
    ...scoreRetailRehearsal(input,answer,input.stock),
    knowledgeVersion:input.knowledgeVersion,
    source:"sample_rules",
    generatedByModel:false,
  } as const;
}

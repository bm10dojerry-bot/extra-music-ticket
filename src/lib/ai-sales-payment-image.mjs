/** STAGED decision helper. No image download, model call, database mutation, or message sending.
 * Caller must derive lookup exclusively from the existing trusted Extra order/payment flow;
 * never pass model-supplied verification flags. Authorize conversation ownership before disclosing anything.
 * A paid decision only permits reporting trusted order status; issuing tickets remains in the existing backend.
 */
function receiptNextStep(input = {}) {
  const { hasImage = false, visionState = "not_run", receiptKind = "unknown", lookup = null, humanHandling = false } = input ?? {};
  // Only call with trusted webhook and worker state. Vision results are hints, never proof of payment.
  if (humanHandling === true) return {action:"skip", mayConfirmPaid:false};
  if (hasImage !== true) return {action:"not_image", mayConfirmPaid:false};
  if (visionState !== "readable") return {action:"request_clear_image_or_reference", mayConfirmPaid:false};
  if (receiptKind !== "transfer_receipt") return {action:"route_to_other_image_handling", mayConfirmPaid:false};
  if (!lookup || typeof lookup !== "object") return {action:"lookup_order_read_only", mayConfirmPaid:false};
  // All lookup fields below must be supplied by the trusted Extra backend, not the model or image.
  if (lookup.verified !== true || lookup.customerAuthorized !== true || lookup.uniqueOrder !== true) {
    return {action:"clarify_order_or_handoff", mayConfirmPaid:false};
  }
  if (lookup.receiptConflict === true || lookup.paymentStatus === "mismatch") return {action:"handoff_discrepancy", mayConfirmPaid:false};
  if (lookup.paymentStatus === "paid") return {action:"report_verified_order_paid", mayConfirmPaid:true};
  if (lookup.paymentStatus === "pending" || lookup.paymentStatus === "unpaid") return {action:"report_not_yet_confirmed", mayConfirmPaid:false};
  return {action:"handoff_payment_review", mayConfirmPaid:false};
}

export { receiptNextStep };

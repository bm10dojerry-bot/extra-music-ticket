import test from "node:test";
import assert from "node:assert/strict";
import { receiptNextStep } from "../src/lib/ai-sales-payment-image.mjs";
const cases = [
  [
    "photo without caption",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt"
    },
    {
      "action": "lookup_order_read_only",
      "mayConfirmPaid": false
    }
  ],
  [
    "confirmed paid",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": true,
        "paymentStatus": "paid"
      }
    },
    {
      "action": "report_verified_order_paid",
      "mayConfirmPaid": true
    }
  ],
  [
    "pending",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": true,
        "paymentStatus": "pending"
      }
    },
    {
      "action": "report_not_yet_confirmed",
      "mayConfirmPaid": false
    }
  ],
  [
    "unpaid",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": true,
        "paymentStatus": "unpaid"
      }
    },
    {
      "action": "report_not_yet_confirmed",
      "mayConfirmPaid": false
    }
  ],
  [
    "wrong order owner",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": false,
        "uniqueOrder": true,
        "paymentStatus": "paid"
      }
    },
    {
      "action": "clarify_order_or_handoff",
      "mayConfirmPaid": false
    }
  ],
  [
    "multiple matches",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": false,
        "paymentStatus": "paid"
      }
    },
    {
      "action": "clarify_order_or_handoff",
      "mayConfirmPaid": false
    }
  ],
  [
    "fake paid claim",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "paymentStatus": "paid"
      }
    },
    {
      "action": "clarify_order_or_handoff",
      "mayConfirmPaid": false
    }
  ],
  [
    "amount or reference mismatch",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": true,
        "paymentStatus": "paid",
        "receiptConflict": true
      }
    },
    {
      "action": "handoff_discrepancy",
      "mayConfirmPaid": false
    }
  ],
  [
    "unreadable image",
    {
      "hasImage": true,
      "visionState": "unreadable",
      "receiptKind": "transfer_receipt"
    },
    {
      "action": "request_clear_image_or_reference",
      "mayConfirmPaid": false
    }
  ],
  [
    "failed image fetch",
    {
      "hasImage": true,
      "visionState": "download_failed",
      "receiptKind": "transfer_receipt"
    },
    {
      "action": "request_clear_image_or_reference",
      "mayConfirmPaid": false
    }
  ],
  [
    "expired or refunded order",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "lookup": {
        "verified": true,
        "customerAuthorized": true,
        "uniqueOrder": true,
        "paymentStatus": "refunded"
      }
    },
    {
      "action": "handoff_payment_review",
      "mayConfirmPaid": false
    }
  ],
  [
    "poster instead of receipt",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "poster"
    },
    {
      "action": "route_to_other_image_handling",
      "mayConfirmPaid": false
    }
  ],
  [
    "human handling",
    {
      "hasImage": true,
      "visionState": "readable",
      "receiptKind": "transfer_receipt",
      "humanHandling": true
    },
    {
      "action": "skip",
      "mayConfirmPaid": false
    }
  ],
  [
    "text only",
    {
      "hasImage": false
    },
    {
      "action": "not_image",
      "mayConfirmPaid": false
    }
  ]
];
for (const [name,input,expected] of cases) test(name,()=>assert.deepEqual(receiptNextStep(input),expected));

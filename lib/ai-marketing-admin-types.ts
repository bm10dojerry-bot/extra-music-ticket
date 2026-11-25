/** Admin-only view. Provider tokens and customer identities never belong here. */
export type MarketingPostStatus = "draft" | "scheduled" | "publishing" | "published" | "blocked" | "failed" | "uncertain" | "cancelled";
export type MarketingObjective = "messages" | "sales";
export type MarketingAllocationStatus = "reserved" | "pending" | "active" | "paused" | "completed" | "uncertain" | "blocked" | "failed" | "released";

export type MarketingShow = {
  id:string; artist:string; title:string; startsAt:string; venueName:string;
  posterUrl:string|null; url:string;
};
export type MarketingPost = {
  id:string; businessDate:string; slot:number; scheduledAt:string; showId:string;
  showName:string; caption:string; imageUrl:string|null; landingUrl:string;
  status:MarketingPostStatus; objective:MarketingObjective;
  facebookPostId:string|null; permalink:string|null; publishedAt:string|null;
  reason:string|null; updatedAt:string;
};
export type MarketingAllocation = {
  id:string; postId:string; showName:string; businessDate:string; objective:MarketingObjective;
  status:MarketingAllocationStatus; budgetVnd:number; spendVnd:number|null;
  messages:number|null; platformPurchases:number|null; attributedPaidOrders:number|null;
  attributedPaidRevenueVnd:number|null; metricsAsOf:string|null;
  freshness:"fresh"|"stale"|"unavailable"; reason:string|null; adId:string|null;
};
export type MarketingAuditEvent = {
  id:string; createdAt:string; title:string; detail:string;
  status:"info"|"success"|"warning"|"error";
};

export type AiMarketingAdminResponse = {
  updatedAt:string;
  settings:{
    enabled:boolean; pageId:string; pageName:string; accountId:string|null; accountName:string|null;
    publishingReady:boolean; advertisingReady:boolean; readinessReasons:string[];
    timezone:"Asia/Ho_Chi_Minh"; slots:[string,string]; initialBudgetVnd:number; scaleBudgetVnd:number;
    dailyCapVnd:number; maxAuthorizedDailyCapVnd:number;
    objectivePlan:"rotate_messages_sales"|"messages_only";
    automationStatus:"active"|"waiting_connection"|"paused"|"needs_attention";
    lastWorkerAt:string|null; pausePending:boolean;
  };
  accounts:{id:string;name:string}[];
  shows:MarketingShow[];
  posts:MarketingPost[];
  allocations:MarketingAllocation[];
  audit:MarketingAuditEvent[];
  totals:{
    businessDate:string; publishedToday:number; scheduledToday:number; allocatedVnd:number;
    spendVnd:number|null; messages:number|null; attributedPaidOrders:number|null;
    attributedPaidRevenueVnd:number|null; metricsAsOf:string|null;
  };
  limited?:boolean;
};

export type AiMarketingAdminAction =
  | {action:"set_enabled";enabled:boolean}
  | {action:"configure";accountId:string|null;slots:[string,string];dailyCapVnd:number};

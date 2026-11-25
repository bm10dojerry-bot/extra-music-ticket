/** Public, admin-only response. Never include provider credentials or Messenger recipient IDs. */
export type AiSalesStatus = "in_progress" | "awaiting_payment" | "successful" | "unsuccessful" | "needs_attention";
export type AiSalesMode = "ai" | "manual";

export type AiSalesConversation = {
  /** Stable outcome/state row identifier; id always remains the conversation ID. */
  recordId?: string;
  id: string;
  customerName: string;
  showName?: string | null;
  status: AiSalesStatus;
  mode: AiSalesMode;
  summary?: string | null;
  reason?: string | null;
  updatedAt: string;
  orderCode?: string | null;
  orderId?: string | null;
  amount?: number | null;
  ticketCount?: number | null;
};

export type AiSalesAdminResponse = {
  enabled: boolean;
  ready: boolean;
  modelLabel: string;
  readinessMessage?: string | null;
  updatedAt: string;
  totals: {
    successful: number;
    unsuccessful: number;
    inProgress: number;
    revenue: number;
  };
  conversations: AiSalesConversation[];
  notificationEmailConfigured?: boolean;
  notificationEmail?: string | null;
  limited?: boolean;
};

export type AiSalesAdminAction =
  | { action: "connect_ad_referrals" }
  | { action: "set_enabled"; enabled: boolean }
  | { action: "set_mode"; chatId: string; mode: AiSalesMode };

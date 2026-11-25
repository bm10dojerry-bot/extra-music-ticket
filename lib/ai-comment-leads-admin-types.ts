/** Admin-only view. Provider credentials and Facebook recipient IDs never belong here. */
export type AiCommentLeadStatus = "pending" | "eligible" | "sending" | "sent" | "replied" | "needs_review" | "skipped" | "failed" | "uncertain";

export type AiCommentLead = {
  id: string;
  customerName: string;
  commentText: string;
  postTitle?: string | null;
  showName?: string | null;
  status: AiCommentLeadStatus;
  reason?: string | null;
  replyPreview?: string | null;
  commentedAt: string;
  updatedAt: string;
  sentAt?: string | null;
  /** Set only after a verified incoming Messenger event is matched to this lead. */
  repliedAt?: string | null;
  postUrl?: string | null;
  commentUrl?: string | null;
  /** An existing internal chat UUID, never a Facebook author/recipient ID. */
  chatId?: string | null;
};

export type AiCommentLeadsAdminResponse = {
  enabled: boolean;
  ready: boolean;
  /** Fresh Page permission/read/feed checks; independent of customer eligibility and master AI. */
  pageConnectionReady: boolean;
  /** Verified access to serve real customers; OAuth success alone never establishes this. */
  publicAccessReady: boolean;
  readinessMessage?: string | null;
  updatedAt: string;
  pausePending?: boolean;
  lastScanAt?: string | null;
  lastWorkerAt?: string | null;
  limits?: {hourly:number;daily:number;contactCooldownDays:number};
  totals: {
    eligible: number | null;
    sent: number | null;
    replied: number | null;
    needsReview: number | null;
    failed: number | null;
  };
  leads: AiCommentLead[];
  limited?: boolean;
};

export type AiCommentLeadsAdminAction = {action:"set_enabled";enabled:boolean} | {action:"check_connection"};

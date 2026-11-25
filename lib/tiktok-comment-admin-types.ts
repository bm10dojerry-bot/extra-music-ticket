/** Admin-only public-comment view. Provider tokens and private-message identities are excluded. */
export type TikTokCommentStatus="pending"|"ready"|"sending"|"replied"|"skipped"|"needs_review"|"failed"|"uncertain";

export type TikTokCommentRow={
  id:string;
  customerName:string;
  commentText:string;
  videoCaption:string|null;
  status:TikTokCommentStatus;
  reason:string|null;
  replyPreview:string|null;
  videoUrl:string|null;
  firstSeenAt:string|null;
  updatedAt:string|null;
  repliedAt:string|null;
};

export type TikTokCommentAdminResponse={
  account:{name:string;username:string|null;profileUrl:string|null;connected:boolean};
  enabled:boolean;
  /** May save a resume request; the worker must still refresh stale read evidence before sending. */
  canEnable:boolean;
  /** Connection, permissions and an actual verified schedule permit a future run. */
  ready:boolean;
  scheduleReady:boolean;
  pollIntervalMinutes:number|null;
  /** Separate from scope authorization; true only after a successful public-reply receipt. */
  replyVerified:boolean;
  pausePending:boolean;
  readinessMessage:string|null;
  sourceFreshnessWarning:string|null;
  sourceCoverageLimited:boolean;
  updatedAt:string;
  permissionsCheckedAt:string|null;
  lastScanAt:string|null;
  lastWorkerAt:string|null;
  lastSuccessAt:string|null;
  lastReplyAt:string|null;
  lastError:string|null;
  reportDays:number|null;
  totals:{processed:number|null;replied:number|null;needsReview:number|null;uncertain:number|null;failed:number|null};
  comments:TikTokCommentRow[];
  limited:boolean;
};

export type TikTokCommentAdminAction={action:"set_enabled";enabled:boolean};

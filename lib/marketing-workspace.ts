export const departments = ["operations", "sales", "finance", "media", "tiktok"] as const;
export type Department = typeof departments[number];
export const departmentLabels: Record<Department, string> = {
  operations: "Điều hành show",
  sales: "Marketing, Sale & CSKH",
  finance: "Tài chính",
  media: "Quản lý media",
  tiktok: "TikTok",
};

export const reportStatuses = ["in_progress", "submitted", "blocked"] as const;
export type ReportStatus = typeof reportStatuses[number];
export type TaskStatus = "pending" | ReportStatus | "accepted";

export function isEvidenceLink(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https://drive.google.com", "https://docs.google.com", "https://www.tiktok.com", "https://vm.tiktok.com"].includes(url.origin)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

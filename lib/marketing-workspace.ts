// Domain model only; authenticated server-side persistence and session revocation are required.
export const departments = ["operations","sales","finance","media","tiktok"] as const;
export type Department = typeof departments[number];
export type StaffMembership = { userId: string; department: Department; active: boolean };
export type Actor = { userId: string; isOwner: boolean; memberships: StaffMembership[] };
export type WorkItem = { id: string; showId: string; department: Department; title: string; status: "pending" | "in_progress" | "submitted" | "accepted" | "blocked"; driveLinks: string[]; dueAt: string; budgetVnd: number };
export type WorkReport = { taskId: string; authorId: string; createdAt: string; note: string; evidenceLinks: string[]; status: "in_progress" | "submitted" | "blocked" };
export function canAccess(actor: Actor, department: Department): boolean {
  return actor.isOwner || actor.memberships.some(m => m.userId === actor.userId && m.active && m.department === department);
}
export function submitWorkReport(actor: Actor, task: WorkItem, report: Omit<WorkReport,"authorId"|"taskId"|"createdAt">, now: Date): WorkReport {
  if (!canAccess(actor, task.department)) throw new Error("Forbidden");
  if (task.status === "accepted" || !report.note.trim()) throw new Error("Invalid report");
  if (!["in_progress","submitted","blocked"].includes(report.status)) throw new Error("Invalid status");
  for (const link of report.evidenceLinks) {
    const url = new URL(link);
    if (url.protocol !== "https:" || !["drive.google.com","docs.google.com"].includes(url.hostname) || url.username || url.password) throw new Error("Invalid evidence link");
  }
  return {...report, taskId:task.id, authorId:actor.userId, createdAt:now.toISOString()};
}
export function planHandover(actor: Actor, department: Department, outgoingId: string, incomingId: string, now: Date) {
  if (!actor.isOwner) throw new Error("Forbidden");
  if (!outgoingId || !incomingId || outgoingId === incomingId) throw new Error("Invalid handover");
  return {department, outgoingId, incomingId, authorizedBy:actor.userId, createdAt:now.toISOString(), preserveDepartmentTasks:true, preserveReportAuthors:true, revokeOutgoingDepartmentAccess:true, grantIncomingDepartmentAccess:true};
}

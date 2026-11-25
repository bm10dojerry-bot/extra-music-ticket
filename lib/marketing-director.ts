// Pure planning layer: does not execute ads, publish content or modify ticketing.
export type Agent = "Research" | "Planner" | "Content" | "Creative" | "Social" | "Ads" | "Sale" | "CRM" | "Analyst" | "Auditor";
export type ShowSnapshot = { id: string; startsAt: string; capacity: number; paidTickets: number };
export type MarketingTask = { id: string; showId: string; agent: Agent; action: string; dependsOn: string[]; approvalRequired: boolean; priority: number };
export function planMarketing(show: ShowSnapshot, now: Date): MarketingTask[] {
  const start = Date.parse(show.startsAt);
  if (!show.id || !Number.isFinite(start) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(show.capacity) || !Number.isSafeInteger(show.paidTickets) || show.capacity < 1 || show.paidTickets < 0 || show.paidTickets > show.capacity) throw new Error("Invalid show snapshot");
  if (start <= now.getTime() || show.paidTickets === show.capacity) return [];
  const days = (start - now.getTime()) / 86400000;
  const priority = days <= 3 ? 100 : days <= 7 ? 80 : days <= 14 ? 60 : 40;
  const prefix = show.id + ":" + now.toISOString().slice(0,10) + ":";
  const task = (agent: Agent, action: string, dependencies: Agent[] = [], approvalRequired = false): MarketingTask => ({id: prefix + agent, showId: show.id, agent, action, dependsOn: dependencies.map(a => prefix + a), approvalRequired, priority});
  return [
    task("Research", "Research relevant audiences and demand"),
    task("Analyst", "Analyze verified paid ticket counts and campaign attribution"),
    task("Planner", "Draft campaign for remaining seats", ["Research", "Analyst"]),
    task("Content", "Draft factual show content", ["Planner"]),
    task("Creative", "Draft creative briefs", ["Planner"]),
    task("Sale", "Review existing sales funnel without changing ticketing", ["Analyst"]),
    task("CRM", "Draft consent-compliant follow-up plan", ["Planner"]),
    task("Auditor", "Review facts, permissions and proposed campaign", ["Content", "Creative", "Sale", "CRM"]),
    task("Social", "Propose publication; require approval before publishing", ["Auditor"], true),
    task("Ads", "Propose spend; require approval before any external ad mutation", ["Auditor"], true)
  ];
}

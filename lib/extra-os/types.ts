import type {Agent, JobKind} from "../marketing-director";
import type {Department, TaskStatus} from "../marketing-workspace";
import type {ShowFinancialPlan, ShowIntake} from "../marketing-show-intake";

export type OsShow = {
  id: string;
  artist: string;
  starts_at: string;
  venue: string;
  capacity: number;
  intake: ShowIntake;
  finances: ShowFinancialPlan;
  ad_limit_vnd: number;
  website_id: string | null;
};

export type OsJob = {
  id: string;
  show_id: string;
  kind: JobKind;
  agent: Agent;
  dependencies: JobKind[];
  status: "queued" | "running" | "succeeded" | "blocked" | "failed" | "skipped";
  attempts: number;
  lease_token: string;
  run_at: string;
  message: string;
  output: Record<string, unknown>;
  updated_at: string;
};

export type OsTask = {
  id: string;
  key: string;
  show_id: string;
  department: Department;
  title: string;
  requirements: string;
  acceptance: string;
  due_at: string;
  budget_vnd: number;
  drive_links: string[];
  status: TaskStatus;
  reminder_at: string | null;
  extra_os_shows: {artist: string; starts_at: string};
};

export type OsReport = {
  id: number;
  task_id: string;
  author_name: string;
  status: TaskStatus;
  note: string;
  evidence_links: string[];
  created_at: string;
};

export type OsLog = {
  id: number;
  show_id: string | null;
  actor_id: string;
  event: string;
  details: {kind?: JobKind; message?: string; department?: Department};
  created_at: string;
};

export type PaidSnapshot = {
  paidOrders: number;
  paidTickets: number;
  seatsTaken: number;
  revenueVnd: number;
  adAttributedRevenueVnd: number;
  adAttributedTickets: number;
  actualCostVnd: number | null;
  actualProfitVnd: number | null;
};

export type OsAsset = {
  id: string;
  show_id: string;
  key: string;
  drive_id: string;
  name: string;
  mime_type: string;
  web_url: string | null;
  version: string | null;
  departments: Department[];
  ready: boolean;
};

export type AdAllocation = {
  id: string;
  show_id: string;
  allocation_key: string;
  status: "reserved" | "active" | "paused" | "uncertain";
  limit_vnd: number;
  delivery_limit_vnd: number;
  spent_vnd: number;
  billed_vnd: number | null;
  campaign_id: string | null;
  adset_id: string | null;
  started_at: string | null;
};

export type DirectorPanel = {
  shows: OsShow[];
  tasks: OsTask[];
  reports: OsReport[];
  jobs: OsJob[];
  logs: OsLog[];
  assets: OsAsset[];
  allocations: AdAllocation[];
  controls: {scope: string; paused: boolean}[];
  memberships: {department: Department; staff_id: string | null}[];
  staff: {id: string; username: string; display_name: string; role: string}[];
};

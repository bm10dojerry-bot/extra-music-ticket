import "server-only";
import {staffDb, type Staff} from "../staff-auth";
import {planMarketing, planStaffWork} from "../marketing-director";
import {parseShowIntake, prepareShow, type ShowIntake, type TicketZone} from "../marketing-show-intake";
import {seatsFor, venues, type VenueId} from "../venues";
import type {Department} from "../marketing-workspace";
import type {AdAllocation, DirectorPanel, OsAsset, OsJob, OsLog, OsReport, OsShow, OsTask} from "./types";

export class WorkBlocked extends Error {}

// Preview runs must never use the live ticketing database or its privileged key.
const EXTRA_OS_TEST_PROJECT = "cucmanjakryycfxvplmt";
export function deploymentAllowsExtraOs(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV !== "preview") return true;
  const expected = "https://" + EXTRA_OS_TEST_PROJECT + ".supabase.co";
  if (env.SUPABASE_URL?.replace(/\/$/, "") !== expected ||
      env.EXTRA_OS_PREVIEW_DATABASE_URL?.replace(/\/$/, "") !== expected ||
      env.EXTRA_OS_MARKETING_LIVE !== "false") return false;
  // The test configuration uses the legacy service_role JWT. Decode only to
  // detect accidental project/role mismatches; Supabase authenticates it.
  const parts = env.SUPABASE_SERVICE_ROLE_KEY?.split(".");
  if (!parts || parts.length !== 3 || parts.some(part => !part)) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims?.ref === EXTRA_OS_TEST_PROJECT && claims?.role === "service_role";
  } catch {
    return false;
  }
}

export async function osDb<T>(path: string, init?: RequestInit): Promise<T> {
  if (!deploymentAllowsExtraOs()) throw new WorkBlocked("Preview cần Supabase kiểm thử riêng.");
  return await staffDb(path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  }) as T;
}

export function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  return osDb<T>("rpc/extra_os_" + name, {method: "POST", body: JSON.stringify(body)});
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

export async function getSeatInventory(venueId: string) {
  const rows = await osDb<{row_code: string; seat_count: number}[]>(
    "venue_seat_rows?venue_id=eq." + encodeURIComponent(venueId) + "&select=row_code,seat_count",
  );
  const counts = Object.fromEntries(rows.map(row => [row.row_code, row.seat_count]));
  const seats = seatsFor(venueId as VenueId, counts);
  const inventory = {A: 0, B: 0, C: 0, D: 0};
  for (const seat of seats) inventory[seat.zone as TicketZone]++;
  return {inventory, seats};
}

export function readIntake(body: unknown) {
  const input = parseShowIntake(body);
  const venue = venues.find(item => item.id === input.venueId);
  if (venue) input.venue = venue.name;
  prepareShow(input);
  return input;
}

export async function startExtraOs(actor: Staff, requestId: string, input: ShowIntake) {
  const now = new Date();
  const inventory = input.venueId ? (await getSeatInventory(input.venueId)).inventory : undefined;
  const finances = prepareShow(input, now, inventory);
  return rpc<{id: string; finances: typeof finances; reused: boolean}>("start", {
    p_actor: actor.id,
    p_request: requestId,
    p_intake: input,
    p_finances: finances,
    p_jobs: planMarketing(input, now),
    p_tasks: planStaffWork(input, finances, now),
  });
}

export async function actorDepartment(actor: Staff): Promise<Department | null> {
  return rpc<Department | null>("department", {p_actor: actor.id});
}

export async function loadWork(actor: Staff, showId: string | null) {
  if (actor.role !== "admin") {
    return rpc<{tasks: OsTask[]; reports: OsReport[]}>("staff_work", {p_actor: actor.id});
  }
  const tasks = showId ? await osDb<OsTask[]>(
    "extra_os_tasks?select=*,extra_os_shows(artist,starts_at)&show_id=eq." + showId + "&order=due_at&limit=100",
  ) : [];
  const reports = tasks.length ? await osDb<OsReport[]>(
    "extra_os_reports?select=id,task_id,author_name,status,note,evidence_links,created_at&task_id=in.(" +
    tasks.map(task => task.id).join(",") + ")&order=id.desc&limit=100",
  ) : [];
  return {tasks, reports};
}

export async function loadDirector(actor: Staff, selected: string | null) {
  const shows = await osDb<OsShow[]>("extra_os_shows?select=id,artist,starts_at,venue,capacity,intake,finances,ad_limit_vnd,website_id&order=created_at.desc&limit=50");
  const active = selected ? shows.find(show => show.id === selected) : shows[0];
  const id = active?.id ?? null;
  const [work, jobs, logs, controls, memberships, staff, assets, allocations] = await Promise.all([
    loadWork(actor, id),
    id ? osDb<OsJob[]>("extra_os_jobs?select=id,kind,agent,status,dependencies,attempts,run_at,message,output,updated_at&show_id=eq." + id + "&order=priority.desc,kind") : [],
    osDb<OsLog[]>("extra_os_log?select=id,show_id,actor_id,event,details,created_at&order=id.desc&limit=35" +
      (id ? "&or=(show_id.eq." + id + ",show_id.is.null)" : "&show_id=is.null")),
    osDb<DirectorPanel["controls"]>("extra_os_controls?select=scope,paused"),
    osDb<DirectorPanel["memberships"]>("extra_os_memberships?select=department,staff_id"),
    osDb<DirectorPanel["staff"]>("staff_accounts?select=id,username,display_name,role&active=eq.true&role=neq.admin&order=display_name&limit=300"),
    id ? osDb<OsAsset[]>("extra_os_assets?show_id=eq." + id + "&ready=eq.true&order=key") : [],
    id ? osDb<AdAllocation[]>("extra_os_ad_allocations?show_id=eq." + id + "&order=created_at") : [],
  ]);
  const panel: DirectorPanel = {shows, ...work, jobs, logs, controls, memberships, staff, assets, allocations};
  return {active, panel};
}

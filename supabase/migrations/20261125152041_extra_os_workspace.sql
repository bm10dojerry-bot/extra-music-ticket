begin;

create table public.extra_os_shows (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  artist text not null,
  starts_at timestamptz not null,
  venue text not null,
  venue_key text not null,
  capacity integer not null check (capacity > 0),
  intake jsonb not null,
  finances jsonb not null,
  ad_limit_vnd bigint not null check (ad_limit_vnd >= 0),
  website_id text unique,
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index extra_os_shows_identity_idx
  on public.extra_os_shows (lower(artist), starts_at, venue_key);

create table public.extra_os_jobs (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.extra_os_shows(id),
  kind text not null,
  agent text not null,
  dependencies text[] not null default '{}',
  priority integer not null default 0,
  status text not null default 'queued' check (status in ('queued','running','succeeded','blocked','failed','skipped')),
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  output jsonb not null default '{}',
  message text not null default '',
  updated_at timestamptz not null default now(),
  unique(show_id, kind),
  check ((status = 'running') = (lease_token is not null and lease_expires_at is not null))
);
create index extra_os_jobs_ready_idx on public.extra_os_jobs (priority desc, run_at) where status = 'queued';
create index extra_os_jobs_lease_idx on public.extra_os_jobs (lease_expires_at) where status = 'running';

create table public.extra_os_controls (
  scope text primary key,
  paused boolean not null,
  changed_by text not null,
  updated_at timestamptz not null default now()
);

create table public.extra_os_memberships (
  department text primary key check (department in ('operations','sales','finance','media','tiktok')),
  staff_id uuid unique references public.staff_accounts(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.extra_os_memberships (department) values ('operations'),('sales'),('finance'),('media'),('tiktok');

create table public.extra_os_tasks (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.extra_os_shows(id),
  key text not null,
  department text not null references public.extra_os_memberships(department),
  title text not null,
  requirements text not null,
  acceptance text not null,
  due_at timestamptz not null,
  budget_vnd bigint not null default 0 check (budget_vnd >= 0),
  drive_links text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','in_progress','submitted','accepted','blocked')),
  reminder_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(show_id, key)
);
create index extra_os_tasks_department_idx on public.extra_os_tasks(department, due_at);
create index extra_os_tasks_deadline_idx on public.extra_os_tasks(show_id, due_at) where status in ('pending','in_progress','blocked');

create table public.extra_os_reports (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.extra_os_tasks(id),
  author_id text not null,
  author_name text not null,
  status text not null check (status in ('in_progress','submitted','blocked','accepted')),
  note text not null check (length(note) between 1 and 5000),
  evidence_links text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index extra_os_reports_task_idx on public.extra_os_reports(task_id, id desc);

create table public.extra_os_log (
  id bigint generated always as identity primary key,
  show_id uuid references public.extra_os_shows(id),
  job_id uuid references public.extra_os_jobs(id),
  task_id uuid references public.extra_os_tasks(id),
  actor_id text not null,
  event text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index extra_os_log_show_idx on public.extra_os_log(show_id, id desc);

alter table public.extra_os_shows enable row level security;
alter table public.extra_os_jobs enable row level security;
alter table public.extra_os_controls enable row level security;
alter table public.extra_os_memberships enable row level security;
alter table public.extra_os_tasks enable row level security;
alter table public.extra_os_reports enable row level security;
alter table public.extra_os_log enable row level security;

revoke all on public.extra_os_shows, public.extra_os_jobs, public.extra_os_controls,
  public.extra_os_memberships, public.extra_os_tasks, public.extra_os_reports, public.extra_os_log
  from public, anon, authenticated;
grant select, insert, update on public.extra_os_shows, public.extra_os_jobs, public.extra_os_controls,
  public.extra_os_memberships, public.extra_os_tasks, public.extra_os_reports, public.extra_os_log to service_role;
grant usage on sequence public.extra_os_reports_id_seq, public.extra_os_log_id_seq to service_role;

-- Dedicated accounts gain no rights in the existing ticketing, Sale or check-in portals.
alter table public.staff_accounts drop constraint if exists staff_accounts_role_check;
alter table public.staff_accounts add constraint staff_accounts_role_check
  check (role in ('admin','sale','show_manager','accountant','checkin','extra_os'));

-- The server derives this actor from the existing signed cookie, never the request body.
create function public.extra_os_is_admin(p_actor text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(p_actor = 'owner', false) or exists (
    select 1 from public.staff_accounts
    where id::text = p_actor and active and role = 'admin'
  );
$$;

create function public.extra_os_start(p_actor text, p_request uuid, p_intake jsonb, p_finances jsonb, p_jobs jsonb, p_tasks jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  existing public.extra_os_shows;
  new_id uuid;
begin
  if not public.extra_os_is_admin(p_actor) then raise exception using errcode = '42501'; end if;
  insert into public.extra_os_shows (request_id, artist, starts_at, venue, venue_key, capacity, intake, finances, ad_limit_vnd, created_by)
  values (p_request, p_intake->>'artist', (p_intake->>'startsAt')::timestamptz, p_intake->>'venue',
    coalesce(nullif(p_intake->>'venueId', ''), lower(p_intake->>'venue')), (p_intake->>'capacity')::int,
    p_intake, p_finances, (p_intake->>'adsVnd')::bigint, p_actor)
  on conflict do nothing returning id into new_id;

  if new_id is null then
    select * into existing from public.extra_os_shows where request_id = p_request;
    if not found or existing.intake <> p_intake then
      raise exception 'Show đã có trong EXTRA OS hoặc mã yêu cầu đã được sử dụng.' using errcode = '23505';
    end if;
    return jsonb_build_object('id', existing.id, 'finances', existing.finances, 'reused', true);
  end if;

  insert into public.extra_os_jobs (show_id, kind, agent, dependencies, priority, run_at)
  select new_id, kind, agent, dependencies, priority, coalesce(run_at,now())
    from jsonb_to_recordset(p_jobs) as job(kind text, agent text, dependencies text[], priority int, run_at timestamptz);
  insert into public.extra_os_tasks (show_id, key, department, title, requirements, acceptance, due_at, budget_vnd, drive_links)
  select new_id, key, department, title, requirements, acceptance, due_at, budget_vnd, drive_links
    from jsonb_to_recordset(p_tasks) as task(key text, department text, title text, requirements text,
      acceptance text, due_at timestamptz, budget_vnd bigint, drive_links text[]);
  insert into public.extra_os_log (show_id, actor_id, event, details)
  values (new_id, p_actor, 'show_started', jsonb_build_object('permissions',p_intake->'permissions'));

  return jsonb_build_object('id', new_id, 'finances', p_finances, 'reused', false);
end;
$$;

create function public.extra_os_claim(p_limit integer)
returns setof public.extra_os_jobs language plpgsql security invoker set search_path = '' as $$
begin
  with expired as (
    update public.extra_os_jobs
    set status = case when attempts >= 4 then 'failed' else 'queued' end,
        lease_token = null, lease_expires_at = null, updated_at = now(), message = 'Worker hết thời hạn thực thi.'
    where status = 'running' and lease_expires_at <= now()
    returning id, show_id, status
  )
  insert into public.extra_os_log (show_id, job_id, actor_id, event)
  select show_id, id, 'Director', 'lease_expired_' || status from expired;

  with expired as (
    update public.extra_os_jobs j set status = 'skipped', message = 'Show đã bắt đầu.', updated_at = now()
    from public.extra_os_shows s where j.show_id = s.id and j.status = 'queued' and s.starts_at <= now()
      and j.kind not in ('analyst','archive_report','ads_monitor','reminders','crm','close_sales')
    returning j.id, j.show_id
  )
  insert into public.extra_os_log (show_id, job_id, actor_id, event)
  select show_id, id, 'Director', 'job_skipped' from expired;

  return query
  with ready as (
    select j.id
    from public.extra_os_jobs j
    where j.status = 'queued' and j.run_at <= now()
      and not exists (select 1 from public.extra_os_controls c where c.paused and c.scope in ('system',j.agent)
        and j.kind not in ('ads_monitor','close_sales'))
      and not exists (
        select 1 from unnest(j.dependencies) d(kind)
        left join public.extra_os_jobs prerequisite on prerequisite.show_id = j.show_id and prerequisite.kind = d.kind
        where prerequisite.id is null or (prerequisite.status <> 'succeeded'
          and (prerequisite.output = '{}'::jsonb or prerequisite.kind <> 'analyst'))
      )
    order by j.priority desc, j.run_at, j.id
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit,1),8))
  )
  update public.extra_os_jobs j
  set status = 'running', attempts = attempts + 1, lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '4 minutes', updated_at = now()
  from ready where j.id = ready.id returning j.*;
end;
$$;

create function public.extra_os_lease_valid(p_id uuid, p_lease uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.extra_os_jobs j where j.id = p_id and j.lease_token = p_lease
      and j.status = 'running' and j.lease_expires_at > now()
      and not exists (select 1 from public.extra_os_controls c where c.paused and c.scope in ('system',j.agent)
        and j.kind not in ('ads_monitor','close_sales'))
  );
$$;

create function public.extra_os_finish(p_id uuid, p_lease uuid, p_status text, p_output jsonb, p_message text, p_next timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  job public.extra_os_jobs;
begin
  if p_status not in ('succeeded','queued','failed','blocked','skipped') then raise exception 'Invalid result'; end if;
  update public.extra_os_jobs
  set status = case when p_status = 'succeeded' and p_next is not null then 'queued' else p_status end,
    attempts = case when p_status = 'succeeded' then 0 else attempts end,
    output = coalesce(p_output, output), message = left(coalesce(p_message,''),600),
    run_at = coalesce(p_next, now()), lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_id and lease_token = p_lease and status = 'running' and lease_expires_at > now()
  returning * into job;
  if not found then return false; end if;
  insert into public.extra_os_log (show_id, job_id, actor_id, event, details)
  values (job.show_id, job.id, job.agent, 'job_' || p_status, jsonb_build_object('kind',job.kind,'message',job.message));
  return true;
end;
$$;

create function public.extra_os_control(p_actor text, p_scope text, p_paused boolean, p_retry uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_show uuid;
begin
  if not public.extra_os_is_admin(p_actor) then raise exception using errcode = '42501'; end if;
  if p_retry is not null then
    update public.extra_os_jobs set status = 'queued', attempts = 0, run_at = now(), updated_at = now(), message = ''
    where id = p_retry and status in ('blocked','failed') returning show_id into target_show;
    if found then
      insert into public.extra_os_log (show_id, job_id, actor_id, event) values (target_show, p_retry, p_actor, 'job_retry_requested');
    end if;
  else
    if p_scope not in ('system','Director','Research','Planner','Content','Creative','Social','Ads','Sale','CRM','Analyst','Auditor') then raise exception 'Invalid scope'; end if;
    insert into public.extra_os_controls (scope, paused, changed_by) values (p_scope, p_paused, p_actor)
      on conflict (scope) do update set paused = excluded.paused, changed_by = excluded.changed_by, updated_at = now();
    if p_scope in ('system','Ads') then
      update public.extra_os_jobs set run_at = now() where kind = 'ads_monitor' and status = 'queued' and run_at > now();
    end if;
    insert into public.extra_os_log (actor_id, event, details)
      values (p_actor, 'control_changed', jsonb_build_object('scope',p_scope,'paused',p_paused));
  end if;
end;
$$;

create function public.extra_os_assign(p_actor text, p_department text, p_staff uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous uuid;
begin
  if not public.extra_os_is_admin(p_actor) then raise exception using errcode = '42501'; end if;
  select staff_id into previous from public.extra_os_memberships where department = p_department for update;
  if not found then raise exception 'Invalid department'; end if;
  if p_staff is not null and not exists (select 1 from public.staff_accounts where id = p_staff and active and role <> 'admin') then
    raise exception 'Invalid staff account' using errcode = '22023';
  end if;
  if previous is not distinct from p_staff then return; end if;
  update public.extra_os_memberships set staff_id = p_staff, updated_at = now() where department = p_department;
  insert into public.extra_os_log (actor_id, event, details)
    values (p_actor, 'department_handover', jsonb_build_object('department',p_department,'previous',previous,'staff',p_staff));
end;
$$;

create function public.extra_os_department(p_actor text)
returns text language sql stable security invoker set search_path = '' as $$
  select m.department
  from public.extra_os_memberships m join public.staff_accounts a on a.id = m.staff_id
  where a.id::text = p_actor and a.active;
$$;

create function public.extra_os_report(p_actor text, p_task uuid, p_status text, p_note text, p_links text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  task public.extra_os_tasks;
  admin boolean := public.extra_os_is_admin(p_actor);
  author text;
begin
  select * into task from public.extra_os_tasks where id = p_task for update;
  if not found then raise exception using errcode = '42501'; end if;
  if not admin then
    select a.display_name into author from public.extra_os_memberships m
    join public.staff_accounts a on a.id = m.staff_id
    where m.department = task.department and a.id::text = p_actor and a.active for share of m,a;
    if not found or p_status = 'accepted' then raise exception using errcode = '42501'; end if;
  else
    select display_name into author from public.staff_accounts where id::text = p_actor;
    author := coalesce(author, 'Chủ quản trị');
  end if;
  if task.status = 'accepted' or (p_status = 'accepted' and task.status <> 'submitted') then
    raise exception 'Trạng thái nhiệm vụ đã thay đổi.' using errcode = '23514';
  end if;
  insert into public.extra_os_reports (task_id, author_id, author_name, status, note, evidence_links)
    values (p_task, p_actor, author, p_status, p_note, p_links);
  update public.extra_os_tasks set status = p_status, updated_at = now() where id = p_task;
  insert into public.extra_os_log (show_id, task_id, actor_id, event)
    values (task.show_id, task.id, p_actor, 'task_' || p_status);
end;
$$;

create function public.extra_os_remind(p_show uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare total integer;
begin
  with overdue as (
    update public.extra_os_tasks set reminder_at = now()
    where show_id = p_show and status in ('pending','in_progress','blocked')
      and due_at <= now() and (reminder_at is null or reminder_at <= now() - interval '1 day')
    returning id, show_id, department
  )
  insert into public.extra_os_log (show_id, task_id, actor_id, event, details)
  select show_id, id, 'Director', 'task_overdue', jsonb_build_object('department',department) from overdue;
  get diagnostics total = row_count;
  return total;
end;
$$;

revoke execute on function public.extra_os_is_admin(text),
  public.extra_os_start(text,uuid,jsonb,jsonb,jsonb,jsonb), public.extra_os_claim(integer),
  public.extra_os_lease_valid(uuid,uuid), public.extra_os_finish(uuid,uuid,text,jsonb,text,timestamptz),
  public.extra_os_control(text,text,boolean,uuid), public.extra_os_assign(text,text,uuid),
  public.extra_os_department(text), public.extra_os_report(text,uuid,text,text,text[]),
  public.extra_os_remind(uuid) from public, anon, authenticated;
grant execute on function public.extra_os_is_admin(text),
  public.extra_os_start(text,uuid,jsonb,jsonb,jsonb,jsonb), public.extra_os_claim(integer),
  public.extra_os_lease_valid(uuid,uuid), public.extra_os_finish(uuid,uuid,text,jsonb,text,timestamptz),
  public.extra_os_control(text,text,boolean,uuid), public.extra_os_assign(text,text,uuid),
  public.extra_os_department(text), public.extra_os_report(text,uuid,text,text,text[]),
  public.extra_os_remind(uuid) to service_role;

commit;

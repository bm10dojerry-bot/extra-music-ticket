create table if not exists os_v11_users (
  id uuid primary key,
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('OWNER','ADS_MANAGER','SALE_MANAGER','FINANCE_MANAGER','OPERATIONS_MANAGER','CAMERA_ADMIN','AI_DIRECTOR','AI_AGENT','AI_AUDITOR')),
  password_hash text,
  invite_hash text unique,
  invite_expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists os_v11_sessions (
  token_hash text primary key,
  csrf text not null,
  expires_at timestamptz not null,
  actor_id uuid not null references os_v11_users(id)
);
create index if not exists os_v11_sessions_owner on os_v11_sessions(actor_id);

create table if not exists os_v11_grants (
  id uuid primary key,
  user_id uuid not null references os_v11_users(id),
  permission text not null,
  scope jsonb not null,
  unique (user_id,permission,scope)
);

create table if not exists os_v11_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references os_v11_users(id),
  event text not null,
  scope jsonb not null default '{}',
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function os_v11_keep_evidence() returns trigger language plpgsql as $$
begin
  raise exception 'EXTRA OS evidence is append-only';
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='os_v11_audit_append_only' and tgrelid='os_v11_audit'::regclass) then
    create trigger os_v11_audit_append_only before update or delete or truncate on os_v11_audit
      for each statement execute function os_v11_keep_evidence();
  end if;
end
$$;

create table if not exists os_v11_suppliers (
  id uuid primary key,
  name text not null,
  platform text not null check (platform in ('music','24h')),
  unique(platform,name)
);

create table if not exists os_v11_categories (
  platform text not null check (platform in ('music','24h')),
  category text not null,
  cost_type text not null,
  primary key(platform,category,cost_type)
);

create table if not exists os_v11_costs (
  id uuid primary key,
  platform text not null check (platform in ('music','24h')),
  scope_key text not null,
  code text not null,
  source_line text not null,
  category text not null,
  cost_type text not null,
  supplier_id uuid references os_v11_suppliers(id),
  details jsonb not null,
  status text not null check (status in ('pending','approved','rejected')),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(platform,source_line),
  unique(platform,scope_key,code)
);
create index if not exists os_v11_costs_scope on os_v11_costs(platform,scope_key);

create table if not exists os_v11_cost_history (
  cost_id uuid not null references os_v11_costs(id),
  revision integer not null,
  actor_id uuid not null references os_v11_users(id),
  snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(cost_id,revision)
);

create table if not exists os_v11_cost_coverage (
  platform text not null,
  scope_key text not null,
  basis text not null check (basis in ('planned','approved','actual')),
  source text not null,
  actor_id uuid not null references os_v11_users(id),
  attested_at timestamptz not null default now(),
  primary key(platform,scope_key,basis)
);

create table if not exists os_v11_ads_switch (
  singleton boolean primary key check (singleton),
  stopped boolean not null,
  revision integer not null default 1
);
insert into os_v11_ads_switch values (true,false) on conflict do nothing;

create table if not exists os_v11_ads_targets (
  id uuid primary key,
  platform text not null check (platform in ('music','24h')),
  account text not null,
  show_key text not null,
  campaign text not null,
  ad_set text not null,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  unique(account,campaign,ad_set)
);

create table if not exists os_v11_ads_limits (
  layer text not null,
  key text not null,
  cap_vnd bigint not null check (cap_vnd >= 0),
  updated_at timestamptz not null default now(),
  primary key(layer,key)
);

create table if not exists os_v11_ads_observations (
  layer text not null,
  key text not null,
  source text not null check (source in ('meta','fixture')),
  spend_vnd bigint not null check (spend_vnd >= 0),
  observed_at timestamptz not null,
  verified boolean not null,
  primary key(layer,key,source)
);

create table if not exists os_v11_ads_actions (
  id uuid primary key,
  target_id uuid not null references os_v11_ads_targets(id),
  action text not null check (action in ('PAUSE','OPTIMIZE','CREATE_CAMPAIGN','INCREASE_TOTAL_BUDGET')),
  proposal jsonb not null,
  state text not null check (state in ('pending','approved','simulated','rejected','expired')),
  requested_by uuid not null references os_v11_users(id),
  approved_by uuid references os_v11_users(id),
  expires_at timestamptz not null,
  revision integer not null default 1,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists os_v11_ads_reservations (
  action_id uuid not null references os_v11_ads_actions(id),
  layer text not null,
  key text not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  primary key(action_id,layer,key)
);
create index if not exists os_v11_ads_reservation_layer on os_v11_ads_reservations(layer,key);

create table if not exists os_v11_ads_ticks (
  slot timestamptz primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running','available','missing','error')),
  details jsonb not null default '{}'
);

create table if not exists os_v11_ads_metrics (
  target_id uuid not null references os_v11_ads_targets(id),
  observed_at timestamptz not null,
  day date not null,
  source text not null check (source='meta'),
  metrics jsonb not null,
  primary key(target_id,observed_at)
);

create table if not exists os_v11_camera_policy (
  camera text primary key,
  api_daily integer not null default 0 check (api_daily between 0 and 300),
  snapshots_daily integer not null default 0 check (snapshots_daily between 0 and 30),
  media_bytes_daily bigint not null default 0 check (media_bytes_daily between 0 and 25000000),
  snapshot_interval_s integer not null default 900 check (snapshot_interval_s between 120 and 86400),
  retention_days integer not null default 0 check (retention_days between 0 and 30),
  ai_day_vnd bigint not null default 0 check (ai_day_vnd >= 0),
  ai_month_vnd bigint not null default 0 check (ai_month_vnd >= 0),
  imou_terms_verified boolean not null default false,
  media_host text,
  terms_reference text,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists os_v11_camera_usage (
  camera text not null,
  day date not null,
  calls integer not null default 0,
  snapshots integer not null default 0,
  media_bytes bigint not null default 0,
  snapshot_at timestamptz,
  primary key(camera,day)
);

create table if not exists os_v11_camera_status (
  camera text primary key,
  status text not null,
  model text,
  name text,
  reason text,
  checked_at timestamptz not null default now()
);

create table if not exists os_v11_sources (
  source text primary key,
  state text not null check (state in ('MISSING','UNAVAILABLE','PARTIAL','AVAILABLE')),
  checked_at timestamptz not null default now(),
  details jsonb not null
);

create table if not exists os_v11_supplier_quotes (
  id uuid primary key,
  supplier_id uuid not null references os_v11_suppliers(id),
  category text not null,
  cost_type text not null,
  unit text not null,
  unit_price_vnd bigint not null check (unit_price_vnd >= 0),
  source text not null,
  as_of date not null,
  unique(supplier_id,category,cost_type,unit,source,as_of)
);

alter table os_v11_costs add column if not exists allocation_of uuid references os_v11_costs(id);
create index if not exists os_v11_costs_allocation on os_v11_costs(allocation_of);

alter table os_v11_ads_targets add column if not exists dry_run_allocation_vnd bigint
  check (dry_run_allocation_vnd >= 0);

create table if not exists os_v11_operations (
  location text not null,
  day date not null,
  hour integer not null check (hour between -1 and 23),
  fields jsonb not null,
  source text not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(location,day,hour)
);

create table if not exists os_v11_camera_counts (
  camera text not null,
  day date not null,
  hour integer not null check (hour between 0 and 23),
  fields jsonb not null,
  source text not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(camera,day,hour)
);

create table if not exists os_v11_staff_shifts (
  id uuid primary key,
  location text not null,
  staff_id uuid not null references os_v11_users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at>starts_at),
  arrived_at timestamptz,
  left_at timestamptz check (left_at is null or left_at>arrived_at),
  state text not null default 'pending' check (state in ('pending','confirmed')),
  note text,
  revision integer not null default 1,
  unique(location,staff_id,starts_at)
);

create table if not exists os_v11_crowd_rules (
  camera text primary key,
  settings jsonb not null,
  revision integer not null default 1
);

create table if not exists os_v11_operational_alerts (
  id uuid primary key,
  camera text not null,
  detected_at timestamptz not null,
  details jsonb not null,
  reviewed_at timestamptz,
  reviewed_by uuid references os_v11_users(id),
  unique(camera,detected_at)
);

create table if not exists os_v11_goals (
  id uuid primary key,
  platform text not null check (platform in ('music','24h')),
  scope_key text not null,
  period text not null check (period in ('day','week','month')),
  objective text not null,
  created_by uuid not null references os_v11_users(id),
  parent_id uuid references os_v11_goals(id),
  version integer not null default 1,
  section text,
  revision_note text,
  status text not null check (status in ('queued','running','blocked','ready','approved','rejected')),
  step integer not null default 0,
  run_token uuid,
  facts jsonb,
  results jsonb not null default '{}',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parent_id)
);

create table if not exists os_v11_goal_steps (
  goal_id uuid not null references os_v11_goals(id),
  step text not null,
  attempt integer not null,
  state text not null check (state in ('running','succeeded','blocked')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  reason text,
  primary key(goal_id,step,attempt)
);

create table if not exists os_v11_goal_tasks (
  id uuid primary key,
  goal_id uuid not null references os_v11_goals(id),
  assignment jsonb not null,
  status text not null default 'pending' check (status in ('pending','in_progress','submitted','accepted')),
  note text,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists os_v11_signin_rate (
  bucket bigint not null,
  identity_hash text not null,
  attempts integer not null,
  primary key(bucket,identity_hash)
);

create table if not exists os_v11_retail_products (
  location text not null,
  day date not null,
  code text not null,
  name text not null,
  fields jsonb not null,
  source text not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(location,day,code)
);

create table if not exists os_v11_external_evidence (
  id uuid primary key,
  source text not null check (source in ('weather','tourism','market','drive')),
  platform text not null check (platform in ('music','24h')),
  scope_key text not null,
  evidence_at timestamptz not null,
  reference text not null,
  assessment text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  actor_id uuid not null references os_v11_users(id),
  created_at timestamptz not null default now(),
  unique(source,platform,scope_key,evidence_at,reference)
);

create index if not exists os_v11_external_evidence_scope on os_v11_external_evidence(platform,scope_key,evidence_at desc);

create table if not exists public.extra_live_visitors (
 session_id uuid primary key,
 show_id text not null,
 stage text not null check(stage in ('viewing','selecting','payment')),
 last_seen timestamptz not null default now()
);
create index if not exists extra_live_visitors_seen_idx on public.extra_live_visitors(last_seen desc);
create index if not exists extra_live_visitors_show_idx on public.extra_live_visitors(show_id,last_seen desc);
alter table public.extra_live_visitors enable row level security;
revoke all on public.extra_live_visitors from public,anon,authenticated;

create table if not exists public.extra_live_sales (
 staff_id uuid primary key references public.staff_accounts(id) on delete cascade,
 last_seen timestamptz not null default now()
);
create index if not exists extra_live_sales_seen_idx on public.extra_live_sales(last_seen desc);
alter table public.extra_live_sales enable row level security;
revoke all on public.extra_live_sales from public,anon,authenticated;

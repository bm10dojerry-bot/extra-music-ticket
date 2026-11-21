-- Run in Supabase SQL Editor after migrations 001-004.
create table if not exists public.staff_accounts (
 id uuid primary key default gen_random_uuid(),
 username text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
 display_name text not null,
 role text not null check (role in ('admin','sale','show_manager','accountant')),
 password_hash text not null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create index if not exists staff_accounts_role_idx on public.staff_accounts(role);
alter table public.staff_accounts enable row level security;
-- Only service-role server endpoints can read/write credentials.
alter table public.ticket_sales add column if not exists show_id text;
create index if not exists ticket_sales_show_date_idx on public.ticket_sales(show_id,paid_at) where payment_verified=true;

-- Sale pipeline: these are requests only, NOT paid tickets or seat reservations.
create table if not exists public.sale_requests (
 id uuid primary key default gen_random_uuid(),
 show_id text not null,
 customer_name text not null,
 customer_phone text not null,
 requested_seats text[] not null default '{}',
 note text not null default '',
 status text not null default 'new' check (status in ('new','contacted','awaiting_payment','cancelled')),
 created_by uuid not null references public.staff_accounts(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists sale_requests_owner_idx on public.sale_requests(created_by,created_at desc);
alter table public.sale_requests enable row level security;

-- Additional lifecycle states for show managers.
alter table public.managed_shows drop constraint if exists managed_shows_status_check;
alter table public.managed_shows add constraint managed_shows_status_check check (status in ('announced','pending','hidden','sold_out','live','ended'));

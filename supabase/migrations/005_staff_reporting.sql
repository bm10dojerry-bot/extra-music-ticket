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
create index if not exists ticket_sales_show_date_idx on public.ticket_sales(show_id,paid_at) where payment_verified=true;

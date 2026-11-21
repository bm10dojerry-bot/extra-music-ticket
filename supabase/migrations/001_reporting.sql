-- Run in Supabase SQL editor before enabling reporting.
create extension if not exists pgcrypto;
create table if not exists public.ticket_sales (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  event_name text not null,
  venue_name text not null,
  customer_name text not null,
  customer_email text,
  seats text[] not null default '{}',
  amount_vnd bigint not null check (amount_vnd >= 0),
  payment_method text not null,
  seller_name text,
  paid_at timestamptz not null default now(),
  payment_verified boolean not null default false
);
create table if not exists public.report_deliveries (
  delivery_key text primary key,
  created_at timestamptz not null default now()
);
-- Atomic duplicate prevention for concurrent requests. Do not expose to public clients.
create or replace function public.claim_report_delivery(p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.report_deliveries(delivery_key) values (p_key) on conflict do nothing;
  return found;
end $$;
revoke all on function public.claim_report_delivery(text) from public, anon, authenticated;
grant execute on function public.claim_report_delivery(text) to service_role;
alter table public.ticket_sales enable row level security;
alter table public.report_deliveries enable row level security;

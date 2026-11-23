-- Persistent and protected Sale commission rates, adjustable by Admin only via server endpoints.
create table if not exists public.sale_commission_settings (
  id text primary key default 'default' check (id = 'default'),
  rate_1_10 numeric(5,2) not null default 15.00 check (rate_1_10 between 0 and 100),
  rate_11_30 numeric(5,2) not null default 18.00 check (rate_11_30 between 0 and 100),
  rate_31_50 numeric(5,2) not null default 22.00 check (rate_31_50 between 0 and 100),
  rate_51_plus numeric(5,2) not null default 25.00 check (rate_51_plus between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);
insert into public.sale_commission_settings (id, rate_1_10, rate_11_30, rate_31_50, rate_51_plus)
values ('default', 15, 18, 22, 25)
on conflict (id) do nothing;
alter table public.sale_commission_settings enable row level security;
revoke all on table public.sale_commission_settings from public, anon, authenticated;
grant select, update on table public.sale_commission_settings to service_role;

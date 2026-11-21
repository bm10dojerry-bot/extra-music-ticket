create table if not exists public.show_financial_costs (
 show_id text primary key references public.managed_shows(id) on delete restrict,
 artist_fee bigint not null default 0 check (artist_fee >= 0),
 venue_fee bigint not null default 0 check (venue_fee >= 0),
 sound_lighting bigint not null default 0 check (sound_lighting >= 0),
 labor bigint not null default 0 check (labor >= 0),
 advertising bigint not null default 0 check (advertising >= 0),
 band bigint not null default 0 check (band >= 0),
 tax bigint not null default 0 check (tax >= 0),
 sale_commission bigint not null default 0 check (sale_commission >= 0),
 logistics bigint not null default 0 check (logistics >= 0),
 security bigint not null default 0 check (security >= 0),
 miscellaneous bigint not null default 0 check (miscellaneous >= 0),
 notes text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.show_financial_costs enable row level security;
revoke all on public.show_financial_costs from anon, authenticated;
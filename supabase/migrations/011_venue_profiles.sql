create table if not exists public.venue_profiles (venue_id text primary key, biography text not null default '', updated_at timestamptz not null default now());
alter table public.venue_profiles enable row level security;

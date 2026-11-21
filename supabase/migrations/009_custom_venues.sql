create table if not exists public.custom_venues (
 id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
 name text not null,
 city text not null default '',
 address text not null,
 capacity integer not null check (capacity between 1 and 20000),
 description text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.custom_venues enable row level security;

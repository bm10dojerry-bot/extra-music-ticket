-- Run after 003_media_management.sql in Supabase SQL Editor.
create table if not exists public.managed_shows (
 id text primary key check (char_length(id) between 3 and 100),
 artist text not null,
 title text not null,
 show_date date not null,
 show_time text not null,
 venue_id text not null check (venue_id in ('moana','ccc','laocai')),
 status text not null default 'announced' check (status in ('announced','pending','hidden','sold_out')),
 poster_path text,
 prices jsonb not null default '{"A":null,"B":null,"C":null,"D":null}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.managed_shows enable row level security;
-- Public reads go through the server API; writes require server-side administrator authorization.

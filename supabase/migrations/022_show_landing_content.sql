create table if not exists public.show_landing_content (
 show_id text primary key references public.managed_shows(id) on delete cascade,
 introduction text not null default '',
 setlist text not null default '',
 updated_at timestamptz not null default now(),
 constraint show_landing_intro_limit check (char_length(introduction)<=4000),
 constraint show_landing_setlist_limit check (char_length(setlist)<=8000)
);
alter table public.show_landing_content enable row level security;
revoke all on public.show_landing_content from anon,authenticated;
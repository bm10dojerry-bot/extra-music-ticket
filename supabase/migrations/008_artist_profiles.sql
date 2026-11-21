-- Artist profile content is separate from show posters and images.
create table if not exists public.artist_profiles (
 show_id text primary key,
 biography text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.artist_profiles enable row level security;
-- Access is through authenticated server routes with the service-role key.

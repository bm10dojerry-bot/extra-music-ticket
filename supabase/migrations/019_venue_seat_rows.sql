create table if not exists public.venue_seat_rows (
 venue_id text not null,
 row_code text not null check (row_code ~ '^[A-Z]$'),
 seat_count integer not null check (seat_count between 2 and 80),
 updated_at timestamptz not null default now(),
 primary key (venue_id,row_code),
 constraint venue_seat_rows_venue check (venue_id in ('moana','ccc','laocai'))
);
alter table public.venue_seat_rows enable row level security;
revoke all on public.venue_seat_rows from anon,authenticated;
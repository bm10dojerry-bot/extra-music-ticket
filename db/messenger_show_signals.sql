create table public.extra_messenger_show_signals (
  actor_key text not null check (actor_key ~ '^[a-f0-9]{64}$'),
  event_key text not null check (event_key ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('ad','image')),
  occurred_at timestamptz not null,
  expires_at timestamptz not null,
  show_id text,
  media_url text,
  primary key (actor_key, event_key, kind)
);
create index extra_messenger_show_signals_recent on public.extra_messenger_show_signals (actor_key, occurred_at desc);
create index extra_messenger_show_signals_expiry on public.extra_messenger_show_signals (expires_at);
alter table public.extra_messenger_show_signals enable row level security;
revoke all on public.extra_messenger_show_signals from public, anon, authenticated;
grant select, insert, update, delete on public.extra_messenger_show_signals to service_role;

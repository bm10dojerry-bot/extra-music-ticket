-- Server-only GA4 connection. The singleton remains after disconnect so an old
-- OAuth attempt can never recreate credentials after an administrator removed them.
create table if not exists public.extra_google_analytics_connection (
 id text primary key default 'default' check (id='default'),
 version uuid not null default gen_random_uuid(),
 refresh_token_cipher text check (refresh_token_cipher is null or length(refresh_token_cipher) between 40 and 12000),
 property_id text check (property_id is null or property_id ~ '^[1-9][0-9]{0,19}$'),
 property_name text not null default '',
 stream_id text check (stream_id is null or stream_id ~ '^[1-9][0-9]{0,19}$'),
 stream_name text not null default '',
 site_url text not null default '',
 measurement_id text not null default '' check (measurement_id='' or measurement_id ~ '^G-[A-Z0-9]{6,20}$'),
 connected_by text,
 connected_at timestamptz,
 updated_at timestamptz not null default now(),
 check ((refresh_token_cipher is null)=(connected_at is null)),
 check ((property_id is null and stream_id is null and measurement_id='') or
        (property_id is not null and stream_id is not null and measurement_id<>'' and refresh_token_cipher is not null))
);
insert into public.extra_google_analytics_connection(id) values ('default') on conflict(id) do nothing;
alter table public.extra_google_analytics_connection enable row level security;
revoke all on public.extra_google_analytics_connection from public,anon,authenticated;
grant select,insert,update,delete on public.extra_google_analytics_connection to service_role;

create table if not exists public.extra_google_analytics_oauth_attempts (
 state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
 browser_hash text not null check (browser_hash ~ '^[a-f0-9]{64}$'),
 verifier_cipher text not null check (length(verifier_cipher) between 40 and 12000),
 expected_version uuid not null,
 authorized_by text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check (expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
create index if not exists extra_google_analytics_oauth_expiry_idx on public.extra_google_analytics_oauth_attempts(expires_at);
alter table public.extra_google_analytics_oauth_attempts enable row level security;
revoke all on public.extra_google_analytics_oauth_attempts from public,anon,authenticated;
grant select,insert,delete on public.extra_google_analytics_oauth_attempts to service_role;

create or replace function public.extra_start_google_analytics_oauth(p_state_hash text,p_browser_hash text,p_verifier_cipher text,p_authorized_by text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_version uuid;
begin
 select version into v_version from public.extra_google_analytics_connection where id='default';
 if v_version is null then return false; end if;
 delete from public.extra_google_analytics_oauth_attempts where expires_at<=now();
 insert into public.extra_google_analytics_oauth_attempts(state_hash,browser_hash,verifier_cipher,expected_version,authorized_by,expires_at)
 values(p_state_hash,p_browser_hash,p_verifier_cipher,v_version,p_authorized_by,now()+interval '10 minutes');
 return true;
end $$;

-- DELETE ... RETURNING atomically claims an attempt once, before exchanging its
-- code with Google. Failed browser bindings do not consume another browser's state.
create or replace function public.extra_consume_google_analytics_oauth(p_state_hash text,p_browser_hash text)
returns table(verifier_cipher text,expected_version uuid,authorized_by text)
language sql security invoker set search_path=public as $$
 delete from public.extra_google_analytics_oauth_attempts a
 where a.state_hash=p_state_hash and a.browser_hash=p_browser_hash
 and a.expires_at>now() and a.created_at>=now()-interval '10 minutes'
 returning a.verifier_cipher,a.expected_version,a.authorized_by;
$$;

create or replace function public.extra_finish_google_analytics_oauth(p_expected_version uuid,p_refresh_cipher text,p_authorized_by text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.extra_google_analytics_connection set
 version=gen_random_uuid(),refresh_token_cipher=p_refresh_cipher,
 property_id=null,property_name='',stream_id=null,stream_name='',site_url='',measurement_id='',
 connected_by=p_authorized_by,connected_at=now(),updated_at=now()
 where id='default' and version=p_expected_version;
 return found;
end $$;

create or replace function public.extra_select_google_analytics_stream(p_expected_version uuid,p_property_id text,p_property_name text,p_stream_id text,p_stream_name text,p_site_url text,p_measurement_id text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.extra_google_analytics_connection set version=gen_random_uuid(),
 property_id=p_property_id,property_name=p_property_name,stream_id=p_stream_id,stream_name=p_stream_name,
 site_url=p_site_url,measurement_id=p_measurement_id,updated_at=now()
 where id='default' and version=p_expected_version and refresh_token_cipher is not null;
 return found;
end $$;

create or replace function public.extra_disconnect_google_analytics()
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.extra_google_analytics_connection set version=gen_random_uuid(),refresh_token_cipher=null,
 property_id=null,property_name='',stream_id=null,stream_name='',site_url='',measurement_id='',
 connected_by=null,connected_at=null,updated_at=now() where id='default';
 delete from public.extra_google_analytics_oauth_attempts;
 return true;
end $$;

revoke all on function public.extra_start_google_analytics_oauth(text,text,text,text) from public,anon,authenticated;
revoke all on function public.extra_consume_google_analytics_oauth(text,text) from public,anon,authenticated;
revoke all on function public.extra_finish_google_analytics_oauth(uuid,text,text) from public,anon,authenticated;
revoke all on function public.extra_select_google_analytics_stream(uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.extra_disconnect_google_analytics() from public,anon,authenticated;
grant execute on function public.extra_start_google_analytics_oauth(text,text,text,text) to service_role;
grant execute on function public.extra_consume_google_analytics_oauth(text,text) to service_role;
grant execute on function public.extra_finish_google_analytics_oauth(uuid,text,text) to service_role;
grant execute on function public.extra_select_google_analytics_stream(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.extra_disconnect_google_analytics() to service_role;

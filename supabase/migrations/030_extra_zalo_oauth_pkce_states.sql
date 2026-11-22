create table if not exists public.extra_zalo_oauth_attempts (
 state_hash text primary key,
 code_verifier text not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.extra_zalo_oauth_attempts enable row level security;
revoke all on public.extra_zalo_oauth_attempts from anon,authenticated;
create or replace function public.extra_consume_zalo_oauth_state(p_hash text)
returns text language plpgsql security definer set search_path=public as $$
declare v_verifier text;
begin
 update public.extra_zalo_oauth_attempts
 set consumed_at=now()
 where state_hash=p_hash and consumed_at is null and expires_at>now()
 returning code_verifier into v_verifier;
 return v_verifier;
end $$;
revoke all on function public.extra_consume_zalo_oauth_state(text) from public,anon,authenticated;
grant execute on function public.extra_consume_zalo_oauth_state(text) to service_role;
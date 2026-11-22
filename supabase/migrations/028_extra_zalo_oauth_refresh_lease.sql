alter table public.extra_zalo_oauth_tokens add column if not exists refresh_lease_until timestamptz;
create or replace function public.extra_claim_zalo_refresh()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.extra_zalo_oauth_tokens(singleton,access_token,refresh_token,expires_at)
 values(true,'','','epoch'::timestamptz) on conflict(singleton) do nothing;
 update public.extra_zalo_oauth_tokens
 set refresh_lease_until=now()+interval '30 seconds'
 where singleton=true and (refresh_lease_until is null or refresh_lease_until<now()) and expires_at<now()+interval '5 minutes';
 return found;
end $$;
revoke all on function public.extra_claim_zalo_refresh() from public,anon,authenticated;
grant execute on function public.extra_claim_zalo_refresh() to service_role;
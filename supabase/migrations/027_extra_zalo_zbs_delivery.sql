create table if not exists public.extra_zalo_delivery (
 order_code text primary key references public.extra_payment_orders(code) on delete cascade,
 status text not null default 'pending' check (status in ('pending','sending','accepted','failed','disabled')),
 attempts integer not null default 0,
 last_attempt_at timestamptz,
 accepted_at timestamptz,
 provider_message_id text,
 last_error text,
 updated_at timestamptz not null default now()
);
alter table public.extra_zalo_delivery enable row level security;
revoke all on public.extra_zalo_delivery from anon,authenticated;
create table if not exists public.extra_zalo_oauth_tokens (
 singleton boolean primary key default true check(singleton),
 access_token text not null,
 refresh_token text not null,
 expires_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.extra_zalo_oauth_tokens enable row level security;
revoke all on public.extra_zalo_oauth_tokens from anon,authenticated;
create or replace function public.extra_claim_zalo_delivery(p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.extra_zalo_delivery(order_code) select code from public.extra_payment_orders where code=p_code and status='paid' on conflict do nothing;
 update public.extra_zalo_delivery d
 set status='sending',attempts=attempts+1,last_attempt_at=now(),updated_at=now()
 where d.order_code=p_code and d.attempts<5
 and (d.status in ('pending','failed') or (d.status='sending' and d.last_attempt_at<now()-interval '10 minutes'))
 and exists(select 1 from public.extra_payment_orders o where o.code=p_code and o.status='paid');
 return found;
end $$;
revoke all on function public.extra_claim_zalo_delivery(text) from public,anon,authenticated;
grant execute on function public.extra_claim_zalo_delivery(text) to service_role;
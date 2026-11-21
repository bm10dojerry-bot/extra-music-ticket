create table if not exists public.extra_order_attribution (
 order_code text primary key references public.extra_payment_orders(code) on delete cascade,
 show_id text not null,
 consent boolean not null default false,
 fbp text not null default '',
 fbc text not null default '',
 landing_path text not null default '',
 utm_source text not null default '',
 utm_campaign text not null default '',
 capi_status text not null default 'pending' check (capi_status in ('pending','sending','sent','failed','skipped')),
 capi_attempts integer not null default 0,
 capi_last_attempt_at timestamptz,
 capi_sent_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists extra_order_attribution_show_idx on public.extra_order_attribution(show_id);
alter table public.extra_order_attribution enable row level security;
revoke all on public.extra_order_attribution from anon,authenticated;
create or replace function public.extra_claim_capi_purchase(p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.extra_order_attribution a set capi_status='sending',capi_attempts=capi_attempts+1,capi_last_attempt_at=now()
 where a.order_code=p_code and a.consent=true and a.capi_attempts<5
 and (a.capi_status in ('pending','failed') or (a.capi_status='sending' and a.capi_last_attempt_at<now()-interval '10 minutes'))
 and exists(select 1 from public.extra_payment_orders o where o.code=p_code and o.status='paid');
 return found;
end $$;
revoke all on function public.extra_claim_capi_purchase(text) from public,anon,authenticated;
grant execute on function public.extra_claim_capi_purchase(text) to service_role;
create table if not exists public.extra_landing_funnel (
 show_id text not null,
 session_id uuid not null,
 event_name text not null check (event_name in ('view','checkout')),
 created_at timestamptz not null default now(),
 primary key(show_id,session_id,event_name)
);
create index if not exists extra_landing_funnel_show_idx on public.extra_landing_funnel(show_id,event_name);
alter table public.extra_landing_funnel enable row level security;
revoke all on public.extra_landing_funnel from anon,authenticated;
create table if not exists public.extra_sms_delivery (
 order_code text primary key references public.extra_payment_orders(code) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','accepted','delivered','failed','unknown')),
 attempts integer not null default 0,
 last_attempt_at timestamptz,
 accepted_at timestamptz,
 provider_transaction_id text,
 provider_sms_count integer,
 provider_price numeric,
 last_error text,
 updated_at timestamptz not null default now()
);
alter table public.extra_sms_delivery enable row level security;
revoke all on public.extra_sms_delivery from anon,authenticated;
create index if not exists extra_sms_delivery_status_idx on public.extra_sms_delivery(status,updated_at);
create or replace function public.extra_claim_sms_delivery(p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.extra_sms_delivery(order_code)
 select code from public.extra_payment_orders where code=p_code and status='paid'
 on conflict do nothing;
 update public.extra_sms_delivery d
 set status='sending',attempts=attempts+1,last_attempt_at=now(),updated_at=now()
 where d.order_code=p_code and d.attempts<3 and d.status in ('pending','failed')
 and exists(select 1 from public.extra_payment_orders o where o.code=p_code and o.status='paid');
 return found;
end $$;
revoke all on function public.extra_claim_sms_delivery(text) from public,anon,authenticated;
grant execute on function public.extra_claim_sms_delivery(text) to service_role;
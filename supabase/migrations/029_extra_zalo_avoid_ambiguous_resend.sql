create or replace function public.extra_claim_zalo_delivery(p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.extra_zalo_delivery(order_code) select code from public.extra_payment_orders where code=p_code and status='paid' on conflict do nothing;
 update public.extra_zalo_delivery d
 set status='sending',attempts=attempts+1,last_attempt_at=now(),updated_at=now()
 where d.order_code=p_code and d.attempts<5 and d.status in ('pending','failed')
 and exists(select 1 from public.extra_payment_orders o where o.code=p_code and o.status='paid');
 return found;
end $$;
revoke all on function public.extra_claim_zalo_delivery(text) from public,anon,authenticated;
grant execute on function public.extra_claim_zalo_delivery(text) to service_role;
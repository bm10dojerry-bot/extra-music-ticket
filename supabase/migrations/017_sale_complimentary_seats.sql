-- 017: Allow up to 20 purchased seats plus 3 complimentary seats in one atomic reservation.
-- All seats remain in the same order and ticket issuance path.
create or replace function public.extra_reserve_order(p_code text,p_token text,p_show text,p_venue text,p_seats text[],p_amount bigint,p_name text,p_phone text,p_email text)
returns table(order_code text,expires_at timestamptz) language plpgsql security definer set search_path=public as $$
declare taken text[];
begin
 if cardinality(p_seats) is null or cardinality(p_seats)<1 or cardinality(p_seats)>23 or cardinality(p_seats)<> (select count(distinct x) from unnest(p_seats) x) then raise exception 'Invalid seats';end if;
 perform pg_advisory_xact_lock(hashtext(p_show));
 select array_agg(distinct x) into taken from (
  select unnest(e.seats) x from public.extra_payment_orders e where e.show_id=p_show and (e.status='paid' or (e.status='pending' and e.expires_at>now()))
  union all
  select unnest(seats) x from public.ticket_sales where show_id=p_show and payment_verified=true
 ) q;
 if p_seats && coalesce(taken,array[]::text[]) then raise exception 'Seats already reserved';end if;
 insert into public.extra_payment_orders(code,access_token,show_id,venue_id,seats,amount_vnd,buyer_name,buyer_phone,buyer_email)
 values(p_code,p_token,p_show,p_venue,p_seats,p_amount,p_name,p_phone,p_email);
 return query select o.code,o.expires_at from public.extra_payment_orders o where o.code=p_code;
end $$;
revoke all on function public.extra_reserve_order(text,text,text,text,text[],bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.extra_reserve_order(text,text,text,text,text[],bigint,text,text,text) to service_role;

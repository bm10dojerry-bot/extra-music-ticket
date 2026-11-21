create table if not exists public.extra_show_blocked_seats(
 show_id text not null references public.managed_shows(id) on delete cascade,
 seat_id text not null,
 created_at timestamptz not null default now(),
 primary key(show_id,seat_id)
);
create index if not exists extra_show_blocked_seats_show_idx on public.extra_show_blocked_seats(show_id);
alter table public.extra_show_blocked_seats enable row level security;
revoke all on public.extra_show_blocked_seats from anon,authenticated;

create or replace function public.extra_set_show_seat_block(p_show text,p_seat text,p_block boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext(p_show));
 if not exists(select 1 from public.managed_shows where id=p_show) then raise exception 'Unknown show';end if;
 if p_block then
  if exists(select 1 from public.extra_payment_orders where show_id=p_show and (status='paid' or (status='pending' and expires_at>now())) and p_seat=any(seats))
    or exists(select 1 from public.ticket_sales where show_id=p_show and payment_verified=true and p_seat=any(seats))
  then raise exception 'Seat already sold or held';end if;
  insert into public.extra_show_blocked_seats(show_id,seat_id) values(p_show,p_seat) on conflict do nothing;
 else
  delete from public.extra_show_blocked_seats where show_id=p_show and seat_id=p_seat;
 end if;
 return true;
end $$;
revoke all on function public.extra_set_show_seat_block(text,text,boolean) from public,anon,authenticated;
grant execute on function public.extra_set_show_seat_block(text,text,boolean) to service_role;

create or replace function public.extra_reserve_order(p_code text,p_token text,p_show text,p_venue text,p_seats text[],p_amount bigint,p_name text,p_phone text,p_email text)
returns table(order_code text,expires_at timestamptz) language plpgsql security definer set search_path=public as $$
declare taken text[];
begin
 if cardinality(p_seats) is null or cardinality(p_seats)<1 or cardinality(p_seats)>23 or cardinality(p_seats)<>(select count(distinct x) from unnest(p_seats) x) then raise exception 'Invalid seats';end if;
 perform pg_advisory_xact_lock(hashtext(p_show));
 if exists(select 1 from public.extra_show_blocked_seats b where b.show_id=p_show and b.seat_id=any(p_seats)) then raise exception 'Seats blocked by admin';end if;
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
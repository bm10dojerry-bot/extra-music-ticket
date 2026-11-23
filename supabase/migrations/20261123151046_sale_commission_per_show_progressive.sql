-- Independent show policies and immutable checkout price/gift details.
-- Existing payment, seat locking, ticket issuance and the old API remain usable
-- while the application deployment changes to the atomic wrapper below.
create or replace function public.extra_valid_commission_tiers(p_tiers jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public as $$
declare tier jsonb; previous numeric:=0; upper_bound numeric; percentage numeric;
begin
 if jsonb_typeof(p_tiers) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_tiers)<1 or jsonb_array_length(p_tiers)>12 then return false; end if;
 for tier in select value from jsonb_array_elements(p_tiers) loop
  if jsonb_typeof(tier) is distinct from 'object' or jsonb_typeof(tier->'maxTickets') is distinct from 'number' or jsonb_typeof(tier->'rate') is distinct from 'number' then return false; end if;
  upper_bound:=(tier->>'maxTickets')::numeric; percentage:=(tier->>'rate')::numeric;
  if upper_bound<>trunc(upper_bound) or upper_bound<=previous or upper_bound>10000 or percentage<0 or percentage>100 or percentage<>round(percentage,2) then return false; end if;
  previous:=upper_bound;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.extra_valid_commission_tiers(jsonb) from public,anon,authenticated;
grant execute on function public.extra_valid_commission_tiers(jsonb) to service_role;

create table public.sale_commission_policies (
 show_id text primary key references public.managed_shows(id) on delete cascade,
 tiers jsonb not null check(public.extra_valid_commission_tiers(tiers)),
 version uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now(),
 updated_by text not null default 'system'
);
alter table public.sale_commission_policies enable row level security;
revoke all on public.sale_commission_policies from public,anon,authenticated;
grant select,insert,update on public.sale_commission_policies to service_role;
insert into public.sale_commission_policies(show_id,tiers,updated_by)
select id,'[{"maxTickets":10,"rate":15},{"maxTickets":30,"rate":18},{"maxTickets":50,"rate":22},{"maxTickets":550,"rate":25}]'::jsonb,'system:progressive-policy-2026-11-23'
from public.managed_shows;

create or replace function public.extra_save_sale_commission_policy(p_show_id text,p_tiers jsonb,p_expected_version uuid,p_updated_by text)
returns setof public.sale_commission_policies language plpgsql security invoker set search_path=public as $$
begin
 if not public.extra_valid_commission_tiers(p_tiers) then raise exception 'Invalid commission tiers'; end if;
 if p_updated_by is null or length(p_updated_by)<1 or length(p_updated_by)>200 then raise exception 'Invalid actor'; end if;
 if p_expected_version is null then
  return query insert into public.sale_commission_policies(show_id,tiers,updated_by)
   values(p_show_id,p_tiers,p_updated_by) on conflict(show_id) do nothing returning *;
 else
  return query update public.sale_commission_policies set tiers=p_tiers,version=gen_random_uuid(),updated_at=clock_timestamp(),updated_by=p_updated_by
   where show_id=p_show_id and version=p_expected_version returning *;
 end if;
end $$;
revoke all on function public.extra_save_sale_commission_policy(text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.extra_save_sale_commission_policy(text,jsonb,uuid,text) to service_role;

create or replace function public.extra_valid_commission_lines(p_lines jsonb,p_seats text[],p_amount bigint)
returns boolean language plpgsql immutable security invoker set search_path=public as $$
declare line jsonb; net numeric; total numeric:=0; visited text[]:=array[]::text[]; seat_code text;
begin
 if jsonb_typeof(p_lines) is distinct from 'array' or p_amount is null or p_amount<0 or cardinality(p_seats) is null or cardinality(p_seats)<1 then return false; end if;
 if jsonb_array_length(p_lines)<>cardinality(p_seats) then return false; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(line) is distinct from 'object' or jsonb_typeof(line->'seat') is distinct from 'string' or jsonb_typeof(line->'netAmount') is distinct from 'number' then return false; end if;
  seat_code:=line->>'seat';net:=(line->>'netAmount')::numeric;
  if not(seat_code=any(p_seats)) or seat_code=any(visited) or net<0 or net>9007199254740991 or net<>trunc(net) then return false; end if;
  visited:=array_append(visited,seat_code);total:=total+net;
 end loop;
 return total=p_amount;
exception when others then return false;
end $$;
revoke all on function public.extra_valid_commission_lines(jsonb,text[],bigint) from public,anon,authenticated;
grant execute on function public.extra_valid_commission_lines(jsonb,text[],bigint) to service_role;

alter table public.extra_payment_orders add column commission_lines jsonb,add column commission_basis text;
alter table public.extra_payment_orders add constraint extra_payment_order_commission_lines_valid check(commission_lines is null or public.extra_valid_commission_lines(commission_lines,seats,amount_vnd));
alter table public.ticket_sales add column commission_lines jsonb,add column commission_basis text;
alter table public.ticket_sales add constraint ticket_sale_commission_lines_valid check(commission_lines is null or public.extra_valid_commission_lines(commission_lines,seats,amount_vnd));

create or replace function public.extra_reserve_order_with_commission(p_code text,p_token text,p_show text,p_venue text,p_seats text[],p_amount bigint,p_name text,p_phone text,p_email text,p_commission_lines jsonb)
returns table(order_code text,expires_at timestamptz) language plpgsql security invoker set search_path=public as $$
begin
 if not public.extra_valid_commission_lines(p_commission_lines,p_seats,p_amount) then raise exception 'Invalid commission snapshot'; end if;
 return query select * from public.extra_reserve_order(p_code,p_token,p_show,p_venue,p_seats,p_amount,p_name,p_phone,p_email);
 update public.extra_payment_orders set commission_lines=p_commission_lines,commission_basis='checkout' where code=p_code;
 if not found then raise exception 'Reservation snapshot failed'; end if;
end $$;
revoke all on function public.extra_reserve_order_with_commission(text,text,text,text,text[],bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.extra_reserve_order_with_commission(text,text,text,text,text[],bigint,text,text,text,jsonb) to service_role;

-- Historical rows: all seats in the same row had the same checkout price.
-- Exclude 6/12/23-seat orders because these counts can include promotion gifts.
-- Do not reconstruct mixed-price or ambiguous gifts from today's price list.
update public.extra_payment_orders o set commission_lines=(
 select jsonb_agg(jsonb_build_object('seat',s.seat,'netAmount',o.amount_vnd/cardinality(o.seats)+case when s.position<=o.amount_vnd%cardinality(o.seats) then 1 else 0 end) order by s.seat)
 from (select seat,row_number() over(order by seat) as position from unnest(o.seats) seat) s
),commission_basis='legacy_same_row'
where o.commission_lines is null and not o.is_vip_invitation and o.amount_vnd>=cardinality(o.seats)
 and cardinality(o.seats) between 1 and 12 and cardinality(o.seats) not in(6,12)
 and not exists(select 1 from unnest(o.seats) seat where seat !~ '^[A-Z][0-9]+$')
 and (select count(distinct regexp_replace(seat,'[0-9]+$','')) from unnest(o.seats) seat)=1;

-- Free invitation rows are unambiguous and never consume a paid-ticket ordinal.
update public.extra_payment_orders o set commission_lines=(select jsonb_agg(jsonb_build_object('seat',seat,'netAmount',0) order by seat) from unnest(o.seats) seat),commission_basis='free'
where commission_lines is null and amount_vnd=0;

-- Recover old same-row promotion orders only when the persisted show price was
-- last updated BEFORE checkout, its venue still matches, and exactly one allowed
-- checkout price/count matches the paid total. The checkout appended gift seats.
-- Changed-price, mixed-row and unmatched orders deliberately remain unresolved.
with historical as (
 select o.code,o.seats,o.amount_vnd,cardinality(o.seats) as seat_count,s.prices,
  ascii(left(o.seats[1],1))-ascii('A') as row_number,o.venue_id
 from public.extra_payment_orders o join public.managed_shows s on s.id=o.show_id
 where o.commission_lines is null and not o.is_vip_invitation and o.amount_vnd>0
  and cardinality(o.seats) in(6,12,23) and s.updated_at<=o.created_at and s.venue_id=o.venue_id
  and o.venue_id in('ccc','moana','laocai')
  and not exists(select 1 from unnest(o.seats) seat where seat !~ '^[A-Z][0-9]+$')
  and (select count(distinct left(seat,1)) from unnest(o.seats) seat)=1
), zones as (
 select *,case when venue_id='laocai' then case when row_number<3 then 'A' when row_number<6 then 'B' when row_number<10 then 'C' else 'D' end
  when venue_id='ccc' then case when row_number<2 then 'A' when row_number<4 then 'B' when row_number<8 then 'C' else 'D' end
  else case when row_number<3 then 'A' when row_number<5 then 'B' when row_number<8 then 'C' else 'D' end end as zone
 from historical where row_number between 0 and case venue_id when 'laocai' then 14 when 'ccc' then 10 else 12 end
), priced as (
 select *,case when jsonb_typeof(prices->zone)='number' then (prices->>zone)::numeric else null end as price from zones
), matched as (
 select *,case when seat_count<=12 and amount_vnd=seat_count*price then seat_count
  when seat_count=6 and amount_vnd=5*price then 5
  when seat_count=12 and amount_vnd=10*price then 10
  when seat_count=23 and amount_vnd=20*price then 20 else null end as paid_count
 from priced where price>0 and price=trunc(price)
)
update public.extra_payment_orders o set commission_lines=(
 select jsonb_agg(jsonb_build_object('seat',x.seat,'netAmount',case when x.position<=m.paid_count then m.price else 0 end) order by x.position)
 from unnest(m.seats) with ordinality as x(seat,position)
),commission_basis='reconstructed_checkout'
from matched m where o.code=m.code and m.paid_count is not null and o.commission_lines is null;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_price_quote(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 s public.managed_shows%rowtype;
 child_seats text[]; paid_seats text[]; gifts text[]; all_seats text[]; promo text;
 customer_name text; customer_phone text; customer_email text;
 seat text; row_index integer; seat_number integer; row_size integer; default_size integer;
 zone text; zone_rank integer; lowest_rank integer:=0; price numeric; gross numeric:=0; total numeric;
 prices jsonb:='[]'::jsonb; lines jsonb; seen text[]:=array[]::text[];
 venue_name text; venue_address text; v_now timestamptz:=now();
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(coalesce(p_input->'childSeats','[]'::jsonb)) is distinct from 'array'
  or jsonb_typeof(p_input->'seats') is distinct from 'array'
  or jsonb_typeof(coalesce(p_input->'giftSeats','[]'::jsonb)) is distinct from 'array'
  or exists(select 1 from jsonb_array_elements(p_input->'seats') x where jsonb_typeof(x) is distinct from 'string')
  or exists(select 1 from jsonb_array_elements(coalesce(p_input->'giftSeats','[]'::jsonb)) x where jsonb_typeof(x) is distinct from 'string')
 then raise exception 'AI_INVALID_QUOTE'; end if;
 select coalesce(array_agg(value order by ord),array[]::text[]) into paid_seats from jsonb_array_elements_text(p_input->'seats') with ordinality as x(value,ord);
 select coalesce(array_agg(value order by ord),array[]::text[]) into gifts from jsonb_array_elements_text(coalesce(p_input->'giftSeats','[]'::jsonb)) with ordinality as x(value,ord);
 select coalesce(array_agg(value order by value),array[]::text[]) into child_seats from jsonb_array_elements_text(coalesce(p_input->'childSeats','[]'::jsonb));
 if not (child_seats <@ paid_seats) or cardinality(child_seats)<>(select count(distinct x) from unnest(child_seats) x) then raise exception 'AI_INVALID_CHILD_SEAT'; end if;
 all_seats:=paid_seats||gifts;promo:=coalesce(p_input->>'promotion','none');
 customer_name:=trim(coalesce(p_input->>'name',''));customer_phone:=trim(coalesce(p_input->>'phone',''));customer_email:=trim(coalesce(p_input->>'email',''));
 if cardinality(paid_seats)<1 or cardinality(paid_seats)>20 or cardinality(gifts)>3
  or cardinality(all_seats)<>(select count(distinct x) from unnest(all_seats) x)
  or length(customer_name)<2 or length(customer_name)>120 or customer_name ~ E'[\r\n]'
  or customer_phone !~ '^[0-9+(). -]{9,20}$'
  or length(customer_email)>254 or customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or coalesce(p_input->>'showId','') !~ '^[a-z0-9-]{3,100}$'
 then raise exception 'AI_INVALID_QUOTE'; end if;
 if not (
  (promo='none' and cardinality(paid_seats)<=12 and cardinality(gifts)=0)
  or (promo='couple5' and cardinality(paid_seats)=2 and cardinality(gifts)=0)
  or (promo='buy5' and cardinality(paid_seats)=5 and cardinality(gifts)=1)
  or (promo='buy10' and cardinality(paid_seats)=10 and cardinality(gifts)=2)
  or (promo='buy20' and cardinality(paid_seats)=20 and cardinality(gifts)=3)
 ) then raise exception 'AI_INVALID_PROMOTION'; end if;
 select * into s from public.managed_shows where id=p_input->>'showId' for share;
 if not found or s.status<>'announced' or s.venue_id not in('ccc','moana','laocai')
  or ((s.show_date::text||' '||s.show_time::text)::timestamp at time zone 'Asia/Ho_Chi_Minh')<=v_now
 then raise exception 'AI_SHOW_CLOSED'; end if;
 foreach seat in array all_seats loop
  if seat !~ '^[A-O][0-9]{2}$' then raise exception 'AI_INVALID_SEAT'; end if;
  row_index:=ascii(left(seat,1))-ascii('A');seat_number:=substring(seat from 2)::integer;
  if row_index<0 or row_index>(case s.venue_id when 'ccc' then 10 when 'laocai' then 14 else 12 end) then raise exception 'AI_INVALID_SEAT'; end if;
  default_size:=case s.venue_id when 'ccc' then 50 when 'laocai' then 40 else case row_index when 0 then 25 when 1 then 35 when 2 then 45 when 10 then 50 when 11 then 50 when 12 then 15 else 40 end end;
  select seat_count into row_size from public.venue_seat_rows where venue_id=s.venue_id and row_code=left(seat,1) for share;
  if row_size is null or row_size<2 or row_size>80 then row_size:=default_size; end if;
  if seat_number<1 or seat_number>row_size then raise exception 'AI_INVALID_SEAT'; end if;
  zone:=case s.venue_id
    when 'ccc' then case when row_index<2 then 'A' when row_index<4 then 'B' when row_index<8 then 'C' else 'D' end
    when 'laocai' then case when row_index<3 then 'A' when row_index<6 then 'B' when row_index<10 then 'C' else 'D' end
    else case when row_index<3 then 'A' when row_index<5 then 'B' when row_index<8 then 'C' else 'D' end end;
  zone_rank:=ascii(zone)-ascii('A');
  if seat=any(paid_seats) then
   if jsonb_typeof(s.prices->zone) is distinct from 'number' then raise exception 'AI_PRICE_UNAVAILABLE'; end if;
   price:=(s.prices->>zone)::numeric;
   if price<=0 or price<>trunc(price) or price>9007199254740991 then raise exception 'AI_PRICE_UNAVAILABLE'; end if;
   if seat=any(child_seats) then price:=round(price*70/100); end if;
   gross:=gross+price;lowest_rank:=greatest(lowest_rank,zone_rank);
   prices:=prices||jsonb_build_array(jsonb_build_object('seat',seat,'price',price,'zone',zone));
  end if;
  seen:=array_append(seen,seat);
 end loop;
 foreach seat in array gifts loop
  row_index:=ascii(left(seat,1))-ascii('A');
  zone_rank:=case s.venue_id
    when 'ccc' then case when row_index<2 then 0 when row_index<4 then 1 when row_index<8 then 2 else 3 end
    when 'laocai' then case when row_index<3 then 0 when row_index<6 then 1 when row_index<10 then 2 else 3 end
    else case when row_index<3 then 0 when row_index<5 then 1 when row_index<8 then 2 else 3 end end;
  if zone_rank<lowest_rank then raise exception 'AI_INVALID_PROMOTION'; end if;
 end loop;
 total:=case when promo='couple5' then round(gross*95/100) else gross end;
 if total<cardinality(paid_seats) or total>9007199254740991 then raise exception 'AI_PRICE_UNAVAILABLE'; end if;
 -- Same largest-remainder proportional snapshot as allocateSaleCommissionLines.
 with weighted as (
  select x->>'seat' as seat,trunc(total*(x->>'price')::numeric/gross) as net,
   mod(total*(x->>'price')::numeric,gross) as remainder
  from jsonb_array_elements(prices) x
 ), ranked as (
  select w.*,row_number() over(order by w.remainder desc,w.seat asc) as priority,
   total-sum(w.net) over() as to_allocate from weighted w
 ), final_lines as (
  select r.seat,r.net+case when r.priority<=r.to_allocate then 1 else 0 end as amount from ranked r
  union all select gift,0 from unnest(gifts) gift
 ) select jsonb_agg(jsonb_build_object('seat',f.seat,'netAmount',f.amount) order by f.seat) into lines from final_lines f;
 venue_name:=case s.venue_id when 'ccc' then 'Không gian Văn hóa Sa Pa – CCC' when 'moana' then 'Moana Sa Pa' else '+1 Extra Music Show Lào Cai' end;
 venue_address:=case s.venue_id when 'ccc' then '002 Phan Xi Păng, Sa Pa, Lào Cai' when 'moana' then '68 Violet, Sa Pa, Lào Cai' else '68P Phú Thịnh, Cam Đường, Lào Cai' end;
 return jsonb_build_object('showId',s.id,'venueId',s.venue_id,'artist',s.artist,'title',s.title,'date',s.show_date::text,'time',left(s.show_time::text,5),
  'venueName',venue_name,'venueAddress',venue_address,'seats',to_jsonb(paid_seats),'giftSeats',to_jsonb(gifts),'promotion',promo,
  'name',customer_name,'phone',customer_phone,'email',customer_email,'amount',total,'commissionLines',lines) || case when cardinality(child_seats)>0 then jsonb_build_object('childSeats',child_seats) else '{}'::jsonb end;
end $function$;

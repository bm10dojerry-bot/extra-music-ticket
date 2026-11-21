-- SePay payment orders. Apply in Supabase SQL Editor before enabling checkout.
create table if not exists public.extra_payment_orders (
 id uuid primary key default gen_random_uuid(),
 access_token text not null unique, 
 code text not null unique check(code ~ '^EX[0-9A-F]{16}$'),
 show_id text not null,
 venue_id text not null,
 seats text[] not null,
 amount_vnd bigint not null check(amount_vnd>0),
 buyer_name text not null,
 buyer_phone text not null,
 buyer_email text not null,
 status text not null default 'pending' check(status in ('pending','paid','expired','review')),
 expires_at timestamptz not null default(now()+interval '15 minutes'),
 sepay_transaction_id bigint unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create unique index if not exists extra_payment_orders_sepay_tx on public.extra_payment_orders(sepay_transaction_id) where sepay_transaction_id is not null;
create table if not exists public.extra_payment_events (
 transaction_id bigint primary key,
 order_code text,
 amount_vnd bigint not null,
 payload jsonb not null,
 received_at timestamptz not null default now(),
 outcome text not null default 'received'
);
alter table public.extra_payment_orders enable row level security;
alter table public.extra_payment_events enable row level security;
-- Serialize reservations per show and check both paid sales and active holds.
create or replace function public.extra_reserve_order(p_code text,p_token text,p_show text,p_venue text,p_seats text[],p_amount bigint,p_name text,p_phone text,p_email text)
returns table(order_code text,expires_at timestamptz) language plpgsql security definer set search_path=public as $$
declare taken text[];
begin
 if cardinality(p_seats) is null or cardinality(p_seats)<1 or cardinality(p_seats)>12 or cardinality(p_seats)<> (select count(distinct x) from unnest(p_seats) x) then raise exception 'Invalid seats';end if;
 perform pg_advisory_xact_lock(hashtext(p_show));
 select array_agg(distinct x) into taken from (
  select unnest(seats) x from public.extra_payment_orders where show_id=p_show and (status='paid' or (status='pending' and expires_at>now()))
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
-- Webhook records every verified event; late/incorrect transfers are held for manual review.
create or replace function public.extra_confirm_payment(p_tx bigint,p_code text,p_amount bigint,p_payload jsonb)
returns text language plpgsql security definer set search_path=public as $$
declare o public.extra_payment_orders%rowtype; existing text; outcome text;
begin
 select outcome into existing from public.extra_payment_events where transaction_id=p_tx;
 if found then return existing;end if;
 select * into o from public.extra_payment_orders where code=p_code for update;
 if not found then outcome:='unmatched';
 elsif o.status='paid' then outcome:='already_paid';
 elsif o.status<>'pending' or o.expires_at<=now() then outcome:='late_review';
 elsif o.amount_vnd<>p_amount then outcome:='amount_review';
 else
  perform pg_advisory_xact_lock(hashtext(o.show_id));
  if exists(select 1 from public.ticket_sales t where t.show_id=o.show_id and t.payment_verified=true and t.seats && o.seats)
   or exists(select 1 from public.extra_payment_orders e where e.show_id=o.show_id and e.status='paid' and e.id<>o.id and e.seats && o.seats)
  then outcome:='seat_conflict_review';
  else update public.extra_payment_orders set status='paid',paid_at=now(),sepay_transaction_id=p_tx where id=o.id;outcome:='paid';end if;
 end if;
 insert into public.extra_payment_events(transaction_id,order_code,amount_vnd,payload,outcome) values(p_tx,p_code,p_amount,p_payload,outcome) on conflict(transaction_id) do nothing;
 if outcome like '%review' then update public.extra_payment_orders set status='review' where id=o.id and status='pending';end if;
 return outcome;
end $$;
revoke all on function public.extra_confirm_payment(bigint,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.extra_confirm_payment(bigint,text,bigint,jsonb) to service_role;

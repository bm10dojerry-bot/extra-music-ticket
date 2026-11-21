-- 013: One immutable ticket per paid seat, idempotent issuance and one-time check-in.
create table if not exists public.extra_tickets (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.extra_payment_orders(id) on delete restrict,
 order_code text not null,
 show_id text not null,
 venue_id text not null,
 seat_id text not null,
 qr_secret text not null unique default encode(gen_random_bytes(24),'hex'),
 issued_at timestamptz not null default now(),
 checked_in_at timestamptz,
 checked_in_by text,
 unique(order_id,seat_id)
);
create index if not exists extra_tickets_show_idx on public.extra_tickets(show_id);
create index if not exists extra_tickets_order_idx on public.extra_tickets(order_code);
alter table public.extra_tickets enable row level security;
alter table public.extra_payment_orders add column if not exists email_status text not null default 'queued' check(email_status in ('queued','sending','sent'));
alter table public.extra_payment_orders add column if not exists email_sent_at timestamptz;
alter table public.extra_payment_orders add column if not exists email_claimed_at timestamptz;

create or replace function public.extra_issue_paid_tickets(p_order_code text)
returns integer language plpgsql security definer set search_path=public as $$
declare o public.extra_payment_orders%rowtype; n integer;
begin
 select * into o from public.extra_payment_orders where code=p_order_code for update;
 if not found or o.status<>'paid' then raise exception 'Order is not paid'; end if;
 insert into public.extra_tickets(order_id,order_code,show_id,venue_id,seat_id)
 select o.id,o.code,o.show_id,o.venue_id,s.seat from unnest(o.seats) as s(seat)
 on conflict(order_id,seat_id) do nothing;
 select count(*) into n from public.extra_tickets where order_id=o.id;
 if n<>cardinality(o.seats) then raise exception 'Ticket count mismatch'; end if;
 return n;
end $$;

create or replace function public.extra_claim_ticket_email(p_order_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed text;
begin
 update public.extra_payment_orders set email_status='sending',email_claimed_at=now()
 where code=p_order_code and status='paid' and
 (email_status='queued' or (email_status='sending' and email_claimed_at<now()-interval '5 minutes'))
 returning code into claimed;
 return claimed is not null;
end $$;

create or replace function public.extra_checkin_ticket(p_id uuid,p_secret text,p_staff text)
returns text language plpgsql security definer set search_path=public as $$
declare t public.extra_tickets%rowtype;
begin
 select * into t from public.extra_tickets where id=p_id for update;
 if not found or t.qr_secret<>p_secret then return 'invalid'; end if;
 if t.checked_in_at is not null then return 'already_used'; end if;
 if not exists(select 1 from public.extra_payment_orders o where o.id=t.order_id and o.status='paid') then return 'unpaid'; end if;
 update public.extra_tickets set checked_in_at=now(),checked_in_by=p_staff where id=t.id;
 return 'checked_in';
end $$;
revoke all on function public.extra_issue_paid_tickets(text) from public,anon,authenticated;
revoke all on function public.extra_claim_ticket_email(text) from public,anon,authenticated;
revoke all on function public.extra_checkin_ticket(uuid,text,text) from public,anon,authenticated;
grant execute on function public.extra_issue_paid_tickets(text) to service_role;
grant execute on function public.extra_claim_ticket_email(text) to service_role;
grant execute on function public.extra_checkin_ticket(uuid,text,text) to service_role;

-- Existing paid orders (including test payments) get tickets without charging again.
insert into public.extra_tickets(order_id,order_code,show_id,venue_id,seat_id)
select o.id,o.code,o.show_id,o.venue_id,s.seat
from public.extra_payment_orders o cross join lateral unnest(o.seats) as s(seat)
where o.status='paid'
on conflict(order_id,seat_id) do nothing;

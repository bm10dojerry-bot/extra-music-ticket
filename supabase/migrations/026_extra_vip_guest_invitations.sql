alter table public.extra_payment_orders add column if not exists is_vip_invitation boolean not null default false;
alter table public.extra_payment_orders drop constraint if exists extra_payment_orders_amount_vnd_check;
alter table public.extra_payment_orders add constraint extra_payment_orders_amount_vnd_check check ((is_vip_invitation=true and amount_vnd=0) or (is_vip_invitation=false and amount_vnd>0));
create index if not exists extra_vip_invitations_show_idx on public.extra_payment_orders(show_id) where is_vip_invitation=true;
create or replace function public.extra_create_vip_invitation(p_code text,p_token text,p_show text,p_venue text,p_seat text,p_name text,p_phone text,p_email text)
returns text language plpgsql security definer set search_path=public as $$
declare created_id uuid;
begin
 if p_code !~ '^EX[0-9A-F]{16}$' or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Invalid code';end if;
 if length(trim(p_name))<2 or length(trim(p_phone))<9 or length(trim(p_email))<5 then raise exception 'Invalid guest';end if;
 perform pg_advisory_xact_lock(hashtext(p_show));
 if not exists(select 1 from public.managed_shows where id=p_show and venue_id=p_venue and status not in ('hidden','ended')) then raise exception 'Show unavailable';end if;
 if exists(select 1 from public.extra_show_blocked_seats where show_id=p_show and seat_id=p_seat) then raise exception 'Seat blocked';end if;
 if exists(select 1 from public.extra_payment_orders where show_id=p_show and (status='paid' or (status='pending' and expires_at>now())) and p_seat=any(seats))
 or exists(select 1 from public.ticket_sales where show_id=p_show and payment_verified=true and p_seat=any(seats)) then raise exception 'Seat already sold or held';end if;
 insert into public.extra_payment_orders(code,access_token,show_id,venue_id,seats,amount_vnd,buyer_name,buyer_phone,buyer_email,status,paid_at,is_vip_invitation)
 values(p_code,p_token,p_show,p_venue,array[p_seat],0,trim(p_name),trim(p_phone),lower(trim(p_email)),'paid',now(),true)
 returning id into created_id;
 insert into public.extra_tickets(order_id,order_code,show_id,venue_id,seat_id)
 values(created_id,p_code,p_show,p_venue,p_seat);
 return p_code;
end $$;
revoke all on function public.extra_create_vip_invitation(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.extra_create_vip_invitation(text,text,text,text,text,text,text,text) to service_role;
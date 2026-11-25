begin;

create table public.extra_os_assets (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.extra_os_shows(id),
  key text not null,
  drive_id text not null unique,
  name text not null,
  mime_type text not null,
  web_url text,
  version text,
  departments text[] not null default '{}',
  ready boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(show_id, key)
);

create table public.extra_os_effects (
  show_id uuid not null references public.extra_os_shows(id),
  key text not null,
  started_at timestamptz not null default now(),
  provider_id text,
  detail jsonb not null default '{}',
  primary key (show_id, key)
);

create table public.extra_os_ad_allocations (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.extra_os_shows(id),
  allocation_key text not null,
  limit_vnd bigint not null check (limit_vnd > 0),
  delivery_limit_vnd bigint not null check (delivery_limit_vnd > 0 and delivery_limit_vnd <= limit_vnd),
  spent_vnd bigint not null default 0 check (spent_vnd >= 0),
  billed_vnd bigint check (billed_vnd is null or billed_vnd >= spent_vnd),
  status text not null default 'reserved' check (status in ('reserved','active','paused','uncertain')),
  campaign_id text unique,
  adset_id text,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  unique(show_id, allocation_key)
);

alter table public.extra_os_assets enable row level security;
alter table public.extra_os_effects enable row level security;
alter table public.extra_os_ad_allocations enable row level security;
revoke all on public.extra_os_assets, public.extra_os_effects, public.extra_os_ad_allocations from public, anon, authenticated;
grant select, insert, update on public.extra_os_assets, public.extra_os_effects, public.extra_os_ad_allocations to service_role;
grant delete on public.extra_os_effects to service_role;

create function public.extra_os_staff_work(p_actor text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with permitted as materialized (
    select t.*, jsonb_build_object('artist',s.artist,'starts_at',s.starts_at) as extra_os_shows
    from public.extra_os_tasks t join public.extra_os_shows s on s.id = t.show_id
    where t.department = public.extra_os_department(p_actor)
    order by (t.status = 'accepted'), t.due_at
    limit 150
  ), reports as (
    select r.id,r.task_id,r.author_name,r.status,r.note,r.evidence_links,r.created_at
    from public.extra_os_reports r join permitted t on r.task_id = t.id
    order by r.id desc limit 150
  )
  select jsonb_build_object(
    'tasks',coalesce((select jsonb_agg(t order by (t.status = 'accepted'), t.due_at) from permitted t),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(r order by r.id desc) from reports r),'[]'::jsonb)
  );
$$;

create function public.extra_os_read_asset(p_actor text, p_asset uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(a) from public.extra_os_assets a
  where id = p_asset and ready and (
    public.extra_os_is_admin(p_actor)
    or public.extra_os_department(p_actor) = any(a.departments)
  );
$$;

create function public.extra_os_publish_site(p_job uuid, p_lease uuid, p_id text, p_prices jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  campaign public.extra_os_shows;
  show_day date;
  local_show_time text;
begin
  if not public.extra_os_lease_valid(p_job,p_lease) then raise exception using errcode = '42501'; end if;
  select s.* into campaign from public.extra_os_jobs j join public.extra_os_shows s on s.id = j.show_id
    where j.id = p_job and j.kind = 'website' for update of s;
  if not found or not (campaign.intake->'permissions' ? 'website')
    or campaign.starts_at <= now() or not (campaign.finances->>'layoutMatches')::boolean
    or campaign.finances->>'feasibility' in ('loss','below_target') then raise exception using errcode = '42501'; end if;
  if campaign.website_id is not null then return campaign.website_id; end if;
  show_day := (campaign.starts_at at time zone 'Asia/Ho_Chi_Minh')::date;
  local_show_time := to_char(campaign.starts_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI');
  perform pg_advisory_xact_lock(hashtext('extra-os:' || campaign.venue_key || ':' || show_day::text));
  if exists (select 1 from public.managed_shows m where m.venue_id = campaign.venue_key
    and m.show_date = show_day and left(m.show_time,5) = local_show_time) then
    raise exception 'Đã có show trùng địa điểm và giờ diễn.' using errcode = '23505';
  end if;
  if not (p_prices ?& array['A','B','C','D']) or p_prices <> campaign.finances->'prices' then
    raise exception 'Phương án giá đã thay đổi.' using errcode = '23514';
  end if;
  insert into public.managed_shows (id,artist,title,show_date,show_time,venue_id,status,prices,poster_path)
    values (p_id,campaign.artist,'Đêm nhạc ' || campaign.artist,show_day,local_show_time,campaign.venue_key,'announced',p_prices,
      case when exists (select 1 from public.extra_os_assets where show_id=campaign.id and key='poster' and ready)
        then 'extra-os:' || p_id end);
  insert into public.show_landing_content (show_id,setlist)
    values (p_id, campaign.intake->>'setlist');
  update public.extra_os_shows set website_id = p_id where id = campaign.id;
  return p_id;
end;
$$;

create function public.extra_os_paid(p_show uuid, p_ad_key text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with campaign as (
    select website_id from public.extra_os_shows where id = p_show
  ), web as materialized (
    select o.code,o.seats,o.amount_vnd,o.is_vip_invitation,
      case when jsonb_typeof(o.commission_lines) = 'array' and jsonb_array_length(o.commission_lines) = cardinality(o.seats)
        then (select count(*) from jsonb_array_elements(o.commission_lines) l where (l->>'netAmount')::numeric > 0)
        else cardinality(o.seats) end as paid_count
    from public.extra_payment_orders o join campaign c on c.website_id = o.show_id where o.status = 'paid'
  ), legacy as (
    select t.seats,t.amount_vnd
    from public.ticket_sales t join campaign c on c.website_id = t.show_id
    where t.payment_verified and not exists (select 1 from web where code = t.order_code)
  ), all_orders as (
    select seats, amount_vnd, is_vip_invitation, case when is_vip_invitation then 0 else paid_count end as paid_count from web
    union all
    select seats, amount_vnd, amount_vnd = 0, case when amount_vnd = 0 then 0 else cardinality(seats) end from legacy
  ), receipts as (
    select count(*) filter (where not is_vip_invitation) as orders,
      coalesce(sum(paid_count),0) as paid_tickets, coalesce(sum(amount_vnd),0) as revenue
    from all_orders
  ), attributed as (
    select coalesce(sum(w.amount_vnd),0) as revenue, coalesce(sum(w.paid_count),0) as seats
    from web w join public.extra_order_attribution a on a.order_code = w.code
    where not w.is_vip_invitation and a.consent and a.utm_source = 'facebook'
      and exists (select 1 from public.extra_os_ad_allocations x where x.show_id = p_show
        and a.utm_campaign = 'extra-os-' || p_show::text || '-' || x.allocation_key)
      and (p_ad_key is null or a.utm_campaign = 'extra-os-' || p_show::text || '-' || p_ad_key)
  ), recorded_cost as (
    select f.artist_fee + f.venue_fee + f.sound_lighting + f.labor + f.advertising + f.band +
      f.tax + f.sale_commission + f.logistics + f.security + f.miscellaneous as total
    from public.show_financial_costs f join campaign c on c.website_id = f.show_id
  )
  select jsonb_build_object('paidOrders',r.orders,'paidTickets',r.paid_tickets,
    'seatsTaken',(select count(distinct seat) from all_orders cross join lateral unnest(seats) seat),
    'revenueVnd',r.revenue,'adAttributedRevenueVnd',a.revenue,'adAttributedTickets',a.seats,
    'actualCostVnd',(select total from recorded_cost),
    'actualProfitVnd',r.revenue-(select total from recorded_cost))
  from receipts r cross join attributed a;
$$;

create function public.extra_os_reserve_ads(p_job uuid, p_lease uuid, p_key text, p_amount bigint, p_delivery bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  campaign public.extra_os_shows;
  allocation public.extra_os_ad_allocations;
  committed bigint;
begin
  if not public.extra_os_lease_valid(p_job,p_lease)
    or exists (select 1 from public.extra_os_controls where paused and scope in ('system','Ads'))
    then raise exception using errcode = '42501'; end if;
  select s.* into campaign from public.extra_os_jobs j join public.extra_os_shows s on s.id = j.show_id
    where j.id = p_job and j.kind in ('ads','ads_monitor') for update of s;
  if not found or not (campaign.intake->'permissions' ? 'ads') or campaign.starts_at <= now()
    then raise exception using errcode = '42501'; end if;
  select * into allocation from public.extra_os_ad_allocations where show_id = campaign.id and allocation_key = p_key;
  if found then return to_jsonb(allocation); end if;
  select coalesce(sum(coalesce(billed_vnd,greatest(limit_vnd,spent_vnd))),0) into committed
  from public.extra_os_ad_allocations where show_id = campaign.id;
  if p_amount is null or p_delivery is null or p_amount <= 0 or p_delivery <= 0 or p_delivery > p_amount
    or committed + p_amount > campaign.ad_limit_vnd then return null; end if;
  insert into public.extra_os_ad_allocations (show_id,allocation_key,limit_vnd,delivery_limit_vnd)
    values (campaign.id,p_key,p_amount,p_delivery) returning * into allocation;
  insert into public.extra_os_log (show_id,job_id,actor_id,event,details)
    values (campaign.id,p_job,'Ads','ad_budget_reserved',jsonb_build_object('key',p_key,'limitVnd',p_amount));
  return to_jsonb(allocation);
end;
$$;

create function public.extra_os_bill_ads(p_actor text,p_allocation uuid,p_billed bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  allocation public.extra_os_ad_allocations;
  manager text;
begin
  manager := public.extra_os_department(p_actor);
  if not public.extra_os_is_admin(p_actor) and manager is distinct from 'finance' then raise exception using errcode = '42501'; end if;
  select * into allocation from public.extra_os_ad_allocations where id = p_allocation;
  if not found then raise exception using errcode = '22023'; end if;
  perform 1 from public.extra_os_shows where id = allocation.show_id for update;
  select * into allocation from public.extra_os_ad_allocations where id = p_allocation for update;
  if allocation.status <> 'paused' or p_billed < allocation.spent_vnd or p_billed is null
    or allocation.billed_vnd is not null then raise exception using errcode = '23514'; end if;
  update public.extra_os_ad_allocations set billed_vnd = p_billed where id = allocation.id;
  insert into public.extra_os_log (show_id,actor_id,event,details)
    values (allocation.show_id,p_actor,'ad_bill_recorded',jsonb_build_object('allocation',allocation.id,'billedVnd',p_billed));
end;
$$;


create function public.extra_os_set_pixel(p_show uuid,p_pixel text)
returns void language plpgsql security invoker set search_path = '' as $$
declare changed text;
begin
  if p_pixel !~ '^[0-9]{8,25}$' then raise exception 'Invalid pixel'; end if;
  update public.show_landing_content l set meta_pixel_id = p_pixel, updated_at = now()
    from public.extra_os_shows s where s.id = p_show and s.website_id = l.show_id
      and s.intake->'permissions' ? 'ads' and l.meta_pixel_id in ('',p_pixel)
    returning l.show_id into changed;
  if changed is null then raise exception 'Pixel không phù hợp với show.' using errcode = '23514'; end if;
end;
$$;

create function public.extra_os_crm_summary(p_show uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'openQueries', (select count(*) from public.extra_support_chats c where c.show_id = s.website_id
      and c.status = 'open' and c.last_customer_at <= now() - interval '1 hour'
      and not exists (select 1 from public.extra_support_messages m where m.chat_id = c.id
        and m.sender = 'staff' and m.created_at > c.last_customer_at)),
    'pendingPayments',(select count(*) from public.extra_payment_orders o where o.show_id = s.website_id
      and o.status = 'pending' and o.expires_at > now()),
    'reviewPayments',(select count(*) from public.extra_payment_orders o where o.show_id = s.website_id and o.status = 'review'))
  from public.extra_os_shows s where s.id = p_show;
$$;

create function public.extra_os_finance_panel(p_actor text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with shows as materialized (
    select id,artist,starts_at,venue,capacity,finances,ad_limit_vnd,website_id,
      jsonb_build_object('targetProfitVnd',intake->'targetProfitVnd') as intake
    from public.extra_os_shows where public.extra_os_department(p_actor) = 'finance'
    order by created_at desc limit 50
  )
  select jsonb_build_object(
    'shows',coalesce((select jsonb_agg(s) from shows s),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) - 'lease_token' - 'lease_expires_at') from public.extra_os_jobs j join shows s on j.show_id = s.id
      where j.kind in ('analyst','ads_monitor')),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(a) from public.extra_os_ad_allocations a join shows s on a.show_id = s.id),'[]'::jsonb)
  );
$$;

revoke execute on function public.extra_os_set_pixel(uuid,text), public.extra_os_crm_summary(uuid),
 public.extra_os_finance_panel(text) from public, anon, authenticated;
grant execute on function public.extra_os_set_pixel(uuid,text), public.extra_os_crm_summary(uuid),
 public.extra_os_finance_panel(text) to service_role;


create function public.extra_os_public_poster(p_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(a)
  from public.extra_os_assets a join public.extra_os_shows s on a.show_id = s.id
  join public.managed_shows m on m.id = s.website_id
  where m.id = p_id and m.status <> 'hidden' and a.key = 'poster' and a.ready
    and a.mime_type = 'image/jpeg' and s.intake->'permissions' ? 'website';
$$;
create function public.extra_os_attach_poster(p_show uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.managed_shows m set poster_path = 'extra-os:' || m.id, updated_at = now()
  from public.extra_os_shows s join public.extra_os_assets a on a.show_id=s.id
  where s.id=p_show and s.website_id=m.id and m.poster_path is null and a.key='poster' and a.ready;
$$;

create function public.extra_os_close_sales(p_job uuid,p_lease uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare show_id text;
begin
  if not public.extra_os_lease_valid(p_job,p_lease) then raise exception using errcode = '42501'; end if;
  select s.website_id into show_id from public.extra_os_shows s join public.extra_os_jobs j on j.show_id=s.id
   where j.id=p_job and j.kind='close_sales' and s.starts_at<=now();
  if show_id is null then raise exception 'Show chưa đóng bán.' using errcode = '23514'; end if;
  update public.managed_shows set status='live', updated_at=now() where id=show_id and status='announced';
  return show_id;
end;
$$;
revoke execute on function public.extra_os_attach_poster(uuid),public.extra_os_close_sales(uuid,uuid) from public,anon,authenticated;
grant execute on function public.extra_os_attach_poster(uuid),public.extra_os_close_sales(uuid,uuid) to service_role;
revoke execute on function public.extra_os_public_poster(text) from public,anon,authenticated;
grant execute on function public.extra_os_public_poster(text) to service_role;

revoke execute on function public.extra_os_staff_work(text), public.extra_os_read_asset(text,uuid),
  public.extra_os_publish_site(uuid,uuid,text,jsonb), public.extra_os_paid(uuid,text),
  public.extra_os_reserve_ads(uuid,uuid,text,bigint,bigint), public.extra_os_bill_ads(text,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.extra_os_staff_work(text), public.extra_os_read_asset(text,uuid),
  public.extra_os_publish_site(uuid,uuid,text,jsonb), public.extra_os_paid(uuid,text),
  public.extra_os_reserve_ads(uuid,uuid,text,bigint,bigint), public.extra_os_bill_ads(text,uuid,bigint)
  to service_role;

commit;

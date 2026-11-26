begin;

create table public.extra_sale_pro_config (
  page_id text primary key,
  enabled boolean not null default false
);

create table public.extra_sale_pro_operators (
  staff_id uuid primary key references public.staff_accounts(id),
  can_resolve_any boolean not null default false
);

create table public.extra_sale_pro_handoffs (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.extra_support_chats(id),
  page_id text not null,
  show_id text,
  reason text not null check (reason in ('human_requested','complaint','out_of_scope','repeated',
    'unable_to_answer','send_failed','delivery_unconfirmed')),
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff_accounts(id),
  payment text check (payment in ('paid','unpaid')),
  source text not null default 'existing_state',
  check ((resolved_at is null and resolved_by is null and payment is null)
      or (resolved_at is not null and resolved_by is not null and payment is not null))
);
create unique index extra_sale_pro_one_handoff on public.extra_sale_pro_handoffs(chat_id) where resolved_at is null;
create index extra_sale_pro_handoffs_page_time on public.extra_sale_pro_handoffs(page_id, opened_at);

create table public.extra_sale_pro_resolution_audit (
  event_id uuid primary key,
  handoff_id uuid not null references public.extra_sale_pro_handoffs(id),
  staff_id uuid not null references public.staff_accounts(id),
  issued_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in ('paid','unpaid','payment_unknown'))
);

create table public.extra_sale_pro_dispatches (
  token uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.extra_support_chats(id),
  page_id text not null,
  delivery_key text not null,
  purpose text not null check (purpose in ('reply','checkout','ticket','followup',
    'before_show_paid','manual_timeout','seat_map','comment_reply')),
  mode text not null check (mode in ('legacy','pro')),
  status text not null check (status in ('sending','skipped','sent','failed','uncertain')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '30 seconds',
  finished_at timestamptz,
  receipt text,
  unique (chat_id, delivery_key)
);
create unique index extra_sale_pro_one_dispatch on public.extra_sale_pro_dispatches(chat_id) where status = 'sending';
create index extra_sale_pro_pending_dispatches on public.extra_sale_pro_dispatches(page_id, expires_at) where status = 'sending';

create table public.extra_sale_pro_delivery (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  kind text not null check (kind in ('handoff','hourly')),
  audience text not null check (audience in ('trang','owner')),
  delivery_key text not null unique,
  handoff_id uuid references public.extra_sale_pro_handoffs(id),
  period_end timestamptz,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','uncertain')),
  token uuid,
  external_id text,
  payload jsonb,
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  finished_at timestamptz,
  check ((kind = 'handoff' and handoff_id is not null and period_end is null)
      or (kind = 'hourly' and period_end is not null and handoff_id is null))
);
create index extra_sale_pro_delivery_queue on public.extra_sale_pro_delivery(page_id, kind, created_at)
  where state in ('queued','sending');

create function public.extra_sale_pro_mode(p_page_id text)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object('enabled', coalesce(
    (select enabled from public.extra_sale_pro_config where page_id = p_page_id), false))
$$;

create function public.extra_sale_pro_current_show(p_chat_id uuid)
returns text language sql stable set search_path = pg_catalog, public as $$
  select coalesce(
    (select o.show_id
     from public.extra_messenger_ai_state s
     join public.extra_messenger_ai_orders x on x.chat_id = s.chat_id and x.order_code = s.current_order_code
     join public.extra_payment_orders o on o.code = x.order_code
     where s.chat_id = p_chat_id),
    (select q.quote->>'showId' from public.extra_messenger_ai_quotes q
     where q.chat_id = p_chat_id and q.quote ? 'showId'
     order by q.created_at desc, q.id desc limit 1),
    (select c.show_id from public.extra_support_chats c where c.id = p_chat_id))
$$;

create function public.extra_sale_pro_lock(p_chat_id uuid, p_reason text, p_source text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  c public.extra_support_chats%rowtype;
  h public.extra_sale_pro_handoffs%rowtype;
begin
  if p_reason is null or p_reason not in ('human_requested','complaint','out_of_scope','repeated',
      'unable_to_answer','send_failed','delivery_unconfirmed') or p_source is null or length(p_source) > 100 then
    return jsonb_build_object('outcome','invalid');
  end if;
  select * into c from public.extra_support_chats where id = p_chat_id for update;
  if not found or c.channel <> 'messenger' or c.messenger_page_id is null then
    return jsonb_build_object('outcome','not_found');
  end if;

  select * into h from public.extra_sale_pro_handoffs where chat_id = c.id and resolved_at is null;
  if found then return jsonb_build_object('outcome','already_locked','handoff_id',h.id); end if;

  insert into public.extra_sale_pro_handoffs(chat_id,page_id,show_id,reason,source)
    values(c.id,c.messenger_page_id,public.extra_sale_pro_current_show(c.id),p_reason,p_source)
    returning * into h;
  perform public.extra_messenger_ai_set_mode(c.id,'manual');
  insert into public.extra_sale_pro_delivery(page_id,kind,audience,delivery_key,handoff_id)
    values(c.messenger_page_id,'handoff','trang','handoff:' || h.id,h.id);
  return jsonb_build_object('outcome','locked','handoff_id',h.id);
end
$$;

create function public.extra_sale_pro_keep_manual()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.ai_mode is distinct from 'manual' and exists (
    select 1 from public.extra_sale_pro_handoffs where chat_id = new.id and resolved_at is null
  ) then
    new.ai_mode := 'manual';
    new.assigned_staff_id := old.assigned_staff_id;
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end
$$;
create trigger zz_extra_sale_pro_keep_manual before update on public.extra_support_chats
  for each row execute function public.extra_sale_pro_keep_manual();

create function public.extra_sale_pro_capture_attention()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.extra_sale_pro_lock(new.chat_id,'unable_to_answer','existing_state');
  return new;
end
$$;
create trigger zz_extra_sale_pro_capture_attention after insert or update of status on public.extra_messenger_ai_state
  for each row when (new.status = 'needs_attention')
  execute function public.extra_sale_pro_capture_attention();

-- Carry forward open handoffs from the deployed needs_attention trigger.
insert into public.extra_sale_pro_handoffs(chat_id,page_id,show_id,reason,opened_at)
select c.id,c.messenger_page_id,public.extra_sale_pro_current_show(c.id),'unable_to_answer',s.updated_at
from public.extra_messenger_ai_state s join public.extra_support_chats c on c.id = s.chat_id
where s.status = 'needs_attention' and c.channel = 'messenger' and c.ai_mode = 'manual'
  and c.messenger_page_id is not null;

create function public.extra_sale_pro_payment(p_chat_id uuid, p_show_id text)
returns text language sql stable set search_path = pg_catalog, public as $$
  with contacts as (
    select c.customer_phone phone, null::text email from public.extra_support_chats c where c.id = p_chat_id
    union all
    select q.quote->>'phone',q.quote->>'email' from public.extra_messenger_ai_quotes q
    where q.chat_id = p_chat_id and q.quote->>'showId' = p_show_id
  ), keys as (
    select distinct public.extra_messenger_ai_followup_phone_key(phone) phone,
      public.extra_messenger_ai_followup_email_key(email) email from contacts
  ), orders as (
    select o.code,o.status,o.paid_at,o.sepay_transaction_id,o.amount_vnd
    from public.extra_payment_orders o where o.show_id = p_show_id and (
      exists(select 1 from public.extra_messenger_ai_orders x where x.chat_id = p_chat_id and x.order_code = o.code)
      or exists(select 1 from keys k where
        (k.phone is not null and k.phone = public.extra_messenger_ai_followup_phone_key(o.buyer_phone)) or
        (k.email is not null and k.email = public.extra_messenger_ai_followup_email_key(o.buyer_email))))
  ), verified as (
    select 1 from orders o join public.extra_payment_events e
      on e.transaction_id = o.sepay_transaction_id and e.order_code = o.code and e.outcome = 'paid'
    where o.status = 'paid' and o.paid_at is not null and e.amount_vnd > 0
  )
  select case
    when p_show_id is null or not exists(select 1 from public.managed_shows where id = p_show_id) then 'unknown'
    when exists(select 1 from verified) then 'paid'
    when exists(select 1 from orders where status in ('review','paid')) then 'unknown'
    when public.extra_messenger_ai_followup_has_order(p_chat_id)
      and not exists(select 1 from orders where status = 'pending') then 'unknown'
    when exists(select 1 from orders where status in ('pending','expired','cancelled'))
      or exists(select 1 from keys where phone is not null or email is not null) then 'unpaid'
    else 'unknown' end
$$;

create function public.extra_sale_pro_can_send(p_chat_id uuid, p_page_id text, p_mode text, p_purpose text)
returns text language plpgsql set search_path = pg_catalog, public as $$
declare
  c public.extra_support_chats%rowtype;
  enabled boolean;
  v_show text;
begin
  select * into c from public.extra_support_chats where id = p_chat_id and messenger_page_id = p_page_id for update;
  if not found or c.channel <> 'messenger' or c.status <> 'open' then return 'chat_unavailable'; end if;
  select coalesce((select cfg.enabled from public.extra_sale_pro_config cfg where cfg.page_id = p_page_id), false) into enabled;
  if p_mode is null or p_mode <> (case when enabled then 'pro' else 'legacy' end) then return 'wrong_release'; end if;
  if exists(select 1 from public.extra_sale_pro_handoffs where chat_id = c.id and resolved_at is null) then return 'locked'; end if;
  if c.ai_mode <> 'auto' and (p_purpose <> 'manual_timeout' or enabled) then return 'manual'; end if;

  if p_purpose not in ('ticket','before_show_paid') then
    v_show := public.extra_sale_pro_current_show(c.id);
    if exists(select 1 from public.extra_sale_pro_handoffs where chat_id = c.id and payment = 'paid'
      and (show_id = v_show or v_show is null)) then return 'paid'; end if;
    if p_purpose in ('followup','comment_reply') and public.extra_messenger_ai_followup_has_order(c.id) then
      return 'buyer_guard';
    end if;
  end if;
  return 'ok';
end
$$;

create function public.extra_sale_pro_begin(
  p_chat_id uuid, p_page_id text, p_recipient text, p_key text, p_purpose text, p_mode text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  c public.extra_support_chats%rowtype;
  v_token uuid;
  v_outcome text;
begin
  if p_key is null or length(p_key) not between 4 and 220 or p_purpose is null or p_purpose not in
    ('reply','checkout','ticket','followup','before_show_paid','manual_timeout','seat_map','comment_reply') then
    return jsonb_build_object('outcome','invalid');
  end if;
  if p_chat_id is null then
    select * into c from public.extra_support_chats
    where channel = 'messenger' and messenger_page_id = p_page_id and messenger_psid = p_recipient for update;
  else
    select * into c from public.extra_support_chats where id = p_chat_id for update;
  end if;
  if not found or c.messenger_page_id is distinct from p_page_id or c.messenger_psid is distinct from p_recipient then
    return jsonb_build_object('outcome','chat_unverified');
  end if;
  v_outcome := public.extra_sale_pro_can_send(c.id,p_page_id,p_mode,p_purpose);
  if v_outcome <> 'ok' then return jsonb_build_object('outcome',v_outcome); end if;

  if exists(select 1 from public.extra_sale_pro_dispatches where chat_id = c.id and status = 'sending') then
    return jsonb_build_object('outcome','in_flight');
  end if;
  insert into public.extra_sale_pro_dispatches(chat_id,page_id,delivery_key,purpose,mode,status)
    values(c.id,p_page_id,p_key,p_purpose,p_mode,'sending')
    on conflict (chat_id,delivery_key) do nothing returning token into v_token;
  if v_token is null then return jsonb_build_object('outcome','duplicate'); end if;
  return jsonb_build_object('outcome','send','token',v_token);
end
$$;

create function public.extra_sale_pro_recheck(p_token uuid)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare d public.extra_sale_pro_dispatches%rowtype;
begin
  select * into d from public.extra_sale_pro_dispatches where token = p_token;
  if not found then return jsonb_build_object('outcome','expired'); end if;
  perform 1 from public.extra_support_chats where id = d.chat_id for update;
  select * into d from public.extra_sale_pro_dispatches where token = p_token;
  if d.status <> 'sending' or d.expires_at <= clock_timestamp() + interval '10 seconds' then
    return jsonb_build_object('outcome','expired');
  end if;
  return jsonb_build_object('outcome',public.extra_sale_pro_can_send(d.chat_id,d.page_id,d.mode,d.purpose));
end
$$;

create function public.extra_sale_pro_finish(p_token uuid, p_status text, p_receipt text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare d public.extra_sale_pro_dispatches%rowtype;
begin
  if p_status is null or p_status not in ('sent','failed','uncertain','skipped')
    or (p_status = 'sent' and (p_receipt is null or length(p_receipt) not between 4 and 200)) then
    return jsonb_build_object('outcome','invalid');
  end if;
  select * into d from public.extra_sale_pro_dispatches where token = p_token;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform 1 from public.extra_support_chats where id = d.chat_id for update;
  if d.status = p_status and d.receipt is not distinct from p_receipt then
    return jsonb_build_object('outcome',p_status);
  end if;
  update public.extra_sale_pro_dispatches set status = p_status,receipt = p_receipt,finished_at = clock_timestamp()
  where token = p_token and status = 'sending';
  if not found then return jsonb_build_object('outcome','stale'); end if;
  if p_status in ('failed','uncertain') and (
    d.mode = 'pro' or exists(select 1 from public.extra_sale_pro_handoffs where chat_id = d.chat_id and resolved_at is null)
  ) then
    perform public.extra_sale_pro_lock(d.chat_id,
      case when p_status = 'failed' then 'send_failed' else 'delivery_unconfirmed' end,d.purpose);
  end if;
  return jsonb_build_object('outcome',p_status);
end
$$;

create function public.extra_sale_pro_recover_dispatches(p_page_id text)
returns integer language plpgsql set search_path = pg_catalog, public as $$
declare
  d record;
  v_count integer := 0;
begin
  for d in
    select token from public.extra_sale_pro_dispatches where page_id = p_page_id
      and status = 'sending' and expires_at <= clock_timestamp() order by expires_at limit 50
  loop
    if public.extra_sale_pro_finish(d.token,'uncertain',null)->>'outcome' = 'uncertain' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$$;

create function public.extra_sale_pro_resolve(p_chat_id uuid, p_handoff_id uuid, p_actor_id uuid,
  p_event_id uuid, p_issued_at timestamptz, p_command text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  c public.extra_support_chats%rowtype;
  h public.extra_sale_pro_handoffs%rowtype;
  v_payment text;
  v_now timestamptz := clock_timestamp();
begin
  if p_command is distinct from 'Đã xử lý xong' or p_event_id is null or p_handoff_id is null
    or p_issued_at is null or p_issued_at < v_now - interval '5 minutes' or p_issued_at > v_now + interval '15 seconds' then
    return jsonb_build_object('outcome','invalid');
  end if;
  select * into c from public.extra_support_chats where id = p_chat_id and channel = 'messenger' for update;
  if not found or not exists(
    select 1 from public.extra_sale_pro_operators o join public.staff_accounts s on s.id = o.staff_id
    where o.staff_id = p_actor_id and s.active and s.role in ('admin','sale')
      and (o.can_resolve_any or c.assigned_staff_id = s.id)
  ) then return jsonb_build_object('outcome','forbidden'); end if;
  if exists(select 1 from public.extra_sale_pro_resolution_audit where event_id = p_event_id) then
    return jsonb_build_object('outcome','replay');
  end if;
  select * into h from public.extra_sale_pro_handoffs where id = p_handoff_id and chat_id = c.id and resolved_at is null;
  if not found or p_issued_at < h.opened_at then return jsonb_build_object('outcome','stale'); end if;
  if exists(select 1 from public.extra_sale_pro_dispatches where chat_id = c.id and status = 'sending')
    or exists(select 1 from public.extra_messenger_ai_outbox where chat_id = c.id and state = 'sending'
      and send_started_at > v_now - interval '30 seconds') then
    return jsonb_build_object('outcome','in_flight');
  end if;

  v_payment := public.extra_sale_pro_payment(c.id,h.show_id);
  insert into public.extra_sale_pro_resolution_audit(event_id,handoff_id,staff_id,issued_at,outcome)
    values(p_event_id,h.id,p_actor_id,p_issued_at,case when v_payment = 'unknown' then 'payment_unknown' else v_payment end)
    on conflict (event_id) do nothing;
  if not found then return jsonb_build_object('outcome','replay'); end if;
  if v_payment = 'unknown' then return jsonb_build_object('outcome','payment_unknown'); end if;

  update public.extra_sale_pro_handoffs set resolved_at = v_now,resolved_by = p_actor_id,payment = v_payment
    where id = h.id;
  -- Legacy reminders keep their anchors, ledger and cadence. The prior job
  -- ended when the handoff began and must not answer that inbound again.
  update public.extra_support_chats set ai_mode = 'auto',assigned_staff_id = null,assigned_at = null
    where id = c.id;
  update public.extra_messenger_ai_state set status = 'in_progress',reason = null,updated_at = v_now
    where chat_id = c.id and status = 'needs_attention';
  return jsonb_build_object('outcome',v_payment);
end
$$;

create function public.extra_sale_pro_status(p_chat_id uuid, p_page_id text)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select coalesce((
    select jsonb_build_object('id',h.id,'reason',h.reason,'opened_at',h.opened_at,'resolved_at',h.resolved_at,
      'payment',h.payment,'in_flight',
      exists(select 1 from public.extra_sale_pro_dispatches d where d.chat_id = h.chat_id and d.status = 'sending'))
    from public.extra_sale_pro_handoffs h where h.chat_id = p_chat_id and h.page_id = p_page_id
    order by h.opened_at desc, h.id desc limit 1
  ), '{}'::jsonb)
$$;

alter table public.extra_sale_pro_config enable row level security;
alter table public.extra_sale_pro_operators enable row level security;
alter table public.extra_sale_pro_handoffs enable row level security;
alter table public.extra_sale_pro_resolution_audit enable row level security;
alter table public.extra_sale_pro_dispatches enable row level security;
alter table public.extra_sale_pro_delivery enable row level security;

create function public.extra_sale_pro_metrics(p_page_id text, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  with page_chats as (
    select id from public.extra_support_chats where channel = 'messenger' and messenger_page_id = p_page_id
  ), paid as (
    select x.chat_id,o.code,o.paid_at,e.amount_vnd
    from public.extra_messenger_ai_orders x join page_chats c on c.id = x.chat_id
    join public.extra_payment_orders o on o.code = x.order_code
    left join public.extra_payment_events e on e.order_code = o.code and e.transaction_id = o.sepay_transaction_id
      and e.outcome = 'paid' and e.amount_vnd > 0
    where o.status = 'paid' and o.paid_at < p_end
  ), period_paid as (
    select distinct on (code) chat_id,code,amount_vnd from paid where paid_at >= p_start order by code,chat_id
  ), activity as (
    select distinct m.chat_id from public.extra_support_messages m join page_chats c on c.id = m.chat_id
    where m.sender = 'customer' and m.created_at >= p_start and m.created_at < p_end
    union select chat_id from period_paid
  ), totals as (
    select count(*) as chats,
      count(*) filter (where exists(select 1 from period_paid p where p.chat_id = a.chat_id)) as closed,
      count(*) filter (where not exists(select 1 from paid p where p.chat_id = a.chat_id)
        and public.extra_sale_pro_payment(a.chat_id,public.extra_sale_pro_current_show(a.chat_id)) = 'unpaid') as unclosed,
      count(*) filter (where not exists(select 1 from paid p where p.chat_id = a.chat_id)
        and public.extra_sale_pro_payment(a.chat_id,public.extra_sale_pro_current_show(a.chat_id)) = 'unknown') as unknown
    from activity a
  )
  select jsonb_build_object(
    'chats',t.chats,'closed',t.closed,'unclosed',t.unclosed,'unknown',t.unknown,
    'conversion',case when t.chats = 0 then null else round(100 * t.closed::numeric / t.chats, 2) end,
    'revenue',case when exists(select 1 from period_paid where amount_vnd is null) then null
      else coalesce((select sum(amount_vnd) from period_paid),0)::text end,
    'missing_receipts',(select count(*) from period_paid where amount_vnd is null),
    'handoffs',(select count(distinct chat_id) from public.extra_sale_pro_handoffs
      where page_id = p_page_id and opened_at >= p_start and opened_at < p_end),
    'pending_handoffs',(select count(*) from public.extra_sale_pro_handoffs
      where page_id = p_page_id and opened_at < p_end and (resolved_at is null or resolved_at >= p_end)),
    'errors',(select count(distinct chat_id) from public.extra_sale_pro_handoffs
      where page_id = p_page_id and reason in ('complaint','unable_to_answer','send_failed','delivery_unconfirmed')
        and opened_at < p_end and (resolved_at is null or resolved_at >= p_end))
  ) from totals t
$$;

create function public.extra_sale_pro_trang_items(p_page_id text, p_end timestamptz)
returns table(chat_id uuid, name text, status text, reason text, happened_at timestamptz)
language sql stable set search_path = pg_catalog, public as $$
  select c.id, left(coalesce(nullif(btrim(c.customer_name),''),'Khách Messenger'),100),
    case when h.id is not null then 'handoff'
         when p.result = 'unknown' then 'payment_unknown' else 'unclosed' end,
    coalesce(h.reason,case when p.result = 'unknown' then 'payment_unknown' else 'unclosed' end),
    coalesce(h.opened_at,c.last_customer_at,c.created_at)
  from public.extra_support_chats c
  left join lateral (
    select id,reason,opened_at from public.extra_sale_pro_handoffs
    where page_id = p_page_id and extra_sale_pro_handoffs.chat_id = c.id and opened_at < p_end
      and (resolved_at is null or resolved_at >= p_end)
    order by opened_at desc limit 1
  ) h on true
  left join lateral (
    select public.extra_sale_pro_payment(c.id,public.extra_sale_pro_current_show(c.id)) as result
  ) p on h.id is null
  where c.channel = 'messenger' and c.messenger_page_id = p_page_id and c.created_at < p_end
    and (h.id is not null or (c.status = 'open' and c.last_customer_at < p_end and p.result <> 'paid'))
$$;

create function public.extra_sale_pro_enqueue_hour(p_page_id text, p_end timestamptz)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  v_key text;
  v_day timestamptz;
  v_hour jsonb;
  v_daily jsonb;
  v_total integer;
begin
  if p_end is null or p_end <> date_trunc('hour',p_end,'Asia/Ho_Chi_Minh') then
    return jsonb_build_object('outcome','invalid');
  end if;
  if public.extra_sale_pro_mode(p_page_id)->>'enabled' <> 'true' then
    return jsonb_build_object('outcome','disabled');
  end if;
  v_key := p_page_id || ':hour:' || extract(epoch from p_end)::bigint;
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  if exists(select 1 from public.extra_sale_pro_delivery where delivery_key = v_key || ':owner') then
    return jsonb_build_object('outcome','already_queued');
  end if;
  v_day := date_trunc('day',p_end - interval '1 microsecond','Asia/Ho_Chi_Minh');
  v_hour := public.extra_sale_pro_metrics(p_page_id,p_end - interval '1 hour',p_end);
  v_daily := public.extra_sale_pro_metrics(p_page_id,v_day,p_end);
  insert into public.extra_sale_pro_delivery(page_id,kind,audience,delivery_key,period_end,payload)
  values(p_page_id,'hourly','owner',v_key || ':owner',p_end,
    jsonb_build_object('hour',v_hour,'day',v_daily,'day_start',v_day));

  with numbered as (
    select *, (row_number() over (order by happened_at desc,chat_id) - 1) / 4 as part
    from public.extra_sale_pro_trang_items(p_page_id,p_end)
  ), grouped as (
    select part,jsonb_agg(to_jsonb(n) - 'part' order by happened_at desc,chat_id) as items
    from numbered n group by part
    union all select 0,'[]'::jsonb where not exists(select 1 from numbered)
  )
  insert into public.extra_sale_pro_delivery(page_id,kind,audience,delivery_key,period_end,payload)
  select p_page_id,'hourly','trang',v_key || ':trang:' || part,p_end,
    jsonb_build_object('items',items,'part',part + 1,'parts',count(*) over ())
  from grouped;
  get diagnostics v_total = row_count;
  return jsonb_build_object('outcome','queued','deliveries',v_total + 1);
end
$$;

create function public.extra_sale_pro_claim_delivery(p_page_id text,p_kind text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  d public.extra_sale_pro_delivery%rowtype;
  v_payload jsonb;
begin
  if p_kind is null or p_kind not in ('handoff','hourly') then return null; end if;
  update public.extra_sale_pro_delivery set state = 'uncertain',finished_at = clock_timestamp()
  where page_id = p_page_id and kind = p_kind and state = 'sending'
    and claimed_at < clock_timestamp() - interval '2 minutes';
  select * into d from public.extra_sale_pro_delivery
    where page_id = p_page_id and kind = p_kind and state = 'queued'
    order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.extra_sale_pro_delivery set state = 'sending',token = gen_random_uuid(),claimed_at = clock_timestamp()
    where id = d.id returning * into d;
  if d.kind = 'handoff' then
    select jsonb_build_object('chat_id',c.id,'name',left(c.customer_name,100),'status','handoff',
      'reason',h.reason,'happened_at',h.opened_at) into v_payload
    from public.extra_sale_pro_handoffs h join public.extra_support_chats c on c.id = h.chat_id
    where h.id = d.handoff_id;
  else v_payload := d.payload;
  end if;
  return jsonb_build_object('id',d.id,'key',d.delivery_key,'token',d.token,'audience',d.audience,
    'kind',d.kind,'period_end',d.period_end,'payload',v_payload);
end
$$;

create function public.extra_sale_pro_finish_delivery(p_id uuid,p_token uuid,p_state text,p_external_id text)
returns boolean language plpgsql set search_path = pg_catalog, public as $$
begin
  if p_state is null or p_state not in ('sent','failed','uncertain')
    or (p_state = 'sent' and (p_external_id is null or length(p_external_id) not between 4 and 200)) then
    return false;
  end if;
  update public.extra_sale_pro_delivery set state = p_state, external_id = p_external_id,finished_at = clock_timestamp()
    where id = p_id and token = p_token and state = 'sending';
  return found;
end
$$;

revoke all on table public.extra_sale_pro_config, public.extra_sale_pro_operators, public.extra_sale_pro_handoffs,
  public.extra_sale_pro_resolution_audit, public.extra_sale_pro_dispatches, public.extra_sale_pro_delivery
  from public, anon, authenticated;
grant select,insert,update on table public.extra_sale_pro_config, public.extra_sale_pro_operators,
  public.extra_sale_pro_handoffs, public.extra_sale_pro_resolution_audit, public.extra_sale_pro_dispatches,
  public.extra_sale_pro_delivery to service_role;

do $grants$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and left(p.proname,15) = 'extra_sale_pro_' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;

commit;

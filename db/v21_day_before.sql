create table public.extra_show_reminder_settings (
  show_id text primary key references public.managed_shows(id),
  canopy_confirmed boolean not null default false
);
create table public.extra_messenger_day_before (
  page_id text not null, recipient text not null, show_id text not null,
  chat_id uuid not null references public.extra_support_chats(id),
  kind text not null check(kind in ('paid','pending','interest')),
  state text not null default 'sending' check(state in ('sending','sent','uncertain')),
  claimed_at timestamptz not null default now(), external_id text,
  primary key(page_id,recipient,show_id)
);
alter table public.extra_show_reminder_settings enable row level security;
alter table public.extra_messenger_day_before enable row level security;
revoke all on public.extra_show_reminder_settings,public.extra_messenger_day_before from public,anon,authenticated;
grant select,insert,update on public.extra_show_reminder_settings,public.extra_messenger_day_before to service_role;

-- The same query is used for discovery and in the final claim immediately before delivery.
create function public.extra_day_before_due(p_page text,p_chat uuid default null,p_show text default null)
returns table(chat_id uuid,recipient text,show_id text,title text,artist text,show_date date,show_time text,venue text,canopy boolean,kind text)
language sql stable set search_path=pg_catalog,public as $$
 with shows as (
   select s.* from public.managed_shows s
   where s.show_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date+1
   and s.status in ('announced','sold_out') and (p_show is null or s.id=p_show)
 ), candidates as (
   select c.id chat_id,c.messenger_psid recipient,s.id show_id,s.title,s.artist,s.show_date,s.show_time::text,
    s.venue_id venue,coalesce(v.canopy_confirmed,false) canopy,
    case when o.paid then 'paid' when o.pending and not o.review then 'pending'
         when o.n=0 and s.status='announced' and coalesce(st.status,'in_progress') in ('in_progress','awaiting_confirmation') and (
          c.show_id=s.id or exists(select 1 from extra_messenger_ai_quotes q where q.chat_id=c.id and q.quote->>'showId'=s.id)
          or exists(select 1 from extra_comment_ai_leads l where l.chat_id=c.id and l.show_id=s.id and l.responded_at is not null and not l.is_deleted and not l.is_hidden)
          or (length(trim(s.artist))>=5 and not exists(select 1 from managed_shows other where other.id<>s.id and lower(other.artist)=lower(s.artist) and other.show_date>=current_date and other.status in ('announced','sold_out'))
              and exists(select 1 from extra_support_messages m where m.chat_id=c.id and m.sender='customer' and m.created_at>=now()-interval '24 hours' and strpos(lower(m.body),lower(s.artist))>0 and m.body ~* '(vé|ghế|giá|đặt|quan tâm|muốn xem)')))
         then 'interest' end kind
   from shows s cross join extra_support_chats c
   join extra_messenger_ai_settings cfg on cfg.page_id=c.messenger_page_id and cfg.enabled
   left join extra_messenger_ai_state st on st.chat_id=c.id
   left join extra_show_reminder_settings v on v.show_id=s.id
   cross join lateral (
     select count(*) n, bool_or(o.status='paid') paid,bool_or(o.status='review') review,
        bool_or(o.status='pending' and o.expires_at>now()) pending
     from extra_messenger_ai_orders a join extra_payment_orders o on o.code=a.order_code
     where a.chat_id=c.id and o.show_id=s.id
   ) o
   where p_page='1223940670813189' and c.messenger_page_id=p_page and (p_chat is null or c.id=p_chat)
     and c.channel='messenger' and c.messenger_psid ~ '^[0-9]{5,80}$' and c.status='open'
     and c.ai_mode='auto' and c.assigned_staff_id is null and coalesce(st.status,'') not in ('needs_attention','unsuccessful')
     and c.last_customer_at between now()-interval '23 hours 58 minutes' and now()
     and (now() at time zone 'Asia/Ho_Chi_Minh')::time between time '08:00' and time '20:00'
     and not exists(select 1 from extra_messenger_day_before d where d.page_id=p_page and d.recipient=c.messenger_psid and d.show_id=s.id)
     and not exists(select 1 from extra_messenger_ai_jobs j where j.chat_id=c.id and j.state in ('queued','running'))
     and not exists(select 1 from extra_comment_ai_suppressions z where z.page_id=p_page and (z.author_id=c.messenger_psid or exists(select 1 from extra_comment_ai_leads l where l.chat_id=c.id and l.page_id=p_page and l.author_id=z.author_id)))
     and not exists(select 1 from extra_support_messages m where m.chat_id=c.id and m.sender='customer' and lower(m.body) ~ '(đừng|dừng|ngừng|không|hủy|huỷ|dung|ngung|khong|huy) (cần |can |muốn |muon |nhận |nhan )?(nhắn|gửi tin|nhắc|liên hệ|tin nhắn|nhan tin|nhac|lien he)|^stop[.! ]*$')
 )
 select * from candidates where kind is not null order by case kind when 'pending' then 0 when 'paid' then 1 else 2 end,chat_id,show_id limit 20;
$$;

create function public.extra_day_before_claim(p_page text,p_chat uuid,p_show text,p_expected jsonb) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare candidate record;
begin
 select * into candidate from extra_day_before_due(p_page,p_chat,p_show);
 if not found or to_jsonb(candidate)<>p_expected then return false; end if;
 insert into extra_messenger_day_before(page_id,recipient,show_id,chat_id,kind)
 values(p_page,candidate.recipient,p_show,p_chat,candidate.kind) on conflict do nothing;
 return found;
end; $$;

create function public.extra_day_before_finish(p_page text,p_recipient text,p_show text,p_mid text,p_body text)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare target uuid;
begin
 update extra_messenger_day_before set state=case when p_mid is null then 'uncertain' else 'sent' end,external_id=p_mid
 where page_id=p_page and recipient=p_recipient and show_id=p_show and state='sending' returning chat_id into target;
 if target is not null and p_mid is not null then
   insert into extra_support_messages(chat_id,sender,staff_name,body,external_message_id) values(target,'staff','EXTRA AI',p_body,p_mid) on conflict do nothing;
 end if;
end; $$;
revoke all on function public.extra_day_before_due(text,uuid,text),public.extra_day_before_claim(text,uuid,text,jsonb),public.extra_day_before_finish(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.extra_day_before_due(text,uuid,text),public.extra_day_before_claim(text,uuid,text,jsonb),public.extra_day_before_finish(text,text,text,text,text) to service_role;

-- Each day is a separate cohort of Messenger chats with an inbound customer message.
-- Only aggregate counts cross the Music boundary; no bodies or identifiers are returned.
create or replace function extra_os_reporting.music_sale_audit_v1()
returns jsonb language sql stable security invoker set search_path='' as $$
with bounds as (
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date as day
), starts as (
  select m.chat_id,c.show_id as tagged_show,(m.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,min(m.created_at) as started
  from public.extra_support_messages m
  join public.extra_support_chats c on c.id=m.chat_id and c.channel='messenger'
  cross join bounds b
  where m.sender='customer' and m.created_at>=((b.day-6)::timestamp at time zone 'Asia/Ho_Chi_Minh') and m.created_at<=now()
  group by 1,2,3
), sessions as (
  select s.*,least(now(),((s.day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')) as until,
    encode(sha256(convert_to('['||to_json(c.messenger_page_id)::text||','||to_json(c.messenger_psid)::text||']','UTF8')),'hex') as actor_key
  from starts s join public.extra_support_chats c on c.id=s.chat_id
), scoped as (
  select s.*,coalesce(refs.id,s.tagged_show) as show_id
  from sessions s
  cross join lateral (
    select min(id) as id,count(distinct id) as cnt from (
      select q.quote->>'showId' as id from public.extra_messenger_ai_quotes q
      where q.chat_id=s.chat_id and q.sent_at between s.started and s.until and (q.sent_at at time zone 'Asia/Ho_Chi_Minh')::date=s.day
      union all
      select p.show_id from public.extra_messenger_ai_orders a join public.extra_payment_orders p on p.code=a.order_code
      where a.chat_id=s.chat_id and a.created_at between s.started and s.until and (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date=s.day
      union all
      select sig.show_id from public.extra_messenger_show_signals sig where sig.actor_key=s.actor_key and sig.show_id is not null
        and sig.kind='ad' and sig.occurred_at>=(s.day::timestamp at time zone 'Asia/Ho_Chi_Minh') and sig.occurred_at<s.until
      union all
      select sh.id from public.managed_shows sh where sh.show_date between s.day and s.day+366 and length(sh.artist)>=4
        and exists(select 1 from public.extra_support_messages msg where msg.chat_id=s.chat_id and msg.sender='customer'
          and msg.created_at>=s.started and msg.created_at<s.until and position(lower(sh.artist) in lower(msg.body))>0)
    ) evidence
  ) refs
  where refs.cnt<=1
), stages as (
  select s.day,s.show_id,s.chat_id,
    exists(select 1 from public.extra_support_messages m where m.chat_id=s.chat_id and m.sender='staff' and m.created_at>=s.started and m.created_at<s.until) as replied,
    q.first_quote,checkout.created_order,checkout.paid_order,
    contacts.repeated,
    exists(select 1 from public.extra_messenger_ai_outbox ob join public.extra_payment_orders o on o.code=ob.order_code
      where ob.chat_id=s.chat_id and o.show_id=s.show_id and ob.purpose='payment' and ob.state='sent'
        and o.status='paid' and ob.sent_at>o.paid_at and ob.sent_at>=s.started and ob.sent_at<s.until) as paid_reprompt
  from scoped s join public.managed_shows confirmed on confirmed.id=s.show_id
  cross join lateral (
    select min(sent_at) as first_quote from public.extra_messenger_ai_quotes
    where chat_id=s.chat_id and quote->>'showId'=s.show_id and sent_at>=s.started and sent_at<s.until
  ) q
  cross join lateral (
    select count(*)>0 as created_order,coalesce(bool_or(o.status='paid' and o.amount_vnd>0 and not coalesce(o.is_vip_invitation,false)
      and o.paid_at>=a.created_at and o.paid_at<s.until),false) as paid_order
    from public.extra_messenger_ai_orders a join public.extra_payment_orders o on o.code=a.order_code and o.show_id=s.show_id
    join public.extra_messenger_ai_quotes linked on linked.id=a.quote_id and linked.chat_id=s.chat_id and linked.quote->>'showId'=s.show_id
    where a.chat_id=s.chat_id and linked.sent_at>=s.started and a.created_at>=linked.sent_at and a.created_at<s.until
  ) checkout
  cross join lateral (
    select (count(distinct job_id) filter(where body ~* '(e-?mail|gmail)')>1
       or count(distinct job_id) filter(where body ~* '(số điện thoại|sđt|điện thoại|phone)')>1) as repeated
    from public.extra_messenger_ai_outbox where chat_id=s.chat_id and state='sent' and purpose='reply'
      and sent_at>=s.started and sent_at<s.until and body ~* '(cho em xin|gửi (lại |giúp )?(em |mình )?|vui lòng (nhập|cung cấp)|kiểm tra lại|xin (lại )?(số|email|họ tên))'
  ) contacts
), counts as (
  select day,show_id,count(*) as inquiries,count(*) filter(where replied or first_quote is not null) as engaged,
    count(first_quote) as quoted,count(*) filter(where created_order) as checkout,count(*) filter(where paid_order) as paid,
    count(*) filter(where repeated) as repeated,count(*) filter(where paid_reprompt) as reprompt from stages group by 1,2
)
select jsonb_build_object('source','sale23_message_audit_v1','fromDay',b.day-6,'toDay',b.day,
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('day',days.day,'allInboundChats',days.n,'identifiedChats',coalesce(known.n,0)) order by days.day)
    from (select day,count(*) as n from starts group by day) days
    left join (select day,count(*) as n from stages group by day) known using (day)),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('day',day,'showId',show_id,'inquiryChats',inquiries,'engagedChats',engaged,
    'quotedChats',quoted,'checkoutChats',checkout,'paidChats',paid,'repeatedContactChats',repeated,'paidRepromptChats',reprompt)
    order by day,show_id) from counts),'[]'::jsonb)) from bounds b;
$$;
revoke all on function extra_os_reporting.music_sale_audit_v1() from public, anon, authenticated;
grant execute on function extra_os_reporting.music_sale_audit_v1() to service_role;

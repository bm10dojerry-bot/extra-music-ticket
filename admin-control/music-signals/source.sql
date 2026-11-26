create schema if not exists extra_os_reporting;
revoke all on schema extra_os_reporting from public,anon,authenticated;
grant usage on schema extra_os_reporting to service_role;
create table extra_os_reporting.music_ad_spend (
  observed_day date primary key,
  fetched_at timestamptz not null,
  rows jsonb not null check (jsonb_typeof(rows)='array' and jsonb_array_length(rows)<=2000)
);
revoke all on extra_os_reporting.music_ad_spend from public,anon,authenticated;
grant select on extra_os_reporting.music_ad_spend to service_role;
create or replace function public.extra_os_music_signals_v1()
returns jsonb language sql stable security invoker set search_path='' as $$
with bounds as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as day),
quotes as (select distinct q.quote->>'showId' as show_id,q.chat_id from public.extra_messenger_ai_quotes q,bounds b
 where q.sent_at>=((b.day-6)::timestamp at time zone 'Asia/Ho_Chi_Minh') and q.sent_at<=now() and q.chat_id is not null),
paid as (select distinct m.chat_id,o.show_id from public.extra_messenger_ai_orders m join public.extra_payment_orders o on o.code=m.order_code where o.status='paid' and not coalesce(o.is_vip_invitation,false) and o.paid_at<=now()),
counts as (select q.show_id,count(*)::int as quoted,count(p.chat_id)::int as linked from quotes q join public.managed_shows s on s.id=q.show_id left join paid p on p.chat_id=q.chat_id and p.show_id=q.show_id group by q.show_id)
select jsonb_build_object('source','music_sales_signals_v1','checkedAt',now(),'fromDay',b.day-6,'toDay',b.day,
 'messenger',coalesce((select jsonb_agg(jsonb_build_object('showId',show_id,'quotedChats',quoted,'linkedPaidChats',linked) order by show_id) from counts),'[]'::jsonb),
 'adDays',coalesce((select jsonb_agg(jsonb_build_object('day',a.observed_day,'fetchedAt',a.fetched_at,'rows',a.rows) order by a.observed_day) from extra_os_reporting.music_ad_spend a where a.observed_day between b.day-6 and b.day),'[]'::jsonb)) from bounds b;
$$;
revoke all on function public.extra_os_music_signals_v1() from public,anon,authenticated;
grant execute on function public.extra_os_music_signals_v1() to service_role;

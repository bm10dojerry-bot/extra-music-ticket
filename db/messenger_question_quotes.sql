alter table public.extra_messenger_ai_settings
  add column question_quotes_enabled boolean not null default false,
  add column question_quotes_test_psid text;

alter table public.extra_messenger_ai_settings
  add column short_followups_enabled boolean not null default false;

-- Claim the optional second message under the same chat lock as incoming messages.
-- The original job has already finished, so another shopper turn can start immediately.
create function public.extra_messenger_ai_claim_short_followup(p_job_id uuid,p_parent_id uuid,p_body text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  j public.extra_messenger_ai_jobs;
  c public.extra_support_chats;
  o public.extra_messenger_ai_outbox;
  latest public.extra_support_messages;
  claimed public.extra_messenger_ai_outbox;
begin
  if p_body is null or length(btrim(p_body)) not between 5 and 350 then return null; end if;
  select * into j from public.extra_messenger_ai_jobs where id=p_job_id and kind='inbound' and state='done';
  if not found then return null; end if;
  select * into c from public.extra_support_chats where id=j.chat_id for update;
  if c.status<>'open' or c.channel<>'messenger' or c.ai_mode<>'auto' or not public.extra_messenger_ai_is_active(c.id) then return null; end if;
  if not exists (select 1 from public.extra_messenger_ai_settings s where s.page_id=c.messenger_page_id and s.enabled and (s.short_followups_enabled or s.question_quotes_test_psid=c.messenger_psid)) then return null; end if;
  select * into o from public.extra_messenger_ai_outbox where id=p_parent_id and job_id=j.id and chat_id=c.id and state='sent' and purpose='reply' and order_code is null and quote_id is null and dedupe_key not like '%:short-tip';
  if not found or o.sent_at is null or clock_timestamp()-o.sent_at not between interval '5 seconds' and interval '15 seconds' then return null; end if;
  select * into latest from public.extra_support_messages where chat_id=c.id order by id desc limit 1;
  if latest.sender is distinct from 'staff' or latest.staff_name is distinct from 'EXTRA AI' or latest.external_message_id is distinct from o.external_message_id then return null; end if;
  if exists(select 1 from public.extra_support_messages where chat_id=c.id and id>j.source_message_id and (sender='customer' or staff_name is distinct from 'EXTRA AI')) then return null; end if;
  if exists(select 1 from public.extra_messenger_ai_state where chat_id=c.id and (status<>'in_progress' or current_order_code is not null)) then return null; end if;
  if exists(select 1 from public.extra_messenger_ai_outbox where chat_id=c.id and dedupe_key like '%:short-tip' and body=p_body and created_at>now()-interval '1 day') then return null; end if;
  insert into public.extra_messenger_ai_outbox(job_id,chat_id,dedupe_key,purpose,body,state,send_token,attempts,send_started_at)
  values(j.id,c.id,j.id::text||':short-tip','reply',p_body,'sending',gen_random_uuid(),1,clock_timestamp())
  on conflict(dedupe_key) do nothing returning * into claimed;
  if not found then return null; end if;
  return jsonb_build_object('id',claimed.id,'token',claimed.send_token,'psid',c.messenger_psid);
end;
$$;
revoke all on function public.extra_messenger_ai_claim_short_followup(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.extra_messenger_ai_claim_short_followup(uuid,uuid,text) to service_role;

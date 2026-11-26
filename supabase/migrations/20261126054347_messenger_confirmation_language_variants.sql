-- Applied to EXTRA Music production, migration 20261126054347.
-- Preserve existing service-role-only privileges, active quote, verified price, inventory and payment checks.
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_is_confirmation(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
 select length(coalesce(p_body,''))<=100 and
 replace(trim(regexp_replace(regexp_replace(regexp_replace(lower(normalize(coalesce(p_body,''),NFD)),U&'[\0300-\036f]','','g'),'[.!,]+',' ','g'),'[[:space:]]+',' ','g')),'đ','d')
 ~ '^((da|vang|u|uh|um) )?(ok|okay|oke|okie|okey|oki|o ke|uk|dong y|dong y dat ve|dong y mua ve|dong y lay ve|chot|chot ve|chot don|xac nhan|xac nhan dat ve|xac nhan mua ve|yes|duoc|duoc roi|nhat tri|dong y chot|ok chot|ok dat ve|vang|da|u|uh|um)( (em|anh|chi|nhe|nha|a|nhe em|em nhe|nha em|em nha|giup anh|giup chi|luon|luon em|a em|em a|anh nhe|chi nhe|e|minh))?$';
$function$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_reserve_quote(p_job_id uuid, p_lease_token uuid, p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare guard jsonb; chat uuid; source_id bigint; latest_id bigint; message_body text; message_time timestamptz;
 q public.extra_messenger_ai_quotes%rowtype; canonical jsonb; code text; token text; hold record; linked record; all_seats text[];
begin
 guard:=public.extra_messenger_ai_guard(p_job_id,p_lease_token);
 if guard->>'outcome' is distinct from 'ok' or guard->>'kind' is distinct from 'inbound' then raise exception 'AI_STALE_JOB'; end if;
 chat:=(guard->>'chat_id')::uuid;source_id:=(guard->>'source_message_id')::bigint;
 select * into q from public.extra_messenger_ai_quotes where id=p_quote_id and chat_id=chat for update;
 if not found then raise exception 'AI_QUOTE_NOT_FOUND'; end if;
 -- A committed reservation is the idempotent result of this exact quote.
 select o.code,o.expires_at into linked from public.extra_messenger_ai_orders a join public.extra_payment_orders o on o.code=a.order_code
  where a.quote_id=q.id and a.chat_id=chat;
 if found then return jsonb_build_object('outcome','existing','order_code',linked.code,'expires_at',linked.expires_at); end if;
 select id,body,created_at into latest_id,message_body,message_time from public.extra_support_messages where chat_id=chat and sender='customer' order by created_at desc,id desc limit 1;
 if source_id is null or latest_id is distinct from source_id or q.source_message_id=source_id
  or q.sent_at is null or message_time<=q.sent_at or q.expires_at<=now()
  or not public.extra_messenger_ai_is_confirmation(message_body)
  or exists(select 1 from public.extra_messenger_ai_quotes newer where newer.chat_id=chat and newer.created_at>q.created_at)
 then raise exception 'AI_CONFIRMATION_REQUIRED'; end if;
 -- Consecutive explicit affirmative replies are valid. Any intervening non-confirmation invalidates this quote.
 if exists(select 1 from public.extra_support_messages m where m.chat_id=chat and m.sender='customer' and m.created_at>q.sent_at and (m.created_at<message_time or (m.created_at=message_time and m.id<latest_id)) and not public.extra_messenger_ai_is_confirmation(m.body)) then raise exception 'AI_QUOTE_CHANGED'; end if;
 if exists(select 1 from public.extra_messenger_ai_orders a join public.extra_payment_orders o on o.code=a.order_code where a.chat_id=chat and (o.status='review' or (o.status='pending' and o.expires_at>now()))) then raise exception 'AI_ACTIVE_ORDER'; end if;
 canonical:=public.extra_messenger_ai_price_quote(q.quote);
 if canonical<>q.quote or md5(canonical::text)<>q.fingerprint then raise exception 'AI_QUOTE_CHANGED'; end if;
 select array_agg(value order by ordinal) into all_seats from (
  select value,ord as ordinal from jsonb_array_elements_text(canonical->'seats') with ordinality x(value,ord)
  union all select value,ord+100 as ordinal from jsonb_array_elements_text(canonical->'giftSeats') with ordinality x(value,ord)
 ) seats;
 code:='EX'||upper(left(replace(gen_random_uuid()::text,'-',''),16));
 token:=left(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),48);
 -- Existing reservation function serializes the show and rejects sold, held,
 -- legacy-paid and admin-blocked seats. Any failure rolls back the entire link.
 select * into hold from public.extra_reserve_order_with_commission(code,token,canonical->>'showId',canonical->>'venueId',all_seats,
  (canonical->>'amount')::bigint,canonical->>'name',canonical->>'phone',canonical->>'email',canonical->'commissionLines');
 if hold.order_code is null then raise exception 'AI_RESERVATION_FAILED'; end if;
 insert into public.extra_messenger_ai_orders(order_code,chat_id,quote_id) values(code,chat,q.id);
 update public.extra_messenger_ai_quotes set confirmed_message_id=source_id where id=q.id;
 -- Keep the held order recoverable even if the following Messenger send fails.
 insert into public.extra_messenger_ai_state(chat_id,status,summary,reason,current_order_code)
 values(chat,'awaiting_payment','Đã giữ ghế, đang chờ hệ thống xác nhận thanh toán.',null,code)
 on conflict(chat_id) do update set status='awaiting_payment',summary=excluded.summary,reason=null,current_order_code=excluded.current_order_code,updated_at=now();
 return jsonb_build_object('outcome','reserved','order_code',code,'expires_at',hold.expires_at);
end $function$;

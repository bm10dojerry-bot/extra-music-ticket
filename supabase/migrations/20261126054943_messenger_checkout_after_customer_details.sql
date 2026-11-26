-- Direct checkout after verified customer booking details; preserves legacy quote confirmation RPC.
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_details_ready(p_messages jsonb, p_quote jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r record; wanted text[]; mentioned text[]; raw text; normalized text; artist text; email text; phone text; buyer text;
  anchor integer:=0; seen_show boolean:=false; seen_email boolean:=false; seen_phone boolean:=false;
  has_email boolean; has_phone boolean; exact_seats boolean; customer_choice boolean; booking_prompt boolean;
  adverse boolean; latest_ready boolean:=false; last_sender text:='';
BEGIN
 IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_messages)>40 OR jsonb_typeof(p_quote) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 SELECT array_agg(DISTINCT value ORDER BY value) INTO wanted FROM (SELECT jsonb_array_elements_text(p_quote->'seats') AS value UNION ALL SELECT jsonb_array_elements_text(COALESCE(p_quote->'giftSeats','[]'::jsonb))) x;
 artist:=replace(regexp_replace(lower(normalize(COALESCE(p_quote->>'artist',''),NFD)),U&'[\0300-\036f]','','g'),'đ','d');
 email:=lower(trim(COALESCE(p_quote->>'email','')));
 phone:=regexp_replace(COALESCE(p_quote->>'phone',''),'[^0-9]','','g');
 buyer:=replace(regexp_replace(lower(normalize(COALESCE(p_quote->>'name',''),NFD)),U&'[\0300-\036f]','','g'),'đ','d');
 IF cardinality(wanted) IS NULL OR cardinality(wanted)=0 OR length(artist)<2 OR length(email)<5 OR length(phone)<9 THEN RETURN false; END IF;
 IF left(phone,2)='84' AND length(phone)=11 THEN phone:='0'||substring(phone from 3); END IF;
 FOR r IN SELECT value AS msg, ord::integer AS idx FROM jsonb_array_elements(p_messages) WITH ORDINALITY x(value,ord) ORDER BY ord LOOP
  raw:=COALESCE(r.msg->>'body','');
  normalized:=replace(regexp_replace(lower(normalize(raw,NFD)),U&'[\0300-\036f]','','g'),'đ','d');
  normalized:=trim(regexp_replace(normalized,'[[:space:]]+',' ','g'));
  last_sender:=COALESCE(r.msg->>'sender','');
  latest_ready:=false;
  IF last_sender NOT IN ('customer','staff') THEN CONTINUE; END IF;
  IF last_sender='staff' AND r.msg->>'staff_name' IS DISTINCT FROM 'EXTRA AI' THEN CONTINUE; END IF;
  IF strpos(normalized,artist)>0 THEN seen_show:=true; END IF;
  SELECT COALESCE(array_agg(DISTINCT a[1] ORDER BY a[1]),ARRAY[]::text[]) INTO mentioned FROM regexp_matches(upper(raw),'\m([A-O][0-9]{2})\M','g') a;
  exact_seats:=mentioned=wanted;
  adverse:=raw ~ '[?？]' OR normalized ~ '\m(khong dong y|chua dong y|chua chot|chua dat|khong dat|khong mua|khong lay|doi ghe|doi cho|doi ngay|doi show|show khac|doi suat|huy|tham khao|chi hoi|neu|gia su|de khi khac)\M';
  IF last_sender='customer' THEN
   IF adverse OR (anchor>0 AND cardinality(mentioned)>0 AND NOT mentioned<@wanted) THEN anchor:=0; END IF;
   SELECT EXISTS(SELECT 1 FROM regexp_matches(lower(raw),'[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','g') a WHERE a[1]=email) INTO has_email;
   SELECT EXISTS(SELECT 1 FROM regexp_matches(raw,'[+]?[0-9][0-9 ().-]{7,20}[0-9]','g') a CROSS JOIN LATERAL (SELECT regexp_replace(a[1],'[^0-9]','','g') AS digits) d WHERE d.digits=phone OR (left(d.digits,2)='84' AND length(d.digits)=11 AND '0'||substring(d.digits from 3)=phone)) INTO has_phone;
   seen_email:=seen_email OR has_email; seen_phone:=seen_phone OR has_phone;
   customer_choice:=exact_seats AND NOT adverse AND (normalized ~ '\m(chot|lay|chon|dat|mua|giu)\M' OR regexp_replace(normalized,'\m[a-o][0-9]{2}\M|[[:space:],.;+–—-]','','g') ~ '^(a|nhe|nha|em)?$');
   IF customer_choice AND seen_show THEN anchor:=r.idx; END IF;
   latest_ready:=NOT adverse AND (has_email OR has_phone OR customer_choice OR (length(buyer)>2 AND normalized=buyer) OR (anchor>0 AND public.extra_messenger_ai_is_confirmation(raw)));
  ELSE
   booking_prompt:=exact_seats AND normalized ~ '\m(xin|cho|gui)\M' AND normalized ~ '\m(email|mail|dien thoai|sdt)\M' AND normalized ~ '\m(dat ve|lap don|giu ghe|thanh toan)\M';
   IF booking_prompt AND seen_show AND normalized !~ '\m(tham khao|chi hoi|khong dat)\M' THEN anchor:=r.idx; END IF;
  END IF;
 END LOOP;
 RETURN anchor>0 AND seen_email AND seen_phone AND latest_ready AND last_sender='customer';
END
$function$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_checkout_details(p_job_id uuid, p_lease_token uuid, p_quote_id uuid)
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
 if source_id is null or latest_id is distinct from source_id or q.source_message_id is distinct from source_id
  or q.job_id is distinct from p_job_id or q.sent_at is not null or q.confirmed_message_id is not null or q.expires_at<=now()
  or exists(select 1 from public.extra_messenger_ai_quotes newer where newer.chat_id=chat and newer.created_at>q.created_at)
 then raise exception 'AI_DETAILS_NOT_READY'; end if;
 IF NOT public.extra_messenger_ai_details_ready(
  (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM
    (SELECT id,sender,body,staff_name FROM public.extra_support_messages WHERE chat_id=chat AND created_at>=now()-interval '30 minutes' AND id<=source_id ORDER BY id DESC LIMIT 32) h),
  q.quote) THEN raise exception 'AI_DETAILS_NOT_READY'; END IF;
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
REVOKE ALL ON FUNCTION public.extra_messenger_ai_details_ready(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_details_ready(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_checkout_details(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_checkout_details(uuid,uuid,uuid) TO service_role;

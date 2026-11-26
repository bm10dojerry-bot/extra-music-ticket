-- Two separately deduplicated follow-ups: 3 and 60 minutes.
-- Keep the previous stage values for immutable historical records.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.extra_messenger_ai_followup_control WHERE singleton AND enabled) THEN
   RAISE EXCEPTION 'Disable follow-up before migrating';
 END IF;
END $guard$;
ALTER TABLE public.extra_messenger_ai_followup_ledger
 DROP CONSTRAINT extra_messenger_ai_followup_ledger_stage_check;
ALTER TABLE public.extra_messenger_ai_followup_ledger
 ADD CONSTRAINT extra_messenger_ai_followup_ledger_stage_check CHECK(stage IN (3,10,30,60));

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_stage(p_anchor timestamptz,p_first_sent timestamptz,p_first_state text,p_now timestamptz)
RETURNS smallint LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $fn$
 SELECT CASE
 WHEN p_first_state IS NULL AND p_first_sent IS NULL
   AND p_anchor > p_now-interval '60 minutes' AND p_anchor <= p_now-interval '3 minutes' THEN 3::smallint
 WHEN p_first_state='sent' AND p_first_sent >= p_anchor+interval '3 minutes'
   AND p_anchor >= p_now-interval '120 minutes' AND p_anchor <= p_now-interval '60 minutes'
   AND p_first_sent <= p_now-interval '57 minutes' THEN 60::smallint
 ELSE NULL::smallint END
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_phone_key(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $fn$
 WITH k AS (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d)
 SELECT CASE WHEN btrim(coalesce(p_phone,'')) !~ '^[+0-9 ().-]{9,24}$' THEN NULL
 WHEN d ~ '^84[0-9]{9}$' THEN '0'||substr(d,3)
 WHEN d ~ '^[0-9]{9,15}$' THEN d ELSE NULL END FROM k
$fn$;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_email_key(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $fn$
 SELECT CASE WHEN length(btrim(p_email))<=254 AND btrim(p_email) ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' THEN lower(btrim(p_email)) ELSE NULL END
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_has_order(p_chat_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog,public AS $fn$
 WITH contacts AS (
   SELECT c.customer_phone phone,NULL::text email FROM public.extra_support_chats c WHERE c.id=p_chat_id
   UNION ALL SELECT q.quote->>'phone',q.quote->>'email' FROM public.extra_messenger_ai_quotes q WHERE q.chat_id=p_chat_id
   UNION ALL SELECT r.parts[2],NULL::text FROM public.extra_support_messages m
     CROSS JOIN LATERAL regexp_matches(m.body,'(^|[^0-9])((?:[+]84|84|0)(?:[ .-]?[0-9]){9})(?![0-9])','g') r(parts)
     WHERE m.chat_id=p_chat_id AND m.sender='customer'
   UNION ALL SELECT NULL::text,r.parts[1] FROM public.extra_support_messages m
     CROSS JOIN LATERAL regexp_matches(m.body,'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,})','g') r(parts)
     WHERE m.chat_id=p_chat_id AND m.sender='customer'
 ), keys AS (
   SELECT DISTINCT public.extra_messenger_ai_followup_phone_key(phone) phone,
     public.extra_messenger_ai_followup_email_key(email) email FROM contacts
 ), purchases AS (
   SELECT 1 FROM public.extra_messenger_ai_orders x JOIN public.extra_payment_orders o ON o.code=x.order_code
     WHERE x.chat_id=p_chat_id AND o.status IN ('paid','review','pending')
   UNION ALL SELECT 1 FROM public.extra_payment_orders o JOIN keys k
     ON (k.phone IS NOT NULL AND k.phone=public.extra_messenger_ai_followup_phone_key(o.buyer_phone))
      OR (k.email IS NOT NULL AND k.email=public.extra_messenger_ai_followup_email_key(o.buyer_email))
     WHERE o.status IN ('paid','review','pending')
   UNION ALL SELECT 1 FROM public.ticket_sales t JOIN keys k
     ON k.email IS NOT NULL AND k.email=public.extra_messenger_ai_followup_email_key(t.customer_email)
     WHERE t.payment_verified IS TRUE
 )
 SELECT EXISTS(SELECT 1 FROM purchases)
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_next_show()
RETURNS TABLE(show_id text,artist text,days_remaining integer)
LANGUAGE sql STABLE SET search_path TO pg_catalog,public AS $fn$
 SELECT s.id,s.artist,s.show_date-(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 FROM public.managed_shows s
 WHERE s.status='announced' AND s.id ~ '^[A-Za-z0-9_-]{1,100}$'
 AND length(btrim(s.artist)) BETWEEN 1 AND 150
 AND s.prices IS NOT NULL AND s.prices<>'{}'::jsonb
 AND CASE WHEN s.show_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          THEN s.show_date+s.show_time::time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
          ELSE false END
 ORDER BY s.show_date,s.show_time,s.id LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_candidate(p_page_id text,p_chat_id uuid,p_own_claim uuid)
RETURNS TABLE(chat_id uuid,customer_message_id bigint,anchor_reply_id bigint,stage smallint,anchor_at timestamptz)
LANGUAGE sql STABLE SET search_path TO pg_catalog,public AS $fn$
 SELECT c.id,cm.id,a.id,d.stage,a.created_at
 FROM public.extra_support_chats c
 JOIN public.extra_messenger_ai_settings cfg ON cfg.page_id=c.messenger_page_id AND cfg.enabled AND cfg.provider_checked_at IS NOT NULL AND cfg.provider_error IS NULL
 JOIN public.extra_messenger_ai_state st ON st.chat_id=c.id AND st.status='in_progress' AND st.current_order_code IS NULL
 JOIN LATERAL (SELECT m.id,m.body,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' ORDER BY m.id DESC LIMIT 1) cm ON true
 JOIN LATERAL (SELECT m.id,m.sender,m.staff_name,m.external_message_id,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) lm ON true
 LEFT JOIN public.extra_messenger_ai_followup_ledger f ON f.chat_id=c.id AND f.customer_message_id=cm.id AND f.stage=3 AND f.id IS DISTINCT FROM p_own_claim
 JOIN public.extra_support_messages a ON a.id=coalesce(f.anchor_reply_id,lm.id) AND a.chat_id=c.id AND a.sender='staff' AND a.staff_name='EXTRA AI'
 CROSS JOIN LATERAL (SELECT public.extra_messenger_ai_followup_stage(a.created_at,f.sent_at,f.state,now()) stage) d
 WHERE c.channel='messenger' AND c.messenger_page_id=p_page_id
 AND (p_chat_id IS NULL OR c.id=p_chat_id)
 AND c.status='open' AND c.ai_mode='auto' AND c.ai_started_at IS NOT NULL AND c.assigned_staff_id IS NULL
 AND c.messenger_psid ~ '^[0-9]{5,80}$' AND c.messenger_psid IS DISTINCT FROM cfg.question_quotes_test_psid
 AND c.last_customer_at BETWEEN now()-interval '23 hours 59 minutes' AND now()
 AND cm.created_at BETWEEN now()-interval '23 hours 59 minutes' AND now()
 AND c.last_staff_at>=c.last_customer_at AND c.last_customer_at<=a.created_at
 AND a.external_message_id IS NOT NULL AND a.id>cm.id AND a.created_at>=cm.created_at
 AND lm.sender='staff' AND lm.staff_name='EXTRA AI'
 AND d.stage IS NOT NULL
 AND (f.id IS NULL OR (f.state='sent' AND f.external_message_id IS NOT NULL AND f.external_message_id=lm.external_message_id AND lm.id>a.id))
 AND public.extra_messenger_ai_followup_consultation_intent(cm.body)
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' AND lower(m.body) ~ '(đừng nhắn|ngừng nhắn|không mua|không đi|không cần|đã mua|mua rồi|đã đặt|đặt rồi|đã thanh toán|thanh toán rồi|đã chuyển khoản|chuyển khoản rồi|đã ck|ck rồi|đã cọc|cọc rồi|đã book|book rồi|đã nhận vé|nhận vé rồi|có vé rồi|đã có vé|khiếu nại|hoàn tiền|thử nghiệm)')
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.id>cm.id AND m.sender='staff' AND m.staff_name IS DISTINCT FROM 'EXTRA AI')
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_followup_ledger x WHERE x.chat_id=c.id AND x.id IS DISTINCT FROM p_own_claim AND x.id IS DISTINCT FROM f.id AND (x.customer_message_id=cm.id OR x.created_at>=now()-interval '60 minutes'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_jobs j WHERE j.chat_id=c.id AND j.state IN ('queued','running'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_outbox o WHERE o.chat_id=c.id AND (o.state IN ('sending','uncertain') OR (o.state='failed' AND o.created_at>=cm.created_at)))
 AND NOT public.extra_messenger_ai_followup_has_order(c.id)
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_day_before r WHERE r.chat_id=c.id AND r.claimed_at>=now()-interval '24 hours')
 AND (SELECT count(*) FROM public.extra_messenger_ai_followup_ledger x WHERE x.state IN ('failed','uncertain') AND x.created_at>=now()-interval '15 minutes') < 3
 AND (d.stage<>60 OR EXISTS(SELECT 1 FROM public.extra_messenger_ai_followup_next_show()))
 ORDER BY a.created_at ASC,c.id
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_verify(p_id uuid,p_claim_token uuid,p_page_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $fn$
DECLARE l public.extra_messenger_ai_followup_ledger%rowtype; c public.extra_support_chats%rowtype; d record; s record; cid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.extra_messenger_ai_followup_control WHERE singleton AND enabled) THEN RETURN jsonb_build_object('outcome','disabled'); END IF;
 SELECT chat_id INTO cid FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO c FROM public.extra_support_chats WHERE id=cid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO l FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR l.claim_token IS DISTINCT FROM p_claim_token OR l.state<>'sending' OR l.stage NOT IN (3,60) OR l.created_at<=clock_timestamp()-interval '45 seconds' THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO d FROM public.extra_messenger_ai_followup_candidate(p_page_id,c.id,l.id);
 IF NOT FOUND OR d.customer_message_id IS DISTINCT FROM l.customer_message_id OR d.anchor_reply_id IS DISTINCT FROM l.anchor_reply_id OR d.stage IS DISTINCT FROM l.stage THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 IF l.stage=60 THEN
   SELECT * INTO s FROM public.extra_messenger_ai_followup_next_show();
   IF NOT FOUND THEN RETURN jsonb_build_object('outcome','no_show'); END IF;
   RETURN jsonb_build_object('outcome','ok','psid',c.messenger_psid,'show_id',s.show_id,'artist',s.artist,'days_remaining',s.days_remaining);
 END IF;
 RETURN jsonb_build_object('outcome','ok','psid',c.messenger_psid);
END $fn$;

REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_stage(timestamptz,timestamptz,text,timestamptz),public.extra_messenger_ai_followup_phone_key(text),public.extra_messenger_ai_followup_email_key(text),public.extra_messenger_ai_followup_has_order(uuid),public.extra_messenger_ai_followup_next_show(),public.extra_messenger_ai_followup_candidate(text,uuid,uuid),public.extra_messenger_ai_followup_verify(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_followup_stage(timestamptz,timestamptz,text,timestamptz),public.extra_messenger_ai_followup_phone_key(text),public.extra_messenger_ai_followup_email_key(text),public.extra_messenger_ai_followup_has_order(uuid),public.extra_messenger_ai_followup_next_show(),public.extra_messenger_ai_followup_candidate(text,uuid,uuid),public.extra_messenger_ai_followup_verify(uuid,uuid,text) TO service_role;

DO $test$
DECLARE t timestamptz := '2026-11-26 20:00:00+07';
BEGIN
 IF public.extra_messenger_ai_followup_stage(t-interval '179 sec',NULL,NULL,t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '3 min',NULL,NULL,t) IS DISTINCT FROM 3::smallint
 OR public.extra_messenger_ai_followup_stage(t-interval '59 min',NULL,NULL,t) IS DISTINCT FROM 3::smallint
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',NULL,NULL,t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '59 min',t-interval '56 min','sent',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',t-interval '57 min','sent',t) IS DISTINCT FROM 60::smallint
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',t-interval '56 min','sent',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',NULL,'failed',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',NULL,'uncertain',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '121 min',t-interval '118 min','sent',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_stage(t-interval '60 min',t-interval '59 min','sent',t) IS NOT NULL
 OR public.extra_messenger_ai_followup_phone_key('+84 912 345 678') IS DISTINCT FROM public.extra_messenger_ai_followup_phone_key('0912345678')
 OR public.extra_messenger_ai_followup_phone_key('abc') IS NOT NULL
 OR public.extra_messenger_ai_followup_email_key(' EXAMPLE@EXAMPLE.COM ') IS DISTINCT FROM 'example@example.com'
 OR public.extra_messenger_ai_followup_email_key('invalid') IS NOT NULL
 THEN RAISE EXCEPTION 'AI Sale two-stage follow-up self-test failed'; END IF;
END $test$;


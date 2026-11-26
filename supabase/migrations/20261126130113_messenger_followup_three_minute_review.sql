-- Single follow-up after three minutes, with a sixty-minute rolling review window.
-- Preserve stage 10 as the existing ledger and deployed worker compatibility key.
DO $check$ BEGIN
 IF EXISTS (SELECT 1 FROM public.extra_messenger_ai_followup_control WHERE singleton AND enabled) THEN
  RAISE EXCEPTION 'Keep follow-up disabled while migrating';
 END IF;
END $check$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_window(p_customer_at timestamptz,p_reply_at timestamptz,p_now timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $fn$
 SELECT coalesce(p_customer_at <= p_reply_at
   AND p_customer_at >= p_now - interval '23 hours 59 minutes'
   AND p_reply_at BETWEEN p_now - interval '60 minutes' AND p_now - interval '3 minutes',false)
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_consultation_intent(p_body text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $fn$
 SELECT coalesce(
   length(btrim(p_body)) BETWEEN 1 AND 300
   AND (public.extra_messenger_ai_followup_intent(p_body)
     OR lower(p_body) ~ '(lịch diễn|lịch show|giờ diễn|mấy giờ|địa điểm|ở đâu|bao nhiêu|giá.*vé|giá.*ghế|hạng.*vé|sơ đồ ghế|ghế.*ngồi|vé.*ghế|[0-9]+[[:space:]]*(người|khách|vé|ghế)|phân vân.*vé|tư vấn.*vé)')
   AND lower(p_body) !~ '(không mua|không đi|không đặt|không lấy|không cần|đừng nhắn|ngừng nhắn|khỏi|thôi|huỷ|hủy|từ chối|đã mua|mua rồi|đã đặt|đặt rồi|thanh toán|chuyển khoản|mã đơn|mã vé|lỗi|khiếu nại|hoàn tiền|ảnh|không phải|nhầm|quần|áo|đùa|test|thử nghiệm|chưa muốn|để sau|để hôm khác|chưa cần|tham khảo|sẽ báo|sẽ liên hệ|tự liên hệ|để mình xem|để anh xem|để chị xem|để em xem)'
 ,false)
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_candidate(p_page_id text,p_chat_id uuid,p_own_claim uuid)
RETURNS TABLE(chat_id uuid,customer_message_id bigint,anchor_reply_id bigint,stage smallint,anchor_at timestamptz)
LANGUAGE sql STABLE SET search_path TO pg_catalog,public AS $fn$
 SELECT c.id,cm.id,a.id,10::smallint,a.created_at
 FROM public.extra_support_chats c
 JOIN public.extra_messenger_ai_settings cfg ON cfg.page_id=c.messenger_page_id AND cfg.enabled AND cfg.provider_checked_at IS NOT NULL AND cfg.provider_error IS NULL
 JOIN public.extra_messenger_ai_state st ON st.chat_id=c.id AND st.status='in_progress' AND st.current_order_code IS NULL
 JOIN LATERAL (SELECT m.id,m.body,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' ORDER BY m.id DESC LIMIT 1) cm ON true
 JOIN LATERAL (SELECT m.id,m.sender,m.staff_name,m.external_message_id,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) a ON true
 WHERE c.channel='messenger' AND c.messenger_page_id=p_page_id
 AND (p_chat_id IS NULL OR c.id=p_chat_id)
 AND c.status='open' AND c.ai_mode='auto' AND c.ai_started_at IS NOT NULL AND c.assigned_staff_id IS NULL
 AND c.messenger_psid ~ '^[0-9]{5,80}$' AND c.messenger_psid IS DISTINCT FROM cfg.question_quotes_test_psid
 AND c.last_customer_at BETWEEN now()-interval '23 hours 59 minutes' AND now()
 AND c.last_staff_at>=c.last_customer_at AND c.last_customer_at<=a.created_at
 AND a.sender='staff' AND a.staff_name='EXTRA AI' AND a.external_message_id IS NOT NULL
 AND a.id>cm.id AND public.extra_messenger_ai_followup_window(cm.created_at,a.created_at,now())
 AND public.extra_messenger_ai_followup_consultation_intent(cm.body)
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' AND m.created_at>=now()-interval '24 hours' AND lower(m.body) ~ '(đừng nhắn|ngừng nhắn|không mua|không đi|không cần|đã mua|mua rồi|đã đặt|đặt rồi|khiếu nại|hoàn tiền|thử nghiệm)')
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.id>cm.id AND m.sender='staff' AND m.staff_name IS DISTINCT FROM 'EXTRA AI')
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_followup_ledger x WHERE x.chat_id=c.id AND x.id IS DISTINCT FROM p_own_claim AND (x.customer_message_id=cm.id OR x.created_at>=now()-interval '60 minutes'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_jobs j WHERE j.chat_id=c.id AND j.state IN ('queued','running'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_outbox o WHERE o.chat_id=c.id AND (o.state IN ('sending','uncertain') OR (o.state='failed' AND o.created_at>=cm.created_at)))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_orders x JOIN public.extra_payment_orders o ON o.code=x.order_code WHERE x.chat_id=c.id AND o.status IN ('paid','review','pending'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_day_before d WHERE d.chat_id=c.id AND d.claimed_at>=now()-interval '24 hours')
 AND (SELECT count(*) FROM public.extra_messenger_ai_followup_ledger x WHERE x.state IN ('failed','uncertain') AND x.created_at>=now()-interval '15 minutes') < 3
 ORDER BY a.created_at ASC,c.id
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_due(p_page_id text,p_chat_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(chat_id uuid,customer_message_id bigint,anchor_reply_id bigint,stage smallint,anchor_at timestamptz)
LANGUAGE sql STABLE SET search_path TO pg_catalog,public AS $fn$
 SELECT * FROM public.extra_messenger_ai_followup_candidate(p_page_id,p_chat_id,NULL::uuid)
$fn$;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_verify(p_id uuid,p_claim_token uuid,p_page_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $fn$
DECLARE l public.extra_messenger_ai_followup_ledger%rowtype; c public.extra_support_chats%rowtype; d record; cid uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_followup_control WHERE singleton AND enabled) THEN
  RETURN jsonb_build_object('outcome','disabled');
 END IF;
 SELECT chat_id INTO cid FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO c FROM public.extra_support_chats WHERE id=cid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO l FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR l.claim_token IS DISTINCT FROM p_claim_token OR l.state<>'sending' OR l.stage<>10 OR l.created_at<=clock_timestamp()-interval '45 seconds' THEN
  RETURN jsonb_build_object('outcome','stale');
 END IF;
 SELECT * INTO d FROM public.extra_messenger_ai_followup_candidate(p_page_id,c.id,l.id);
 IF NOT FOUND OR d.customer_message_id IS DISTINCT FROM l.customer_message_id OR d.anchor_reply_id IS DISTINCT FROM l.anchor_reply_id OR d.stage IS DISTINCT FROM l.stage THEN
  RETURN jsonb_build_object('outcome','stale');
 END IF;
 RETURN jsonb_build_object('outcome','ok','psid',c.messenger_psid);
END
$fn$;

REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_window(timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_consultation_intent(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_candidate(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_due(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_followup_verify(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_followup_window(timestamptz,timestamptz,timestamptz),public.extra_messenger_ai_followup_consultation_intent(text),public.extra_messenger_ai_followup_candidate(text,uuid,uuid),public.extra_messenger_ai_followup_due(text,uuid),public.extra_messenger_ai_followup_verify(uuid,uuid,text) TO service_role;

-- Deterministic assertions. No customer data is inserted, changed or sent.
DO $test$
DECLARE t timestamptz := '2026-11-26 20:00:00+07';
BEGIN
 IF public.extra_messenger_ai_followup_window(t-interval '10 min',t-interval '179 sec',t)
  OR NOT public.extra_messenger_ai_followup_window(t-interval '10 min',t-interval '180 sec',t)
  OR NOT public.extra_messenger_ai_followup_window(t-interval '61 min',t-interval '60 min',t)
  OR public.extra_messenger_ai_followup_window(t-interval '61 min',t-interval '3601 sec',t)
  OR public.extra_messenger_ai_followup_window(t-interval '2 min',t-interval '3 min',t)
  OR public.extra_messenger_ai_followup_window(t-interval '24 hours',t-interval '3 min',t)
  OR public.extra_messenger_ai_followup_window(NULL,t-interval '3 min',t)
  OR NOT public.extra_messenger_ai_followup_consultation_intent('Cho mình xin giá vé')
  OR NOT public.extra_messenger_ai_followup_consultation_intent('Đi 2 người')
  OR public.extra_messenger_ai_followup_consultation_intent('Không mua vé nữa')
  OR public.extra_messenger_ai_followup_consultation_intent('Đã chuyển khoản mua vé')
  OR public.extra_messenger_ai_followup_consultation_intent('Để sau mình đặt vé')
  OR public.extra_messenger_ai_followup_consultation_intent('Cảm ơn')
 THEN RAISE EXCEPTION 'AI Sale follow-up policy self-test failed'; END IF;
END $test$;


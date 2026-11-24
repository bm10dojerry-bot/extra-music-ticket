-- Durable Messenger text ownership. A short chat-row transaction gates every transition.
-- Calls to the Messenger Send API are always outside these transactions.
CREATE SCHEMA IF NOT EXISTS extra_messenger_private;
REVOKE ALL ON SCHEMA extra_messenger_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA extra_messenger_private TO service_role;

ALTER TABLE public.extra_support_chats
  ADD COLUMN messenger_ai_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN messenger_last_human_at timestamptz,
  ADD COLUMN messenger_last_ai_at timestamptz,
  ADD COLUMN messenger_human_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN messenger_human_request_id bigint,
  ADD COLUMN messenger_referral jsonb,
  ADD COLUMN messenger_referral_at timestamptz,
  ADD COLUMN messenger_ai_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN messenger_ai_greeted boolean NOT NULL DEFAULT false,
  ADD COLUMN messenger_ai_disclosed boolean NOT NULL DEFAULT false,
  ADD COLUMN messenger_latest_customer_id bigint NOT NULL DEFAULT 0,
  ADD COLUMN messenger_latest_customer_at timestamptz,
  ADD COLUMN messenger_handled_message_id bigint NOT NULL DEFAULT 0,
  ADD COLUMN messenger_active_send uuid;

ALTER TABLE public.extra_support_messages
  DROP CONSTRAINT extra_support_messages_sender_check,
  ADD CONSTRAINT extra_support_messages_sender_check CHECK (sender IN ('customer', 'staff', 'ai')),
  ADD COLUMN messenger_sent_at timestamptz;

CREATE INDEX extra_messenger_ai_queue_idx
  ON public.extra_support_chats (messenger_page_id, messenger_latest_customer_at, id)
  WHERE messenger_ai_managed AND status = 'open' AND NOT messenger_human_requested;

CREATE TABLE extra_messenger_private.send_attempts (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.extra_support_chats (id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('staff', 'ai')),
  status text NOT NULL CHECK (status IN ('composing', 'sending', 'sent', 'unknown', 'retry', 'rejected', 'cancelled')),
  through_message_id bigint NOT NULL,
  lease_until timestamptz NOT NULL,
  sending_at timestamptz,
  referral_at timestamptz,
  body text,
  staff_name text,
  staff_request_id uuid,
  context jsonb,
  greeted boolean NOT NULL DEFAULT false,
  ai_disclosed boolean NOT NULL DEFAULT false,
  meta_mid text,
  UNIQUE (chat_id, staff_request_id)
);
ALTER TABLE extra_messenger_private.send_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE extra_messenger_private.send_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE extra_messenger_private.send_attempts TO service_role;

CREATE FUNCTION extra_messenger_private.human_active(p_last timestamptz, p_now timestamptz)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT p_last IS NOT NULL AND p_now < p_last + INTERVAL '180 seconds';
$$;

CREATE FUNCTION extra_messenger_private.apply_referral(p_chat_id uuid, p_referral jsonb, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  IF p_referral IS NULL OR jsonb_typeof(p_referral) <> 'object' THEN RETURN; END IF;
  p_referral := jsonb_strip_nulls(jsonb_build_object(
    'ref', CASE WHEN jsonb_typeof(p_referral->'ref') = 'string' AND length(p_referral->>'ref') BETWEEN 1 AND 300 THEN p_referral->'ref' END,
    'adId', CASE WHEN p_referral->>'adId' ~ '^[0-9]{3,40}$' THEN to_jsonb(p_referral->>'adId') END
  ));
  IF p_referral = '{}'::jsonb THEN RETURN; END IF;
  UPDATE public.extra_support_chats
     SET messenger_referral = p_referral, messenger_referral_at = p_at
   WHERE id = p_chat_id AND (messenger_referral_at IS NULL OR messenger_referral_at <= p_at);
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_ingest(
  p_page_id text, p_psid text, p_mid text, p_text text, p_sent_at timestamptz,
  p_referral jsonb, p_request_human boolean
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_received jsonb;
  v_chat uuid;
  v_message bigint;
  v_at timestamptz := LEAST(COALESCE(p_sent_at, clock_timestamp()), clock_timestamp());
BEGIN
  IF p_page_id IS NULL OR p_psid IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  v_received := public.extra_support_ingest_messenger(p_page_id, p_psid, p_mid, p_text);
  IF v_received->>'outcome' <> 'received' THEN RETURN v_received; END IF;
  v_chat := (v_received->>'chat_id')::uuid;
  v_message := (v_received->>'message_id')::bigint;
  UPDATE public.extra_support_messages SET messenger_sent_at = v_at WHERE id = v_message;
  -- Honor staff who were already responding before enrollment. Older history stays available to the worker.
  UPDATE public.extra_support_chats c
     SET messenger_ai_managed = true,
         messenger_last_human_at = CASE WHEN c.messenger_ai_managed THEN c.messenger_last_human_at ELSE c.last_staff_at END,
         messenger_ai_greeted = c.messenger_ai_greeted OR (NOT c.messenger_ai_managed AND c.last_staff_at IS NOT NULL),
         messenger_latest_customer_id = v_message,
         messenger_latest_customer_at = GREATEST(c.messenger_latest_customer_at, v_at),
         messenger_handled_message_id = CASE WHEN c.messenger_ai_managed THEN c.messenger_handled_message_id
           ELSE COALESCE((SELECT max(m.id) FROM public.extra_support_messages m
                            WHERE m.chat_id = v_chat AND m.sender = 'customer' AND m.id < v_message), 0) END,
         messenger_human_requested = c.messenger_human_requested OR COALESCE(p_request_human, false),
         messenger_human_request_id = CASE WHEN COALESCE(p_request_human, false) THEN v_message ELSE c.messenger_human_request_id END,
         assigned_staff_id = CASE WHEN NOT c.messenger_ai_managed AND NOT COALESCE(p_request_human, false)
               AND NOT extra_messenger_private.human_active(c.last_staff_at, clock_timestamp()) THEN NULL ELSE c.assigned_staff_id END,
         assigned_at = CASE WHEN NOT c.messenger_ai_managed AND NOT COALESCE(p_request_human, false)
               AND NOT extra_messenger_private.human_active(c.last_staff_at, clock_timestamp()) THEN NULL ELSE c.assigned_at END
   WHERE c.id = v_chat;
  PERFORM extra_messenger_private.apply_referral(v_chat, p_referral, v_at);
  RETURN v_received;
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_record_referral(
  p_page_id text, p_psid text, p_referral jsonb, p_sent_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat uuid;
  v_at timestamptz := LEAST(COALESCE(p_sent_at, clock_timestamp()), clock_timestamp());
BEGIN
  IF p_page_id IS NULL OR p_psid IS NULL OR p_page_id !~ '^[0-9]{5,40}$' OR p_psid !~ '^[0-9]{5,80}$'
     OR p_referral IS NULL OR jsonb_typeof(p_referral) <> 'object'
  THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_page_id), hashtext(p_psid));
  INSERT INTO public.extra_support_chats (access_hash, customer_name, channel, messenger_page_id, messenger_psid, status, messenger_ai_managed)
  VALUES (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          'Khách Messenger', 'messenger', p_page_id, p_psid, 'open', true)
  ON CONFLICT (messenger_page_id, messenger_psid)
    WHERE messenger_page_id IS NOT NULL AND messenger_psid IS NOT NULL DO NOTHING;
  SELECT c.id INTO v_chat FROM public.extra_support_chats c
   WHERE c.messenger_page_id = p_page_id AND c.messenger_psid = p_psid FOR UPDATE;
  PERFORM extra_messenger_private.apply_referral(v_chat, p_referral, v_at);
  RETURN jsonb_build_object('outcome', 'recorded', 'chat_id', v_chat);
END;
$$;

-- A successful human reply consumes only the customer messages visible when it was authorized.
-- A native inbox echo uses its signed event timestamp to establish the same cutoff.
CREATE FUNCTION extra_messenger_private.record_staff_activity(
  p_chat_id uuid, p_at timestamptz, p_through bigint, p_delivered boolean
) RETURNS void
LANGUAGE sql SET search_path = pg_catalog
AS $$
  UPDATE public.extra_support_chats c
     SET messenger_last_human_at = GREATEST(c.messenger_last_human_at, p_at),
         messenger_ai_greeted = c.messenger_ai_greeted OR p_delivered,
         messenger_handled_message_id = CASE WHEN p_through IS NULL THEN c.messenger_handled_message_id
            ELSE GREATEST(c.messenger_handled_message_id, p_through) END,
         messenger_human_requested = CASE WHEN p_delivered AND c.messenger_human_request_id <= p_through THEN false
            ELSE c.messenger_human_requested END,
         messenger_human_request_id = CASE WHEN p_delivered AND c.messenger_human_request_id <= p_through THEN NULL
            ELSE c.messenger_human_request_id END,
         last_staff_at = CASE WHEN p_delivered THEN GREATEST(c.last_staff_at, p_at) ELSE c.last_staff_at END,
         updated_at = CASE WHEN p_delivered THEN GREATEST(c.updated_at, p_at) ELSE c.updated_at END
   WHERE c.id = p_chat_id;
$$;

CREATE FUNCTION public.extra_messenger_ai_record_human_echo(
  p_page_id text, p_psid text, p_mid text, p_text text, p_sent_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat uuid;
  v_message bigint;
  v_through bigint;
  v_at timestamptz := LEAST(COALESCE(p_sent_at, clock_timestamp()), clock_timestamp());
BEGIN
  IF p_page_id IS NULL OR p_psid IS NULL OR p_page_id !~ '^[0-9]{5,40}$' OR p_psid !~ '^[0-9]{5,80}$'
     OR p_mid IS NULL OR length(p_mid) NOT BETWEEN 4 AND 200 OR length(COALESCE(p_text, '')) > 1200
  THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_page_id), hashtext(p_psid));
  INSERT INTO public.extra_support_chats (access_hash, customer_name, channel, messenger_page_id, messenger_psid, status, messenger_ai_managed)
  VALUES (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          'Khách Messenger', 'messenger', p_page_id, p_psid, 'open', true)
  ON CONFLICT (messenger_page_id, messenger_psid)
    WHERE messenger_page_id IS NOT NULL AND messenger_psid IS NOT NULL DO NOTHING;
  SELECT c.id INTO v_chat FROM public.extra_support_chats c
   WHERE c.messenger_page_id = p_page_id AND c.messenger_psid = p_psid FOR UPDATE;
  INSERT INTO public.extra_support_messages (chat_id, sender, body, staff_name, external_message_id, messenger_sent_at)
  VALUES (v_chat, 'staff', COALESCE(NULLIF(btrim(p_text), ''), '[Nhân viên đã gửi một tệp đính kèm]'),
          'Nhân viên Messenger', p_mid, v_at)
  ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message;
  IF v_message IS NULL THEN RETURN jsonb_build_object('outcome', 'duplicate', 'chat_id', v_chat); END IF;
  UPDATE public.extra_support_chats c SET messenger_ai_managed = true,
         messenger_last_human_at = GREATEST(c.messenger_last_human_at, c.last_staff_at)
   WHERE c.id = v_chat AND NOT c.messenger_ai_managed;
  SELECT max(m.id) INTO v_through FROM public.extra_support_messages m
   WHERE m.chat_id = v_chat AND m.sender = 'customer' AND COALESCE(m.messenger_sent_at, m.created_at) <= v_at;
  -- Out-of-order signed echoes are recorded but cannot shorten the most recent pause.
  PERFORM extra_messenger_private.record_staff_activity(v_chat, v_at, v_through, true);
  RETURN jsonb_build_object('outcome', 'recorded', 'chat_id', v_chat);
END;
$$;

-- An unknown outcome consumes its watermark but stays reconcilable by a signed Meta echo.
-- An explicit rejection can be retried; no transport timeout authorizes resending the same turn.
CREATE FUNCTION extra_messenger_private.settle_send(
  p_chat_id uuid, p_token uuid, p_sender text, p_status text, p_meta_mid text, p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_send extra_messenger_private.send_attempts%ROWTYPE;
  v_message bigint;
  v_delivery_at timestamptz;
BEGIN
  SELECT a.* INTO v_send FROM extra_messenger_private.send_attempts a
   WHERE a.chat_id = p_chat_id AND a.token = p_token AND a.sender = p_sender;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  IF v_send.status = 'sent' THEN
    RETURN jsonb_build_object('outcome', CASE WHEN p_status = 'sent' AND v_send.meta_mid IS DISTINCT FROM p_meta_mid THEN 'invalid' ELSE 'sent' END);
  END IF;
  IF p_status = 'retry' AND v_send.status IN ('composing', 'sending') THEN
    UPDATE extra_messenger_private.send_attempts SET status = 'retry' WHERE token = p_token;
    UPDATE public.extra_support_chats SET messenger_active_send = NULL WHERE id = p_chat_id AND messenger_active_send = p_token;
    RETURN jsonb_build_object('outcome', 'retry');
  END IF;
  IF v_send.status NOT IN ('sending', 'unknown') THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  v_delivery_at := LEAST(GREATEST(p_now, v_send.sending_at), v_send.lease_until);
  IF p_status = 'sent' THEN
    IF p_meta_mid IS NULL OR length(p_meta_mid) NOT BETWEEN 4 AND 200 THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
    INSERT INTO public.extra_support_messages (chat_id, sender, body, staff_name, external_message_id, created_at, messenger_sent_at)
    VALUES (p_chat_id, p_sender, v_send.body, v_send.staff_name, p_meta_mid, v_delivery_at, v_delivery_at)
    ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_message;
    IF v_message IS NULL THEN
      SELECT m.id INTO v_message FROM public.extra_support_messages m
       WHERE m.external_message_id = p_meta_mid AND m.chat_id = p_chat_id AND m.sender = p_sender;
      IF v_message IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
    END IF;
  ELSIF p_status = 'unknown' THEN
    IF v_send.status = 'unknown' THEN RETURN jsonb_build_object('outcome', 'unknown'); END IF;
  ELSIF p_status IS DISTINCT FROM 'rejected' OR v_send.status <> 'sending' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  UPDATE extra_messenger_private.send_attempts SET status = p_status, meta_mid = p_meta_mid WHERE token = p_token;
  UPDATE public.extra_support_chats SET messenger_active_send = NULL WHERE id = p_chat_id AND messenger_active_send = p_token;
  IF p_sender = 'ai' THEN
    UPDATE public.extra_support_chats c
       SET messenger_ai_context = CASE WHEN v_send.through_message_id >= c.messenger_handled_message_id THEN v_send.context ELSE c.messenger_ai_context END,
           messenger_ai_greeted = c.messenger_ai_greeted OR (p_status <> 'rejected' AND v_send.greeted),
           messenger_ai_disclosed = c.messenger_ai_disclosed OR (p_status <> 'rejected' AND v_send.ai_disclosed),
           messenger_handled_message_id = GREATEST(c.messenger_handled_message_id, v_send.through_message_id),
           messenger_last_ai_at = CASE WHEN p_status = 'sent' THEN GREATEST(c.messenger_last_ai_at, v_delivery_at) ELSE c.messenger_last_ai_at END,
           updated_at = CASE WHEN p_status = 'sent' THEN GREATEST(c.updated_at, v_delivery_at) ELSE c.updated_at END
     WHERE c.id = p_chat_id;
  ELSIF p_status <> 'rejected' THEN
    -- A delayed acknowledgement of an uncertain staff send must not reset a pause later than the actual send.
    PERFORM extra_messenger_private.record_staff_activity(
      p_chat_id, CASE WHEN p_status = 'unknown' THEN v_send.sending_at ELSE v_delivery_at END,
      v_send.through_message_id, p_status = 'sent'
    );
  END IF;
  RETURN jsonb_build_object('outcome', p_status);
END;
$$;

CREATE FUNCTION extra_messenger_private.expire_attempt(p_chat_id uuid, p_token uuid, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_send extra_messenger_private.send_attempts%ROWTYPE;
BEGIN
  SELECT a.* INTO v_send FROM extra_messenger_private.send_attempts a
   WHERE a.chat_id = p_chat_id AND a.token = p_token AND a.lease_until <= p_now;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_send.status = 'sending' THEN
    PERFORM extra_messenger_private.settle_send(p_chat_id, p_token, v_send.sender, 'unknown', NULL, p_now);
  ELSIF v_send.status = 'composing' THEN
    PERFORM extra_messenger_private.settle_send(p_chat_id, p_token, v_send.sender, 'retry', NULL, p_now);
  END IF;
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_due(p_page_id text, p_limit integer, p_allowed_psids text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
  FROM (
    SELECT c.id AS chat_id, c.messenger_psid AS psid
      FROM public.extra_support_chats c
      LEFT JOIN extra_messenger_private.send_attempts a ON a.token = c.messenger_active_send
     WHERE c.messenger_ai_managed AND c.messenger_page_id = p_page_id AND c.status = 'open'
       AND (p_allowed_psids IS NULL OR c.messenger_psid = ANY (p_allowed_psids))
       AND NOT c.messenger_human_requested
       AND NOT extra_messenger_private.human_active(c.messenger_last_human_at, statement_timestamp())
       AND COALESCE(a.lease_until <= statement_timestamp(), true)
       AND (
         (c.messenger_latest_customer_id > c.messenger_handled_message_id
           AND c.messenger_latest_customer_at > statement_timestamp() - INTERVAL '24 hours')
         OR c.assigned_staff_id IS NOT NULL
       )
     ORDER BY c.messenger_latest_customer_at, c.id
     LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 25), 100))
  ) d;
$$;

CREATE FUNCTION public.extra_messenger_ai_claim(p_chat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat public.extra_support_chats%ROWTYPE;
  v_now timestamptz;
  v_token uuid;
BEGIN
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND OR NOT v_chat.messenger_ai_managed THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  v_now := clock_timestamp();
  PERFORM extra_messenger_private.expire_attempt(p_chat_id, v_chat.messenger_active_send, v_now);
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id;
  IF v_chat.status <> 'open' THEN RETURN jsonb_build_object('outcome', 'closed'); END IF;
  IF v_chat.messenger_human_requested THEN RETURN jsonb_build_object('outcome', 'human_requested'); END IF;
  IF extra_messenger_private.human_active(v_chat.messenger_last_human_at, v_now) THEN RETURN jsonb_build_object('outcome', 'human_active'); END IF;
  IF v_chat.messenger_active_send IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  IF v_chat.assigned_staff_id IS NOT NULL THEN
    UPDATE public.extra_support_chats SET assigned_staff_id = NULL, assigned_at = NULL WHERE id = p_chat_id;
  END IF;
  IF v_chat.messenger_latest_customer_id <= v_chat.messenger_handled_message_id THEN RETURN jsonb_build_object('outcome', 'idle'); END IF;
  IF v_chat.messenger_latest_customer_at <= v_now - INTERVAL '24 hours' THEN RETURN jsonb_build_object('outcome', 'window_closed'); END IF;
  INSERT INTO extra_messenger_private.send_attempts (chat_id, sender, status, through_message_id, lease_until, referral_at)
  VALUES (p_chat_id, 'ai', 'composing', v_chat.messenger_latest_customer_id, v_now + INTERVAL '90 seconds', v_chat.messenger_referral_at)
  RETURNING token INTO v_token;
  UPDATE public.extra_support_chats SET messenger_active_send = v_token WHERE id = p_chat_id;
  RETURN jsonb_build_object(
    'outcome', 'claimed', 'chat_id', p_chat_id, 'psid', v_chat.messenger_psid, 'page_id', v_chat.messenger_page_id,
    'token', v_token, 'through_message_id', v_chat.messenger_latest_customer_id,
    'handled_message_id', v_chat.messenger_handled_message_id, 'context', v_chat.messenger_ai_context,
    'greeted', v_chat.messenger_ai_greeted, 'ai_disclosed', v_chat.messenger_ai_disclosed,
    'referral', v_chat.messenger_referral, 'last_human_at', v_chat.messenger_last_human_at,
    'last_ai_at', v_chat.messenger_last_ai_at, 'customer_latest_at', v_chat.messenger_latest_customer_at
  );
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_begin_send(
  p_chat_id uuid, p_token uuid, p_through_message_id bigint, p_body text, p_context jsonb,
  p_greeted boolean, p_ai_disclosed boolean
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat public.extra_support_chats%ROWTYPE;
  v_send extra_messenger_private.send_attempts%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF (p_body IS NOT NULL AND length(btrim(p_body)) NOT BETWEEN 1 AND 1200)
     OR p_context IS NULL OR jsonb_typeof(p_context) <> 'object' OR octet_length(p_context::text) > 32768
  THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND OR NOT v_chat.messenger_ai_managed OR v_chat.messenger_active_send IS DISTINCT FROM p_token
  THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  v_now := clock_timestamp();
  SELECT a.* INTO v_send FROM extra_messenger_private.send_attempts a
   WHERE a.token = p_token AND a.chat_id = p_chat_id AND a.sender = 'ai' AND a.status = 'composing';
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  IF v_send.lease_until <= v_now OR v_chat.status <> 'open' OR v_chat.messenger_human_requested
     OR extra_messenger_private.human_active(v_chat.messenger_last_human_at, v_now)
     OR v_chat.messenger_latest_customer_id IS DISTINCT FROM p_through_message_id
     OR v_send.through_message_id IS DISTINCT FROM p_through_message_id
     OR v_chat.messenger_handled_message_id >= p_through_message_id
     OR v_chat.messenger_referral_at IS DISTINCT FROM v_send.referral_at
     OR v_chat.messenger_latest_customer_at <= v_now - INTERVAL '24 hours'
  THEN
    UPDATE extra_messenger_private.send_attempts SET status = 'cancelled' WHERE token = p_token;
    UPDATE public.extra_support_chats SET messenger_active_send = NULL WHERE id = p_chat_id;
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;
  IF p_body IS NULL THEN
    UPDATE extra_messenger_private.send_attempts SET status = 'cancelled' WHERE token = p_token;
    UPDATE public.extra_support_chats SET messenger_active_send = NULL, messenger_ai_context = p_context,
           messenger_handled_message_id = p_through_message_id WHERE id = p_chat_id;
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
  UPDATE extra_messenger_private.send_attempts
     SET status = 'sending', sending_at = v_now, lease_until = v_now + INTERVAL '30 seconds', body = btrim(p_body),
         context = p_context, greeted = COALESCE(p_greeted, false), ai_disclosed = COALESCE(p_ai_disclosed, false)
   WHERE token = p_token;
  RETURN jsonb_build_object('outcome', 'ready');
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_finish(p_chat_id uuid, p_token uuid, p_status text, p_meta_mid text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  RETURN extra_messenger_private.settle_send(p_chat_id, p_token, 'ai', p_status, p_meta_mid, clock_timestamp());
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_confirm_echo(
  p_page_id text, p_psid text, p_token uuid, p_meta_mid text, p_sender text, p_sent_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat uuid;
BEGIN
  SELECT c.id INTO v_chat FROM public.extra_support_chats c
   WHERE c.messenger_page_id = p_page_id AND c.messenger_psid = p_psid AND c.messenger_ai_managed FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  RETURN extra_messenger_private.settle_send(v_chat, p_token, p_sender, 'sent', p_meta_mid,
    LEAST(COALESCE(p_sent_at, clock_timestamp()), clock_timestamp()));
END;
$$;

-- Staff preflight both verifies the inbox permission and supersedes an AI draft. Once a
-- Send API call is authorized, another integrated sender waits for settlement or expiry.
CREATE FUNCTION public.extra_messenger_ai_begin_staff_send(
  p_chat_id uuid, p_actor_id uuid, p_is_manager boolean, p_body text, p_staff_name text,
  p_request_id uuid DEFAULT NULL, p_seen_message_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  v_chat public.extra_support_chats%ROWTYPE;
  v_previous extra_messenger_private.send_attempts%ROWTYPE;
  v_now timestamptz;
  v_token uuid;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 2 AND 1200
  THEN RETURN jsonb_build_object('outcome', 'invalid_body'); END IF;
  IF p_staff_name IS NULL OR length(p_staff_name) > 100
  THEN RETURN jsonb_build_object('outcome', 'invalid_name'); END IF;
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND OR NOT v_chat.messenger_ai_managed THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_chat.status <> 'open' THEN RETURN jsonb_build_object('outcome', 'closed'); END IF;
  IF NOT COALESCE(p_is_manager, false) AND (p_actor_id IS NULL OR v_chat.assigned_staff_id IS DISTINCT FROM p_actor_id)
  THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  v_now := clock_timestamp();
  PERFORM extra_messenger_private.expire_attempt(p_chat_id, v_chat.messenger_active_send, v_now);
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id;
  IF p_request_id IS NOT NULL THEN
    SELECT a.* INTO v_previous FROM extra_messenger_private.send_attempts a
     WHERE a.chat_id = p_chat_id AND a.staff_request_id = p_request_id;
    IF FOUND THEN
      IF v_previous.body IS DISTINCT FROM btrim(p_body) OR v_previous.staff_name IS DISTINCT FROM p_staff_name
      THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
      IF v_previous.status IN ('sent', 'unknown', 'rejected') THEN RETURN jsonb_build_object('outcome', v_previous.status); END IF;
      IF v_previous.status <> 'retry' THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
    END IF;
  END IF;
  IF p_seen_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id = p_chat_id AND m.sender = 'ai' AND m.id > p_seen_message_id
  ) THEN RETURN jsonb_build_object('outcome', 'conversation_changed'); END IF;
  IF EXISTS (
    SELECT 1 FROM extra_messenger_private.send_attempts a WHERE a.chat_id = p_chat_id AND a.sender = 'ai'
     AND a.status = 'unknown' AND a.through_message_id >= v_chat.messenger_latest_customer_id
  ) THEN RETURN jsonb_build_object('outcome', 'delivery_unconfirmed'); END IF;
  IF v_chat.messenger_active_send IS NOT NULL THEN
    UPDATE extra_messenger_private.send_attempts SET status = 'cancelled'
     WHERE token = v_chat.messenger_active_send AND status = 'composing';
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  END IF;
  IF v_previous.token IS NOT NULL THEN
    UPDATE extra_messenger_private.send_attempts SET staff_request_id = NULL WHERE token = v_previous.token;
  END IF;
  INSERT INTO extra_messenger_private.send_attempts (chat_id, sender, status, through_message_id, lease_until, sending_at, body, staff_name, staff_request_id)
  VALUES (p_chat_id, 'staff', 'sending', v_chat.messenger_latest_customer_id, v_now + INTERVAL '30 seconds', v_now, btrim(p_body), p_staff_name, p_request_id)
  RETURNING token INTO v_token;
  UPDATE public.extra_support_chats SET messenger_active_send = v_token WHERE id = p_chat_id;
  PERFORM extra_messenger_private.record_staff_activity(p_chat_id, v_now, NULL, false);
  RETURN jsonb_build_object('outcome', 'ready', 'token', v_token);
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_finish_staff_send(p_chat_id uuid, p_token uuid, p_status text, p_meta_mid text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  RETURN extra_messenger_private.settle_send(p_chat_id, p_token, 'staff', p_status, p_meta_mid, clock_timestamp());
END;
$$;

CREATE FUNCTION extra_messenger_private.cancel_draft(p_chat_id uuid, p_token uuid, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE v_phase text;
BEGIN
  IF p_token IS NULL THEN RETURN true; END IF;
  PERFORM extra_messenger_private.expire_attempt(p_chat_id, p_token, p_now);
  SELECT a.status INTO v_phase FROM extra_messenger_private.send_attempts a
   WHERE a.token = p_token AND a.chat_id = p_chat_id;
  IF v_phase = 'sending' THEN RETURN false; END IF;
  UPDATE extra_messenger_private.send_attempts SET status = 'cancelled' WHERE token = p_token AND status = 'composing';
  UPDATE public.extra_support_chats SET messenger_active_send = NULL WHERE id = p_chat_id AND messenger_active_send = p_token;
  RETURN true;
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_takeover(p_chat_id uuid, p_actor_id uuid, p_is_manager boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE v_chat public.extra_support_chats%ROWTYPE; v_now timestamptz;
BEGIN
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND OR NOT v_chat.messenger_ai_managed THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_chat.status <> 'open' THEN RETURN jsonb_build_object('outcome', 'closed'); END IF;
  IF NOT COALESCE(p_is_manager, false) AND (p_actor_id IS NULL OR v_chat.assigned_staff_id IS DISTINCT FROM p_actor_id)
  THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  v_now := clock_timestamp();
  IF NOT extra_messenger_private.cancel_draft(p_chat_id, v_chat.messenger_active_send, v_now)
  THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  PERFORM extra_messenger_private.record_staff_activity(p_chat_id, v_now, NULL, false);
  RETURN jsonb_build_object('outcome', 'taken_over');
END;
$$;

CREATE FUNCTION public.extra_messenger_ai_release_human(p_chat_id uuid, p_actor_id uuid, p_is_manager boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE v_chat public.extra_support_chats%ROWTYPE;
BEGIN
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND OR NOT v_chat.messenger_ai_managed THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_chat.status <> 'open' THEN RETURN jsonb_build_object('outcome', 'closed'); END IF;
  IF NOT COALESCE(p_is_manager, false) AND (p_actor_id IS NULL OR v_chat.assigned_staff_id IS DISTINCT FROM p_actor_id)
  THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  IF v_chat.messenger_human_requested THEN RETURN jsonb_build_object('outcome', 'human_requested'); END IF;
  IF NOT extra_messenger_private.cancel_draft(p_chat_id, v_chat.messenger_active_send, clock_timestamp())
  THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  UPDATE public.extra_support_chats SET messenger_last_human_at = NULL, assigned_staff_id = NULL, assigned_at = NULL
   WHERE id = p_chat_id;
  RETURN jsonb_build_object('outcome', 'released');
END;
$$;

-- Keep website/legacy allocation. Managed Messenger stays AI-first unless a customer
-- requests a human, or a staff member explicitly claims/transfers the conversation.
CREATE OR REPLACE FUNCTION public.extra_support_dispatch_queue(p_limit integer DEFAULT 64)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_chat uuid; v_result jsonb; v_assigned integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(48723, 8015);
  FOR v_chat IN
    SELECT c.id FROM public.extra_support_chats c
     WHERE c.status = 'open' AND c.assigned_staff_id IS NULL
       AND (NOT c.messenger_ai_managed OR c.messenger_human_requested)
     ORDER BY c.created_at, c.id LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 64), 128))
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_result := public.extra_support_assign_chat(v_chat, NULL, NULL, false);
    IF v_result->>'outcome' = 'assigned' THEN v_assigned := v_assigned + 1;
    ELSIF v_result->>'outcome' = 'no_capacity' THEN EXIT;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('assigned', v_assigned);
END;
$$;

CREATE OR REPLACE FUNCTION public.extra_support_staff_route(
  p_chat_id uuid, p_actor_id uuid, p_is_manager boolean, p_mode text, p_target uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_chat public.extra_support_chats%ROWTYPE; v_result jsonb; v_now timestamptz;
BEGIN
  IF p_mode NOT IN ('claim', 'transfer', 'auto') THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  PERFORM pg_advisory_xact_lock(48723, 8015);
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_chat.status <> 'open' THEN RETURN jsonb_build_object('outcome', 'closed'); END IF;
  IF p_mode = 'claim' THEN
    IF v_chat.assigned_staff_id IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'already_assigned'); END IF;
    IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff_accounts s WHERE s.id = p_actor_id AND s.role = 'sale' AND s.active)
    THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  ELSIF NOT COALESCE(p_is_manager, false) AND (p_actor_id IS NULL OR v_chat.assigned_staff_id IS DISTINCT FROM p_actor_id)
  THEN RETURN jsonb_build_object('outcome', 'forbidden');
  ELSIF p_mode = 'transfer' AND p_target IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid_target');
  END IF;
  v_now := clock_timestamp();
  IF v_chat.messenger_ai_managed AND NOT extra_messenger_private.cancel_draft(p_chat_id, v_chat.messenger_active_send, v_now)
  THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  CASE p_mode
    WHEN 'claim' THEN v_result := public.extra_support_assign_chat(p_chat_id, p_actor_id);
    WHEN 'auto' THEN v_result := public.extra_support_assign_chat(p_chat_id, NULL, v_chat.assigned_staff_id, false);
    WHEN 'transfer' THEN v_result := public.extra_support_assign_chat(p_chat_id, p_target, NULL, false);
  END CASE;
  IF v_chat.messenger_ai_managed AND v_result->>'outcome' = 'assigned' THEN
    PERFORM extra_messenger_private.record_staff_activity(p_chat_id, v_now, NULL, false);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.extra_support_staff_status(
  p_chat_id uuid, p_actor_id uuid, p_is_manager boolean, p_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_chat public.extra_support_chats%ROWTYPE; v_assign jsonb; v_queue jsonb;
BEGIN
  IF p_status NOT IN ('open', 'closed') THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  PERFORM pg_advisory_xact_lock(48723, 8015);
  SELECT c.* INTO v_chat FROM public.extra_support_chats c WHERE c.id = p_chat_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF NOT COALESCE(p_is_manager, false) AND (p_actor_id IS NULL OR v_chat.assigned_staff_id IS DISTINCT FROM p_actor_id)
  THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  IF p_status = 'open' AND NOT COALESCE(p_is_manager, false) THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
  IF v_chat.messenger_ai_managed AND NOT extra_messenger_private.cancel_draft(p_chat_id, v_chat.messenger_active_send, clock_timestamp())
  THEN RETURN jsonb_build_object('outcome', 'busy'); END IF;
  UPDATE public.extra_support_chats SET status = p_status, assigned_staff_id = NULL, assigned_at = NULL, updated_at = now()
   WHERE id = p_chat_id;
  IF p_status = 'open' THEN
    IF NOT v_chat.messenger_ai_managed OR v_chat.messenger_human_requested THEN
      v_assign := public.extra_support_assign_chat(p_chat_id);
    END IF;
    RETURN jsonb_build_object('outcome', 'updated', 'status', p_status, 'assignment', v_assign);
  END IF;
  v_queue := public.extra_support_dispatch_queue(64);
  RETURN jsonb_build_object('outcome', 'updated', 'status', p_status, 'queue', v_queue);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA extra_messenger_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extra_messenger_private TO service_role;
REVOKE ALL ON FUNCTION
  public.extra_messenger_ai_ingest(text, text, text, text, timestamptz, jsonb, boolean),
  public.extra_messenger_ai_record_referral(text, text, jsonb, timestamptz),
  public.extra_messenger_ai_record_human_echo(text, text, text, text, timestamptz),
  public.extra_messenger_ai_due(text, integer, text[]),
  public.extra_messenger_ai_claim(uuid),
  public.extra_messenger_ai_begin_send(uuid, uuid, bigint, text, jsonb, boolean, boolean),
  public.extra_messenger_ai_finish(uuid, uuid, text, text),
  public.extra_messenger_ai_confirm_echo(text, text, uuid, text, text, timestamptz),
  public.extra_messenger_ai_begin_staff_send(uuid, uuid, boolean, text, text, uuid, bigint),
  public.extra_messenger_ai_finish_staff_send(uuid, uuid, text, text),
  public.extra_messenger_ai_takeover(uuid, uuid, boolean),
  public.extra_messenger_ai_release_human(uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.extra_messenger_ai_ingest(text, text, text, text, timestamptz, jsonb, boolean),
  public.extra_messenger_ai_record_referral(text, text, jsonb, timestamptz),
  public.extra_messenger_ai_record_human_echo(text, text, text, text, timestamptz),
  public.extra_messenger_ai_due(text, integer, text[]),
  public.extra_messenger_ai_claim(uuid),
  public.extra_messenger_ai_begin_send(uuid, uuid, bigint, text, jsonb, boolean, boolean),
  public.extra_messenger_ai_finish(uuid, uuid, text, text),
  public.extra_messenger_ai_confirm_echo(text, text, uuid, text, text, timestamptz),
  public.extra_messenger_ai_begin_staff_send(uuid, uuid, boolean, text, text, uuid, bigint),
  public.extra_messenger_ai_finish_staff_send(uuid, uuid, text, text),
  public.extra_messenger_ai_takeover(uuid, uuid, boolean),
  public.extra_messenger_ai_release_human(uuid, uuid, boolean)
TO service_role;

CREATE TABLE extra_messenger_private.seat_map_delivery (
  chat_id uuid NOT NULL REFERENCES public.extra_support_chats(id) ON DELETE CASCADE,
  venue text NOT NULL CHECK (venue IN ('ccc','laocai')),
  token uuid NOT NULL REFERENCES extra_messenger_private.send_attempts(token),
  status text NOT NULL CHECK (status IN ('sending','sent','unknown','rejected')),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id,venue)
);
ALTER TABLE extra_messenger_private.seat_map_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON extra_messenger_private.seat_map_delivery FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON extra_messenger_private.seat_map_delivery TO service_role;

CREATE FUNCTION public.extra_messenger_ai_seat_map(p_chat_id uuid,p_token uuid,p_venue text,p_action text,p_repeat boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE claimed uuid;
BEGIN
  IF p_action='claim' THEN
    -- The matching, acknowledged text attempt belongs to this receiver and latest inbound message.
    PERFORM c.id FROM public.extra_support_chats c JOIN extra_messenger_private.send_attempts a ON a.chat_id=c.id
      WHERE c.id=p_chat_id AND a.token=p_token AND a.sender='ai' AND a.status='sent'
        AND c.messenger_ai_managed AND c.status='open' AND NOT c.messenger_human_requested
        AND a.through_message_id=c.messenger_latest_customer_id AND c.messenger_active_send IS NULL
        AND (c.messenger_last_human_at IS NULL OR c.messenger_last_human_at<a.sending_at)
        AND c.messenger_latest_customer_at > now()-interval '24 hours' FOR UPDATE OF c;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome','skip'); END IF;
    INSERT INTO extra_messenger_private.seat_map_delivery AS d(chat_id,venue,token,status)
      VALUES(p_chat_id,p_venue,p_token,'sending')
      ON CONFLICT(chat_id,venue) DO UPDATE SET token=excluded.token,status='sending',started_at=now()
      WHERE d.token<>excluded.token AND (d.status='rejected' OR
        (p_repeat AND (d.status IN ('sent','unknown') OR d.started_at<now()-interval '2 minutes')))
      RETURNING token INTO claimed;
    RETURN jsonb_build_object('outcome',CASE WHEN claimed IS NULL THEN 'skip' ELSE 'send' END);
  ELSIF p_action IN ('sent','unknown','rejected') THEN
    UPDATE extra_messenger_private.seat_map_delivery SET status=p_action
      WHERE chat_id=p_chat_id AND venue=p_venue AND token=p_token AND status='sending';
    RETURN jsonb_build_object('outcome','settled');
  END IF;
  RETURN jsonb_build_object('outcome','invalid');
END;
$$;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_seat_map(uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_seat_map(uuid,uuid,text,text,boolean) TO service_role;

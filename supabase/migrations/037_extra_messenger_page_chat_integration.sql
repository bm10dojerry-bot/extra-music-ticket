-- Integrate authenticated Messenger Page conversations into existing support inbox.
ALTER TABLE public.extra_support_chats
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS messenger_page_id text,
  ADD COLUMN IF NOT EXISTS messenger_psid text;
ALTER TABLE public.extra_support_messages
  ADD COLUMN IF NOT EXISTS external_message_id text;
DO $check$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='extra_support_chats_channel_check') THEN
  ALTER TABLE public.extra_support_chats ADD CONSTRAINT extra_support_chats_channel_check
   CHECK (channel IN ('website','messenger'));
 END IF;
END
$check$;
CREATE UNIQUE INDEX IF NOT EXISTS extra_support_messenger_identity_idx
  ON public.extra_support_chats(messenger_page_id,messenger_psid)
  WHERE messenger_page_id IS NOT NULL AND messenger_psid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS extra_support_external_mid_idx
  ON public.extra_support_messages(external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.extra_support_ingest_messenger(
 p_page_id text, p_psid text, p_mid text, p_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $messenger$
DECLARE
 v_chat uuid;
 v_message bigint;
 v_status text;
BEGIN
 IF p_page_id !~ '^[0-9]{5,40}$' OR p_psid !~ '^[0-9]{5,80}$'
    OR p_mid IS NULL OR char_length(p_mid) NOT BETWEEN 4 AND 200
    OR p_text IS NULL OR char_length(btrim(p_text)) NOT BETWEEN 1 AND 1200
 THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_page_id),hashtext(p_psid));
 SELECT c.id,c.status INTO v_chat,v_status
  FROM public.extra_support_chats c
  WHERE c.messenger_page_id=p_page_id AND c.messenger_psid=p_psid
  FOR UPDATE;
 IF v_chat IS NULL THEN
   INSERT INTO public.extra_support_chats
   (access_hash,customer_name,channel,messenger_page_id,messenger_psid,status)
   VALUES(encode(gen_random_bytes(32),'hex'),'Khách Messenger','messenger',p_page_id,p_psid,'open')
   RETURNING id INTO v_chat;
 END IF;
 INSERT INTO public.extra_support_messages(chat_id,sender,body,external_message_id)
 VALUES(v_chat,'customer',btrim(p_text),p_mid)
 ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
 RETURNING id INTO v_message;
 IF v_message IS NULL THEN
   RETURN jsonb_build_object('outcome','duplicate','chat_id',v_chat);
 END IF;
 UPDATE public.extra_support_chats
 SET updated_at=now(),last_customer_at=now(),status='open',
  assigned_staff_id=CASE WHEN v_status='closed' THEN NULL ELSE assigned_staff_id END,
  assigned_at=CASE WHEN v_status='closed' THEN NULL ELSE assigned_at END
 WHERE id=v_chat;
 RETURN jsonb_build_object('outcome','received','chat_id',v_chat,'message_id',v_message);
END;
$messenger$;
REVOKE ALL ON FUNCTION public.extra_support_ingest_messenger(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_ingest_messenger(text,text,text,text) TO service_role;

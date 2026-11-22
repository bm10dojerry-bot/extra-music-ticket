-- Atomic staff operations under the same advisory lock as automatic allocation.
CREATE OR REPLACE FUNCTION public.extra_support_staff_reply(
 p_chat_id uuid,p_actor_id uuid,p_is_manager boolean,p_body text,p_staff_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $chat$
DECLARE v_sale uuid;v_status text;
BEGIN
 IF p_body IS NULL OR char_length(btrim(p_body))<2 OR char_length(p_body)>1200
 THEN RETURN jsonb_build_object('outcome','invalid_body'); END IF;
 IF p_staff_name IS NULL OR char_length(p_staff_name)>100
 THEN RETURN jsonb_build_object('outcome','invalid_name'); END IF;
 PERFORM pg_advisory_xact_lock(48723,8015);
 SELECT c.assigned_staff_id,c.status INTO v_sale,v_status
 FROM public.extra_support_chats c WHERE c.id=p_chat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF v_status<>'open' THEN RETURN jsonb_build_object('outcome','closed'); END IF;
 IF NOT COALESCE(p_is_manager,false) AND
     (p_actor_id IS NULL OR v_sale IS DISTINCT FROM p_actor_id)
 THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 INSERT INTO public.extra_support_messages(chat_id,sender,body,staff_name)
 VALUES(p_chat_id,'staff',btrim(p_body),p_staff_name);
 UPDATE public.extra_support_chats
 SET updated_at=now(),last_staff_at=now() WHERE id=p_chat_id;
 RETURN jsonb_build_object('outcome','sent');
END;
$chat$;
REVOKE ALL ON FUNCTION public.extra_support_staff_reply(uuid,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_staff_reply(uuid,uuid,boolean,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.extra_support_staff_status(
 p_chat_id uuid,p_actor_id uuid,p_is_manager boolean,p_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $chat$
DECLARE v_assigned uuid;v_current text;v_assign jsonb;v_queue jsonb;
BEGIN
 IF p_status NOT IN ('open','closed') THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(48723,8015);
 SELECT c.assigned_staff_id,c.status INTO v_assigned,v_current
 FROM public.extra_support_chats c WHERE c.id=p_chat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF NOT COALESCE(p_is_manager,false) AND
   (p_actor_id IS NULL OR v_assigned IS DISTINCT FROM p_actor_id)
 THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 IF p_status='open' THEN
   IF NOT COALESCE(p_is_manager,false) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
   UPDATE public.extra_support_chats SET status='open',assigned_staff_id=NULL,
          assigned_at=NULL,updated_at=now() WHERE id=p_chat_id;
   v_assign:=public.extra_support_assign_chat(p_chat_id);
   RETURN jsonb_build_object('outcome','updated','status','open','assignment',v_assign);
 END IF;
 UPDATE public.extra_support_chats SET status='closed',assigned_staff_id=NULL,
      assigned_at=NULL,updated_at=now() WHERE id=p_chat_id;
 v_queue:=public.extra_support_dispatch_queue(64);
 RETURN jsonb_build_object('outcome','updated','status','closed','queue',v_queue);
END;
$chat$;
REVOKE ALL ON FUNCTION public.extra_support_staff_status(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_staff_status(uuid,uuid,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.extra_support_staff_route(
 p_chat_id uuid,p_actor_id uuid,p_is_manager boolean,p_mode text,p_target uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $chat$
DECLARE v_current uuid;v_status text;v_result jsonb;
BEGIN
 IF p_mode NOT IN ('claim','transfer','auto') THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(48723,8015);
 SELECT c.assigned_staff_id,c.status INTO v_current,v_status FROM public.extra_support_chats c
 WHERE c.id=p_chat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF v_status<>'open' THEN RETURN jsonb_build_object('outcome','closed'); END IF;
 IF p_mode='claim' THEN
  IF v_current IS NOT NULL THEN RETURN jsonb_build_object('outcome','already_assigned'); END IF;
  IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.staff_accounts
      WHERE id=p_actor_id AND role='sale' AND active) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
  RETURN public.extra_support_assign_chat(p_chat_id,p_actor_id);
 END IF;
 IF NOT COALESCE(p_is_manager,false) AND (p_actor_id IS NULL OR v_current IS DISTINCT FROM p_actor_id)
 THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 IF p_mode='auto' THEN
   RETURN public.extra_support_assign_chat(p_chat_id,NULL,v_current,false);
 END IF;
 IF p_target IS NULL THEN RETURN jsonb_build_object('outcome','invalid_target'); END IF;
 RETURN public.extra_support_assign_chat(p_chat_id,p_target,NULL,false);
END;
$chat$;
REVOKE ALL ON FUNCTION public.extra_support_staff_route(uuid,uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_staff_route(uuid,uuid,boolean,text,uuid) TO service_role;

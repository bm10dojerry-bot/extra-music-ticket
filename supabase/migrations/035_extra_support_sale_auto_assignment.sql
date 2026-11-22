-- Automatic, concurrency-safe chat allocation (8 open chats per active Sale).
ALTER TABLE public.extra_support_chats
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
CREATE INDEX IF NOT EXISTS extra_support_active_assignment_idx
 ON public.extra_support_chats(assigned_staff_id,updated_at DESC) WHERE status='open';
CREATE INDEX IF NOT EXISTS extra_support_unassigned_queue_idx
 ON public.extra_support_chats(created_at) WHERE status='open' AND assigned_staff_id IS NULL;

CREATE OR REPLACE FUNCTION public.extra_support_assign_chat(
  p_chat_id uuid,
  p_target_sale_id uuid DEFAULT NULL,
  p_exclude_sale_id uuid DEFAULT NULL,
  p_release boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $support$
DECLARE
 v_current uuid;
 v_status text;
 v_target uuid;
 v_assigned integer;
BEGIN
 -- Serialize all assignment decisions, including transfers and queue dispatch.
 PERFORM pg_advisory_xact_lock(48723,8015);
 SELECT c.assigned_staff_id,c.status INTO v_current,v_status
 FROM public.extra_support_chats c WHERE c.id=p_chat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF p_release THEN
   UPDATE public.extra_support_chats
   SET assigned_staff_id=NULL,assigned_at=NULL,updated_at=now() WHERE id=p_chat_id;
   RETURN jsonb_build_object('outcome','released');
 END IF;
 IF v_status<>'open' THEN RETURN jsonb_build_object('outcome','closed'); END IF;
 IF p_target_sale_id IS NULL AND v_current IS NOT NULL
   AND (p_exclude_sale_id IS NULL OR v_current<>p_exclude_sale_id)
   AND EXISTS(SELECT 1 FROM public.staff_accounts s
       WHERE s.id=v_current AND s.active AND s.role='sale')
 THEN RETURN jsonb_build_object('outcome','already_assigned','staff_id',v_current); END IF;
 IF p_target_sale_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.staff_accounts s
     WHERE s.id=p_target_sale_id AND s.active AND s.role='sale')
  THEN RETURN jsonb_build_object('outcome','invalid_target'); END IF;
  SELECT COUNT(*) INTO v_assigned FROM public.extra_support_chats c
   WHERE c.assigned_staff_id=p_target_sale_id AND c.status='open' AND c.id<>p_chat_id;
  IF v_assigned>=8 THEN RETURN jsonb_build_object('outcome','full','max',8); END IF;
  v_target:=p_target_sale_id;
 ELSE
  SELECT s.id INTO v_target
  FROM public.staff_accounts s
  CROSS JOIN LATERAL (
     SELECT COUNT(*) AS count_open FROM public.extra_support_chats c
     WHERE c.assigned_staff_id=s.id AND c.status='open' AND c.id<>p_chat_id
  ) load
  WHERE s.role='sale' AND s.active=true
    AND (p_exclude_sale_id IS NULL OR s.id<>p_exclude_sale_id)
    AND load.count_open<8
  ORDER BY load.count_open ASC,
    COALESCE((SELECT MAX(c2.assigned_at) FROM public.extra_support_chats c2
              WHERE c2.assigned_staff_id=s.id),'epoch'::timestamptz) ASC,
    s.created_at ASC,s.id ASC LIMIT 1;
  IF v_target IS NULL THEN RETURN jsonb_build_object('outcome','no_capacity','max',8); END IF;
 END IF;
 UPDATE public.extra_support_chats
 SET assigned_staff_id=v_target,assigned_at=now(),updated_at=now()
 WHERE id=p_chat_id;
 RETURN jsonb_build_object('outcome','assigned','staff_id',v_target,'max',8);
END;
$support$;
REVOKE ALL ON FUNCTION public.extra_support_assign_chat(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_assign_chat(uuid,uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.extra_support_dispatch_queue(p_limit integer DEFAULT 64)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $support$
DECLARE
 v_chat uuid;
 v_result jsonb;
 v_assigned integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(48723,8015);
 FOR v_chat IN
  SELECT c.id FROM public.extra_support_chats c
  WHERE c.status='open' AND c.assigned_staff_id IS NULL
  ORDER BY c.created_at ASC,c.id ASC LIMIT GREATEST(0,LEAST(COALESCE(p_limit,64),128))
 LOOP
  v_result:=public.extra_support_assign_chat(v_chat,NULL,NULL,false);
  IF v_result->>'outcome'='assigned' THEN
   v_assigned:=v_assigned+1;
  ELSIF v_result->>'outcome'='no_capacity' THEN
   EXIT;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('assigned',v_assigned);
END;
$support$;
REVOKE ALL ON FUNCTION public.extra_support_dispatch_queue(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_dispatch_queue(integer) TO service_role;

-- Assign previously unassigned open conversations without touching message history.
SELECT public.extra_support_dispatch_queue(64);

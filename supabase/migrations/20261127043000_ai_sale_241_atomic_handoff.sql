-- AI Sale 2.4.1: atomic, lease-guarded handoff. Additive; old builds remain compatible.
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_handoff(
 p_job_id uuid, p_lease_token uuid, p_summary text, p_reason text,
 p_order_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE g jsonb; s jsonb; m jsonb;
BEGIN
 g:=public.extra_messenger_ai_guard(p_job_id,p_lease_token);
 IF g->>'outcome' IS DISTINCT FROM 'ok' THEN RETURN g; END IF;
 IF g->>'kind' IS DISTINCT FROM 'inbound' THEN
  RETURN jsonb_build_object('outcome','invalid_job_kind');
 END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN
  RETURN jsonb_build_object('outcome','reason_required');
 END IF;
 -- The guard holds the chat/job row locks until this RPC commits.
 -- Existing set_state rejects stale customer messages, invalid order ownership
 -- and records the owner notification; retain all those protections.
 s:=public.extra_messenger_ai_set_state(p_job_id,p_lease_token,'needs_attention',p_summary,p_reason,p_order_code);
 IF s->>'outcome' IS DISTINCT FROM 'updated' THEN RETURN s; END IF;
 -- Existing set_mode switches to manual and cancels pending inbound jobs.
 m:=public.extra_messenger_ai_set_mode((g->>'chat_id')::uuid,'manual');
 IF m->>'outcome' IS DISTINCT FROM 'updated' OR m->>'mode' IS DISTINCT FROM 'manual' THEN
  RAISE EXCEPTION 'AI handoff mode update failed';
 END IF;
 RETURN jsonb_build_object('outcome','updated','mode','manual','in_flight',COALESCE((m->>'in_flight')::boolean,false));
END
$function$;
REVOKE ALL ON FUNCTION public.extra_messenger_ai_handoff(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_messenger_ai_handoff(uuid,uuid,text,text,text) TO service_role;

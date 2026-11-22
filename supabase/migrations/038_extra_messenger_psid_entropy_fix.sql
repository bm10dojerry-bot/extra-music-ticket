DO $repair$
DECLARE fn text;old_part text;new_part text;
BEGIN
 SELECT pg_get_functiondef('public.extra_support_ingest_messenger(text,text,text,text)'::regprocedure) INTO fn;
 old_part:='encode(gen_random_bytes(32),''hex'')';
 new_part:='replace(gen_random_uuid()::text,''-'','''') || replace(gen_random_uuid()::text,''-'','''')';
 IF position(old_part IN fn)=0 THEN RAISE EXCEPTION 'Expected webhook function expression not found'; END IF;
 EXECUTE replace(fn,old_part,new_part);
END
$repair$;
REVOKE ALL ON FUNCTION public.extra_support_ingest_messenger(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extra_support_ingest_messenger(text,text,text,text) TO service_role;

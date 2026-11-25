-- Run on a disposable database after applying the migrations. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  campaign uuid;
  request_key uuid := gen_random_uuid();
  original_staff uuid;
  replacement uuid;
  task uuid;
  runner public.extra_os_jobs;
  monitor public.extra_os_jobs;
  result jsonb;
  upcoming text := to_char((now() + interval '20 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') || '+00:00';
  intake jsonb;
  jobs jsonb := '[
    {"kind":"ads","agent":"Ads","dependencies":[],"priority":100},
    {"kind":"ads_monitor","agent":"Ads","dependencies":[],"priority":20}
  ]';
  tasks jsonb;
begin
  if has_table_privilege('anon','public.extra_os_shows','SELECT')
    or has_table_privilege('authenticated','public.extra_os_reports','SELECT')
    or has_function_privilege('authenticated','public.extra_os_report(text,uuid,text,text,text[])','EXECUTE') then
    raise exception 'Public roles can access private EXTRA OS data';
  end if;
  insert into public.staff_accounts (username,display_name,role,password_hash)
    values ('os-staff-test-a','Original fixture','extra_os','fixture') returning id into original_staff;
  insert into public.staff_accounts (username,display_name,role,password_hash)
    values ('os-staff-test-b','Replacement fixture','extra_os','fixture') returning id into replacement;
  intake := jsonb_build_object('artist','Postgres fixture','venue','Test venue','venueId','ccc',
    'startsAt',upcoming,'capacity',550,'adsVnd',1000000,'permissions',jsonb_build_array('ads'));
  tasks := jsonb_build_array(jsonb_build_object('key','asset','department','media','title','Media task',
    'requirements','Check rights','acceptance','Ready','due_at',now()-interval '1 hour','budget_vnd',0,'drive_links',jsonb_build_array()));
  result := public.extra_os_start('owner',request_key,intake,'{}',jobs,tasks);
  campaign := (result->>'id')::uuid;
  result := public.extra_os_start('owner',request_key,intake,'{}',jobs,tasks);
  if result->>'id' <> campaign::text or (result->>'reused')::boolean is not true then
    raise exception 'Duplicate start created a new campaign';
  end if;
  begin
    perform public.extra_os_start('owner',gen_random_uuid(),intake,'{}',jobs,tasks);
    raise exception 'Duplicate venue/time/artist was accepted';
  exception when unique_violation then null;
  end;

  perform public.extra_os_assign('owner','media',original_staff);
  select id into task from public.extra_os_tasks t where t.show_id = campaign;
  perform public.extra_os_report(original_staff::text,task,'in_progress','Original update','{}');
  perform public.extra_os_assign('owner','media',replacement);
  if jsonb_array_length(public.extra_os_staff_work(original_staff::text)->'tasks') <> 0
    or (public.extra_os_staff_work(replacement::text)->'reports'->0->>'author_name') <> 'Original fixture' then
    raise exception 'Handover dropped history or left access for the previous staff member';
  end if;
  begin
    perform public.extra_os_report(original_staff::text,task,'blocked','Must fail','{}');
    raise exception 'Revoked account changed task';
  exception when insufficient_privilege then null;
  end;
  if public.extra_os_remind(campaign) <> 1 or public.extra_os_remind(campaign) <> 0 then
    raise exception 'An overdue task produced repeat alerts';
  end if;

  select * into runner from public.extra_os_claim(1) where show_id=campaign;
  if runner.kind is distinct from 'ads' then raise exception 'Expected the highest priority job'; end if;
  if public.extra_os_finish(runner.id,gen_random_uuid(),'succeeded','{}','',null) then
    raise exception 'Wrong worker acquired the job lease';
  end if;
  result := public.extra_os_reserve_ads(runner.id,runner.lease_token,'initial',700000,630000);
  if (result->>'limit_vnd')::bigint is distinct from 700000::bigint then raise exception 'Reserve failed'; end if;
  result := public.extra_os_reserve_ads(runner.id,runner.lease_token,'initial',700000,630000);
  if (select count(*) from public.extra_os_ad_allocations where show_id=campaign) <> 1 then raise exception 'A retried allocation was duplicated'; end if;
  select * into monitor from public.extra_os_claim(1) where show_id=campaign;
  if monitor.kind is distinct from 'ads_monitor' then raise exception 'A working job was claimed twice'; end if;
  if public.extra_os_reserve_ads(monitor.id,monitor.lease_token,'growth',500000,440000) is not null then
    raise exception 'Budget overspent';
  end if;
  perform public.extra_os_control('owner','system',true,null);
  if public.extra_os_lease_valid(runner.id,runner.lease_token) then raise exception 'System pause did not invalidate normal work'; end if;
  if not public.extra_os_lease_valid(monitor.id,monitor.lease_token) then raise exception 'Pause disabled the ad shutdown monitor'; end if;
end $$;

do $$
declare
  campaign uuid;
  worker public.extra_os_jobs;
  public_id text;
  starts timestamptz := now() + interval '23 days';
  prices jsonb := '{"A":400000,"B":350000,"C":300000,"D":250000}';
begin
  perform public.extra_os_control('owner','system',false,null);
  campaign := (public.extra_os_start('owner',gen_random_uuid(),jsonb_build_object(
    'artist','Published fixture','venue','CCC','venueId','ccc','capacity',550,'adsVnd',0,
    'startsAt',starts,'setlist','Sample song','permissions',jsonb_build_array('website','facebook')),
    jsonb_build_object('layoutMatches',true,'feasibility','feasible','prices',prices),
    '[{"kind":"website","agent":"Director","priority":200,"dependencies":[]}]','[]')->>'id')::uuid;
  select * into worker from public.extra_os_claim(1) where show_id=campaign;
  public_id := 'extra-os-' || campaign::text;
  if public.extra_os_publish_site(worker.id,worker.lease_token,public_id,prices) <> public_id
    or public.extra_os_publish_site(worker.id,worker.lease_token,public_id,prices) <> public_id then
    raise exception 'Website publication was not idempotent';
  end if;
  if (select setlist from public.show_landing_content where show_id=public_id) is distinct from 'Sample song' then
    raise exception 'Published show lost its set list';
  end if;
  insert into public.extra_os_effects (show_id,key,provider_id,detail)
    values (campaign,'facebook-feed','12345_67890','{"pageId":"12345"}');
  if public.extra_os_messenger_show('12345','','67890') <> array[public_id]
    or public.extra_os_messenger_show('54321','','67890') <> '{}'::text[] then
    raise exception 'Messenger did not resolve the id under its own Page';
  end if;
end $$;
rollback;

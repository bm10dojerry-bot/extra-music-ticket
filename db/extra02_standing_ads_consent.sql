-- Standing marketing consent is account-scoped. The provider still checks its grant on each write.
alter table public.extra_marketing_settings
 add column standing_ads_account_id text,
 add constraint extra_marketing_standing_ads_scope check (
   standing_ads_account_id is null or
   (account_id is not null and standing_ads_account_id=account_id and page_id='1223940670813189')
 );

create function public.extra_marketing_ads_authorized(s public.extra_marketing_settings, as_of timestamptz default now())
returns boolean language sql stable set search_path to pg_catalog,public
as $function$
 select coalesce(s.advertising_ready and s.account_id is not null
   and s.advertising_checked_at is not null
   and s.advertising_checked_at <= as_of + interval '1 minute'
   and (s.standing_ads_account_id=s.account_id or s.advertising_checked_at >= as_of - interval '24 hours'),false);
$function$;
revoke all on function public.extra_marketing_ads_authorized(public.extra_marketing_settings,timestamptz) from public,anon,authenticated;
grant execute on function public.extra_marketing_ads_authorized(public.extra_marketing_settings,timestamptz) to service_role;

-- Keep the deployed budget, targeting, publishing and idempotency rules intact.
do $migration$
declare patch record; source text;
begin
 for patch in select * from (values
   ('public.extra_marketing_reserve(uuid,date,text,bigint,text)',
    $$NOT s.advertising_ready OR s.account_id IS NULL OR s.advertising_checked_at IS NULL OR s.advertising_checked_at<now()-interval '24 hours'$$,
    $$NOT public.extra_marketing_ads_authorized(s)$$),
   ('public.extra_marketing_begin_action(text,uuid,uuid,jsonb,text)',
    $$NOT s.advertising_ready OR s.advertising_checked_at IS NULL OR s.advertising_checked_at<now()-interval '24 hours'$$,
    $$NOT public.extra_marketing_ads_authorized(s)$$),
   ('public.extra_marketing_read_contract()',
    $$'settings',to_jsonb(s),$$,
    $$'settings',to_jsonb(s)||jsonb_build_object('advertising_authorization_valid',public.extra_marketing_ads_authorized(s)),$$),
   ('public.extra_marketing_configure(jsonb)',
    $$  advertising_ready=CASE$$,
    $$  standing_ads_account_id=CASE WHEN v_account IS DISTINCT FROM s.account_id OR (p_patch?'advertising_ready' AND (p_patch->>'advertising_ready')::boolean IS FALSE) THEN NULL ELSE s.standing_ads_account_id END,
  advertising_ready=CASE$$)
 ) patches(signature,before_text,after_text)
 loop
  source:=pg_get_functiondef(patch.signature::regprocedure);
  if length(source)-length(replace(source,patch.before_text,'')) <> length(patch.before_text) then
   raise exception 'Unexpected definition of %',patch.signature;
  end if;
  execute replace(source,patch.before_text,patch.after_text);
 end loop;
end;
$migration$;

do $consent$
begin
 update public.extra_marketing_settings
 set standing_ads_account_id=account_id,updated_at=now()
 where id and page_id='1223940670813189' and account_id='1915621506464312'
   and advertising_ready and advertising_checked_at is not null;
 if not found then raise exception 'No verified advertising connection for the requested Page and account'; end if;
 insert into public.extra_marketing_actions(kind,dedupe_key,payload,state,reason,finished_at)
 values ('configure','configure:standing-ads-extra02-20261125',
         jsonb_build_object('standing_ads_account_id','1915621506464312','page_id','1223940670813189'),
         'succeeded','Chủ quản cho phép luồng quảng cáo Extra 02 tiếp tục dùng quyền đã xác minh đến khi thu hồi.',now());
end;
$consent$;

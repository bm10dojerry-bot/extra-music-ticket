-- Applied to the Music reporting schema. Inputs contain aggregated Meta campaign
-- figures only. The admin-web caller retains its existing report-only access.
alter table extra_os_reporting.music_ad_spend
  add column if not exists account_totals jsonb,
  add column if not exists campaign_rows jsonb;

create or replace function extra_os_reporting.record_meta_day(
  p_day date, p_fetched_at timestamptz, p_accounts jsonb, p_campaigns jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  grouped jsonb;
  affected integer;
begin
  if p_day is null or p_fetched_at is null
    or p_day>(p_fetched_at at time zone 'Asia/Ho_Chi_Minh')::date or p_fetched_at>now()+interval '1 minute'
    or jsonb_typeof(p_accounts) is distinct from 'object' or jsonb_typeof(p_campaigns) is distinct from 'array' then
    raise exception 'invalid Meta reporting day';
  end if;
  if not(p_accounts ?& array['1915621506464312','1482182900406200'])
    or (p_accounts-'1915621506464312'-'1482182900406200')<>'{}'::jsonb
    or exists (select from jsonb_each(p_accounts) e where jsonb_typeof(e.value)<>'number' or e.value::text !~ '^([0-9]{1,13})$')
    or jsonb_array_length(p_campaigns)>2000 then
    raise exception 'invalid Meta account coverage';
  end if;
  if exists(select from jsonb_array_elements(p_campaigns) r where jsonb_typeof(r)<>'object'
    or not(r ?& array['showId','accountId','campaignId','campaignName','spendVnd'])
    or r->>'accountId' is null or not(p_accounts ? (r->>'accountId'))
    or jsonb_typeof(r->'campaignId')<>'string' or r->>'campaignId' !~ '^[0-9]{5,30}$'
    or jsonb_typeof(r->'campaignName')<>'string' or length(r->>'campaignName') not between 1 and 500
    or jsonb_typeof(r->'spendVnd')<>'number' or (r->>'spendVnd') !~ '^([0-9]{1,13})$'
    or (jsonb_typeof(r->'showId')<>'null' and not exists(select from public.managed_shows s where s.id=r->>'showId'))
  ) or exists(select from jsonb_array_elements(p_campaigns) r group by r->>'accountId',r->>'campaignId',r->>'showId' having count(*)>1) then
    raise exception 'invalid or duplicate Meta campaign group';
  end if;
  if exists(select from jsonb_each_text(p_accounts) a where a.value::bigint <>
       (select coalesce(sum((r->>'spendVnd')::bigint),0) from jsonb_array_elements(p_campaigns) r where r->>'accountId'=a.key)) then
    raise exception 'campaign spend does not reconcile to both account totals';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('showId',show_id,'accountId',account_id,'spendVnd',spend,'campaigns',campaigns) order by show_id,account_id),'[]'::jsonb)
  into grouped from (
    select r->>'showId' show_id,r->>'accountId' account_id,sum((r->>'spendVnd')::bigint) spend,count(distinct r->>'campaignId') campaigns
    from jsonb_array_elements(p_campaigns) r where r->>'showId' is not null group by 1,2
  ) g;
  insert into extra_os_reporting.music_ad_spend(observed_day,fetched_at,rows,account_totals,campaign_rows)
    values (p_day,p_fetched_at,grouped,p_accounts,p_campaigns)
    on conflict(observed_day) do update set fetched_at=excluded.fetched_at,rows=excluded.rows,
      account_totals=excluded.account_totals,campaign_rows=excluded.campaign_rows
      where extra_os_reporting.music_ad_spend.fetched_at<excluded.fetched_at;
  get diagnostics affected=row_count;
  return affected=1;
end; $$;
revoke all on function extra_os_reporting.record_meta_day(date,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function extra_os_reporting.music_economics_v1()
returns jsonb language sql stable security invoker set search_path='' as $$
with bounds as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as day),
old_ads as (
  select r->>'showId' show_id, sum((r->>'spendVnd')::bigint) spend
  from extra_os_reporting.music_ad_spend a cross join bounds b cross join lateral jsonb_array_elements(a.rows) r
  where a.observed_day<b.day-6 group by 1
), snapshots as (
  select a.observed_day,a.fetched_at,a.account_totals,a.campaign_rows from extra_os_reporting.music_ad_spend a,bounds b
  where a.observed_day between b.day-6 and b.day and a.account_totals is not null
)
select jsonb_build_object('version',1,
  'priorTo',b.day-6,'oldAds',coalesce((select jsonb_object_agg(show_id,spend) from old_ads),'{}'::jsonb),
  'historyStart',(select min(observed_day) from extra_os_reporting.music_ad_spend where observed_day<=b.day),
  'costs',coalesce((select jsonb_agg(jsonb_build_object('showId',c.show_id,'updatedAt',c.updated_at,
    'categories',jsonb_build_object('artist_fee',c.artist_fee,'venue_fee',c.venue_fee,'sound_lighting',c.sound_lighting,
      'labor',c.labor,'advertising',c.advertising,'band',c.band,'tax',c.tax,'sale_commission',c.sale_commission,
      'logistics',c.logistics,'security',c.security,'miscellaneous',c.miscellaneous)) order by c.show_id)
    from public.show_financial_costs c),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('day',observed_day,'accounts',account_totals,
    'unassignedVnd',(select coalesce(sum((r->>'spendVnd')::bigint),0) from jsonb_array_elements(campaign_rows) r where r->>'showId' is null))
    order by observed_day) from snapshots),'[]'::jsonb),
  'campaigns',coalesce((select jsonb_agg(r order by r->>'showId',(r->>'spendVnd')::bigint desc)
    from snapshots s cross join lateral jsonb_array_elements(s.campaign_rows) r where s.observed_day=b.day and r->>'showId' is not null),'[]'::jsonb)
) from bounds b; $$;
revoke all on function extra_os_reporting.music_economics_v1() from public,anon,authenticated;
grant execute on function extra_os_reporting.music_economics_v1() to service_role;

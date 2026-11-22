-- Optional Google Ads purchase conversion settings per show.
-- Empty values are safe and do not load advertising tags.
alter table public.show_landing_content
  add column if not exists google_ads_id text not null default '',
  add column if not exists google_ads_conversion_label text not null default '';

alter table public.show_landing_content
  drop constraint if exists show_landing_google_ads_id_format;
alter table public.show_landing_content
  add constraint show_landing_google_ads_id_format
  check (google_ads_id = '' or google_ads_id ~ '^AW-[0-9]{6,20}$');

alter table public.show_landing_content
  drop constraint if exists show_landing_google_ads_label_format;
alter table public.show_landing_content
  add constraint show_landing_google_ads_label_format
  check (google_ads_conversion_label = '' or google_ads_conversion_label ~ '^[A-Za-z0-9_-]{4,100}$');

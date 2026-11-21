alter table public.show_landing_content add column if not exists meta_pixel_id text not null default '';
alter table public.show_landing_content add column if not exists ga4_measurement_id text not null default '';
alter table public.show_landing_content drop constraint if exists show_landing_meta_pixel_format;
alter table public.show_landing_content add constraint show_landing_meta_pixel_format check (meta_pixel_id = '' or meta_pixel_id ~ '^[0-9]{8,25}$');
alter table public.show_landing_content drop constraint if exists show_landing_ga4_format;
alter table public.show_landing_content add constraint show_landing_ga4_format check (ga4_measurement_id = '' or ga4_measurement_id ~ '^G-[A-Z0-9]{6,20}$');
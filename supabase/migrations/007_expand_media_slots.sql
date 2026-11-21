-- Run once in Supabase SQL Editor for the existing Extra Music database.
-- Extend the original 003_media_management.sql slot constraint to support
-- venue albums and separate transparent artist PNGs.
-- Existing site_media rows and images are preserved.
begin;
alter table public.site_media drop constraint if exists site_media_slot_check;
alter table public.site_media add constraint site_media_slot_check
check (slot in (
  'venue-moana','venue-ccc','venue-laocai',
  'venue-moana-2','venue-moana-3',
  'venue-ccc-2','venue-ccc-3',
  'venue-laocai-2','venue-laocai-3',
  'artist-dinh-dung-2811',
  'artist-minh-vuong-0512',
  'artist-trinh-dinh-quang-1212',
  'artist-khanh-phuong-1912',
  'artist-ho-quang-hieu-2412',
  'artist-khac-viet-2612',
  'artist-thai-hoc-3112'
));
commit;

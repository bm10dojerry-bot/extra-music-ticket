-- Artist images follow saved show IDs instead of the original seven-show list.
-- The upload API verifies that a nondefault show exists before writing Storage.
-- Keep existing media, bucket settings and service-only table access unchanged.
begin;
set local lock_timeout = '5s';

alter table public.site_media
  drop constraint site_media_slot_check,
  add constraint site_media_slot_check check (
    slot in (
      'banner-home-desktop', 'banner-home-mobile',
      'venue-moana', 'venue-ccc', 'venue-laocai',
      'venue-moana-2', 'venue-moana-3',
      'venue-ccc-2', 'venue-ccc-3',
      'venue-laocai-2', 'venue-laocai-3'
    )
    or slot ~ '^artist-[a-z0-9][a-z0-9-]{2,99}$'
  );

commit;

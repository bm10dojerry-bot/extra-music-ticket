-- Run once in Supabase SQL Editor.
create table if not exists public.site_media (
  slot text primary key check (slot in ('venue-moana','venue-ccc','venue-laocai')),
  image_path text not null,
  updated_at timestamptz not null default now()
);
alter table public.site_media enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('extra-media','extra-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy "Public can read Extra media" on storage.objects for select to anon,authenticated using (bucket_id='extra-media');
-- Writes are performed only by the server with the service role.

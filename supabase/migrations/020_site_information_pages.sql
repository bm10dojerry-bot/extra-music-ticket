create table if not exists public.site_information_pages (
 slug text primary key check (slug in ('gioi-thieu','tuyen-dung')),
 title text not null default '',
 body text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.site_information_pages enable row level security;
revoke all on public.site_information_pages from anon,authenticated;
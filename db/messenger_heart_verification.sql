create table public.extra_messenger_heart_verification (
 page_id text primary key,
 test_digest text check(test_digest ~ '^[a-f0-9]{64}$'),
 test_until timestamptz,
 attempted_at timestamptz,
 acknowledged_at timestamptz,
 verified_at timestamptz,
 check(verified_at is null or acknowledged_at is not null)
);
alter table public.extra_messenger_heart_verification enable row level security;
revoke all on public.extra_messenger_heart_verification from public,anon,authenticated;
grant select,insert,update on public.extra_messenger_heart_verification to service_role;
insert into public.extra_messenger_heart_verification(page_id) values ('1223940670813189');

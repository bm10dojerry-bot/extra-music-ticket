-- Run once in Supabase SQL Editor. Requires SQL 005.
alter table public.staff_accounts add column if not exists email text;
create unique index if not exists staff_accounts_email_unique on public.staff_accounts (lower(email)) where email is not null;
create table if not exists public.owner_credentials (
 id text primary key check (id='owner'),
 password_hash text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.password_reset_tokens (
 token_hash text primary key,
 account_kind text not null check (account_kind in ('owner','staff')),
 account_id text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists password_reset_account_idx on public.password_reset_tokens(account_kind,account_id,created_at desc);
alter table public.owner_credentials enable row level security;
alter table public.password_reset_tokens enable row level security;
-- Atomically claim a single-use token. Only service_role can execute.
create or replace function public.claim_password_reset(p_hash text)
returns table(account_kind text,account_id text)
language plpgsql security definer set search_path=public as $$
begin
 return query
 delete from public.password_reset_tokens t
 where t.token_hash=p_hash and t.expires_at>now()
 returning t.account_kind,t.account_id;
end $$;
revoke all on function public.claim_password_reset(text) from public,anon,authenticated;
grant execute on function public.claim_password_reset(text) to service_role;
